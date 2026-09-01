import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFileSync(join(root, name), "utf8");

const index = src("index.ts");
const review = src("review.ts");
const evidence = src("evidence.ts");
const policy = src("policy.ts");
const roles = src("roles.ts");

// Task memory is written only through TaskStore.
for (const leak of [
	"task.spec =",
	"task.role =",
	"task.cwd =",
	"task.baseEvidence =",
	"task.lastComparison =",
]) {
	assert.equal(index.includes(leak), false, `Pi adapter leaks across the Task store seam: ${leak}`);
}

// Review loop apply lives in the Review module, not the adapter.
assert.equal(index.includes("const applyDecision"), false, "applyDecision must not live in the Pi adapter");
assert.match(review, /export function applyReviewDecision/);

// WorkerReport JSON scrape is not a Task concern.
assert.doesNotMatch(review, /jsonCandidates \} from "\.\/task\.ts"/);
assert.match(review, /from "\.\/report\.ts"/);

// Git-read argv lives in one module.
assert.match(evidence, /GIT_READ_ARGV/);
assert.match(evidence, /from "\.\/git-audit\.ts"/);
assert.doesNotMatch(policy, /SAFE_GIT_STATUS_FLAGS/);
assert.match(policy, /isSafeAuditCommand/);

// Delegation owns remap + packet.
assert.match(roles, /export function prepareRoleDelegation/);
assert.match(roles, /export function delegationPrompt/);

// Pi adapter is a thin host seam.
assert.match(index, /from "\.\/orchestrate\.ts"/);
assert.doesNotMatch(index, /const beginDelegation/);
assert.doesNotMatch(index, /const prepareRoleDelegation/);

console.log("planner-only architecture: PASS");
