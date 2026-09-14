import assert from "node:assert/strict";
import { parseSubagentNotify, readChildMeta, readLargestRunOutput, tempRootFromAsyncDir, verifySessionFileBinding } from "./notify.ts";

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

// Regression: readLargestRunOutput prefers role-bearing events.jsonl over output-0.log
{
	const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-notify-events-"));
	try {
		const asyncDir = join(dir, "async-subagent-runs", "run-ingest-test");
		mkdirSync(asyncDir, { recursive: true });

		const promptCompleted = JSON.stringify({
			version: 1, taskId: "T-diag-001", status: "completed", summary: "Scoped change is done.",
			changedFiles: [], validation: [{ command: "npm test", type: "test", status: "not-run", summary: "not run" }],
			evidence: { taskId: "T-diag-001" }, risks: [], unresolved: [],
		});
		const assistantPartial = JSON.stringify({
			version: 1, taskId: "T-diag-001", status: "partial", summary: "Real diagnosis was partial.",
			changedFiles: [], validation: [{ command: "npm test", type: "diagnostic", status: "not-run", summary: "replay not run" }],
			evidence: { taskId: "T-diag-001", cwd: "/public/pi/pi-planner-only" },
			risks: ["risk a"], unresolved: ["unresolved item 1"],
		});

		// Write output-0.log containing prompt completed at top and partial at bottom
		writeFileSync(join(asyncDir, "output-0.log"), [
			`Task:\n${promptCompleted}`,
			"Running tool ls...",
			"Tool finished.",
			assistantPartial,
		].join("\n"));

		// Write events.jsonl with role markers
		writeFileSync(join(asyncDir, "events.jsonl"), [
			JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: `Task:\n${promptCompleted}` }] } }),
			JSON.stringify({ type: "tool_execution_end", toolName: "read", result: { content: [{ type: "text", text: "tool result" }] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: assistantPartial }] } }),
		].join("\n"));

		// readLargestRunOutput MUST pick the assistant partial from events.jsonl, not output-0.log
		const output = readLargestRunOutput(asyncDir, "run-ingest-test");
		assert.ok(output);
		assert.match(output, /"status":\s*"partial"/);
		assert.match(output, /Real diagnosis was partial/);
		assert.doesNotMatch(output, /Scoped change is done/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Regression: Modern async run MUST NOT fall back to output-0.log when events is missing/role-less and session is unreadable
{
	const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-notify-fallback-"));
	try {
		const asyncDir = join(dir, "async-subagent-runs", "run-stdout-fallback-test");
		mkdirSync(asyncDir, { recursive: true });

		const promptCompleted = JSON.stringify({
			version: 1, taskId: "T-diag-001", status: "completed", summary: "Scoped change is done.",
			changedFiles: [], validation: [{ command: "npm test", type: "test", status: "not-run", summary: "not run" }],
			evidence: { taskId: "T-diag-001" }, risks: [], unresolved: [],
		});
		const toolHistoryCompleted = JSON.stringify({
			version: 1, taskId: "T-diag-001", status: "completed", summary: "tool history completed report",
			changedFiles: [], validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "ok" }],
			evidence: { taskId: "T-diag-001" }, risks: [], unresolved: [],
		});

		// output-0.log contains prompt and tool history with completed report
		writeFileSync(join(asyncDir, "output-0.log"), [
			`Task:\n${promptCompleted}`,
			"Executing tool bash...",
			`Tool stdout: ${toolHistoryCompleted}`,
			"Runner process terminated prematurely.",
		].join("\n"));

		// 1. events.jsonl missing, status.json missing -> MUST return undefined, NOT output-0.log
		const outputNoEvents = readLargestRunOutput(asyncDir, "run-stdout-fallback-test");
		assert.equal(outputNoEvents, undefined, "modern async run must not fall back to output-0.log when events/status missing");

		// 2. events.jsonl has no roles (runner events only), status session unreadable -> MUST return undefined
		writeFileSync(join(asyncDir, "events.jsonl"), [
			JSON.stringify({ type: "subagent.run.started", runId: "run-stdout-fallback-test" }),
			JSON.stringify({ type: "subagent.step.started", stepIndex: 0 }),
		].join("\n"));
		writeFileSync(join(asyncDir, "status.json"), JSON.stringify({
			steps: [{ agent: "worker", sessionFile: join(asyncDir, "nonexistent-session.jsonl") }],
		}));
		const outputRoleless = readLargestRunOutput(asyncDir, "run-stdout-fallback-test");
		assert.equal(outputRoleless, undefined, "modern async run must not fall back to output-0.log when events has no roles and session missing");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Regression: status.json with multiple steps selects by exact binding; never silently picks steps[0]
{
	const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-notify-multistep-"));
	try {
		const asyncDir = join(dir, "async-subagent-runs", "run-multistep-test");
		mkdirSync(asyncDir, { recursive: true });

		const step0Report = JSON.stringify({
			version: 1, taskId: "T-multi", status: "completed", summary: "Step 0 worker output.",
			changedFiles: ["a.ts"], validation: [], evidence: { taskId: "T-multi" }, risks: [], unresolved: [],
		});
		const step1Report = JSON.stringify({
			version: 1, taskId: "T-multi", status: "completed", summary: "Step 1 reviewer output.",
			changedFiles: [], validation: [], evidence: { taskId: "T-multi" }, risks: [], unresolved: [],
		});

		writeFileSync(join(asyncDir, "step0-session.jsonl"), [
			JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "task" }] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: step0Report }] } }),
		].join("\n"));

		writeFileSync(join(asyncDir, "step1-session.jsonl"), [
			JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "review task" }] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: step1Report }] } }),
		].join("\n"));

		writeFileSync(join(asyncDir, "status.json"), JSON.stringify({
			runId: "run-multistep-test",
			steps: [
				{ agent: "worker", sessionFile: join(asyncDir, "step0-session.jsonl") },
				{ agent: "reviewer", sessionFile: join(asyncDir, "step1-session.jsonl") },
			],
		}));

		// Exact binding by agent = reviewer -> picks step 1
		const outputByAgent = readLargestRunOutput(asyncDir, "run-multistep-test", { agent: "reviewer" });
		assert.ok(outputByAgent);
		assert.match(outputByAgent, /Step 1 reviewer output/);
		assert.doesNotMatch(outputByAgent, /Step 0 worker output/);

		// Exact binding by stepIndex = 1 -> picks step 1
		const outputByStep = readLargestRunOutput(asyncDir, "run-multistep-test", { stepIndex: 1 });
		assert.ok(outputByStep);
		assert.match(outputByStep, /Step 1 reviewer output/);

		// Ambiguous: no binding provided -> must NOT default to steps[0]
		const outputAmbiguous = readLargestRunOutput(asyncDir, "run-multistep-test");
		assert.equal(outputAmbiguous, undefined, "multi-step run without binding must be treated as ambiguous, not steps[0]");

		// Unmatched binding -> returns undefined
		const outputUnmatched = readLargestRunOutput(asyncDir, "run-multistep-test", { agent: "nonexistent-agent" });
		assert.equal(outputUnmatched, undefined, "unmatched agent must return undefined");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Regression: Accurate session binding, external session recovery, and strict failure on sibling/symlink/ambiguity
{
	const { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-notify-binding-"));
	try {
		const runA = join(dir, "async-subagent-runs", "run-A");
		const runB = join(dir, "async-subagent-runs", "run-B");
		const extDir = join(dir, "external-sessions");
		mkdirSync(runA, { recursive: true });
		mkdirSync(runB, { recursive: true });
		mkdirSync(extDir, { recursive: true });

		const reportB = JSON.stringify({
			version: 1, taskId: "T-B", status: "completed", summary: "Sibling run B report",
			changedFiles: [], validation: [], evidence: { taskId: "T-B" }, risks: [], unresolved: [],
		});
		writeFileSync(join(runB, "session.jsonl"), [
			JSON.stringify({ type: "session", version: 3, id: "session-B", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "session_info", name: "subagent-worker-run-B-1" }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: reportB }] } }),
		].join("\n"));

		// 1. Positive: Normal relative session within run-A
		mkdirSync(join(runA, "run-0"), { recursive: true });
		const normalReport = JSON.stringify({
			version: 1, taskId: "T-A", status: "completed", summary: "Normal run-A report",
			changedFiles: [], validation: [], evidence: { taskId: "T-A" }, risks: [], unresolved: [],
		});
		writeFileSync(join(runA, "run-0", "session.jsonl"), [
			JSON.stringify({ type: "session", version: 3, id: "session-A", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: normalReport }] } }),
		].join("\n"));
		writeFileSync(join(runA, "status.json"), JSON.stringify({
			runId: "run-A",
			sessionFile: "run-0/session.jsonl",
		}));
		const normalOutput = readLargestRunOutput(runA, "run-A");
		assert.ok(normalOutput, "normal relative session must be read");
		assert.match(normalOutput, /Normal run-A report/);

		// 2. Positive: Real-shape external session declared in bound status.json (sessionDir is NOT parent of sessionFile)
		mkdirSync(join(extDir, "run-0"), { recursive: true });
		const extFile = join(extDir, "run-0", "session.jsonl");
		const extReport = JSON.stringify({
			version: 1, taskId: "T-EXT", status: "completed", summary: "External bound report",
			changedFiles: [], validation: [], evidence: { taskId: "T-EXT" }, risks: [], unresolved: [],
		});
		writeFileSync(extFile, [
			JSON.stringify({ type: "session", version: 3, id: "session-ext", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: extReport }] } }),
		].join("\n"));
		writeFileSync(join(runA, "status.json"), JSON.stringify({
			runId: "run-A",
			sessionDir: extDir,
			steps: [{ agent: "worker", sessionFile: extFile }],
		}));
		assert.equal(verifySessionFileBinding(extFile, "run-A", { asyncDir: runA, agent: "worker" }), true, "external session declared in bound status.json must verify");
		const extOutput = readLargestRunOutput(runA, "run-A", { agent: "worker" });
		assert.ok(extOutput, "external session must be read by readLargestRunOutput");
		assert.match(extOutput, /External bound report/);

		// 3. Negative: Sibling session mentioning target runId in body text but not matching bound session
		const siblingMentionFile = join(runB, "session.jsonl");
		writeFileSync(siblingMentionFile, [
			JSON.stringify({ type: "session", version: 3, id: "session-mention", timestamp: new Date().toISOString() }),
			JSON.stringify({
				type: "message",
				message: {
					role: "user",
					content: [{ type: "text", text: "Please review sibling run-A error report." }],
				},
			}),
			JSON.stringify({
				type: "message_end",
				message: {
					role: "assistant",
					content: [{ type: "text", text: JSON.stringify({ version: 1, taskId: "T-B", status: "completed", summary: "Sibling leaked" }) }],
				},
			}),
		].join("\n"));
		assert.equal(verifySessionFileBinding(siblingMentionFile, "run-A", { asyncDir: runA, agent: "worker" }), false, "sibling session mentioning target runId must be rejected");

		// 4. Negative: Relative path traversal attempting to escape asyncDir
		writeFileSync(join(runA, "status.json"), JSON.stringify({
			runId: "run-A",
			sessionFile: "../run-B/session.jsonl",
		}));
		assert.equal(verifySessionFileBinding("../run-B/session.jsonl", "run-A", { asyncDir: runA }), false, "relative path traversal escaping asyncDir must be refused");

		// 5. Negative: Symlink escape
		const symlinkPath = join(runA, "symlink.jsonl");
		try { rmSync(symlinkPath, { force: true }); } catch {}
		symlinkSync(join(runB, "session.jsonl"), symlinkPath);
		assert.equal(verifySessionFileBinding(symlinkPath, "run-A", { asyncDir: runA }), false, "symlink escaping asyncDir must be refused");

		// 6. Negative: Wrong status.runId
		const wrongRunDir = join(dir, "async-subagent-runs", "run-wrong");
		mkdirSync(wrongRunDir, { recursive: true });
		writeFileSync(join(wrongRunDir, "status.json"), JSON.stringify({
			runId: "run-WRONG",
			sessionFile: extFile,
		}));
		assert.equal(verifySessionFileBinding(extFile, "run-A", { asyncDir: wrongRunDir }), false, "mismatched status.runId must fail");
		assert.equal(readLargestRunOutput(wrongRunDir, "run-A"), undefined, "mismatched status.runId must not be read");

		// 7. Negative: Status in unbound directory
		const unboundDir = join(dir, "unbound-dir");
		mkdirSync(unboundDir, { recursive: true });
		writeFileSync(join(unboundDir, "status.json"), JSON.stringify({
			runId: "run-unbound",
			sessionFile: extFile,
		}));
		assert.equal(verifySessionFileBinding(extFile, "run-A", { asyncDir: unboundDir }), false, "status in unbound directory must fail");

		// 8. Negative: Ambiguous same-named agent steps
		const ambiguousDir = join(dir, "async-subagent-runs", "run-ambiguous");
		mkdirSync(ambiguousDir, { recursive: true });
		writeFileSync(join(ambiguousDir, "status.json"), JSON.stringify({
			runId: "run-ambiguous",
			steps: [
				{ agent: "worker", sessionFile: extFile },
				{ agent: "worker", sessionFile: join(extDir, "other.jsonl") },
			],
		}));
		assert.equal(verifySessionFileBinding(extFile, "run-ambiguous", { asyncDir: ambiguousDir, agent: "worker" }), false, "ambiguous same-named agent steps must fail");
		assert.equal(readLargestRunOutput(ambiguousDir, "run-ambiguous", { agent: "worker" }), undefined, "ambiguous steps must not be read");

		// 9. Positive & Negative: Multi-step exact binding and out-of-bounds
		const multiDir = join(dir, "async-subagent-runs", "run-multi-index");
		mkdirSync(multiDir, { recursive: true });
		const step0File = join(extDir, "step0.jsonl");
		const step1File = join(extDir, "step1.jsonl");
		writeFileSync(step0File, JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "step0" }] } }));
		writeFileSync(step1File, JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "step1" }] } }));
		writeFileSync(join(multiDir, "status.json"), JSON.stringify({
			runId: "run-multi-index",
			steps: [
				{ agent: "step0-agent", sessionFile: step0File },
				{ agent: "step1-agent", sessionFile: step1File },
			],
		}));
		assert.equal(verifySessionFileBinding(step0File, "run-multi-index", { asyncDir: multiDir, stepIndex: 0 }), true, "exact step 0 must verify");
		assert.equal(verifySessionFileBinding(step1File, "run-multi-index", { asyncDir: multiDir, stepIndex: 0 }), false, "step 1 candidate against step 0 must fail");
		assert.equal(verifySessionFileBinding(step0File, "run-multi-index", { asyncDir: multiDir, stepIndex: 5 }), false, "out of bounds stepIndex must fail");

		// 10. Negative: Session missing final assistant message must NOT fall back to runner stdout
		const noAssistantDir = join(dir, "async-subagent-runs", "run-no-assistant");
		mkdirSync(noAssistantDir, { recursive: true });
		const noAssistantSession = join(noAssistantDir, "session.jsonl");
		writeFileSync(noAssistantSession, JSON.stringify({
			type: "message",
			message: { role: "user", content: [{ type: "text", text: "prompt only, no assistant reply" }] },
		}));
		writeFileSync(join(noAssistantDir, "output-0.log"), "STDOUT output that must NEVER be returned as fallback");
		writeFileSync(join(noAssistantDir, "status.json"), JSON.stringify({
			runId: "run-no-assistant",
			sessionFile: "session.jsonl",
		}));
		assert.equal(readLargestRunOutput(noAssistantDir, "run-no-assistant"), undefined, "missing final assistant must not fall back to stdout");

		// 11. Read-only playback of real sample run 927d07f0-c193-428b-b226-6daa851ec308
		const realRunId = "927d07f0-c193-428b-b226-6daa851ec308";
		const realAsyncDir = `/tmp/pi-subagents-uid-1000/async-subagent-runs/${realRunId}`;
		const realSessionFile = "/public/pi/pi-planner-only/.scratch/nx-followups/host-validation/session-binding-fix-sessions/4432154a-dcd3-42a1-bb15-57b57b25ffc4/run-0/session.jsonl";
		if (existsSync(realAsyncDir) && existsSync(realSessionFile)) {
			const realVerified = verifySessionFileBinding(realSessionFile, realRunId, { asyncDir: realAsyncDir, agent: "worker" });
			assert.equal(realVerified, true, "real run sessionFile binding must verify successfully");
			const realOutput = readLargestRunOutput(realAsyncDir, realRunId, { agent: "worker" });
			assert.ok(realOutput, "real run output must be read successfully");
			assert.match(realOutput, /acceptance-report/, "real run output must extract acceptance-report");
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}


console.log("planner-only notify: PASS");
