import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import * as local from "./subagent-delegation-contract.ts";
import { DEFAULT_LIMITS, ROLE_AGENTS, createCwdLocks, runDelegation } from "./delegate.ts";
import { ARTIFACT_DIRS, resolveArtifacts } from "./subagent-artifacts.ts";
import { fakeBus, noGit, usage } from "./test-helpers.mjs";

const root = process.env.PI_SUBAGENTS_DIR ?? join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents");
const apiPath = join(root, "src", "api", "delegation.js");
const parserPath = join(root, "src", "slash", "delegation-request.js");

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
	const file = role === "validator" ? resolve("agents", `${agent}.md`) : join(root, "agents", `${agent}.md`);
	assert.ok(existsSync(file), `${role} maps to missing agent ${agent}`);
	const tools = readFileSync(file, "utf8").match(/^tools:(.*)$/m)?.[1].split(",").map((t) => t.trim()) ?? [];
	const canChange = tools.some((t) => ["bash", "edit", "write"].includes(t));
	assert.equal(lock, EXPECTED_LOCK[role], `${role}/${agent}: lock=${lock}`);
	if (role === "reviewer") assert.equal(canChange, false, `${role}/${agent}: reviewer must be read-only, tools are ${tools.join(", ")}`);
	else assert.equal(canChange, true, `${role}/${agent}: lock=${lock} but tools are ${tools.join(", ")}`);
	if (lock === "shared") assert.ok(!tools.includes("edit"), `${role}/${agent}: shared lock but has edit, tools are ${tools.join(", ")}`);
}

// Exercise package discovery with isolated user settings, never operator settings.
{
	const dir = mkdtempSync(join(tmpdir(), "planner-validator-contract-"));
	const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
	try {
		const config = join(dir, "config");
		mkdirSync(config);
		const project = join(dir, "project");
		mkdirSync(project);
		process.env.PI_CODING_AGENT_DIR = config;
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [process.cwd()], subagents: { agentOverrides: {
			"planner-validator": { model: "test/validator-model" }, oracle: { model: "test/oracle-model" },
		} } }));
		const { discoverAgents, clearAgentDiscoveryCache } = await import(join(root, "src", "agents", "agents.js"));
		clearAgentDiscoveryCache();
		const discover = (cwd) => discoverAgents(cwd, "both", undefined, { globalNpmRoot: "" }).agents;
		const agents = discover(project);
		const validator = agents.find((agent) => agent.name === "planner-validator");
		assert.ok(validator, "package validator must be discoverable");
		assert.equal(validator.source, "package");
		assert.deepEqual(validator.tools, ["read", "grep", "find", "ls", "bash"]);
		assert.equal(validator.thinking, "medium");
		assert.equal(validator.defaultContext, "fresh");
		assert.equal(validator.inheritProjectContext, true, "validator must inherit project validation rules");
		assert.equal(validator.model, "test/validator-model");
		assert.equal(agents.find((agent) => agent.name === "oracle").model, "test/oracle-model");
		assert.ok(!validator.aliases?.some((alias) => ["oracle", "advisor", "validator"].includes(alias)));
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [process.cwd()], subagents: { defaultModel: "test/default-model", agentOverrides: { oracle: { model: "test/oracle-model" } } } }));
		clearAgentDiscoveryCache();
		const defaults = discover(project);
		assert.equal(defaults.find((agent) => agent.name === "planner-validator").model, "test/default-model");
		assert.equal(defaults.find((agent) => agent.name === "oracle").model, "test/oracle-model");
		const missing = join(dir, "missing");
		mkdirSync(missing);
		writeFileSync(join(missing, "package.json"), JSON.stringify({ name: "missing-agent" }));
		writeFileSync(join(config, "settings.json"), JSON.stringify({ packages: [missing] }));
		clearAgentDiscoveryCache();
		assert.equal(discover(project).some((agent) => agent.name === "planner-validator"), false, "missing package metadata must not discover the validator");
	} finally {
		if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
		rmSync(dir, { recursive: true, force: true });
	}
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
	assert.equal(parsed.request.context, "fresh");
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
