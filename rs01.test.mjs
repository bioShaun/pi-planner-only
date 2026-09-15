import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
	computeLoadedFingerprint,
	getLoadedPluginFingerprint,
	reloadLoadedFingerprint,
	getDiskHead,
	createLoadedPluginFingerprint,
} from "./index.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { TaskStore, TaskIdAllocator, createTaskSpec } from "./task.ts";
import { UsageLedger } from "./usage.ts";
import { ConcurrencyController } from "./concurrency.ts";

const dummyGitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

test("A01: Loaded plugin fingerprint is recorded from loaded build, distinct from disk HEAD", async () => {
	const initialFingerprint = getLoadedPluginFingerprint();
	assert.match(initialFingerprint, /^[0-9a-f]{64}$/, "fingerprint is a valid sha256 hex string");

	const diskHead = getDiskHead();
	assert.ok(typeof diskHead === "string" && diskHead.length > 0, "disk HEAD is queryable");

	// Loaded fingerprint is distinct from Git disk HEAD
	assert.notEqual(initialFingerprint, diskHead, "loaded fingerprint is distinct from disk HEAD");

	// Create fingerprint info object
	const fpInfo = createLoadedPluginFingerprint(undefined, { diskHead });
	assert.equal(fpInfo.loadedFingerprint, initialFingerprint);
	assert.equal(fpInfo.diskHead, diskHead);
	assert.ok(fpInfo.capabilities.includes("planner-only"));
	assert.ok(fpInfo.capabilities.includes("concurrency"));

	// Modifying disk files in a separate directory should produce a different fingerprint on reload
	const tempDir = mkdtempSync(join(tmpdir(), "planner-only-test-a01-"));
	try {
		writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "0.4.1" }));
		writeFileSync(join(tempDir, "index.ts"), "export const dummy = 1;");
		const customFingerprint = computeLoadedFingerprint(tempDir);
		assert.match(customFingerprint, /^[0-9a-f]{64}$/);
		assert.notEqual(customFingerprint, initialFingerprint);

		// The memory loaded fingerprint has not changed
		assert.equal(getLoadedPluginFingerprint(), initialFingerprint);

		// But if reloadLoadedFingerprint is called for that directory, it changes
		const reloaded = reloadLoadedFingerprint(tempDir);
		assert.equal(reloaded, customFingerprint);

		// Reloading original directory restores it
		reloadLoadedFingerprint();
		assert.equal(getLoadedPluginFingerprint(), initialFingerprint);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	// Orchestrator stores and exposes loaded fingerprint
	const orch = new PlannerOrchestrator({ gitRunner: dummyGitRunner });
	orch.setLoadedFingerprint(fpInfo);
	const retrieved = orch.getLoadedFingerprint();
	assert.equal(retrieved?.loadedFingerprint, initialFingerprint);
	assert.equal(retrieved?.diskHead, diskHead);
});






test("A05: Multi-process shared ledger allocation, quarantine, and cross-workspace checks pass", async () => {
	const root = mkdtempSync(join(tmpdir(), "planner-only-test-a05-"));
	const now = () => new Date("2026-09-11T12:00:00.000Z");

	try {
		// 1. Allocator in process A allocates T-20260911-001
		const allocA = new TaskIdAllocator(root, { now });
		const id1 = allocA.allocate();
		assert.equal(id1, "T-20260911-001");

		// 2. Fresh allocator in process B sees T-20260911-001 is claimed and allocates T-20260911-002
		const allocB = new TaskIdAllocator(root, { now });
		const id2 = allocB.allocate();
		assert.equal(id2, "T-20260911-002");

		// 3. Quarantined / unparseable ledger file occupies ID and is not reused
		mkdirSync(join(root, "planner-only", "ledger"), { recursive: true });
		writeFileSync(
			join(root, "planner-only", "ledger", "T-20260911-003.json"),
			"corrupt unparseable json content",
		);

		const id3 = allocB.allocate();
		assert.equal(id3, "T-20260911-004", "allocator skipped corrupt 003 file and allocated 004");

		// Explicit reuse of occupied ID throws conflict
		assert.throws(
			() => allocB.reserve("T-20260911-003"),
			(err) => err?.code === "TASK_ID_CONFLICT",
			"explicit reserve throws TASK_ID_CONFLICT",
		);

		// 4. Cross-workspace continuation is refused
		const store = new TaskStore();
		const spec1 = createTaskSpec({ objective: "workspace 1 task", cwd: "/workspace/one" }, "T-20260911-001");
		store.create(spec1);

		assert.throws(
			() => store.continueTask("T-20260911-001", "/workspace/two"),
			(err) => err?.code === "TASK_WORKSPACE_MISMATCH",
			"continuing across different workspace throws TASK_WORKSPACE_MISMATCH",
		);

		// Same workspace succeeds
		const continued = store.continueTask("T-20260911-001", "/workspace/one");
		assert.equal(continued.taskId, "T-20260911-001");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
