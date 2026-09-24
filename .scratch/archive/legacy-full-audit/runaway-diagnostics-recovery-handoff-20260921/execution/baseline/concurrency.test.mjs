import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	ConcurrencyController,
	DEFAULT_CONCURRENCY_LIMIT,
	loadConcurrencyDefault,
	parseConcurrencyLimit,
	saveConcurrencyDefault,
} from "./concurrency.ts";

assert.equal(parseConcurrencyLimit("3"), 3);
assert.equal(parseConcurrencyLimit("0"), undefined);
assert.equal(parseConcurrencyLimit("1.5"), undefined);

const controller = new ConcurrencyController();
assert.equal(controller.status().limit, DEFAULT_CONCURRENCY_LIMIT);
assert.equal(controller.status().source, "default");
assert.ok(controller.reserve({ id: "r1", role: "explorer", capability: "reader", workspaces: ["/repo"] }).reservation);
assert.ok(controller.reserve({ id: "r2", role: "explorer", capability: "reader", workspaces: ["/repo"] }).reservation);
assert.equal(controller.reserve({ id: "w", role: "worker", capability: "writer", workspaces: ["/repo"] }).refusal?.code, "WORKSPACE_CONFLICT");
assert.ok(controller.reserve({ id: "w2", role: "worker", capability: "writer", workspaces: ["/other"] }).reservation);
assert.equal(controller.reserve({ id: "w3", role: "worker", capability: "writer", workspaces: ["/third"] }).reservation, undefined);
assert.equal(controller.reserve({ id: "w3", role: "worker", capability: "writer", workspaces: ["/third"] }).refusal?.code, "CONCURRENCY_LIMIT_REACHED");
controller.release("r1");
controller.release("r2");
controller.release("w2");

const root = mkdtempSync(join(tmpdir(), "planner-only-concurrency-test-"));
try {
	const config = join(root, "planner-only", "concurrency.json");
	assert.equal(loadConcurrencyDefault(config).source, "default");
	assert.deepEqual(saveConcurrencyDefault(config, 5), { ok: true });
	assert.deepEqual(loadConcurrencyDefault(config), { limit: 5, source: "saved" });
} finally {
	rmSync(root, { recursive: true, force: true });
}

// --------------------------------------------------------------------------
// Ticket 01 / 03: Symlink aliases and same-task writers contend for the lock
// --------------------------------------------------------------------------
{
	const realDir = mkdtempSync(join(tmpdir(), "planner-only-concurrency-real-"));
	const aliasParent = mkdtempSync(join(tmpdir(), "planner-only-concurrency-alias-"));
	const aliasDir = join(aliasParent, "link");
	symlinkSync(realDir, aliasDir);
	try {
		const c = new ConcurrencyController();
		const r1 = c.reserve({ id: "w-real", taskId: "T-001", role: "worker", capability: "writer", workspaces: [realDir] });
		assert.ok(r1.reservation);

		// Symlink alias must conflict with real dir
		const rAlias = c.reserve({ id: "w-alias", taskId: "T-002", role: "worker", capability: "writer", workspaces: [aliasDir] });
		assert.equal(rAlias.refusal?.code, "WORKSPACE_CONFLICT", "symlink alias of locked worktree must conflict");

		// Same-task second writer on the same workspace must contend and be refused (even if state !== "executing")
		const rSameTask = c.reserve({ id: "w-same", taskId: "T-001", state: "reviewing", role: "worker", capability: "writer", workspaces: [realDir] });
		assert.equal(rSameTask.refusal?.code, "WORKSPACE_CONFLICT", "same-task second writer must conflict");

		// Reader on the same workspace is refused while writer is active
		const rReader = c.reserve({ id: "r-check", role: "explorer", capability: "reader", workspaces: [realDir] });
		assert.equal(rReader.refusal?.code, "WORKSPACE_CONFLICT", "reader cannot run beside active writer");

		// Independent worktree does not conflict
		const otherDir = mkdtempSync(join(tmpdir(), "planner-only-concurrency-other-"));
		try {
			const rOther = c.reserve({ id: "w-other", taskId: "T-003", role: "worker", capability: "writer", workspaces: [otherDir] });
			assert.ok(rOther.reservation, "independent worktree can reserve");
		} finally {
			rmSync(otherDir, { recursive: true, force: true });
		}
	} finally {
		rmSync(realDir, { recursive: true, force: true });
		rmSync(aliasParent, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// Restored writer holds isolate workspaces without consuming this session's
// execution capacity. Direct hold callers remain capacity-counting unless
// they explicitly identify a ledger-restored hold.
// --------------------------------------------------------------------------
{
	const c = new ConcurrencyController({ savedLimit: 2 });
	c.hold({
		id: "writerhold:call-1",
		taskId: "T-20260918-001",
		role: "worker",
		capability: "writer",
		workspaces: ["/repo/a"],
		reservedAt: "2026-09-18T10:00:00.000Z",
		holdReason: "unconfirmed stop on crash",
		countsTowardLimit: false,
	});
	c.hold({
		id: "writerhold:call-2",
		taskId: "T-20260918-002",
		role: "worker",
		capability: "writer",
		workspaces: ["/repo/b"],
		reservedAt: "2026-09-18T10:05:00.000Z",
		holdReason: "abnormal termination",
		countsTowardLimit: false,
	});
	c.hold({
		id: "writerhold:call-3",
		taskId: "T-20260918-003",
		role: "worker",
		capability: "writer",
		workspaces: ["/repo/c"],
		reservedAt: "2026-09-18T10:10:00.000Z",
		holdReason: "network drop",
		countsTowardLimit: false,
	});

	const status = c.status();
	assert.equal(status.occupied, 0, "restored holds do not occupy execution capacity");
	assert.equal(status.isolationHolds, 3, "all restored holds remain visible as isolation holds");
	assert.equal(status.limit, 2, "configured execution limit remains 2");
	assert.equal(status.available, 2, "execution capacity remains available");
	assert.equal(c.get("writerhold:call-1")?.holdReason, "unconfirmed stop on crash");

	// An unrelated writer is admitted, while the held workspace still conflicts.
	const res = c.reserve({
		id: "w-new",
		taskId: "T-20260918-004",
		role: "worker",
		capability: "writer",
		workspaces: ["/repo/d"],
	});
	assert.ok(res.reservation);
	assert.equal(c.status().occupied, 1);
	assert.equal(c.reserve({ id: "w-conflict", role: "worker", capability: "writer", workspaces: ["/repo/a"] }).refusal?.code, "WORKSPACE_CONFLICT");
	assert.equal(c.status().isolationHolds, 3, "holds not cleared");
	assert.equal(c.status().limit, 2, "limit not bumped");
}

{
	const c = new ConcurrencyController({ savedLimit: 1 });
	c.hold({ id: "legacy-direct", role: "worker", capability: "writer", workspaces: ["/legacy"], reservedAt: "2026-09-18T00:00:00.000Z" });
	c.hold({ id: "legacy-direct", role: "worker", capability: "writer", workspaces: ["/legacy"], reservedAt: "2026-09-18T00:00:00.000Z", countsTowardLimit: false });
	assert.equal(c.get("legacy-direct")?.countsTowardLimit, true, "duplicate registration cannot downgrade a live capacity claim");
	assert.equal(c.status().occupied, 1, "hold defaults conservatively to capacity-counting");
	assert.equal(c.reserve({ id: "blocked", role: "worker", capability: "writer", workspaces: ["/other"] }).refusal?.code, "CONCURRENCY_LIMIT_REACHED");
}

{
	const c = new ConcurrencyController();
	c.hold({ id: "same-id", role: "worker", capability: "writer", workspaces: ["/held"], reservedAt: "2026-09-18T00:00:00.000Z", countsTowardLimit: false });
	const collision = c.reserve({ id: "same-id", role: "worker", capability: "writer", workspaces: ["/unrelated"] });
	assert.equal(collision.refusal?.code, "WORKSPACE_CONFLICT", "same-id reserve cannot bypass capacity admission through a restored hold");
	assert.equal(c.get("same-id")?.countsTowardLimit, false);
}
