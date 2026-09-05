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
const usage = src("usage.ts");
const orchestrate = src("orchestrate.ts");
const pkg = JSON.parse(src("package.json"));

// Pi package contract (https://pi.dev/docs — packages.md).
assert.equal(pkg.keywords.includes("pi-package"), true, "keywords must include pi-package");
assert.deepEqual(pkg.pi?.extensions, ["./index.ts"], "manifest must name the factory file, not glob helper modules");
assert.equal(pkg.peerDependencies?.typebox, "*");
assert.equal(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"], "*");
assert.equal(pkg.dependencies?.typebox, undefined, "typebox is bundled by Pi; do not ship a second copy");
assert.equal(pkg.dependencies?.["@earendil-works/pi-coding-agent"], undefined);

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

// usage.ts is a pure module: no Pi host, no adapter.
assert.doesNotMatch(usage, /from "\.\/index\.ts"/);
assert.doesNotMatch(usage, /@earendil-works/);
assert.equal(pkg.files.includes("usage.ts"), true, "usage.ts must ship in the package files list");

// Orchestration records no ledger mutations; the adapter owns capture.
assert.doesNotMatch(orchestrate, /UsageLedger/);
assert.doesNotMatch(orchestrate, /recordRootTurn/);
assert.doesNotMatch(orchestrate, /recordChild/);

console.log("planner-only architecture: PASS");
