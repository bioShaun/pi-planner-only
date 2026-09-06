import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	captureWorkspaceSnapshot,
	compareSnapshotBinding,
	snapshotDigest,
} from "./workspace-snapshot.ts";

function scratch() {
	return mkdtempSync(join(process.cwd(), ".planner-only-snap-"));
}

function snapshot(dir, paths, limits = {}) {
	return captureWorkspaceSnapshot({
		cwd: dir,
		taskId: "T-1",
		invocationId: "call-1",
		paths,
		...limits,
	});
}

// E03 — a content-identical file whose mtime changed does not flip the digest
{
	const dir = scratch();
	try {
		writeFileSync(join(dir, "a.txt"), "same\n");
		const first = snapshot(dir, ["a.txt"]);
		const later = new Date(Date.now() + 60_000);
		utimesSync(join(dir, "a.txt"), later, later);
		const second = snapshot(dir, ["a.txt"]);
		assert.equal(second.state, "fresh");
		assert.equal(first.digest, second.digest, "mtime-only change must not change the digest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E04 — in-scope add, delete, and content change all change the digest
{
	const dir = scratch();
	try {
		writeFileSync(join(dir, "a.txt"), "v1\n");
		const base = snapshot(dir, ["a.txt"]);

		writeFileSync(join(dir, "a.txt"), "v2\n");
		const changed = snapshot(dir, ["a.txt"]);
		assert.equal(changed.state, "fresh");
		assert.notEqual(base.digest, changed.digest, "content change changes the digest");

		rmSync(join(dir, "a.txt"));
		const deleted = snapshot(dir, ["a.txt"]);
		assert.notEqual(changed.digest, deleted.digest, "deletion changes the digest");
		assert.equal(deleted.entries[0].kind, "missing");

		writeFileSync(join(dir, "added.txt"), "new\n");
		const added = snapshot(dir, ["a.txt", "added.txt"]);
		assert.notEqual(deleted.digest, added.digest, "in-scope add changes the digest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E05 — a symlink target change changes the digest; targets are recorded, not followed
{
	const dir = scratch();
	try {
		writeFileSync(join(dir, "real-a.txt"), "a\n");
		writeFileSync(join(dir, "real-b.txt"), "b\n");
		symlinkSync("real-a.txt", join(dir, "link"));
		const first = snapshot(dir, ["link"]);
		assert.equal(first.entries[0].kind, "symlink");
		assert.equal(first.entries[0].linkTarget, "real-a.txt");

		rmSync(join(dir, "link"));
		symlinkSync("real-b.txt", join(dir, "link"));
		const second = snapshot(dir, ["link"]);
		assert.equal(second.state, "fresh");
		assert.notEqual(first.digest, second.digest, "symlink retarget changes the digest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// The execute bit participates in the manifest
{
	const dir = scratch();
	try {
		const path = join(dir, "run.sh");
		writeFileSync(path, "#!/bin/sh\n");
		const before = snapshot(dir, ["run.sh"]);
		chmodSync(path, 0o755);
		const after = snapshot(dir, ["run.sh"]);
		assert.equal(before.entries[0].executable, false);
		assert.equal(after.entries[0].executable, true);
		assert.notEqual(before.digest, after.digest, "the execute bit changes the digest");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E09 — over-budget sampling is unknown with a reason, never truncated-but-fresh
{
	const dir = scratch();
	try {
		mkdirSync(join(dir, "many"));
		for (let i = 0; i < 3; i++) writeFileSync(join(dir, "many", `f${i}.txt`), "x\n");
		const over = snapshot(dir, ["many"], { maxFiles: 2 });
		assert.equal(over.state, "unknown");
		assert.match(over.unknownReason, /file budget exceeded/);
		assert.equal(over.digest, undefined, "an unknown snapshot carries no digest");

		const overBytes = snapshot(dir, ["many"], { maxTotalBytes: 2 });
		assert.equal(overBytes.state, "unknown");
		assert.match(overBytes.unknownReason, /byte budget exceeded/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// E09 — a sampling deadline exceeded is unknown
{
	const dir = scratch();
	try {
		writeFileSync(join(dir, "a.txt"), "x\n");
		const slow = snapshot(dir, ["a.txt"], { deadlineMs: -1 });
		assert.equal(slow.state, "unknown");
		assert.match(slow.unknownReason, /deadline|budget/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// An unreadable file is unknown, not skipped
{
	const dir = scratch();
	try {
		const path = join(dir, "secret.txt");
		writeFileSync(path, "s\n");
		chmodSync(path, 0o000);
		try {
			const unreadable = snapshot(dir, ["secret.txt"]);
			assert.equal(unreadable.state, "unknown");
			assert.match(unreadable.unknownReason, /cannot (read|stat)/);
		} finally {
			chmodSync(path, 0o644);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Directories in scope are walked (skipping .git), bounded by the same budgets
{
	const dir = scratch();
	try {
		mkdirSync(join(dir, "pkg", ".git"), { recursive: true });
		writeFileSync(join(dir, "pkg", ".git", "ignored"), "x\n");
		writeFileSync(join(dir, "pkg", "index.ts"), "export {};\n");
		const snap = snapshot(dir, ["pkg"]);
		assert.equal(snap.state, "fresh");
		assert.deepEqual(snap.entries.map((entry) => entry.path), ["pkg/index.ts"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// An empty declaration is a stable empty manifest
{
	const dir = scratch();
	try {
		const empty = snapshot(dir, []);
		assert.equal(empty.state, "fresh");
		assert.equal(empty.digest, snapshotDigest([]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// compareSnapshotBinding: unknown/stale/revision/pre-snapshot outcomes
{
	const fresh = { state: "fresh", digest: "aaaaaaaaaaaaaaaa", capturedAt: "t" };
	assert.deepEqual(compareSnapshotBinding({ version: 1, digest: "aaaaaaaaaaaaaaaa", reportRevision: 2, capturedAt: "t" }, fresh, 2), { state: "fresh" });

	const changed = { ...fresh, digest: "bbbbbbbbbbbbbbbb" };
	const stale = compareSnapshotBinding({ version: 1, digest: "aaaaaaaaaaaaaaaa", reportRevision: 2, capturedAt: "t" }, changed, 2);
	assert.equal(stale.state, "stale");
	assert.match(stale.reason, /workspace snapshot changed since the report/);

	const unknownNow = { state: "unknown", unknownReason: "file budget exceeded (5 files)" };
	const unknown = compareSnapshotBinding({ version: 1, digest: "aaaaaaaaaaaaaaaa", reportRevision: 2, capturedAt: "t" }, unknownNow, 2);
	assert.equal(unknown.state, "unknown");
	assert.match(unknown.reason, /file budget exceeded/);

	const revisionDrift = compareSnapshotBinding({ version: 1, digest: "aaaaaaaaaaaaaaaa", reportRevision: 1, capturedAt: "t" }, fresh, 2);
	assert.equal(revisionDrift.state, "unknown");
	assert.match(revisionDrift.reason, /revision 1, but the latest report is revision 2/);

	const unbound = compareSnapshotBinding(undefined, fresh, 1);
	assert.equal(unbound.state, "unknown");
	assert.match(unbound.reason, /pre-snapshot report/);
}

console.log("planner-only workspace snapshot: PASS");
