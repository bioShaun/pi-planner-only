import assert from "node:assert/strict";
import { AUDIT_TOOLS, ROOT_TOOLS, decidePolicy, isSafeAuditCommand } from "./policy.ts";
import { TASKSPEC_EXAMPLE_SENTINEL, buildTaskSpecExample, validateTaskSpec } from "./task.ts";

function blocked(toolName, input = undefined) {
	return decidePolicy({ toolName, input, isChild: false, disabled: false }).block;
}

// R01 — parse the fenced example out of a refusal reason (never a snapshot of
// the whole reason or of helper names).
function exampleFromReason(reason) {
	const match = reason.match(/```json\n([\s\S]*?)\n```/);
	assert.ok(match, "refusal carries a fenced JSON example");
	return JSON.parse(match[1]);
}

assert.equal(blocked("read", { path: "/tmp/a" }), false);
assert.equal(blocked("contact_supervisor", {}), false);
assert.equal(blocked("git_audit", { operation: "status" }), false);
assert.equal(blocked("git_audit", { operation: "diff-stat", staged: true }), false);
// v0.3 V-1: planner_verdict is a first-class Root tool; the policy never blocks it
assert.ok(ROOT_TOOLS.has("git_audit"));
assert.ok(ROOT_TOOLS.has("planner_verdict"));
assert.equal(AUDIT_TOOLS, ROOT_TOOLS, "AUDIT_TOOLS stays as an alias export for one release");
assert.equal(blocked("planner_verdict", { verdict: "pass", summary: "looks good" }), false);
assert.equal(
	decidePolicy({ toolName: "planner_verdict", input: { verdict: "blocked", summary: "x" }, isChild: false, disabled: true }).block,
	false,
	"planner_verdict stays unblocked when the guard is off",
);
assert.equal(blocked("functions.grep", { pattern: "x" }), true);
assert.equal(blocked("subagent", { agent: "worker" }), false);
assert.equal(blocked("subagent", { workflow: "review", args: { task: "Review" } }), true);
assert.equal(blocked("subagent", { workflow: "run-ci", args: { command: "npm test" } }), true);
assert.equal(blocked("subagent", { agent: "worker", gate: "npm test" }), true);
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

assert.equal(
	decidePolicy({ toolName: "write", isChild: true, disabled: false }).block,
	false,
);
assert.equal(
	decidePolicy({ toolName: "write", isChild: false, disabled: true }).block,
	false,
);

// ==========================================================================
// R01 — pasteable TaskSpec example JSON in parent-tool refusals
// ==========================================================================

// bash refusal: first line kept, fenced example validates, command → objective + Explorer.
{
	const decision = decidePolicy({
		toolName: "bash",
		input: { command: "npm test" },
		isChild: false,
		disabled: false,
		cwd: "/repo",
	});
	assert.equal(decision.block, true);
	assert.match(
		decision.reason,
		/^Planner-only guard: the parent process may not call 'bash' directly\./,
		"the existing first line of the block reason is kept",
	);
	const example = exampleFromReason(decision.reason);
	assert.deepEqual(validateTaskSpec(example), [], "the example passes TaskSpec validation");
	assert.equal(example.objective, "Run this command and report its output: npm test");
	assert.equal(example.role, "explorer");
	assert.equal(example.cwd, "/repo");
	assert.equal(example.taskId, TASKSPEC_EXAMPLE_SENTINEL);
	assert.equal(example.validation.required, false, "lookup work is not stuck on missing test commands");
	assert.equal(example.budget, undefined, "no invented budget");
	assert.equal(example.additionalWorktreeRoots, undefined, "no invented worktree roots");
}

// Inspect path → path in constraints + Explorer + the WorkerReport contract.
{
	const decision = decidePolicy({
		toolName: "read",
		input: { path: "docs/spec.md" },
		isChild: false,
		disabled: false,
		cwd: "/repo",
	});
	// read is allowed today; exercise the fill table directly through the
	// renderer (the Idle gather policy will route read refusals here).
	const example = buildTaskSpecExample({ toolName: "read", input: { path: "docs/spec.md" }, cwd: "/repo" });
	assert.deepEqual(validateTaskSpec(example), []);
	assert.equal(example.role, "explorer");
	assert.ok(
		(example.constraints ?? []).some((item) => item.includes("docs/spec.md")),
		"the inspect path lands in constraints",
	);
	assert.ok(
		(example.constraints ?? []).some((item) => item.includes("WorkerReport")),
		"the example requests the existing WorkerReport output contract",
	);
}

// write/edit refusal → role Worker in the example JSON.
{
	const decision = decidePolicy({
		toolName: "edit",
		input: { path: "src/parser.ts" },
		isChild: false,
		disabled: false,
		cwd: "/repo",
	});
	assert.equal(decision.block, true);
	const example = exampleFromReason(decision.reason);
	assert.deepEqual(validateTaskSpec(example), []);
	assert.equal(example.role, "worker", "mutating intent is not downgraded to Explorer");
}

// Invalid validation shapes collapse to { required: false } with commands omitted.
assert.deepEqual(buildTaskSpecExample({
	toolName: "subagent",
	submitted: { validation: ["npm test"] },
}).validation, { required: false });
assert.deepEqual(buildTaskSpecExample({
	toolName: "subagent",
	submitted: { validation: { required: "yes", commands: "npm test" } },
}).validation, { required: false });

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
	buildTaskSpecExample({ toolName: "subagent", submitted: { taskId: TASKSPEC_EXAMPLE_SENTINEL } }).taskId,
	TASKSPEC_EXAMPLE_SENTINEL,
);

// The composite subagent refusal keeps its plain reason: no example JSON there.
{
	const composite = decidePolicy({
		toolName: "subagent",
		input: { workflow: "review" },
		isChild: false,
		disabled: false,
	});
	assert.equal(composite.block, true);
	assert.equal(composite.reason.includes("```json"), false, "composite refusal gains no example JSON");
}

console.log("planner-only policy: PASS");
