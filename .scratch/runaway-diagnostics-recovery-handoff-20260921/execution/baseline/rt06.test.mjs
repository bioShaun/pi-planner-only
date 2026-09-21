import assert from "node:assert/strict";
import { dirtyPathsOutsideTruth, parseGitStatusPaths, resolveGitCommit } from "./git-audit.ts";
import { exportSessionEvidence } from "./usage.ts";
import { rootReadLimitNotice } from "./index.ts";

const plan = resolveGitCommit({ taskId: "T-20260912-027", cwd: "/repo", truthPaths: ["src/index.ts"], message: "Implement commit primitive" });
assert.equal(plan.ok, true);
if (plan.ok) {
	assert.deepEqual(plan.addArgv, ["add", "--", "src/index.ts"]);
	assert.match(plan.message, /T-20260912-027/);
}
assert.equal(resolveGitCommit({ taskId: "T-pending", cwd: "/repo", truthPaths: ["src/index.ts"] }).ok, false);
// Real `git status --porcelain=v2` separates the path with a SPACE (a tab only
// splits the two paths of a rename). The previous fixture used a tab, which the
// buggy parser happened to accept; keep the fixture faithful to git output.
assert.deepEqual(parseGitStatusPaths("1 .M N... 100644 100644 100644 abc abc src/index.ts\n? notes.txt\n"), ["src/index.ts", "notes.txt"]);
// A modified tracked truth path must not be reported as an external dirty path.
assert.deepEqual(dirtyPathsOutsideTruth(parseGitStatusPaths("1 .M N... 100644 100644 100644 abc abc src/index.ts\n"), ["src/index.ts"]), []);
assert.deepEqual(dirtyPathsOutsideTruth(["src/index.ts", "notes.txt"], ["src/index.ts"]), ["notes.txt"]);

assert.match(rootReadLimitNotice({ startLine: 1, endLine: 201 }) ?? "", /200/);
assert.equal(rootReadLimitNotice({ startLine: 1, endLine: 200 }), undefined);

const evidence = exportSessionEvidence({
	rootSessionId: "session-rt06",
	tasks: [
		{ taskId: "T-1", rootSessionId: "session-rt06", state: "closed-superseded", completionKind: "superseded", reportCorrections: 2, reports: [], reviews: [], usage: { root: {}, children: [] } },
		{ taskId: "T-2", rootSessionId: "session-rt06", state: "completed", completionKind: "committed", reports: [], reviews: [], usage: { root: {}, children: [] } },
	],
	runRecords: [{ rootSessionId: "session-rt06", taskId: "T-2", executionId: "e1", executionState: "terminal", ingestionState: "recorded" }],
	usageEntries: [{ taskId: "foreign-task", child: { input: 4, output: 2, costUsd: 0.5, runId: "foreign" } }],
});
assert.equal(evidence.breakdown.superseded, 1);
assert.equal(evidence.breakdown.committed, 1);
assert.equal(evidence.breakdown.envelopeRepairs, 2);
assert.equal(evidence.breakdown.foreignChildSpend.count, 1);
assert.equal(evidence.breakdown.foreignChildSpend.tokens, 6);
assert.deepEqual(evidence.usage.breakdown, evidence.breakdown);

console.log("rt06: PASS");
