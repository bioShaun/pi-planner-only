import assert from "node:assert/strict";
import { ROOT_TOOLS, decidePolicy, isSafeAuditCommand } from "./policy.ts";
import { TASKSPEC_EXAMPLE_SENTINEL, buildTaskSpecExample, buildTaskSpecRepair, validateTaskSpec } from "./task.ts";


// R01 — parse the fenced example out of a refusal reason (never a snapshot of
// the whole reason or of helper names).
function exampleFromReason(reason) {
	const match = reason.match(/```json\n([\s\S]*?)\n```/);
	assert.ok(match, "refusal carries a fenced JSON example");
	return JSON.parse(match[1]);
}

// ==========================================================================
// Ticket 05 B — post-cutover path (no legacyDelegation flag)
// ==========================================================================

function cutover(toolName, input = undefined, liveTask = true) {
	return decidePolicy({ toolName, input, isChild: false, disabled: false, liveTask });
}

// subagent and bg_wait are refused outright: static reason, no TaskSpec
// repair, and the input is never read — a valid embedded TaskSpec changes
// nothing, and neither does the composite {gate, workflow} shape.
{
	const spec = buildTaskSpecExample({ toolName: "subagent", input: { agent: "worker" } });
	const decision = cutover("subagent", { agent: "worker", task: JSON.stringify(spec) });
	assert.equal(decision.block, true);
	assert.match(decision.reason, /^Planner-only guard: the parent process may not call 'subagent'\./);
	assert.ok(decision.reason.includes("planner_delegate"), "the refusal names the replacement tool");
	assert.equal(decision.reason.includes("```json"), false, "the cutover refusal carries no repair example");

	const composite = cutover("subagent", { agent: "worker", gate: "npm test", workflow: "review" });
	assert.equal(composite.block, true);
	assert.equal(composite.reason, decision.reason, "the composite shape gets the same cutover refusal");

	for (const live of [true, false]) {
		const wait = cutover("bg_wait", { id: "run-1" }, live);
		assert.equal(wait.block, true, `bg_wait is refused (liveTask=${live})`);
		assert.match(wait.reason, /may not call 'bg_wait'/);
		assert.ok(wait.reason.includes("no asynchronous wait"));
	}
}

// Live allowlist: inspect, questions, Root tools, safe-shell Git-read.
assert.equal(cutover("read", { path: "x" }).block, false);
assert.equal(cutover("question", {}).block, false);
assert.equal(cutover("questionnaire", {}).block, false);
assert.equal(cutover("planner_delegate", { role: "worker", objective: "x" }).block, false);
assert.equal(cutover("planner_redelegate", { taskId: "T-20260916-001", role: "worker", objective: "x" }).block, false);
assert.equal(cutover("planner_tasks", {}).block, false);
assert.equal(cutover("planner_verdict", { verdict: "pass", summary: "x" }).block, false);
assert.equal(cutover("git_audit", { operation: "status" }).block, false);
assert.equal(cutover("bash", { command: "git status --short" }).block, false);
// The async receipt tools lose the live allowlist with the cutover.
for (const name of ["subagent_wait", "subagent_supervisor", "contact_supervisor"]) {
	assert.equal(cutover(name, {}).block, true, `${name} is refused post-cutover`);
}
const liveRefusal = cutover("write", { path: "x" });
assert.equal(liveRefusal.block, true);
assert.ok(liveRefusal.reason.includes("```json"), "non-delegation refusals keep the TaskSpec repair");
assert.ok(liveRefusal.reason.includes("planner_delegate"), "the repair text names planner_delegate");

// Idle allowlist is IDLE_TOOLS + questions; the legacy recovery tool is gone.
for (const name of ["planner_delegate", "planner_redelegate", "planner_tasks", "planner_verdict", "git_audit", "question", "questionnaire"]) {
	assert.equal(cutover(name, {}, false).block, false, `${name} is allowed while Idle`);
}
const idleRead = cutover("read", { path: "x" }, false);
assert.equal(idleRead.block, true);
assert.match(idleRead.reason, /idle for gather/);
assert.ok(idleRead.reason.includes("```json"), "the Idle repair still applies to inspect tools");
assert.equal(idleRead.reason.includes("bg_wait"), false, "the Idle reason no longer offers bg_wait recovery");

// The isChild/disabled short-circuits precede the flag check.
assert.equal(decidePolicy({ toolName: "subagent", isChild: true, disabled: false }).block, false);
assert.equal(decidePolicy({ toolName: "subagent", isChild: false, disabled: true }).block, false);

// Live-phase allow/deny under the post-cutover policy.
const blocked = (toolName, input) => cutover(toolName, input).block;
assert.equal(blocked("read", { path: "/tmp/a" }), false);
assert.equal(blocked("contact_supervisor", {}), true, "the async supervisor tools left the live allowlist at the cutover");
assert.equal(blocked("git_audit", { operation: "status" }), false);
assert.equal(blocked("git_audit", { operation: "diff-stat", staged: true }), false);
// v0.3 V-1: planner_verdict is a first-class Root tool; the policy never blocks it
assert.ok(ROOT_TOOLS.has("git_audit"));
assert.ok(ROOT_TOOLS.has("planner_verdict"));
assert.ok(ROOT_TOOLS.has("planner_delegate"));
assert.ok(ROOT_TOOLS.has("planner_redelegate"));
assert.ok(ROOT_TOOLS.has("planner_tasks"));
assert.equal(blocked("planner_delegate", { role: "worker", objective: "x" }), false);
assert.equal(blocked("planner_redelegate", { taskId: "T-20260916-001", role: "reviewer", objective: "x" }), false);
assert.equal(blocked("planner_verdict", { verdict: "pass", summary: "looks good" }), false);
assert.equal(blocked("functions.grep", { pattern: "x" }), true);
assert.equal(blocked("subagent", { agent: "worker" }), true, "subagent is refused regardless of shape");
assert.equal(blocked("write", { path: "/tmp/a" }), true);
assert.equal(blocked("edit", { path: "/tmp/a" }), true);
assert.equal(blocked("bash", { command: "npm test" }), true);
assert.equal(blocked("unknown_mutator", {}), true);
// git_audit is a first-class tool, but it never widens into a shell
assert.equal(blocked("git_audit", { operation: "reset --hard" }), false, "input validation is the tool's job");
assert.equal(blocked("bash", { command: "git reset --hard" }), true);

assert.equal(isSafeAuditCommand("pwd"), true);
assert.equal(isSafeAuditCommand("git status --short --branch"), true);
assert.equal(isSafeAuditCommand("git diff --cached --stat"), true);
assert.equal(isSafeAuditCommand("git log --oneline -n20"), true);
assert.equal(isSafeAuditCommand("git diff --output=/tmp/leak"), false);
assert.equal(isSafeAuditCommand("git status && rm -rf /tmp/x"), false);
assert.equal(isSafeAuditCommand("pwd $(touch /tmp/x)"), false);


// IS-02/S03/S05 — an invalid validation shape with validation intent is no
// longer silently collapsed to { required: false }. A losslessly convertible
// shape (a plain command list) is repaired with the intent made explicit;
// anything else is needs-input and the refusal provides no resubmittable
// template.
{
	const repaired = buildTaskSpecRepair({
		toolName: "subagent",
		input: { agent: "worker" },
		submitted: { validation: ["npm test"] },
	});
	assert.equal(repaired.status, "repairable");
	assert.deepEqual(repaired.example?.validation, { required: true, commands: ["npm test"] });
	assert.ok(
		repaired.changes.some((change) => change.field === "validation" && /converted/.test(change.reason)),
		"the validation change is disclosed in the summary",
	);

	const unconvertible = buildTaskSpecRepair({
		toolName: "subagent",
		input: { agent: "worker" },
		submitted: { validation: { required: "yes", commands: "npm test" } },
	});
	assert.equal(unconvertible.status, "needs-input");
	assert.deepEqual(unconvertible.unresolvedFields, ["validation"]);
	assert.equal(unconvertible.example, undefined, "no template is produced when the repair is not lossless");
	assert.ok(
		unconvertible.changes.some((change) => change.field === "validation"),
		"the unresolved validation field is called out",
	);
}

// Submitted valid fields are preserved; the sentinel is never treated as an identity.
{
	const example = buildTaskSpecExample({
		toolName: "subagent",
		cwd: "/repo",
		submitted: {
			taskId: "T-20260910-042",
			objective: "real objective",
			role: "worker",
			constraints: ["no new deps"],
			acceptanceCriteria: ["tests pass"],
			validation: { required: true, commands: ["npm test"] },
		},
	});
	assert.deepEqual(validateTaskSpec(example), []);
	assert.equal(example.taskId, "T-20260910-042", "a valid non-sentinel taskId is preserved");
	assert.equal(example.objective, "real objective");
	assert.equal(example.role, "worker");
	assert.deepEqual(example.validation, { required: true, commands: ["npm test"] });
}
// A submitted sentinel stays the sentinel (it is not an identity).
assert.equal(
	buildTaskSpecExample({ toolName: "subagent", input: { agent: "worker" }, submitted: { taskId: TASKSPEC_EXAMPLE_SENTINEL } }).taskId,
	TASKSPEC_EXAMPLE_SENTINEL,
);


console.log("planner-only policy: PASS");
