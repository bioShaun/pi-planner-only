import assert from "node:assert/strict";
import { DelegationAborted, DelegationRefused } from "./delegate.ts";
import { TaskSpecContractError } from "./task.ts";
import {
	BLOCK_AT,
	HARD_STOP_AT,
	NOTICE_AT,
	RefusalBreaker,
	canonicalJson,
	isRefusal,
	refusalCodeOf,
} from "./refusal-breaker.ts";

// ============================================================================
// refusal-breaker.test.mjs — ticket 16. The state machine is pure; the tests
// pin the streak semantics (same code continues, different code resets,
// success clears), the notice escalation ladder, and the isRefusal boundary
// (pre-launch refusals only — aborts and store errors never count).
// ============================================================================

assert.equal(NOTICE_AT, 2);
assert.equal(HARD_STOP_AT, 3);
assert.equal(BLOCK_AT, 4);

// canonicalJson: key order and undefined noise are not different arguments.
{
	assert.equal(canonicalJson({ a: 1, b: { x: 1, y: 2 } }), canonicalJson({ b: { y: 2, x: 1 }, a: 1 }));
	assert.equal(canonicalJson({ a: 1, b: undefined }), canonicalJson({ a: 1 }));
	assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
	assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: "1" }));
	assert.equal(canonicalJson([1, { b: 2, a: 1 }]), canonicalJson([1, { a: 1, b: 2 }]));
}

// isRefusal: pre-launch refusals only.
{
	assert.equal(isRefusal(new DelegationRefused("TASK_UNKNOWN", "planner_delegate refused: unknown Task T-x")), true);
	assert.equal(isRefusal(new TaskSpecContractError("TASKSPEC_VALIDATION_INCOMPLETE", "createTaskSpec refused: …")), true);
	assert.equal(isRefusal(new Error("git_commit refused: push is unsupported")), true);
	assert.equal(isRefusal(new Error("planner_verdict refused (stale-evidence, task=T-1, verdict=pass): re-sample first")), true);
	assert.equal(isRefusal(new Error("planner_verdict: unknown task T-1.")), true);
	assert.equal(isRefusal(new Error("planner_redelegate refused: unknown Task T-x")), true);

	assert.equal(isRefusal(new DelegationAborted("T-1")), false, "an accepted-then-cancelled launch is not a refusal");
	assert.equal(isRefusal(new Error("boom")), false);
	assert.equal(isRefusal(new Error("planner_verdict refused (store-error, task=T-1, verdict=pass): disk full")), false, "store errors are operational, not refusals");
	assert.equal(isRefusal("planner_delegate refused: not an Error"), false, "non-Error values never count");
	assert.equal(isRefusal(undefined), false);
}

// refusalCodeOf: structured code wins; the first message line is the fallback.
{
	assert.equal(refusalCodeOf(new DelegationRefused("WRITER_CONFLICT", "planner_delegate refused: …", "T-1")), "WRITER_CONFLICT");
	assert.equal(refusalCodeOf(new TaskSpecContractError("TASKSPEC_VALIDATION_INCOMPLETE", "line one\nline two")), "TASKSPEC_VALIDATION_INCOMPLETE");
	assert.equal(refusalCodeOf(new Error("git_commit refused: x\nsecond line")), "git_commit refused: x");
}

// The escalation ladder: same (tool, args, code) repeats count up; the fourth
// identical call is what the hook blocks.
{
	const breaker = new RefusalBreaker();
	const params = { role: "worker", objective: "x", taskId: "T-20200101-001" };
	const refusal = () => new DelegationRefused("TASK_UNKNOWN", "planner_delegate refused: unknown Task T-20200101-001; omit taskId to create a new Task, or pass the id of an existing Task");

	const first = breaker.observeRefusal("planner_delegate", "call-1", params, refusal());
	assert.equal(first.count, 1);
	assert.equal(first.notice, undefined);
	assert.equal(first.hardStop, false);
	assert.equal(first.previousToolCallId, undefined);
	assert.equal(breaker.shouldBlock("planner_delegate", params).block, false);

	const second = breaker.observeRefusal("planner_delegate", "call-2", params, refusal());
	assert.equal(second.count, 2);
	assert.equal(second.previousToolCallId, "call-1");
	assert.match(second.notice, /Repeat notice: 本边界收到的规范化参数相同 \(observed boundary: root tool input; previous toolCallId: call-1; refusal code: TASK_UNKNOWN; missing fields: none\)/);
	assert.doesNotMatch(second.notice, /^STOP:/);
	assert.equal(second.hardStop, false);
	assert.equal(breaker.shouldBlock("planner_delegate", params).block, false);

	const third = breaker.observeRefusal("planner_delegate", "call-3", params, refusal());
	assert.equal(third.count, 3);
	assert.equal(third.previousToolCallId, "call-2");
	assert.match(third.notice, /^STOP: this exact call has now been refused 3 times with TASK_UNKNOWN\./);
	assert.match(third.notice, /Do not call planner_delegate again with these arguments/);
	assert.match(third.notice, /Repeat notice:/);
	assert.equal(third.hardStop, true);

	const blocked = breaker.shouldBlock("planner_delegate", params);
	assert.equal(blocked.block, true, "the fourth identical call is intercepted pre-execution");
	assert.equal(blocked.reason, "planner-only: identical call refused 3 times with TASK_UNKNOWN; blocked. Change the arguments or ask the user.");
}

// Key-order-only differences still hit the same key.
{
	const breaker = new RefusalBreaker();
	const refusal = () => new Error("git_commit refused: Task T-1 is blocked; only completed Tasks may be committed.");
	breaker.observeRefusal("git_commit", "c1", { taskId: "T-1", message: "m" }, refusal());
	const again = breaker.observeRefusal("git_commit", "c2", { message: "m", taskId: "T-1" }, refusal());
	assert.equal(again.count, 2, "key order does not make different arguments");
}

// A different code on the same key restarts the streak; a different tool or
// different params never touch it.
{
	const breaker = new RefusalBreaker();
	const params = { taskId: "T-1" };
	breaker.observeRefusal("planner_delegate", "c1", params, new DelegationRefused("TASK_UNKNOWN", "…"));
	breaker.observeRefusal("planner_delegate", "c2", params, new DelegationRefused("TASK_UNKNOWN", "…"));
	const changed = breaker.observeRefusal("planner_delegate", "c3", params, new DelegationRefused("TASK_FOREIGN_WORKSPACE", "…"));
	assert.equal(changed.count, 1, "a different code is progress, not a repeat");
	assert.equal(changed.notice, undefined);
	assert.equal(changed.previousToolCallId, undefined);

	const otherTool = breaker.observeRefusal("planner_verdict", "c4", params, new DelegationRefused("TASK_FOREIGN_WORKSPACE", "…"));
	assert.equal(otherTool.count, 1, "the key includes the tool name");
	const otherParams = breaker.observeRefusal("planner_delegate", "c5", { taskId: "T-2" }, new DelegationRefused("TASK_FOREIGN_WORKSPACE", "…"));
	assert.equal(otherParams.count, 1, "the key includes the arguments");
}

// observeSuccess clears the streak for that key only.
{
	const breaker = new RefusalBreaker();
	const params = { a: 1 };
	const refusal = () => new Error("git_commit refused: nope");
	breaker.observeRefusal("git_commit", "c1", params, refusal());
	breaker.observeRefusal("git_commit", "c2", params, refusal());
	breaker.observeSuccess("git_commit", params);
	const after = breaker.observeRefusal("git_commit", "c3", params, refusal());
	assert.equal(after.count, 1, "success on the same key clears the entry");
	// A success under a different tool does not clear this one.
	breaker.observeRefusal("planner_delegate", "d1", params, refusal());
	breaker.observeSuccess("planner_verdict", params);
	const still = breaker.observeRefusal("planner_delegate", "d2", params, refusal());
	assert.equal(still.count, 2, "success is keyed by (tool, args), not args alone");
}

// reset() empties the table (session_start).
{
	const breaker = new RefusalBreaker();
	const params = { a: 1 };
	const refusal = () => new Error("git_commit refused: nope");
	breaker.observeRefusal("git_commit", "c1", params, refusal());
	breaker.observeRefusal("git_commit", "c2", params, refusal());
	breaker.observeRefusal("git_commit", "c3", params, refusal());
	assert.equal(breaker.shouldBlock("git_commit", params).block, true);
	breaker.reset();
	assert.equal(breaker.shouldBlock("git_commit", params).block, false);
	assert.equal(breaker.observeRefusal("git_commit", "c4", params, refusal()).count, 1);
}

// isRefusal'd errors keep counting under observeRefusal regardless of class —
// the wrapper decides by isRefusal; observeRefusal itself just records.
{
	const breaker = new RefusalBreaker();
	const observation = breaker.observeRefusal("git_commit", "c1", { taskId: "T-9" }, new Error("git_commit refused: nope"));
	assert.equal(observation.count, 1);
}

// --------------------------------------------------------------------------
// Ticket 03: Missing fields summary & commands variation participates in key
// --------------------------------------------------------------------------
{
	const breaker = new RefusalBreaker();
	const paramsIncomplete = {
		role: "worker",
		objective: "fix issue",
		validation: { required: true },
	};
	const refusalIncomplete = () => new Error("createTaskSpec refused: validation.commands is required and must contain at least one non-empty command when validation.required is true");

	breaker.observeRefusal("planner_delegate", "call-missing-1", paramsIncomplete, refusalIncomplete());
	const second = breaker.observeRefusal("planner_delegate", "call-missing-2", paramsIncomplete, refusalIncomplete());
	assert.equal(second.count, 2);
	assert.match(second.notice, /missing fields: validation\.commands/);
	assert.match(second.notice, /observed boundary: root tool input/);

	// Incident sample command: passing commands produces a distinct canonical key,
	// allowing genuine correction to not be blocked by the previous refusal streak.
	const incidentCommand = "cd skills/herdr-pair && python3 -m unittest tests.test_pairctl -v";
	const paramsCorrected = {
		role: "worker",
		objective: "fix issue",
		validation: { required: true, commands: [incidentCommand] },
	};
	const refusalOther = () => new Error("another refusal");
	const correctedObs = breaker.observeRefusal("planner_delegate", "call-corrected", paramsCorrected, refusalOther());
	assert.equal(correctedObs.count, 1, "corrected commands produce a new key, count resets to 1");

	// Commands order difference produces different key
	const paramsOrder1 = { commands: ["cmd1", "cmd2"] };
	const paramsOrder2 = { commands: ["cmd2", "cmd1"] };
	assert.notEqual(canonicalJson(paramsOrder1), canonicalJson(paramsOrder2), "array order is preserved in canonicalJson");
}

console.log("refusal-breaker.test.mjs: all cases passed");

