import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as local from "./subagent-delegation-contract.ts";
import { DEFAULT_LIMITS, ROLE_AGENTS, createCwdLocks, runDelegation } from "./delegate.ts";
import { ARTIFACT_DIRS, resolveArtifacts } from "./subagent-artifacts.ts";
import { fakeBus, noGit, usage, tempDir } from "./test-helpers.mjs";

const root = process.env.PI_SUBAGENTS_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents");
const apiPath = join(root, "src", "api", "delegation.js");
const parserPath = join(root, "src", "slash", "delegation-request.js");
const costFixture = tempDir("ppo-cost-contract-");
process.env.PI_SUBAGENTS_TEMP_ROOT = costFixture;

if (!existsSync(apiPath) || !existsSync(parserPath)) {
	console.log(`contract.test: SKIP (pi-subagents not found at ${root})`);
	process.exit(0);
}

const installed = await import(apiPath);
for (const name of ["REQUEST", "STARTED", "UPDATE", "RESPONSE", "CANCEL"]) {
	const key = `SUBAGENT_DELEGATION_${name}_EVENT`;
	assert.equal(local[key], installed[key], `${key} differs from installed pi-subagents`);
}

// Lock mode matches the role: writers (worker, validator) hold exclusively, the
// read-only reviewer holds nothing, and explorers share a repository. Explorers are
// prompt-constrained, not tool-constrained, to read project files (scout keeps bash and
// write for its report, which goes to pi-subagents' per-run artifact dir); a new edit tool
// on scout would make sharing unsafe, so it fails here.
const EXPECTED_LOCK = { worker: "exclusive", explorer: "shared", validator: "exclusive", reviewer: "none" };
for (const [role, { agent, lock }] of Object.entries(ROLE_AGENTS)) {
	const file = join(root, "agents", `${agent}.md`);
	assert.ok(existsSync(file), `${role} maps to missing builtin agent ${agent}`);
	const tools = readFileSync(file, "utf8").match(/^tools:(.*)$/m)?.[1].split(",").map((t) => t.trim()) ?? [];
	const canChange = tools.some((t) => ["bash", "edit", "write"].includes(t));
	assert.equal(lock, EXPECTED_LOCK[role], `${role}/${agent}: lock=${lock}`);
	if (role === "reviewer") assert.equal(canChange, false, `${role}/${agent}: reviewer must be read-only, tools are ${tools.join(", ")}`);
	else assert.equal(canChange, true, `${role}/${agent}: lock=${lock} but tools are ${tools.join(", ")}`);
	if (lock === "shared") assert.ok(!tools.includes("edit"), `${role}/${agent}: shared lock but has edit, tools are ${tools.join(", ")}`);
}

// The exact request runDelegation emits must pass the installed parser.
const { parseSubagentDelegationRequest } = await import(parserPath);
for (const role of ["worker", "explorer", "validator", "reviewer"]) {
	const bus = fakeBus();
	bus.on(local.SUBAGENT_DELEGATION_REQUEST_EVENT, (req) => {
		bus.emit(local.SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", agent: req.agent, result: { kind: "text", text: "ok" }, usage: usage() });
	});
	await runDelegation({ events: bus, git: noGit, ownerRunId: "owner", limits: DEFAULT_LIMITS, locks: createCwdLocks() }, { role, task: "do it", cwd: "/work" });
	const request = bus.emitted.find(([e]) => e === local.SUBAGENT_DELEGATION_REQUEST_EVENT)[1];
	const parsed = parseSubagentDelegationRequest(request);
	assert.equal(parsed.ok, true, `${role} request rejected by installed parser: ${parsed.error}`);
	assert.deepEqual(parsed.request.intercomBridge, { mode: "off" });
	const { toSubagentDelegationExecutionParams } = await import(join(root, "src", "slash", "delegation-adapters.js"));
	assert.deepEqual(toSubagentDelegationExecutionParams(parsed.request).intercomBridge, { mode: "off" });
}

// The artifact adapter resolves the same files as the installed getArtifactsDir/getArtifactPaths for every artifactDir.
{
	const artifactsApi = await import(join(root, "src", "shared", "artifacts.js"));
	const sessionFile = join(root, "sessions", "2026-09-24T07-17-07_root.jsonl");
	for (const artifactDir of ARTIFACT_DIRS) {
		for (const cwd of ["/work/project", ""]) {
			const upstreamDir = artifactsApi.getArtifactsDir(sessionFile, cwd || undefined, artifactDir);
			const upstream = artifactsApi.getArtifactPaths(upstreamDir, "run-1", "worker", 0);
			const local = resolveArtifacts({ runId: "run-1", agent: "worker", sessionFile, cwd, artifactDir });
			assert.equal(local.outputPath, upstream.outputPath, `${artifactDir} output path differs from installed pi-subagents`);
			assert.equal(local.transcriptPath, upstream.transcriptPath, `${artifactDir} transcript path differs from installed pi-subagents`);
		}
	}
	const noSession = resolveArtifacts({ runId: "run-1", agent: "worker", cwd: "/work/project", artifactDir: "session" });
	assert.equal(noSession.outputPath, artifactsApi.getArtifactPaths(artifactsApi.getArtifactsDir(null, "/work/project", "session"), "run-1", "worker", 0).outputPath);
}

console.log("contract.test: ok");

// Exercise the installed RPC bridge and its real current-branch artifact accounting.
{
	const { registerSubagentRpcBridge } = await import(join(root, "src/extension/rpc.js"));
	const { buildWorkflowReceipt, writeWorkflowReceipt } = await import(join(root, "src/workflows/workflow-receipt.js"));
	const { getArtifactPaths } = await import(join(root, "src/shared/artifacts.js"));
	const sessionFile = join(costFixture, "session.jsonl");
	const artifacts = join(costFixture, "subagent-artifacts");
	const runDir = (id) => join(costFixture, "async-subagent-runs", id);
	mkdirSync(artifacts, { recursive: true });
	for (const [id, amount] of [["async-child", 0.2], ["workflow-child", 0.3]]) {
		writeFileSync(getArtifactPaths(artifacts, id, "worker", 0).metadataPath, JSON.stringify({ runId: id, agent: "worker", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: amount, turns: 1 } }));
	}
	mkdirSync(runDir("async-child"), { recursive: true });
	writeFileSync(join(runDir("async-child"), "status.json"), JSON.stringify({ steps: [{ agent: "worker", status: "completed" }] }));
	mkdirSync(runDir("workflow-parent"), { recursive: true });
	writeWorkflowReceipt(runDir("workflow-parent"), buildWorkflowReceipt({ workflowRunId: "workflow-parent", state: "complete", children: [{ key: "work", runId: "workflow-child", agent: "worker" }] }));
	const entry = (details) => ({ type: "message", message: { role: "toolResult", toolName: "subagent", details } });
	const branch = [entry({ mode: "single", asyncId: "async-child", results: [] }), entry({ mode: "workflow", runId: "workflow-parent", asyncId: "workflow-parent", results: [] })];
	let current = branch;
	const ctx = { cwd: costFixture, sessionManager: { getSessionId: () => current === branch ? "one" : "two", getSessionFile: () => sessionFile, getBranch: () => current } };
	const events = fakeBus();
	const bridge = registerSubagentRpcBridge({ events, getContext: () => ctx, execute: async () => { throw new Error("unexpected execute"); } });
	const cost = (requestId) => new Promise((resolve) => {
		const off = events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => { off(); resolve(reply); });
		events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "cost" });
	});
	const first = await cost("first");
	assert.equal(first.success, true);
	assert.equal(first.data.childTotal.cost, 0.5);
	assert.equal(first.data.childTotal.input, 20);
	const second = await cost("second");
	assert.equal(second.data.childTotal.cost, 0.5, "repeated snapshots are cumulative, not deltas");
	const { default: plannerOnly } = await import("./index.ts");
	const handlers = new Map(), statuses = [];
	const pi = { events, on: (name, handler) => handlers.set(name, handler), registerTool() {}, registerCommand() {}, getActiveTools: () => [], setActiveTools() {}, appendEntry() {}, exec: async () => ({ code: 1, stdout: "", stderr: "" }) };
	const plannerCtx = { ...ctx, hasUI: true, ui: { setStatus: (_key, text) => statuses.push(text), notify() {}, theme: { fg: (_color, text) => text } } };
	const previousMode = process.env.PI_PLANNER_ONLY_MODE;
	const previousChild = process.env.PI_SUBAGENT_CHILD;
	delete process.env.PI_SUBAGENT_CHILD;
	process.env.PI_PLANNER_ONLY_MODE = "native";
	plannerOnly(pi);
	await handlers.get("session_start")({ reason: "new" }, plannerCtx);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 2 } } }, plannerCtx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(statuses.at(-1), /child.*≥\$0\.500/, "planner receives installed bridge cost snapshot");
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 2 } } }, plannerCtx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(statuses.at(-1), /child.*≥\$0\.500/, "planner replaces cumulative snapshots");
	current = [];
	const other = await cost("other-session");
	assert.equal(other.data.childTotal.cost, 0, "another session branch excludes prior runs");
	await handlers.get("session_start")({ reason: "new" }, plannerCtx);
	await handlers.get("message_end")({ message: { role: "assistant", usage: { input: 2 } } }, plannerCtx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.match(statuses.at(-1), /child.*≥\$0\.000/, "planner displays only the new branch");
	await handlers.get("session_shutdown")({}, plannerCtx);
	if (previousMode === undefined) delete process.env.PI_PLANNER_ONLY_MODE; else process.env.PI_PLANNER_ONLY_MODE = previousMode;
	if (previousChild !== undefined) process.env.PI_SUBAGENT_CHILD = previousChild;
	bridge.dispose();
	console.log("contract.test: installed cost RPC and async/workflow artifacts ok");
}
