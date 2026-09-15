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

// Delegation remap + packet parsing died with the legacy chain (ticket 08).
assert.doesNotMatch(roles, /export function prepareRoleDelegation/, "ticket 08: the legacy prompt-remap path must not come back");
assert.doesNotMatch(roles, /export function delegationPrompt/, "ticket 08: prompt-text delegation input is gone");

// Pi adapter is a thin host seam.
assert.match(index, /from "\.\/orchestrate\.ts"/);
assert.doesNotMatch(index, /const beginDelegation/);
assert.doesNotMatch(index, /const prepareRoleDelegation/);

// usage.ts is a pure module: no Pi host, no adapter.
assert.doesNotMatch(usage, /from "\.\/index\.ts"/);
assert.doesNotMatch(usage, /@earendil-works/);
assert.doesNotMatch(usage, /from "\.\/task\.ts"/);
assert.equal(pkg.files.includes("usage.ts"), true, "usage.ts must ship in the package files list");
assert.equal(pkg.files.includes("pricing.defaults.json"), true, "bundled pricing defaults must ship in the package files list");
assert.match(index, /ensurePricingFile\(\)/, "the adapter must seed the local pricing table at startup");
assert.equal(pkg.files.includes("floors.ts"), true, "floors.ts must ship in the package files list");
assert.equal(pkg.files.includes("role-models.ts"), true, "role-models.ts must ship in the package files list");
assert.match(index, /from "\.\/role-models\.ts"/);
assert.doesNotMatch(policy, /role-models|PI_PLANNER_ONLY_MODEL_|ROLE_MODELS/);
assert.doesNotMatch(roleModels, /from "\.\/index\.ts"|@earendil-works/);
assert.equal(pkg.files.includes("reservations.ts"), false, "ticket 08: reservations.ts is deleted and must not ship");
assert.match(floors, /export const DEFAULT_HOST_ENFORCEMENT: HostEnforcement = Object\.freeze\(\{\s*tokens: false,\s*costUsd: false,\s*\}\)/, "W15: DEFAULT_HOST_ENFORCEMENT must stay false,false in source");
assert.match(floors, /export const DEFAULT_SESSION_ROOT_BUDGET_ENABLED = false/, "session root budget must default off");
assert.doesNotMatch(floors, /from "\.\/index\.ts"|@earendil-works/, "W16: floors.ts must not import the adapter or the Pi host");

// Orchestration records no ledger mutations; the adapter owns capture.
assert.doesNotMatch(orchestrate, /UsageLedger/);
assert.doesNotMatch(orchestrate, /recordRootTurn/);
assert.doesNotMatch(orchestrate, /recordChild/);

// Ticket 15 X11: every pendingChild call carries a key (runId or a defined toolCallId).


assert.equal(pkg.files.includes("ledger-store.ts"), true, "C1: ledger-store.ts must ship in the package files list");
assert.match(pkg.scripts?.test ?? "", /ledger-store\.test\.mjs/, "C2: the unit test script must run ledger-store.test.mjs");
assert.doesNotMatch(ledgerStore, /from "\.\/index\.ts"|@earendil-works/, "C3: ledger-store.ts must not import the adapter or the Pi host");
assert.match(ledgerStore, /readFileSync/, "C4: readAll reads snapshot files");
assert.doesNotMatch(ledgerStore, /usage\.jsonl/, "C5: ledger snapshots must not reuse usage.jsonl");
assert.match(index, /ledgerDir:\s*AGENT_DIR/, "C6: the Pi adapter passes AGENT_DIR as ledgerDir");
assert.match(orchestrate, /from "\.\/ledger-store\.ts"/, "C7: the orchestrator owns LedgerSnapshotStore");
assert.match(orchestrate, /new LedgerSnapshotStore\(deps\.ledgerDir\)/, "C8: the sink is constructed from deps.ledgerDir");
assert.match(index, /task\.usage = usage;\s*\n\s*orchestrator\.store\.persist\(task\)/, "C9: syncUsage persists after the direct usage write");
assert.match(src("task.ts"), /restore\(record: TaskRecord\): void/, "C16-1: TaskStore.restore is a real method");
assert.match(orchestrate, /restoreFromLedger\(\)/, "C16-2: the orchestrator loads snapshots at restoreFromLedger");
assert.match(index, /loadSessionUsage\(ctx\);\s*\n\s*orchestrator\.restoreFromLedger\(\)/, "C16-3: session_start restores the ledger after loadSessionUsage");
assert.match(orchestrate, /untrustedBalances/, "C16-4: untrusted balances are tracked per taskId");
assert.match(ledgerStore, /quarantine\(taskId/, "C16-6: LedgerSnapshotStore exposes quarantine");
assert.match(ledgerStore, /isQuarantined\(taskId/, "C16-7: LedgerSnapshotStore exposes isQuarantined");
assert.match(orchestrate, /this\.snapshots\.quarantine\(/, "C16-8: restoreFromLedger registers corrupt taskIds in the snapshot quarantine");
assert.match(ledgerStore, /isQuarantined\(record\.taskId\)/, "C16-9: write refuses quarantined taskIds");


console.log("planner-only architecture: PASS");
