import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as local from "./subagent-delegation-contract.ts";
import { DEFAULT_LIMITS, ROLE_AGENTS, createCwdLocks, runDelegation } from "./delegate.ts";
import { ARTIFACT_DIRS, resolveArtifacts } from "./subagent-artifacts.ts";
import { fakeBus, noGit, usage, tempDir, tick } from "./test-helpers.mjs";

const root = process.env.PI_SUBAGENTS_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents");
const packageManifest = join(root, "package.json");

if (!existsSync(packageManifest)) {
	console.log(`contract.test: SKIP (pi-subagents not found at ${root})`);
	process.exit(0);
}

const requireFromSubagents = createRequire(join(root, "noop.js"));
const importPublic = (specifier) => import(requireFromSubagents.resolve(specifier));

const previousTempRoot = process.env.PI_SUBAGENTS_TEMP_ROOT;
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousChild = process.env.PI_SUBAGENT_CHILD;
const costFixture = tempDir("ppo-cost-contract-");
process.env.PI_SUBAGENTS_TEMP_ROOT = costFixture;
process.env.PI_CODING_AGENT_DIR = join(costFixture, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
delete process.env.PI_SUBAGENT_CHILD;

try {

const installed = await importPublic("pi-subagents/delegation");
const { resolveSubagentLaunchContract } = await importPublic("pi-subagents/preflight");
for (const name of ["REQUEST", "STARTED", "UPDATE", "RESPONSE", "CANCEL"]) {
	const key = `SUBAGENT_DELEGATION_${name}_EVENT`;
	assert.equal(local[key], installed[key], `${key} differs from installed pi-subagents`);
}

function publicHarness() {
	const events = fakeBus();
	const lifecycle = new Map();
	const tools = [];
	const pi = {
		events,
		on(event, handler) {
			if (!lifecycle.has(event)) lifecycle.set(event, new Set());
			lifecycle.get(event).add(handler);
			return () => lifecycle.get(event)?.delete(handler);
		},
		registerTool(tool) { tools.push(tool); },
		registerCommand() {}, registerShortcut() {}, registerFlag() {}, getFlag: () => undefined,
		registerMessageRenderer() {}, registerEntryRenderer() {}, registerToolRenderer() {}, registerMarkdownTransformer() {},
		sendMessage() {}, sendUserMessage() {}, appendEntry() {}, setSessionName() {}, getSessionName: () => undefined, setLabel() {},
		exec: async () => ({ code: 1, stdout: "", stderr: "not available" }),
		getActiveTools: () => [], getAllTools: () => [], getSettings: () => ({}), setActiveTools() {},
		getThinkingLevel: () => "medium", isHeld: () => false,
	};
	return {
		events, pi, tools,
		async trigger(name, event, ctx) {
			for (const handler of [...(lifecycle.get(name) ?? [])]) await handler(event, ctx);
		},
	};
}

async function loadPublicExtension() {
	const { default: registerSubagentExtension } = await importPublic("pi-subagents");
	const harness = publicHarness();
	registerSubagentExtension(harness.pi);
	return harness;
}

async function terminalDelegationResponse(events, request) {
	const seen = Promise.withResolvers();
	const off = events.on(local.SUBAGENT_DELEGATION_RESPONSE_EVENT, (response) => {
		if (response?.requestId !== request.requestId) return;
		off();
		seen.resolve(response);
	});
	events.emit(local.SUBAGENT_DELEGATION_REQUEST_EVENT, request);
	return await Promise.race([
		seen.promise,
		(async () => { await tick(1000); throw new Error(`timed out waiting for delegation response ${request.requestId}`); })(),
	]);
}

const thinkingSuffix = /:(?:off|minimal|low|medium|high|xhigh|max)$/;
const modelWithoutThinking = (model) => model?.replace(thinkingSuffix, "");

// Package discovery, model overrides, and role/tool resolution are exercised through
// pi-subagents' public launch preflight rather than its private discovery module.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-validator-contract-"));
	try {
		const config = join(dir, "config");
		mkdirSync(config);
		const project = join(dir, "project");
		mkdirSync(project);
		process.env.PI_CODING_AGENT_DIR = config;
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [process.cwd()], subagents: { defaultModel: "test/base-model", agentOverrides: {
			"planner-validator": { model: "test/validator-model" }, oracle: { model: "test/oracle-model" },
		} } }));
		const preflight = async (agent, overrides = {}) => {
			const input = {
				agent,
				cwd: project,
				task: "contract discovery probe",
				context: "fresh",
				artifacts: true,
				artifactDir: "session",
				parentSessionFile: join(dir, "session.jsonl"),
				sessionRoot: join(dir, "session-root"),
				runId: "run-1",
				intercomBridge: { mode: "off" },
				...overrides,
			};
			return await resolveSubagentLaunchContract(input);
		};
		const contractFor = async (agent, overrides = {}) => {
			const result = await preflight(agent, overrides);
			assert.equal(result.ok, true, `${agent} preflight failed: ${result.message ?? result.code}`);
			return result.contract;
		};

		const validator = await contractFor("planner-validator");
		assert.equal(validator.agent.source, "package");
		assert.deepEqual(validator.tools.effectiveAllowlist, ["read", "grep", "find", "ls", "bash"]);
		assert.equal(validator.thinking, "medium");
		assert.equal(validator.context, "fresh");
		assert.equal(validator.inheritProjectContext, true, "validator must inherit project validation rules");
		assert.equal(modelWithoutThinking(validator.model), "test/validator-model");
		const oracle = await contractFor("oracle");
		assert.equal(modelWithoutThinking(oracle.model), "test/oracle-model");
		assert.ok(!readFileSync(resolve("agents", "planner-validator.md"), "utf8").match(/^aliases?:.*\b(?:oracle|advisor|validator)\b/m), "validator must not alias oracle/advisor/validator");

		// Lock mode matches the role: writers (worker, validator) hold exclusively, the
		// read-only reviewer holds nothing, and explorers share a repository. Explorers are
		// prompt-constrained, not tool-constrained, to read project files (scout keeps bash and
		// write for its report, which goes to pi-subagents' per-run artifact dir); a new edit tool
		// on scout would make sharing unsafe, so it fails here.
		const EXPECTED_LOCK = { worker: "exclusive", explorer: "shared", validator: "exclusive", reviewer: "none" };
		for (const [role, { agent, lock }] of Object.entries(ROLE_AGENTS)) {
			const resolved = await contractFor(agent);
			const tools = resolved.tools.effectiveAllowlist;
			const canChange = tools.some((tool) => ["bash", "edit", "write"].includes(tool));
			assert.equal(lock, EXPECTED_LOCK[role], `${role}/${agent}: lock=${lock}`);
			if (role === "reviewer") assert.equal(canChange, false, `${role}/${agent}: reviewer must be read-only, tools are ${tools.join(", ")}`);
			else assert.equal(canChange, true, `${role}/${agent}: lock=${lock} but tools are ${tools.join(", ")}`);
			if (lock === "shared") assert.ok(!tools.includes("edit"), `${role}/${agent}: shared lock but has edit, tools are ${tools.join(", ")}`);
		}

		const architect = await contractFor("architect");
		assert.equal(architect.agent.source, "package");
		const architectDefinition = readFileSync(resolve("agents", "architect.md"), "utf8");
		assert.ok(architectDefinition.match(/^description:\s*\S/m), "architect must describe its role");
		assert.ok(architectDefinition.match(/^acceptanceRole:\s*read-only\s*$/m), "architect must stay read-only for acceptance");
		const assertArchitectTools = (tools) => {
			assert.deepEqual(tools, ["read", "grep", "find", "ls", "contact_supervisor"], "architect must have only its read-only tools and supervisor contact");
		};
		assertArchitectTools(architect.tools.effectiveAllowlist);
		assert.equal(architect.thinking, "high");
		assert.equal(architect.context, "fresh");
		assert.equal(architect.systemPromptMode, "replace");
		assert.equal(architect.inheritProjectContext, true);
		assert.equal(architect.inheritSkills, false);

		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [process.cwd()], subagents: { defaultModel: "test/default-model", agentOverrides: { oracle: { model: "test/oracle-model" } } } }));
		const defaultsProject = join(dir, "project-defaults");
		mkdirSync(defaultsProject);
		const defaultedValidator = await contractFor("planner-validator", { cwd: defaultsProject });
		assert.equal(modelWithoutThinking(defaultedValidator.model), "test/default-model");
		const defaultedOracle = await contractFor("oracle", { cwd: defaultsProject });
		assert.equal(modelWithoutThinking(defaultedOracle.model), "test/oracle-model");

		const missing = join(dir, "missing");
		mkdirSync(missing);
		writeFileSync(join(missing, "package.json"), JSON.stringify({ name: "missing-agent" }));
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [missing] }));
		const missingProject = join(dir, "project-missing");
		mkdirSync(missingProject);
		const missingResult = await preflight("planner-validator", { cwd: missingProject });
		assert.equal(missingResult.ok, false, "missing package metadata must not discover the validator");
		assert.equal(missingResult.code, "missing_agent");

		const faultPackage = join(dir, "architect-tool-fault");
		mkdirSync(join(faultPackage, "agents"), { recursive: true });
		writeFileSync(join(faultPackage, "package.json"), JSON.stringify({ name: "architect-tool-fault", "pi-subagents": { agents: ["./agents"] } }));
		writeFileSync(join(faultPackage, "agents", "architect.md"), architectDefinition.replace(/^tools:.*$/m, "$&, bash"));
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [faultPackage] }));
		const faultProject = join(dir, "project-fault");
		mkdirSync(faultProject);
		const architectWithBash = await contractFor("architect", { cwd: faultProject });
		assert.ok(architectWithBash.tools.effectiveAllowlist.includes("bash"), "fault fixture must parse with bash");
		assert.throws(() => assertArchitectTools(architectWithBash.tools.effectiveAllowlist), /architect must have only its read-only tools/);
	} finally {
		process.env.PI_CODING_AGENT_DIR = join(costFixture, "agent");
		rmSync(dir, { recursive: true, force: true });
	}
}

// Verify the deployed reviewer using the public launch preflight and launch planner.
{
	const { checkReviewerConfig } = await import("./scripts/check-reviewer-config.mjs");
	const dir = tempDir("reviewer-config-contract-");
	const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		const config = join(dir, "config"), project = join(dir, "project");
		mkdirSync(join(config, "agents"), { recursive: true });
		mkdirSync(join(project, ".pi"), { recursive: true });
		process.env.PI_CODING_AGENT_DIR = config;
		const tools = ["read", "grep", "find", "ls", "watchdog_diff", "contact_supervisor", "git_review"];
		const entry = resolve("reviewer-git.ts");
		writeFileSync(join(config, "agents", "reviewer.md"), `---\nname: reviewer\ndescription: Review\ntools: ${tools.join(", ")}\nsubagentOnlyExtensions: ${entry}\n---\nReview.\n`);
		const override = { tools, subagentOnlyExtensions: [entry] };
		writeFileSync(join(config, "settings.json"), JSON.stringify({ subagents: { agentOverrides: { reviewer: override } } }));
		const good = await checkReviewerConfig(project, { piSubagentsDir: root });
		assert.deepEqual(good.issues, []);
		assert.deepEqual(good.tools, tools);
		assert.deepEqual(good.subagentOnlyExtensions, [entry]);
		const cli = () => spawnSync(process.execPath, [resolve("scripts/check-reviewer-config.mjs"), project], { encoding: "utf8", env: { ...process.env, PI_SUBAGENTS_DIR: root } });
		const goodCli = cli();
		assert.equal(goodCli.status, 0, goodCli.stderr);
		assert.match(goodCli.stdout, /reviewer configuration: ok/);
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ subagents: { agentOverrides: { reviewer: { tools: [...tools, "bash"] } } } }));
		const badTools = await checkReviewerConfig(project, { piSubagentsDir: root });
		assert.match(badTools.issues.join("\n"), /bash/);
		const badCli = cli();
		assert.equal(badCli.status, 1);
		assert.match(badCli.stderr, /bash/);
		writeFileSync(join(project, ".pi", "settings.json"), JSON.stringify({ subagents: { agentOverrides: { reviewer: { subagentOnlyExtensions: [join(dir, "missing", "reviewer-git.ts")] } } } }));
		const badExtension = await checkReviewerConfig(project, { piSubagentsDir: root });
		assert.match(badExtension.issues.join("\n"), /reviewer-git\.ts.*(?:exist|missing)/i);
	} finally {
		process.env.PI_CODING_AGENT_DIR = oldAgentDir;
		rmSync(dir, { recursive: true, force: true });
	}
}

// The exact request runDelegation emits is accepted by the installed extension's
// public structured-delegation event surface. With no active session context the
// bridge proves the request parsed and adapted by reaching its explicit
// unavailable_context terminal rather than invalid_request; a fault-injected
// unknown field must still be rejected as invalid.
{
	const harness = await loadPublicExtension();
	for (const role of ["worker", "explorer", "validator", "reviewer"]) {
		const bus = fakeBus();
		bus.on(local.SUBAGENT_DELEGATION_REQUEST_EVENT, (req) => {
			bus.emit(local.SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", agent: req.agent, result: { kind: "text", text: "ok" }, usage: usage() });
		});
		await runDelegation({ events: bus, git: noGit, ownerRunId: "owner", limits: DEFAULT_LIMITS, locks: createCwdLocks() }, { role, task: "do it", cwd: "/work" });
		const request = bus.emitted.find(([event]) => event === local.SUBAGENT_DELEGATION_REQUEST_EVENT)[1];
		assert.equal(request.context, "fresh");
		assert.deepEqual(request.intercomBridge, { mode: "off" });
		const response = await terminalDelegationResponse(harness.events, request);
		assert.equal(response.status, "unavailable_context", `${role} request rejected by installed public delegation surface: ${response.error ?? response.status}`);
		assert.match(response.error ?? "", /No active extension context/);
		const malformed = await terminalDelegationResponse(harness.events, { ...request, requestId: `${request.requestId}-fault`, unsupportedField: true });
		assert.equal(malformed.status, "invalid_request", `${role} malformed request was not rejected`);
		assert.match(malformed.error ?? "", /Unsupported delegation field/);
	}
	console.log("contract.test: public delegation surface ok");
}

// The artifact adapter resolves the same files as public launch preflight for every artifactDir.
{
	mkdirSync(join(costFixture, "project"), { recursive: true });
	const artifactProject = join(costFixture, "project");
	const sessionFile = join(costFixture, "sessions", "2026-09-24T07-17-07_root.jsonl");
	const upstreamPaths = async ({ artifactDir, cwd, parentSessionFile, runId = "run-1" }) => {
		const result = await resolveSubagentLaunchContract({
			agent: "worker",
			cwd,
			task: "artifact path probe",
			context: "fresh",
			artifacts: true,
			artifactDir,
			parentSessionFile,
			runId,
			intercomBridge: { mode: "off" },
		});
		assert.equal(result.ok, true, `${artifactDir} preflight failed: ${result.message ?? result.code}`);
		return result.contract.roots.artifactPaths;
	};
	for (const artifactDir of ARTIFACT_DIRS) {
		for (const parentSessionFile of [sessionFile, null]) {
			const upstream = await upstreamPaths({ artifactDir, cwd: artifactProject, parentSessionFile });
			const localPaths = resolveArtifacts({ runId: "run-1", agent: "worker", sessionFile: parentSessionFile ?? undefined, cwd: artifactProject, artifactDir });
			assert.equal(localPaths.outputPath, upstream.outputPath, `${artifactDir} output path differs from installed pi-subagents`);
			assert.equal(localPaths.transcriptPath, upstream.transcriptPath, `${artifactDir} transcript path differs from installed pi-subagents`);
		}
	}
	const noSession = resolveArtifacts({ runId: "run-1", agent: "worker", cwd: artifactProject, artifactDir: "session" });
	const upstreamNoSession = await upstreamPaths({ artifactDir: "session", cwd: artifactProject, parentSessionFile: null });
	assert.equal(noSession.outputPath, upstreamNoSession.outputPath);
	console.log("contract.test: public artifact preflight paths ok");
}

// Exercise the installed extension through its public RPC surface and its real
// current-branch artifact accounting. The receipt and metadata bytes are fixtures;
// their paths come from public preflight, and the extension itself remains the
// only implementation under test.
{
	const sessionFile = join(costFixture, "session.jsonl");
	mkdirSync(join(costFixture, "subagent-artifacts"), { recursive: true });
	const runDir = (id) => join(costFixture, "async-subagent-runs", id);
	const metadataPath = async (runId) => {
		const result = await resolveSubagentLaunchContract({
			agent: "worker", cwd: costFixture, task: "cost fixture", context: "fresh", artifacts: true,
			artifactDir: "session", parentSessionFile: sessionFile, runId, intercomBridge: { mode: "off" },
		});
		assert.equal(result.ok, true, `cost fixture preflight failed: ${result.message ?? result.code}`);
		return result.contract.roots.artifactPaths.metadataPath;
	};
	for (const [id, amount] of [["async-child", 0.2], ["workflow-child", 0.3]]) {
		writeFileSync(await metadataPath(id), JSON.stringify({ runId: id, agent: "worker", usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: amount, turns: 1 } }));
	}
	mkdirSync(runDir("async-child"), { recursive: true });
	writeFileSync(join(runDir("async-child"), "status.json"), JSON.stringify({ steps: [{ agent: "worker", status: "completed" }] }));
	mkdirSync(runDir("workflow-parent"), { recursive: true });
	writeFileSync(join(runDir("workflow-parent"), "workflow-receipt.json"), JSON.stringify({
		version: 1,
		workflowRunId: "workflow-parent",
		state: "complete",
		createdAt: 1,
		entries: {
			work: {
				key: "work",
				agent: "worker",
				continuation: { runIds: ["workflow-child"] },
				latestRunId: "workflow-child",
				resumability: { state: "not-resumable", reason: "cost fixture" },
			},
		},
	}));
	const entry = (details) => ({ type: "message", message: { role: "toolResult", toolName: "subagent", details } });
	const branch = [entry({ mode: "single", asyncId: "async-child", results: [] }), entry({ mode: "workflow", runId: "workflow-parent", asyncId: "workflow-parent", results: [] })];
	let current = branch;
	const sessionManager = {
		getSessionId: () => current === branch ? "one" : "two",
		getSessionFile: () => sessionFile,
		getBranch: () => current,
		getEntries: () => current,
		getLeafId: () => null,
		buildSessionContext: () => ({ messages: [] }),
	};
	const ctx = { cwd: costFixture, hasUI: false, mode: "rpc", sessionManager, model: null, isProjectTrusted: () => true, isIdle: () => true, signal: new AbortController().signal, ui: { notify() {}, setStatus() {}, setWidget() {}, theme: { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text } } };
	const harness = await loadPublicExtension();
	await harness.trigger("session_start", { reason: "new" }, ctx);
	const events = harness.events;
	const cost = async (requestId) => {
		const seen = Promise.withResolvers();
		const off = events.on(`subagents:rpc:v1:reply:${requestId}`, (reply) => { off(); seen.resolve(reply); });
		events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "cost" });
		return await Promise.race([
			seen.promise,
			(async () => { await tick(1000); throw new Error(`timed out waiting for cost RPC ${requestId}`); })(),
		]);
	};
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
	await harness.trigger("session_shutdown", { reason: "test" }, ctx);
	console.log("contract.test: installed cost RPC and async/workflow artifacts ok");
}

console.log("contract.test: ok");
} finally {
	if (previousTempRoot === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
	else process.env.PI_SUBAGENTS_TEMP_ROOT = previousTempRoot;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	if (previousChild !== undefined) process.env.PI_SUBAGENT_CHILD = previousChild;
	rmSync(costFixture, { recursive: true, force: true });
}
