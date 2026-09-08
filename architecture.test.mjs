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
const roleModels = src("role-models.ts");
const orchestrate = src("orchestrate.ts");
const reservations = src("reservations.ts");
const ledgerStore = src("ledger-store.ts");
const floors = src("floors.ts");
const pkg = JSON.parse(src("package.json"));

// Pi package contract (https://pi.dev/docs — packages.md).
assert.equal(pkg.keywords.includes("pi-package"), true, "keywords must include pi-package");
assert.deepEqual(pkg.pi?.extensions, ["./index.ts"], "manifest must name the factory file, not glob helper modules");
assert.equal(pkg.peerDependencies?.typebox, "*");
// C01 — the Pi host peer is a bounded compatibility range, not any-version.
const hostPeer = pkg.peerDependencies?.["@earendil-works/pi-coding-agent"];
assert.equal(typeof hostPeer, "string", "the Pi host peer must be declared");
assert.notEqual(hostPeer.trim(), "*", "the Pi host peer must not claim every version");
assert.match(hostPeer, /^>=/, "the Pi host peer must be a bounded range");
assert.equal(typeof pkg["pi-planner-only"]?.piHost, "string", "package.json must declare a Pi host compatibility range");
assert.match(pkg.scripts?.["test:release"] ?? "", /typecheck/, "the release gate must run typecheck");
assert.match(pkg.scripts?.["test:release"] ?? "", /PI_PLANNER_ONLY_REQUIRE_CONTRACT=1/, "the release gate must require contract coverage");
assert.equal(pkg.dependencies?.typebox, undefined, "typebox is bundled by Pi; do not ship a second copy");
assert.equal(pkg.dependencies?.["@earendil-works/pi-coding-agent"], undefined);

// Task memory is written only through TaskStore.
for (const leak of [
	"task.spec =",
	"task.role =",
	"task.cwd =",
	"task.baseEvidence =",
	"task.lastComparison =",
	"task.snapshot =",
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
assert.equal(pkg.files.includes("floors.ts"), true, "floors.ts must ship in the package files list");
assert.equal(pkg.files.includes("role-models.ts"), true, "role-models.ts must ship in the package files list");
assert.match(orchestrate, /from "\.\/role-models\.ts"/);
assert.match(index, /from "\.\/role-models\.ts"/);
assert.doesNotMatch(policy, /role-models|PI_PLANNER_ONLY_MODEL_|ROLE_MODELS/);
assert.doesNotMatch(roleModels, /from "\.\/index\.ts"|@earendil-works/);
assert.equal((orchestrate.match(/this\.delegations\.delete\(/g) ?? []).length, 1, "delegations must converge on one endDelegation delete");
assert.equal(pkg.files.includes("reservations.ts"), true, "reservations.ts must ship in the package files list");
assert.doesNotMatch(reservations, /from "\.\/index\.ts"|@earendil-works/);
assert.match(floors, /export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object\.freeze\(\{\s*tokens: false,\s*costUsd: false,\s*\}\)/, "W15: DEFAULT_HOST_ENFORCEMENT must stay false,false in source");
assert.doesNotMatch(floors, /from "\.\/index\.ts"|@earendil-works/, "W16: floors.ts must not import the adapter or the Pi host");

// Orchestration records no ledger mutations; the adapter owns capture.
assert.doesNotMatch(orchestrate, /UsageLedger/);
assert.doesNotMatch(orchestrate, /recordRootTurn/);
assert.doesNotMatch(orchestrate, /recordChild/);

// Ticket 15 X11: every pendingChild call carries a key (runId or a defined toolCallId).
assert.equal(index.includes("pendingChild(record.kind, { agent, toolCallId: undefined })"), false);
{
	const callRe = /(?<!function )pendingChild\(/g;
	let match;
	let calls = 0;
	while ((match = callRe.exec(index))) {
		calls += 1;
		const expr = index.slice(match.index, match.index + 220);
		assert.equal(/toolCallId(?!\s*:\s*undefined)|\brunId\b/.test(expr), true, `pendingChild call is unkeyed: ${expr.split("\n")[0]}`);
	}
	assert.equal(calls >= 3, true, "pendingChild must still be called from the adapter");
}

// Ticket 15-b D1: confirmed-not-launched is queried from the orchestrator, not recoded in the adapter.
assert.equal(index.includes("wasConfirmedNotLaunched("), true);
assert.equal(orchestrate.includes("wasConfirmedNotLaunched("), true);

assert.equal(pkg.files.includes("ledger-store.ts"), true, "C1: ledger-store.ts must ship in the package files list");
assert.match(pkg.scripts?.test ?? "", /ledger-store\.test\.mjs/, "C2: the unit test script must run ledger-store.test.mjs");
assert.doesNotMatch(ledgerStore, /from "\.\/index\.ts"|@earendil-works/, "C3: ledger-store.ts must not import the adapter or the Pi host");
assert.doesNotMatch(ledgerStore, /readFileSync|readFile\(/, "C4: this round must not read snapshots back");
assert.doesNotMatch(ledgerStore, /usage\.jsonl/, "C5: ledger snapshots must not reuse usage.jsonl");
assert.match(index, /ledgerDir:\s*AGENT_DIR/, "C6: the Pi adapter passes AGENT_DIR as ledgerDir");
assert.match(orchestrate, /from "\.\/ledger-store\.ts"/, "C7: the orchestrator owns LedgerSnapshotStore");
assert.match(orchestrate, /new LedgerSnapshotStore\(deps\.ledgerDir\)/, "C8: the sink is constructed from deps.ledgerDir");
assert.match(index, /task\.usage = usage;\s*\n\s*orchestrator\.store\.persist\(task\)/, "C9: syncUsage persists after the direct usage write");

assert.match(reservations, /rekey\(/, "C37-1: BudgetReservations exposes rekey");
assert.equal((orchestrate.match(/this\.reservations\.rekey\(/g) ?? []).length, 1, "C37-2: orchestrate rekeys in exactly one place");
assert.match(orchestrate, /this\.store\.create\(storedSpec, spec\.taskId\);\s*\n\s*this\.reservations\.rekey\(spec\.taskId, task\.taskId, event\.toolCallId\);/, "C37-3: rekey runs immediately after the shouldReplaceTaskId create");
assert.match(orchestrate, /emptyTaskUsage/, "C37-4: first-delegation budget is computed from emptyTaskUsage");
assert.doesNotMatch(orchestrate, /this\.store\.create\(spec\);\s*\n\s*this\.reservations\.rekey/, "C37-5: the matching-id create does not rekey");
assert.equal((orchestrate.match(/this\.store\.create\(/g) ?? []).length, 3, "C37-6: store.create sites stay three; only the replace site rekeys");

console.log("planner-only architecture: PASS");
