import assert from "node:assert/strict";
import { decidePolicy, isSafeAuditCommand } from "./policy.ts";

function blocked(toolName, input = undefined) {
	return decidePolicy({ toolName, input, isChild: false, disabled: false }).block;
}

assert.equal(blocked("read", { path: "/tmp/a" }), false);
assert.equal(blocked("contact_supervisor", {}), false);
assert.equal(blocked("git_audit", { operation: "status" }), false);
assert.equal(blocked("git_audit", { operation: "diff-stat", staged: true }), false);
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

console.log("planner-only policy: PASS");
