import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const directory = dirname(fileURLToPath(import.meta.url));
const settings = JSON.parse(await readFile(join(directory, "settings.json"), "utf8"));
const s1 = await readFile(join(directory, "S1-brief.md"), "utf8");
const s2 = await readFile(join(directory, "S2-brief.md"), "utf8");
const packageRoot = process.env.PI_SUBAGENTS_DIR ?? "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents";
const { discoverAgentsAll } = await import(`${packageRoot}/src/agents/agents.js`);
const batchRoot = "/project/tmp/pi-native-lite-20261028T010659";
const sha256 = value => createHash("sha256").update(value).digest("hex");

test("frozen child roles use Luna medium and report-capable tool allowlists", () => {
	const roles = settings.subagents.agentOverrides;
	for (const role of ["worker", "oracle", "reviewer"]) {
		assert.equal(roles[role].model, "tcuni/gpt-6-luna");
		assert.equal(roles[role].thinking, "medium");
		assert.ok(roles[role].tools.includes("write"));
	}
	assert.ok(roles.oracle.tools.includes("bash"));
	assert.ok(!roles.reviewer.tools.includes("bash"));
});

test("installed resolver applies the reviewer no-shell and validator-shell tool policies", () => {
	const agents = discoverAgentsAll("/project/tmp/pi-native-lite-20261028T010659/worktrees/S2-lite", "tcuni").builtin;
	const worker = agents.find(agent => agent.name === "worker");
	const oracle = agents.find(agent => agent.name === "oracle");
	const reviewer = agents.find(agent => agent.name === "reviewer");
	assert.deepEqual(worker.tools, ["read", "grep", "find", "ls", "write"]);
	assert.deepEqual(oracle.tools, ["read", "grep", "find", "ls", "bash", "write"]);
	assert.deepEqual(reviewer.tools, ["read", "grep", "find", "ls", "write"]);
	for (const agent of [worker, oracle, reviewer]) {
		assert.equal(agent.model, "tcuni/gpt-6-luna");
		assert.equal(agent.thinking, "medium");
	}
});

test("paired briefs use the new worktrees, reports, and Root evidence acceptance contract", () => {
	for (const brief of [s1, s2]) {
		assert.match(brief, /results\/reopen-a1\/<pair>-<mode>/);
		assert.match(brief, /worktrees\/<pair>-<mode>/);
		assert.match(brief, /`batchId` is `20261028T010659`/);
		assert.match(brief, /`attemptId` is `reopen-a1`/);
		assert.ok(brief.includes("nl-${batchId}-${attemptId}-${pair}-${mode}"));
		assert.ok(brief.includes("replace each character outside `[A-Za-z0-9._-]` with `-`"));
		assert.ok(brief.includes("Every `children[]` entry uses the same Root `sessionId` and `attemptId`"));
		assert.ok(brief.includes("Native entries do not include `requestId`, `ownerRunId`, or `nodeId`"));
		for (const field of ["root-acceptance", "sessionId", "attemptId", "reportPath", "reportSha256", "reviewVerdict", "Native read-only", "plain-text reports"]) {
			assert.ok(brief.includes(field), `brief must contain ${field}`);
		}
		assert.ok(!brief.includes("retry1"));
	}
	assert.match(s2, /reviewer reads only this immutable, precomputed diff artifact/);
	assert.match(s2, /role:\"validator\", agent:\"oracle\"/);
	for (const [brief, expectedChildren] of [[s1, [["worker", "worker"]]], [s2, [["validator", "oracle"], ["reviewer", "reviewer"]]]]) {
		assert.ok(brief.includes("For Lite,"));
		for (const field of ["requestId", "ownerRunId", "nodeId", "native-lite-delegation-receipt"]) assert.ok(brief.includes(field));
		const examples = [...brief.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
		assert.equal(examples.length, 1);
		const acceptance = JSON.parse(examples[0][1]);
		assert.equal(acceptance.attemptId, "reopen-a1");
		assert.equal(acceptance.sessionId, "<actual Root session ID from the formula>");
		assert.deepEqual(acceptance.children.map(({ role, agent }) => [role, agent]), expectedChildren);
		for (const child of acceptance.children) {
			assert.equal(child.sessionId, "<same actual Root session ID>");
			assert.equal(child.attemptId, acceptance.attemptId);
		}
	}
});

test("four draft manifests bind clean candidate trees, nonignored inputs, and the unchanged ledger prefix", async () => {
	const ledger = JSON.parse(await readFile("/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json", "utf8"));
	for (const arm of ["S1-native", "S1-lite", "S2-lite", "S2-native"]) {
		const cwd = join(batchRoot, "worktrees", arm);
		const manifest = JSON.parse(await readFile(join(batchRoot, "manifests", `${arm}.json`), "utf8"));
		const pair = arm.slice(0, 2);
		const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
		const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd, encoding: "buffer" });
		const paths = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer" }).toString().split("\0").filter(Boolean).sort();
		const files = await Promise.all(paths.map(async path => ({ path, sha256: sha256(await readFile(join(cwd, path))) })));
		assert.equal(manifest.batchId, "20261028T010659");
		assert.equal(manifest.attemptId, "reopen-a1");
		assert.equal(manifest.pair, pair);
		assert.equal(manifest.gitTree, tree);
		assert.equal(manifest.workspaceSha256, sha256(JSON.stringify({ tree, diffSha256: sha256(diff), files })));
		assert.equal(manifest.ledgerPrefixCount, ledger.events.length);
		assert.equal(manifest.ledgerEventsSha256, sha256(JSON.stringify(ledger.events)));
		assert.equal(manifest.ledgerReservedUsd, ledger.reservedUsd);
	}
});

test("runtime lock binds installed Pi entrypoints and pi-subagents execution files by content", async () => {
	const lock = JSON.parse(await readFile(join(batchRoot, "config/runtime-lock.json"), "utf8"));
	const subagents = JSON.parse(await readFile(join(batchRoot, "config/pi-subagents-runtime-manifest.json"), "utf8"));
	const pi = JSON.parse(await readFile(join(batchRoot, "config/pi-runtime-manifest.json"), "utf8"));
	assert.equal(lock.runtime.piInstallRoot, "/home/tcuni-claw/.pi/agent/install/releases/1.4.0");
	assert.equal(lock.runtime.piLauncher, "/home/tcuni-claw/.pi/agent/bin/pi");
	assert.equal(lock.runtime.piSubagentsRoot, "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents");
	assert.equal(lock.runtime.piSubagentsRuntimeManifestSha256, sha256(await readFile(join(batchRoot, "config/pi-subagents-runtime-manifest.json"))));
	assert.equal(lock.runtime.piRuntimeManifestSha256, sha256(await readFile(join(batchRoot, "config/pi-runtime-manifest.json"))));
	assert.equal(subagents.fileCount, subagents.files.length);
	assert.ok(subagents.files.some(file => file.path === "bundle/index.js"));
	for (const file of subagents.files) assert.equal(sha256(await readFile(join(subagents.packageRoot, file.path))), file.sha256, file.path);
	assert.equal(pi.version, "1.4.0");
	assert.equal(pi.entrypoint, "/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
	assert.equal(pi.fileCount, pi.files.length);
	for (const file of pi.files) assert.equal(sha256(await readFile(join("/home/tcuni-claw/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-coding-agent", file.path))), file.sha256, file.path);
});
