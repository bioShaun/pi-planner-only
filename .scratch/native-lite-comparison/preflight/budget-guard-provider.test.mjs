import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLedger, readLedger } from "./budget-guard-core.mjs";

test("Pi provider boundary exits on a budget denial before localhost transport", async () => {
	const root = await mkdtemp(join(tmpdir(), "native-lite-pi-provider-"));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	let requests = 0;
	const server = createServer((_request, response) => {
		requests++;
		response.writeHead(500).end("unexpected mock provider request");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	const model = {
		id: "gpt-6.1-terra", name: "gpt-6.1-terra", api: "openai-responses", reasoning: true,
		input: ["text"], cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 }, contextWindow: 500000, maxTokens: 128000,
	};
	await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {
		tcuni: { api: "openai-responses", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "offline-test-only", models: [model] },
	} }));
	const repo = process.cwd();
	const subagents = join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents/index.js");
	const requiredExtensions = join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents/bundle/required-child-extensions.js");
	const guard = join(repo, ".scratch/native-lite-comparison/preflight/budget-guard.ts");
	const pi = process.env.PI_BIN ?? join(process.env.HOME, ".pi/agent/bin/pi");
	const args = ["--offline", "--approve", "--no-session", "--mode", "json", "--model", "tcuni/gpt-6.1-terra", "--thinking", "high", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp", "-e", subagents, "-e", guard, "-p", "offline guard probe"];
	let allPassed = false;
	try {
		for (const role of ["root", "child-process"]) {
			const ledgerPath = join(root, `${role}-budget.json`);
			await createLedger(ledgerPath, { initialReserveUsd: 15.95, sessionId: `${role}-seed` });
			const child = spawn(pi, args, { cwd: root, env: {
				...process.env,
				...(role === "child-process" ? { PI_SUBAGENT_CHILD: "1" } : {}),
				PI_CODING_AGENT_DIR: agentDir,
				PI_CODING_AGENT_SESSION_DIR: join(root, `${role}-sessions`),
				PI_NATIVE_LITE_BUDGET_LEDGER: ledgerPath,
				PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: requiredExtensions,
				PI_PLANNER_ONLY_MODE: "lite",
				PI_TELEMETRY: "0",
				TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir(),
			} });
			child.stdin.end();
			let stdout = "", stderr = "";
			child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
			child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
			const exitCode = await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
				child.once("error", reject);
				child.once("close", (code) => { clearTimeout(timeout); resolve(code); });
			});
			assert.equal(exitCode, 73, `${role}: expected budget exit 73; stderr=${stderr}; stdout=${stdout.slice(-500)}`);
			assert.match(stderr, /budget guard denied provider request/);
			assert.equal(requests, 0, `${role}: mock HTTP transport must not be called after the guard denies`);
		}
		allPassed = true;
	} finally {
		await new Promise((resolve) => server.close(resolve));
		if (allPassed) await rm(root, { recursive: true, force: true });
	}
});

test("allowed Pi requests use the active hook context identity, not inherited process identity", async () => {
	const root = await mkdtemp(join(tmpdir(), "native-lite-pi-identity-"));
	const agentDir = join(root, "agent");
	await mkdir(agentDir);
	const observed = [];
	const server = createServer((request, response) => {
		let body = "";
		request.setEncoding("utf8").on("data", (chunk) => { body += chunk; });
		request.on("end", () => {
			observed.push(JSON.parse(body));
			response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "offline test stop" } }));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = server.address().port;
	const model = {
		id: "gpt-6.1-terra", name: "gpt-6.1-terra", api: "openai-responses", reasoning: true,
		input: ["text"], cost: { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 }, contextWindow: 500000, maxTokens: 128000,
	};
	await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: {
		tcuni: { api: "openai-responses", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "offline-test-only", models: [model] },
	} }));
	const repo = process.cwd();
	const subagents = join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents/index.js");
	const requiredExtensions = join(process.env.HOME, ".pi/agent/npm/node_modules/pi-subagents/bundle/required-child-extensions.js");
	const guard = join(repo, ".scratch/native-lite-comparison/preflight/budget-guard.ts");
	const pi = process.env.PI_BIN ?? join(process.env.HOME, ".pi/agent/bin/pi");
	const failures = [];
	let allPassed = false;
	try {
		for (const identity of ["clear", "polluted"]) {
			const observedStart = observed.length;
			const sessionId = `identity-${identity}-session`;
			const ledgerPath = join(root, `${identity}-budget.json`);
			await createLedger(ledgerPath, { initialReserveUsd: 1, sessionId: "seed" });
			const childEnv = {
				...process.env,
				PI_CODING_AGENT_DIR: agentDir,
				PI_CODING_AGENT_SESSION_DIR: join(root, `${identity}-sessions`),
				PI_NATIVE_LITE_BUDGET_LEDGER: ledgerPath,
				PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: requiredExtensions,
				PI_TELEMETRY: "0",
				NO_PROXY: "127.0.0.1,localhost",
				no_proxy: "127.0.0.1,localhost",
				TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir(),
			};
			if (identity === "clear") {
				delete childEnv.PI_PROVIDER;
				delete childEnv.PI_SESSION_ID;
			} else {
				childEnv.PI_PROVIDER = "outer-stale-provider";
				childEnv.PI_SESSION_ID = "outer-worker-session";
			}
			const args = ["--approve", "--mode", "json", "--session-dir", join(root, `${identity}-sessions`), "--session-id", sessionId, "--model", "tcuni/gpt-6.1-terra", "--thinking", "high", "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-mcp", "-e", subagents, "-e", guard, "-p", "offline allowed identity probe"];
			const child = spawn(pi, args, { cwd: root, env: childEnv });
			child.stdin.end();
			let stderr = "";
			child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
				child.once("error", reject);
				child.once("close", () => { clearTimeout(timeout); resolve(); });
			});
			const ledger = await readLedger(ledgerPath);
			const event = ledger.events.at(-1);
			if (observed.length === observedStart || !ledger.events.slice(1).length) failures.push(`${identity}: HTTP did not arrive; ${stderr}`);
			if (event?.model !== "tcuni/gpt-6.1-terra" || event?.sessionId !== sessionId) failures.push(`${identity}: ledger identity was ${event?.model}/${event?.sessionId}`);
			const request = observed.slice(observedStart).at(-1);
			if (request?.model !== "gpt-6.1-terra") failures.push(`${identity}: provider model was ${request?.model}`);
			if (!Number.isInteger(request?.max_output_tokens) || request.max_output_tokens < 1 || request.max_output_tokens > 16384) failures.push(`${identity}: provider output cap missing or exceeded`);
		}
		assert.deepEqual(failures, [], "active Pi ctx.model/ctx.sessionManager identity must admit the request and be recorded");
		assert.equal(observed.length, 2);
		allPassed = true;
	} finally {
		await new Promise((resolve) => server.close(resolve));
		if (allPassed) await rm(root, { recursive: true, force: true });
	}
});

test("RPC runner sends get_state first and gates the brief on a matching model/session", async () => {
	const repo = process.cwd();
	const runnerSource = join(repo, ".scratch/native-lite-comparison/pairs/run-rpc-arm.mjs");
	const fakePiSource = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
const idIndex = args.indexOf("--session-id");
const sessionId = args[idIndex + 1];
const mode = process.env.MOCK_RPC_MODE;
const log = process.env.MOCK_RPC_COMMAND_LOG;
let buffer = "";
function output(event) { process.stdout.write(JSON.stringify(event) + "\\n"); }
function line(raw) {
	const command = JSON.parse(raw);
	appendFileSync(log, command.type + ":" + (command.id ?? "") + "\\n");
	if (command.type === "get_state") {
		if (mode === "stall") return;
		output({ id: command.id, type: "response", command: "get_state", success: true, data: {
			model: { provider: "tcuni", id: mode === "mismatch-model" ? "gpt-6-luna" : "gpt-6.1-terra" }, thinkingLevel: "high",
			sessionId: mode === "mismatch-session" ? "wrong-session" : sessionId,
		} });
	} else if (command.type === "prompt" && command.id === "p6-task") {
		output({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "started" } });
		output({ type: "message_end", message: { role: "assistant", provider: "tcuni", model: "gpt-6.1-terra", stopReason: "stop", content: [{ type: "text", text: "Root final" }] } });
		output({ type: "agent_settled" });
	} else if (command.type === "prompt" && command.message === "/subagent-cost") {
		output({ id: command.id, type: "response", command: "prompt", success: true, data: { disposition: "handled" } });
		output({ type: "message_end", message: { role: "custom", customType: "subagent-slash-result", content: "Subagent cost\\n\\nChild 1 (worker): input=10 output=5 cost=0.0010\\nChildren: input=10 output=5 cost=0.0010\\nTotal: input=10 output=5 cost=0.0010" } });
	}
}
process.stdin.on("data", chunk => { buffer += chunk; const lines = buffer.split("\\n"); buffer = lines.pop(); for (const value of lines) if (value) line(value); });
process.stdin.on("end", () => process.exit(0));
setTimeout(() => process.exit(0), mode === "stall" || mode === "valid" ? 4000 : 1000).unref();
`;
	const attempts = [];
	for (const mode of ["valid", "mismatch-model", "mismatch-session", "stall"]) {
		const temp = await mkdtemp(join(tmpdir(), `rpc-handshake-${mode}-`));
		try {
			const fakePi = join(temp, "fake-pi.mjs");
			const commandLog = join(temp, "commands.txt");
			await writeFile(fakePi, fakePiSource, { mode: 0o700 });
			await chmod(fakePi, 0o700);
			const child = spawn(process.execPath, [runnerSource], { cwd: "/project/tmp/pi-native-lite-pairs/S1/native", env: {
				...process.env,
				PI_NATIVE_LITE_RESULTS_ROOT: temp,
				PI_NATIVE_LITE_RPC_DEADLINE_MS: "2500",
				PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS: "2000",
				PI_BIN: fakePi,
				MOCK_RPC_MODE: mode,
				MOCK_RPC_COMMAND_LOG: commandLog,
				TMPDIR: tmpdir(), TMP: tmpdir(), TEMP: tmpdir(),
			} });
			child.stdin.end();
			let stderr = "";
			child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
			const exitCode = await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => child.kill("SIGKILL"), 3000);
				child.once("error", reject);
				child.once("close", (code) => { clearTimeout(timeout); resolve(code); });
			});
			const commands = await readFile(commandLog, "utf8").catch(() => "");
			const controlLog = await readFile(join(temp, "results/S1-native/control.jsonl"), "utf8").catch(() => "");
			attempts.push({ mode, exitCode, commands, stderr, controlLog });
		} finally { await rm(temp, { recursive: true, force: true }); }
	}
	const valid = attempts.find((attempt) => attempt.mode === "valid");
	const modelMismatch = attempts.find((attempt) => attempt.mode === "mismatch-model");
	const sessionMismatch = attempts.find((attempt) => attempt.mode === "mismatch-session");
	const stall = attempts.find((attempt) => attempt.mode === "stall");
	assert.match(valid.commands, /^get_state:p6-state\nprompt:p6-task\nprompt:p6-child-cost\n$/, `valid handshake must request state before submitting the brief; stderr=${valid.stderr}; control=${valid.controlLog}`);
	assert.equal(valid.exitCode, 0);
	assert.equal(modelMismatch.commands, "get_state:p6-state\n", "mismatched model must never receive the brief");
	assert.notEqual(modelMismatch.exitCode, 0);
	assert.equal(sessionMismatch.commands, "get_state:p6-state\n", "mismatched session must never receive the brief");
	assert.notEqual(sessionMismatch.exitCode, 0);
	assert.equal(stall.commands, "get_state:p6-state\n", "state timeout must never submit the brief");
	assert.notEqual(stall.exitCode, 0);
	assert.match(stall.controlLog, /RPC get_state handshake timed out/);
});
