import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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

// Every mapped builtin agent exists, and only agents that can change files hold the cwd lock.
for (const [role, { agent, exclusive }] of Object.entries(ROLE_AGENTS)) {
	const file = join(root, "agents", `${agent}.md`);
	assert.ok(existsSync(file), `${role} maps to missing builtin agent ${agent}`);
	const tools = readFileSync(file, "utf8").match(/^tools:(.*)$/m)?.[1].split(",").map((t) => t.trim()) ?? [];
	const canChange = tools.some((t) => ["bash", "edit", "write"].includes(t));
	assert.equal(exclusive, canChange, `${role}/${agent}: exclusive=${exclusive} but tools are ${tools.join(", ")}`);
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
