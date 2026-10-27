import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const batchId = "20261028T054700+0800";
const attemptId = "retry1";
const retryDir = resolve(new URL(".", import.meta.url).pathname);
const runner = join(retryDir, "run-rpc-arm.mjs");
const tempRoot = process.env.PI_NATIVE_LITE_TEST_TMP ?? `/project/tmp/pi-native-lite-${batchId}/tmp`;
await mkdir(tempRoot, { recursive: true });

const fakePi = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
writeFileSync(process.env.MOCK_ARGV_PATH, JSON.stringify({
  args, sessionId: value("--session-id"), sessionDir: value("--session-dir"), cwd: process.cwd(),
  mode: process.env.PI_PLANNER_ONLY_MODE, strict: process.env.PI_PLANNER_ONLY_STRICT,
  ledger: process.env.PI_NATIVE_LITE_BUDGET_LEDGER, tmp: process.env.TMPDIR,
  fingerprintLog: process.env.PI_NATIVE_LITE_FINGERPRINT_LOG,
  requiredExtensions: process.env.PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS,
  inheritedChild: process.env.PI_SUBAGENT_CHILD ?? null
}));
let buffer = "";
function emit(event) { process.stdout.write(JSON.stringify(event) + "\\n"); }
function line(raw) {
  const command = JSON.parse(raw);
  appendFileSync(process.env.MOCK_COMMANDS_PATH, JSON.stringify(command) + "\\n");
  if (command.type === "get_state") {
    if (process.env.MOCK_STATE === "timeout") return;
    emit({ id: command.id, type: "response", command: "get_state", success: true, data: {
      model: { provider: "tcuni", id: process.env.MOCK_STATE === "model" ? "gpt-6-luna" : "gpt-6.1-terra" },
      thinkingLevel: process.env.MOCK_STATE === "thinking" ? "medium" : "high",
      sessionId: process.env.MOCK_STATE === "session" ? "wrong-session" : value("--session-id")
    }});
  } else if (command.type === "prompt" && command.id === "p6-task") {
    emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
    emit({ type: "message_end", message: { role: "assistant", provider: "tcuni", model: "gpt-6.1-terra", stopReason: "stop", content: [{ type: "text", text: "fake root result" }] } });
    emit({ type: "agent_settled" });
  } else if (command.type === "prompt" && command.message === "/subagent-cost") {
    emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
    emit({ type: "message_end", message: { role: "custom", customType: "subagent-slash-text-result", content: "Subagent cost\\n\\nChild 1 (worker): ↑10 ↓5 $0.0010 (cache read 2, cache write 1, 1 turn)\\n────────────────────────────\\nChildren: ↑10 ↓5 $0.0010 (cache read 2, cache write 1, 1 turn)\\nTotal: ↑10 ↓5 $0.0010 (cache read 2, cache write 1, 1 turn)" } });
  }
}
process.stdin.on("data", chunk => { buffer += chunk; const lines = buffer.split("\\n"); buffer = lines.pop(); for (const value of lines) if (value) line(value); });
process.stdin.on("end", () => process.exit(0));
setTimeout(() => process.exit(0), 4000).unref();
`;

async function invoke({ state = "valid", config = "valid", repeat = false, armName = "S1-native" } = {}) {
	const root = await mkdtemp(join(tempRoot, "retry1-rpc-test-"));
	const checkout = join(root, "retry1-worktrees", config === "wrong-cwd" ? "not-an-arm" : armName);
	const arm = armName;
	const batchRoot = join(root, "batch-root");
	const tmp = join(root, "tmp");
	await mkdir(join(checkout, "input"), { recursive: true });
	await mkdir(tmp, { recursive: true });
	const contractResultRoot = config === "wrong-result-root" ? join(batchRoot, "results", "wrong") : join(batchRoot, "results", attemptId);
	const contractCwdRoot = config === "old-cwd-path" ? "/project/tmp/pi-native-lite-pairs" : join(root, "retry1-worktrees");
	const reviewDiffPath = config === "wrong-review-diff" ? "/project/tmp/pi-native-lite-pairs/common/S2-candidate.diff" : join(batchRoot, "retry1-common", "S2-candidate.diff");
	const reviewerInput = armName.startsWith("S2") ? `\nS2 reviewer reads only this immutable, precomputed diff artifact: \`${reviewDiffPath}\`.` : "";
	const contractBrief = `Common execution contract: put sessions and reports under \`${contractResultRoot}/<pair>-<mode>/\`, deriving the arm suffix from this worktree CWD \`${contractCwdRoot}/<pair>-<mode>\`; use that external path as the session directory.${reviewerInput}\nretry1 fake brief\n`;
	await writeFile(join(checkout, "input", "brief.md"), config === "old-path" ? "Use /project/tmp/pi-native-lite-pairs/results/<pair>-<mode>/ from /project/tmp/pi-native-lite-pairs/<pair>/<mode>.\n" : contractBrief);
	if (armName.startsWith("S2")) {
		const diff = join(batchRoot, "retry1-common", "S2-candidate.diff");
		await mkdir(join(batchRoot, "retry1-common"), { recursive: true });
		await writeFile(diff, "synthetic S2 diff fixture\n");
		await writeFile(join(checkout, "input", "S2-candidate.diff"), "synthetic S2 diff fixture\n");
	}
	const fakePath = join(root, "fake-pi.mjs");
	const argvPath = join(root, "argv.json");
	const commandsPath = join(root, "commands.jsonl");
	await writeFile(fakePath, fakePi);
	await chmod(fakePath, 0o700);
	const expectedResults = join(batchRoot, "results", attemptId, arm);
	if (config === "overwrite") {
		await mkdir(expectedResults, { recursive: true });
		await writeFile(join(expectedResults, "session.jsonl"), "preserve this\n");
	}
	const env = { ...process.env };
	for (const key of ["PI_OFFLINE", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SUBAGENT_RUNNER_PID", "PI_ASYNC_NATIVE_RUNNER"]) delete env[key];
	Object.assign(env, {
		PI_BIN: fakePath,
		PI_NATIVE_LITE_BATCH_ROOT: batchRoot,
		PI_NATIVE_LITE_BATCH_ID: batchId,
		PI_NATIVE_LITE_ATTEMPT_ID: attemptId,
		PI_NATIVE_LITE_RPC_DEADLINE_MS: "1200",
		PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "120",
		MOCK_ARGV_PATH: argvPath,
		MOCK_COMMANDS_PATH: commandsPath,
		MOCK_STATE: state,
		TMPDIR: tmp, TMP: tmp, TEMP: tmp,
	});
	if (config === "no-batch-root") delete env.PI_NATIVE_LITE_BATCH_ROOT;
	if (config === "no-batch-id") delete env.PI_NATIVE_LITE_BATCH_ID;
	if (config === "no-attempt-id") delete env.PI_NATIVE_LITE_ATTEMPT_ID;
	const child = spawn(process.execPath, [runner], { cwd: checkout, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
	const exitCode = await new Promise((resolveExit, reject) => {
		const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
		child.once("error", reject);
		child.once("close", code => { clearTimeout(timer); resolveExit(code); });
	});
	const commands = await readFile(commandsPath, "utf8").catch(() => "");
	const argv = await readFile(argvPath, "utf8").then(JSON.parse).catch(() => undefined);
	const control = await readFile(join(expectedResults, "control.jsonl"), "utf8").catch(() => "");
	const existing = await readFile(join(expectedResults, "session.jsonl"), "utf8").catch(() => undefined);
	if (repeat) {
		const second = spawn(process.execPath, [runner], { cwd: checkout, env, stdio: ["ignore", "pipe", "pipe"] });
		let secondStderr = "";
		second.stderr.setEncoding("utf8").on("data", chunk => { secondStderr += chunk; });
		const secondExit = await new Promise(resolveExit => second.once("close", resolveExit));
		await rm(root, { recursive: true, force: true });
		return { exitCode: secondExit, stderr: secondStderr, existing };
	}
	const result = { root, exitCode, stdout, stderr, commands, argv, control, existing, expectedResults, batchRoot };
	await rm(root, { recursive: true, force: true });
	return result;
}

test("retry1 runner state-gates the brief and derives retry1 session, result, ledger and extension paths", async () => {
	const valid = await invoke();
	assert.equal(valid.exitCode, 0, `${valid.stderr}\n${valid.stdout}\n${valid.control}`);
	const commands = valid.commands.trim().split("\n").map(JSON.parse);
	assert.deepEqual(commands.map(command => command.type === "get_state" ? "get_state" : `${command.type}:${command.id}`), ["get_state", "prompt:p6-task", "prompt:p6-child-cost"]);
	assert.equal(valid.argv.sessionId, `nl-${batchId.replace(/[^A-Za-z0-9._-]/g, "-")}-retry1-S1-native`);
	assert.equal(valid.argv.sessionDir, join(valid.expectedResults, "session"));
	assert.equal(valid.argv.ledger, join(valid.batchRoot, "budget-ledger.json"));
	assert.equal(valid.argv.fingerprintLog, join(valid.expectedResults, "request-fingerprints.jsonl"));
	assert.equal(valid.argv.requiredExtensions, join(retryDir, "required-child-extensions-wrapper.mjs"));
	assert.ok(valid.argv.args.some((arg, index) => arg === "-e" && valid.argv.args[index + 1] === join(retryDir, "request-fingerprint.ts")));
	assert.equal(valid.argv.inheritedChild, null);
	assert.match(commands[1].message, /retry1 fake brief/);
});

test("retry1 runner rejects model, thinking, session mismatches and handshake timeout before brief", async () => {
	for (const state of ["model", "thinking", "session", "timeout"]) {
		const result = await invoke({ state });
		assert.notEqual(result.exitCode, 0, state);
		assert.deepEqual(result.commands.trim().split("\n").filter(Boolean).map(line => JSON.parse(line).type), ["get_state"], state);
		assert.doesNotMatch(result.control, /task-prompt-accepted/);
	}
});

test("retry1 runner rejects missing batch/attempt identity and an incorrect cwd", async () => {
	for (const config of ["no-batch-root", "no-batch-id", "no-attempt-id", "wrong-cwd"]) {
		const result = await invoke({ config });
		assert.notEqual(result.exitCode, 0, config);
		assert.equal(result.argv, undefined, config);
		assert.equal(result.commands, "", config);
	}
});

test("retry1 runner rejects old-brief and wrong-results path layouts before starting Pi", async () => {
	for (const config of ["old-path", "old-cwd-path", "wrong-result-root"]) {
		const result = await invoke({ config });
		const evidence = `${config}: argv=${JSON.stringify(result.argv)} commands=${result.commands}`;
		assert.notEqual(result.exitCode, 0, evidence);
		assert.equal(result.argv, undefined, evidence);
		assert.equal(result.commands, "", evidence);
		assert.match(result.stderr, /brief (path|cwd|results) contract/);
	}
});

test("retry1 runner rejects an S2 reviewer diff path outside the retry1 artifact root before Pi starts", async () => {
	const result = await invoke({ armName: "S2-lite", config: "wrong-review-diff" });
	assert.notEqual(result.exitCode, 0);
	assert.equal(result.argv, undefined);
	assert.equal(result.commands, "");
	assert.match(result.stderr, /reviewer diff path contract/);
});

test("retry1 runner refuses repeated output paths without overwriting existing files", async () => {
	const result = await invoke({ config: "overwrite", repeat: true });
	assert.notEqual(result.exitCode, 0);
	assert.match(result.stderr, /refusing to overwrite existing result/);
	assert.equal(result.existing, "preserve this\n");
});
