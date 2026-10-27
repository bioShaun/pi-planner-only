import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const batchId = "20261028T054700+0800";
const batchDir = resolve(new URL(".", import.meta.url).pathname);
const runner = join(batchDir, "run-rpc-arm.mjs");
const legacyRunner = resolve(".scratch/native-lite-comparison/pairs/run-rpc-arm.mjs");
const tempRoot = process.env.PI_NATIVE_LITE_TEST_TMP ?? `/project/tmp/pi-native-lite-${batchId}/tmp`;
await mkdir(tempRoot, { recursive: true });

const fakePi = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
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
function onLine(raw) {
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
    emit({ type: "message_end", message: { role: "custom", customType: "subagent-slash-result", content: "Child 1 (worker): input=10 output=5 cost=0.001\\nTotal: input=10 output=5 cost=0.001" } });
  }
}
process.stdin.on("data", chunk => { buffer += chunk; const lines = buffer.split("\\n"); buffer = lines.pop(); for (const line of lines) if (line) onLine(line); });
process.stdin.on("end", () => process.exit(0));
setTimeout(() => process.exit(0), 4000).unref();
`;

async function invoke({ useLegacy = false, state = "valid", config = "valid", repeat = false, armName = "S1-native" } = {}) {
	const root = await mkdtemp(join(tempRoot, "rpc-test-"));
	const checkout = useLegacy
		? join(root, "checkout", "S1", "native")
		: join(root, "checkout", config === "wrong-cwd" ? "not-an-arm" : armName);
	const arm = armName;
	const batchRoot = join(root, "batch-root");
	const tmp = join(root, "tmp");
	await mkdir(join(checkout, "input"), { recursive: true });
	await mkdir(tmp, { recursive: true });
	await writeFile(join(checkout, "input", "brief.md"), "frozen fake brief\n");
	const fakePath = join(root, "fake-pi.mjs");
	const argvPath = join(root, "argv.json");
	const commandsPath = join(root, "commands.jsonl");
	await writeFile(fakePath, fakePi);
	await chmod(fakePath, 0o700);
	const expectedResults = useLegacy ? join(batchRoot, "results", arm) : join(batchRoot, "results", batchId, arm);
	if (config === "overwrite") {
		await mkdir(expectedResults, { recursive: true });
		await writeFile(join(expectedResults, "session.jsonl"), "preserve this\n");
	}
	const script = useLegacy ? legacyRunner : runner;
	const env = { ...process.env };
	delete env.PI_SUBAGENT_CHILD;
	Object.assign(env, {
		PI_BIN: fakePath,
		PI_NATIVE_LITE_BATCH_ROOT: batchRoot,
		PI_NATIVE_LITE_BATCH_ID: batchId,
		PI_NATIVE_LITE_RESULTS_ROOT: batchRoot,
		PI_NATIVE_LITE_RPC_DEADLINE_MS: "1200",
		PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "120",
		MOCK_ARGV_PATH: argvPath,
		MOCK_COMMANDS_PATH: commandsPath,
		MOCK_STATE: state,
		TMPDIR: tmp, TMP: tmp, TEMP: tmp,
	});
	if (config === "no-batch-root") delete env.PI_NATIVE_LITE_BATCH_ROOT;
	if (config === "no-batch-id") delete env.PI_NATIVE_LITE_BATCH_ID;
	if (config === "wrong-cwd") env.PI_NATIVE_LITE_BATCH_ROOT = batchRoot;
	const child = spawn(process.execPath, [script], { cwd: checkout, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
	const exitCode = await new Promise((resolveExit, reject) => {
		const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
		child.once("error", reject);
		child.once("close", (code) => { clearTimeout(timer); resolveExit(code); });
	});
	const commands = await readFile(commandsPath, "utf8").catch(() => "");
	const argv = await readFile(argvPath, "utf8").then(JSON.parse).catch(() => undefined);
	const control = await readFile(join(expectedResults, "control.jsonl"), "utf8").catch(() => "");
	const piStderr = await readFile(join(expectedResults, "session.stderr"), "utf8").catch(() => "");
	const existing = await readFile(join(expectedResults, "session.jsonl"), "utf8").catch(() => undefined);
	if (repeat && !useLegacy) {
		const second = spawn(process.execPath, [script], { cwd: checkout, env, stdio: ["ignore", "pipe", "pipe"] });
		let secondStderr = "";
		second.stderr.setEncoding("utf8").on("data", (chunk) => { secondStderr += chunk; });
		const secondExit = await new Promise((resolveExit) => second.once("close", resolveExit));
		await rm(root, { recursive: true, force: true });
		return { exitCode: secondExit, stderr: secondStderr, existing };
	}
	const result = { root, exitCode, stdout, stderr, piStderr, commands, argv, control, existing, expectedResults, batchRoot, batchId };
	if (!useLegacy) await rm(root, { recursive: true, force: true });
	return result;
}

test("new batch RPC runner gates the brief on matching state and isolates argv, results, ledger and temp", async () => {
	const valid = await invoke();
	assert.equal(valid.exitCode, 0, `${valid.stderr}\n${valid.stdout}\n${valid.piStderr}\n${valid.control}`);
	const commands = valid.commands.trim().split("\n").map(JSON.parse);
	assert.deepEqual(commands.map((command) => command.type === "get_state" ? "get_state" : `${command.type}:${command.id}`), ["get_state", "prompt:p6-task", "prompt:p6-child-cost"]);
	assert.equal(valid.argv.sessionId, `nl-${batchId.replace(/[^A-Za-z0-9._-]/g, "-")}-S1-native`);
	assert.match(valid.argv.sessionId, /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
	assert.equal(valid.argv.sessionDir, join(valid.expectedResults, "session"));
	assert.equal(valid.argv.ledger, join(valid.batchRoot, "budget-ledger.json"));
	assert.equal(valid.argv.tmp, join(valid.batchRoot, "tmp"));
	assert.equal(valid.argv.fingerprintLog, join(valid.expectedResults, "request-fingerprints.jsonl"));
	assert.equal(valid.argv.requiredExtensions, join(batchDir, "required-child-extensions-wrapper.mjs"));
	assert.ok(valid.argv.args.some((arg, index) => arg === "-e" && valid.argv.args[index + 1] === join(batchDir, "request-fingerprint.ts")));
	assert.equal(valid.argv.inheritedChild, null);
	assert.equal(valid.argv.mode, "native");
	assert.match(commands[1].message, /frozen fake brief/);
	assert.match(valid.control, /"event":"task-prompt-accepted","success":true/);
	const lite = await invoke({ armName: "S1-lite" });
	assert.equal(lite.exitCode, 0, `${lite.stderr}\n${lite.piStderr}`);
	assert.equal(lite.argv.mode, "lite");
	assert.equal(lite.argv.strict, "true");
});

test("new batch RPC runner rejects mismatched model, thinking, session and handshake timeout without submitting brief", async () => {
	for (const state of ["model", "thinking", "session", "timeout"]) {
		const result = await invoke({ state });
		assert.notEqual(result.exitCode, 0, state);
		const commands = result.commands.trim().split("\n").filter(Boolean).map(JSON.parse);
		assert.deepEqual(commands.map((command) => command.type), ["get_state"], `${state}: ${result.stderr}\n${result.stdout}\n${result.piStderr}\n${result.control}`);
		assert.doesNotMatch(result.control, /task-prompt-accepted/);
	}
});

test("new batch RPC runner fails closed for missing batch fields and wrong arm cwd", async () => {
	for (const config of ["no-batch-root", "no-batch-id", "wrong-cwd"]) {
		const result = await invoke({ config });
		assert.notEqual(result.exitCode, 0, config);
		assert.equal(result.argv, undefined, config);
		assert.equal(result.commands, "", config);
	}
});

test("new batch RPC runner refuses repeat output without overwriting existing files", async () => {
	const result = await invoke({ config: "overwrite", repeat: true });
	assert.notEqual(result.exitCode, 0);
	assert.match(result.stderr, /refusing to overwrite existing result/);
	assert.equal(result.existing, "preserve this\n");
});

test("legacy runner behavior snapshot uses its hard-coded old identity and shared prior results layout", async () => {
	const result = await invoke({ useLegacy: true });
	try {
		assert.equal(result.exitCode, 0, `${result.stderr}\n${result.stdout}\n${result.piStderr}\n${result.control}`);
		assert.equal(result.argv.sessionId, "p6-S1-native-20261027");
		assert.ok(!result.argv.sessionId.includes(batchId));
		assert.ok(result.argv.sessionDir.includes(join(result.batchRoot, "results", "S1-native")));
	} finally {
		await rm(result.root, { recursive: true, force: true });
	}
});
