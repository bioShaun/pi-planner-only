import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";

const [arm, runId = "probe"] = process.argv.slice(2);
if (!/^S[12]-(native|lite)$/.test(arm ?? "")) throw new Error("expected S1-native, S1-lite, S2-native, or S2-lite");
if (!/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("invalid probe run id");
const [, mode] = arm.match(/S[12]-(native|lite)/);
const batchId = "20261028T054700+0800";
const root = `/project/tmp/pi-native-lite-${batchId}`;
const cwd = join(root, "worktrees", arm);
const results = join(root, "results", batchId, arm, `runtime-probe-${runId}`);
const sessionId = `nl-${batchId.replace(/[^A-Za-z0-9._-]/g, "-")}-${arm}-${runId}`;
const guard = join(resolve(new URL(".", import.meta.url).pathname), "budget-guard.ts");
const probe = join(resolve(new URL(".", import.meta.url).pathname), "runtime-probe.ts");
const piSubagents = "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js";
const registryModule = join(resolve(new URL(".", import.meta.url).pathname), "required-child-extensions-wrapper.mjs");
const pi = "/home/tcuni-claw/.pi/agent/bin/pi";

await mkdir(join(results, "session"), { recursive: true });
const env = { ...process.env };
for (const key of ["PI_OFFLINE", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SUBAGENT_RUNNER_PID", "PI_ASYNC_NATIVE_RUNNER", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL", "PI_SESSION_ID", "PI_SESSION_FILE"]) delete env[key];
Object.assign(env, {
	PI_OFFLINE: "1",
	PI_NATIVE_LITE_BATCH_ROOT: root,
	PI_NATIVE_LITE_BATCH_ID: batchId,
	PI_NATIVE_LITE_BUDGET_LEDGER: join(root, "budget-ledger.json"),
	PI_NATIVE_LITE_FINGERPRINT_LOG: join(results, "request-fingerprints.jsonl"),
	PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: registryModule,
	PI_SUBAGENTS_TEMP_ROOT: join(root, "tmp"),
	PI_PLANNER_ONLY_MODE: mode,
	PI_PLANNER_ONLY_STRICT: mode === "lite" ? "true" : "false",
	PI_PLANNER_ONLY_HANDOFF: "off",
	PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: "150000",
	PI_TELEMETRY: "0",
	TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
});
const args = [
	"--approve", "--mode", "rpc", "--session-dir", join(results, "session"), "--session-id", sessionId,
	"--model", "tcuni/gpt-6.1-terra", "--thinking", "high", "--no-extensions", "--no-mcp",
	"-e", piSubagents, "-e", join(cwd, "index.ts"), "-e", guard,
	"-e", join(resolve(new URL(".", import.meta.url).pathname), "request-fingerprint.ts"), "-e", probe,
];
const log = await open(join(results, "driver.jsonl"), "wx", 0o600);
const child = spawn(pi, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
const stdout = createInterface({ input: child.stdout });
const stderr = createInterface({ input: child.stderr });
let stateMatched = false;
let modelCommandSent = false;
let modelCommandSeen = false;
let probeSeen = false;
const write = (stream, line) => stream.write(`${line}\n`);
stderr.on("line", (line) => { write(process.stderr, line); });
stdout.on("line", (line) => {
	write(log, line);
	write(process.stdout, line);
	let event;
	try { event = JSON.parse(line); } catch { return; }
	if (event.type === "extension_ui_request" && event.method === "notify") {
		try {
			const data = JSON.parse(event.message);
			if (data.probe === "native-lite-batch-runtime" && data.sessionId === sessionId) probeSeen = true;
		} catch { }
	}
	if (event.type === "response" && event.id === "probe-state") {
		const state = event.data;
		stateMatched = event.success === true && state?.model?.provider === "tcuni" && state?.model?.id === "gpt-6.1-terra" && state?.thinkingLevel === "high" && state?.sessionId === sessionId;
		if (!stateMatched) { child.stdin.end(); return; }
		modelCommandSent = true;
		void child.stdin.write(`${JSON.stringify({ id: "probe-models", type: "prompt", message: "/subagents-models" })}\n`);
	}
	if (event.type === "message_end" && event.message?.role === "custom" && event.message.customType === "subagent-slash-result" && modelCommandSent) {
		modelCommandSeen = true;
		child.stdin.end();
	}
});
const deadline = setTimeout(() => child.kill("SIGTERM"), 15000);
child.stdin.write(`${JSON.stringify({ id: "probe-state", type: "get_state" })}\n`);
const exitCode = await new Promise((resolveExit, reject) => {
	child.once("error", reject);
	child.once("close", resolveExit);
});
clearTimeout(deadline);
await log.close();
if (exitCode !== 0 || !stateMatched || !modelCommandSeen || !probeSeen) {
	console.error(JSON.stringify({ arm, exitCode, stateMatched, modelCommandSeen, probeSeen }));
	process.exitCode = 1;
} else {
	console.error(JSON.stringify({ arm, exitCode, stateMatched, modelCommandSeen, probeSeen }));
}
