import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, chmod } from "node:fs/promises";
import { join, resolve } from "node:path";
import { formatSubagentCostReport } from "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/slash/subagent-cost.js";

const retryDir = resolve(new URL(".", import.meta.url).pathname);
const prechangeRunner = resolve(join(retryDir, "..", "run-rpc-arm.mjs"));
const runner = process.env.PI_RETRY1_RUNNER_PATH ?? prechangeRunner;
const root = process.env.PI_NATIVE_LITE_TEST_TMP ?? "/project/tmp/pi-native-lite-20261028T054700+0800/tmp";

const empty = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0 };
const parent = { input: 11434, output: 348, cacheRead: 8704, cacheWrite: 0, cost: 0.0136092, turns: 2 };
const worker = { input: 27, output: 19, cacheRead: 3, cacheWrite: 1, cost: 0.0002, turns: 1 };
function costText(children) {
	const childTotal = children.reduce((sum, child) => ({
		input: sum.input + child.usage.input,
		output: sum.output + child.usage.output,
		cacheRead: sum.cacheRead + child.usage.cacheRead,
		cacheWrite: sum.cacheWrite + child.usage.cacheWrite,
		cost: sum.cost + child.usage.cost,
		turns: sum.turns + child.usage.turns,
	}), { ...empty });
	const total = Object.fromEntries(Object.keys(empty).map(key => [key, parent[key] + childTotal[key]]));
	return formatSubagentCostReport({ version: 1, parent, children, childTotal, total, unresolvedAsyncChildren: 0 });
}

const fakePi = `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
const sessionId = value("--session-id");
let buffer = "";
function emit(event) { process.stdout.write(JSON.stringify(event) + "\\n"); }
function receive(command) {
  appendFileSync(process.env.MOCK_RPC_COMMANDS, JSON.stringify(command) + "\\n");
  if (command.type === "get_state") {
    emit({ id: command.id, type: "response", command: "get_state", success: true, data: { model: { provider: "tcuni", id: "gpt-6.1-terra" }, thinkingLevel: "high", sessionId } });
  } else if (command.type === "prompt" && command.id === "p6-task") {
    emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
    if (process.env.MOCK_CHILD === "yes") { const roles = JSON.parse(process.env.MOCK_ROLES); emit({ type: "message_end", message: { role: "toolResult", toolName: "delegate", isError: false, details: { status: "completed", role: roles[0], results: roles.map(agent => ({ agent })) } } }); }
    emit({ type: "message_end", message: { role: "assistant", provider: "tcuni", model: "gpt-6.1-terra", stopReason: "stop", content: [{ type: "text", text: "replay root result" }] } });
    emit({ type: "agent_settled" });
  } else if (command.type === "prompt" && command.message === "/subagent-cost") {
    emit({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
    emit({ type: "message_end", message: { role: "custom", customType: "subagent-slash-text-result", content: process.env.MOCK_COST_TEXT } });
  }
}
process.stdin.on("data", chunk => { buffer += chunk; const lines = buffer.split("\\n"); buffer = lines.pop(); for (const line of lines) if (line) receive(JSON.parse(line)); });
process.stdin.on("end", () => process.exit(0));
setTimeout(() => process.exit(0), 6000).unref();
`;

async function replay({ children, expectChildren, armName = "S1-native", roles = [] }) {
	const dir = await mkdtemp(join(root, "rpc-cost-replay-"));
	const arm = join(dir, "retry1-worktrees", armName);
	const batchRoot = join(dir, "batch-root");
	const tmp = join(dir, "tmp");
	await mkdir(join(arm, "input"), { recursive: true });
	await mkdir(tmp, { recursive: true });
	const reviewerPath = join(batchRoot, "retry1-common", "S2-candidate.diff");
	const reviewerLine = armName.startsWith("S2") ? `\nS2 reviewer reads only this immutable, precomputed diff artifact: \`${reviewerPath}\`.` : "";
	const brief = `Put sessions under \`${batchRoot}/results/retry1/<pair>-<mode>/\` from this worktree CWD \`${join(dir, "retry1-worktrees")}/<pair>-<mode>\`.${reviewerLine}\nReplay only; no provider.\n`;
	await writeFile(join(arm, "input", "brief.md"), brief);
	if (armName.startsWith("S2")) {
		const diff = await readFile("/project/tmp/pi-native-lite-20261028T054700+0800/retry1-common/S2-candidate.diff");
		await mkdir(join(batchRoot, "retry1-common"), { recursive: true });
		await writeFile(reviewerPath, diff);
		await writeFile(join(arm, "input", "S2-candidate.diff"), diff);
	}
	const fakePath = join(dir, "fake-pi.mjs");
	const commandPath = join(dir, "commands.jsonl");
	await writeFile(fakePath, fakePi);
	await chmod(fakePath, 0o700);
	const env = { ...process.env };
	for (const key of ["PI_OFFLINE", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SUBAGENT_RUNNER_PID"]) delete env[key];
	Object.assign(env, {
		PI_BIN: fakePath,
		PI_NATIVE_LITE_BATCH_ROOT: batchRoot,
		PI_NATIVE_LITE_BATCH_ID: "20261028T054700+0800-1",
		PI_NATIVE_LITE_ATTEMPT_ID: "retry1",
		PI_NATIVE_LITE_RPC_DEADLINE_MS: "900",
		PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "200",
		PI_NATIVE_LITE_BUDGET_LEDGER: join(dir, "nonexistent-ledger-for-fake-only.json"),
		PI_NATIVE_LITE_FINGERPRINT_LOG: join(batchRoot, "not-used.jsonl"),
		PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: join(retryDir, "required-child-extensions-wrapper.mjs"),
		MOCK_RPC_COMMANDS: commandPath,
		MOCK_COST_TEXT: costText(children),
		MOCK_CHILD: roles.length ? "yes" : "no",
		MOCK_ROLES: JSON.stringify(roles),
		TMPDIR: tmp, TMP: tmp, TEMP: tmp,
	});
	const started = Date.now();
	const child = spawn(process.execPath, [runner], { cwd: arm, env, stdio: ["ignore", "pipe", "pipe"] });
	let stdout = "";
	let stderr = "";
	child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
	child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
	const exitCode = await new Promise((resolveExit, reject) => {
		const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
		child.once("error", reject);
		child.once("close", code => { clearTimeout(timeout); resolveExit(code); });
	});
	const durationMs = Date.now() - started;
	const control = await readFile(join(batchRoot, "results", "retry1", armName, "control.jsonl"), "utf8").catch(() => "");
	const runnerStderr = await readFile(join(batchRoot, "results", "retry1", armName, "session.stderr"), "utf8").catch(() => "");
	const costOutput = await readFile(join(batchRoot, "results", "retry1", armName, "subagent-cost.txt"), "utf8").catch(() => "");
	const commands = await readFile(commandPath, "utf8").catch(() => "");
	await rm(dir, { recursive: true, force: true });
	return { exitCode, durationMs, control, commands, stdout, stderr, runnerStderr, costOutput };
}

test("actual subagent-cost text format with no children fails immediately instead of waiting for deadline", async () => {
	const result = await replay({ children: [], expectChildren: false });
	assert.notEqual(result.exitCode, 0, `${result.stdout}\n${result.stderr}\n${result.runnerStderr}\n${result.commands}\n${result.control}`);
	assert.ok(result.durationMs < 700, `should fail fast, elapsed ${result.durationMs}ms`);
	assert.match(result.control, /"noChildUsage":true/, `${result.stderr}\n${result.runnerStderr}\n${result.commands}\n${result.control}`);
	assert.equal(result.costOutput.trim(), costText([]));
	assert.doesNotMatch(result.control, /arm-timeout/);
});

test("actual formatter child line is counted and a complete one-child report finishes S1", async () => {
	const result = await replay({ children: [{ label: "Child 1 (worker)", agent: "worker", usage: worker }], expectChildren: true, roles: ["worker"] });
	assert.equal(result.exitCode, 0, `${result.stderr}\n${result.runnerStderr}\n${result.commands}\n${result.control}`);
	assert.match(result.control, /"event":"subagent-cost-report"[^\n]*"childUsageCount":1/, `${result.runnerStderr}\n${result.commands}\n${result.control}`);
	assert.equal(result.costOutput.trim(), costText([{ label: "Child 1 (worker)", agent: "worker", usage: worker }]));
	assert.match(result.control, /"event":"arm-lifecycle-complete"/);
});

test("actual formatter output with both S2 child roles satisfies the exact two-child count", async () => {
	const reviewer = { input: 34, output: 12, cacheRead: 5, cacheWrite: 2, cost: 0.0003, turns: 1 };
	const children = [
		{ label: "Child 1 (oracle)", agent: "oracle", usage: worker },
		{ label: "Child 2 (reviewer)", agent: "reviewer", usage: reviewer },
	];
	const result = await replay({ children, expectChildren: true, armName: "S2-lite", roles: ["oracle", "reviewer"] });
	assert.equal(result.exitCode, 0, `${result.stderr}\n${result.runnerStderr}\n${result.control}`);
	assert.match(result.control, /"childUsageCount":2/);
	assert.match(result.control, /"childRoles":\["oracle","reviewer"\]/);
	assert.equal(result.costOutput.trim(), costText(children));
});

test("actual formatter child count must equal the frozen S1 count", async () => {
	const second = { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.0001, turns: 1 };
	const result = await replay({ children: [
		{ label: "Child 1 (worker)", agent: "worker", usage: worker },
		{ label: "Child 2 (worker)", agent: "worker", usage: second },
	], expectChildren: true });
	assert.notEqual(result.exitCode, 0);
	assert.match(result.control, /expected exactly 1 child usage record/i);
	assert.doesNotMatch(result.control, /arm-timeout/);
});
