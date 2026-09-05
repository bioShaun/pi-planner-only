import assert from "node:assert/strict";
import { parseSubagentNotify, readChildMeta, tempRootFromAsyncDir } from "./notify.ts";

// Fixtures generated 2026-09-05 by copying pi-subagents 0.65.1 out of node_modules
// (Node refuses --experimental-strip-types under node_modules) into
// `.planner-only-test-gen-*`, then:
//   node --experimental-strip-types -e
//     "import { formatSingleCompletion, formatGroupedCompletion } from
//      './<copy>/src/runs/background/notify.ts'; … JSON.stringify(…)"
// Source: /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/runs/background/notify.ts
// The strings below are that output, pasted verbatim.

// A single async run has no `Child runs:` line: buildCompletionDetails only
// derives childRuns from results[].runId, which the runner sets for workflow
// children only. This is the shape the extension sees for an ordinary worker.
const SINGLE_FIXTURE = "Background task completed: **worker**\n\nWorker finished the assigned task.";
// Same formatter when a child run id is present (workflow-style correlation).
const SINGLE_WITH_RUNS_FIXTURE = "Background task completed: **worker**\n\nWorker finished the assigned task.\n\nChild runs: abcdef12-3456-7890-abcd-ef1234567890";
const GROUPED_FIXTURE = "Background tasks completed (2): **worker**, **reviewer**\n\n1. worker\nFirst child output.\nChild runs: 11111111-2222-3333-4444-555555555555\n\n2. reviewer\nSecond child output.\nChild runs: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// B5. both pi-subagents fixture formats parse; a foreign custom message returns undefined
{
	const single = parseSubagentNotify(SINGLE_FIXTURE);
	assert.ok(single, "formatSingleCompletion fixture must parse");
	assert.deepEqual(single.runIds, []);
	assert.equal(single.status, "completed");
	assert.equal(single.agent, "worker");
	assert.equal(single.preview, "Worker finished the assigned task.");
	assert.equal(single.truncated, false);
	assert.equal(single.taskIdHint, undefined);
}

{
	const single = parseSubagentNotify(SINGLE_WITH_RUNS_FIXTURE);
	assert.ok(single);
	assert.deepEqual(single.runIds, ["abcdef12-3456-7890-abcd-ef1234567890"]);
	assert.equal(single.preview, "Worker finished the assigned task.");
}

// taskId hint: a complete "taskId" value is extracted; a truncated one is not.
{
	const withReport = parseSubagentNotify(`Background task completed: **worker**\n\n{"version":1,"taskId":"T-20260905-007","status":"completed"}`);
	assert.equal(withReport?.taskIdHint, "T-20260905-007");
	const truncated = parseSubagentNotify(`Background task completed: **worker**\n\n{"version":1,"taskId":"T-2026 ...[preview truncated]`);
	assert.equal(truncated?.taskIdHint, undefined);
	assert.equal(truncated?.truncated, true);
}

// Output lookup resolves the pi-subagents temp root from asyncDir.
{
	assert.equal(tempRootFromAsyncDir("/tmp/pi-subagents-x/async-subagent-runs/run-1"), "/tmp/pi-subagents-x");
	assert.equal(tempRootFromAsyncDir("/tmp/pi-subagents-x/nested-subagent-runs/root-1/run-2"), "/tmp/pi-subagents-x");
	assert.equal(tempRootFromAsyncDir("/no/marker/here"), undefined);
}

{
	const grouped = parseSubagentNotify(GROUPED_FIXTURE);
	assert.ok(grouped, "formatGroupedCompletion fixture must parse");
	assert.deepEqual(grouped.runIds, [
		"11111111-2222-3333-4444-555555555555",
		"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	]);
	assert.equal(grouped.status, "completed");
	assert.equal(grouped.agent, "worker");
	assert.match(grouped.preview, /First child output/);
	assert.match(grouped.preview, /Second child output/);
	assert.equal(grouped.truncated, false);
}

{
	assert.equal(parseSubagentNotify("hello from an unrelated custom message"), undefined);
	assert.equal(parseSubagentNotify(""), undefined);
	assert.equal(parseSubagentNotify("Async: worker [abcdef12]\nThe async run is detached and running in the background."), undefined);
}

// U-3 readChildMeta: async name, sync _0 name, size cap, runId/agent echo, malformed
{
	const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
	try {
		const artifacts = join(dir, "subagent-artifacts");
		mkdirSync(artifacts, { recursive: true });
		const runId = "run-meta-1";
		const agent = "worker";
		const asyncName = `${runId}_${agent}_meta.json`;
		writeFileSync(join(artifacts, asyncName), JSON.stringify({
			runId,
			agent,
			model: "volcengine/glm-5-3",
			usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
		}));
		const hit = readChildMeta([artifacts], runId, agent);
		assert.ok(hit);
		assert.equal(hit.model, "volcengine/glm-5-3");
		assert.equal(hit.usage.input, 10);

		const syncRun = "run-meta-sync";
		writeFileSync(join(artifacts, `${syncRun}_${agent}_0_meta.json`), JSON.stringify({
			runId: syncRun,
			agent,
			model: "qwen-local/qwen3.8-27b:high",
			usage: { input: 3, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 2 },
		}));
		const syncHit = readChildMeta([artifacts], syncRun, agent);
		assert.ok(syncHit);
		assert.equal(syncHit.runId, syncRun);

		assert.equal(readChildMeta([artifacts], runId, "other-agent"), undefined);
		assert.equal(readChildMeta([artifacts], "missing-run", agent), undefined);

		writeFileSync(join(artifacts, "run-bad_worker_meta.json"), "{not json");
		assert.equal(readChildMeta([artifacts], "run-bad", agent), undefined);

		const huge = join(artifacts, "run-huge_worker_meta.json");
		writeFileSync(huge, `${"x".repeat(2 * 1024 * 1024 + 8)}`);
		assert.equal(readChildMeta([artifacts], "run-huge", agent), undefined);

		writeFileSync(join(artifacts, "run-mismatch_worker_meta.json"), JSON.stringify({
			runId: "other",
			agent,
			usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
		}));
		assert.equal(readChildMeta([artifacts], "run-mismatch", agent), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log("planner-only notify: PASS");
