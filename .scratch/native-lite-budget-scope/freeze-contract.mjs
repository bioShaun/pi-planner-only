import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat as nodeLstat } from "node:fs/promises";

export async function assertLedgerLockAbsent(ledgerPath, { lstat = nodeLstat } = {}) {
	const lockPath = `${ledgerPath}.lock`;
	let details;
	try {
		const info = await lstat(lockPath);
		const type = info.isSymbolicLink() ? "symlink"
			: info.isFile() ? "regular"
				: info.isDirectory() ? "directory" : "other";
		details = `type=${type} inode=${info.ino}`;
	} catch (error) {
		if (error?.code === "ENOENT") return;
		throw new Error(`unable to inspect budget ledger lock ${lockPath}: ${error?.code ?? "unknown error"}`, { cause: error });
	}
	throw new Error(`budget ledger lock exists: ${lockPath} ${details}`);
}

export function assertWorkspaceLock(lock, snapshots) {
	for (const [arm, snapshot] of Object.entries(snapshots)) {
		const locked = lock.workspaces?.[arm];
		assert.ok(locked, `${arm} workspace lock is required`);
		for (const key of ["tree", "diffSha256", "workspaceSha256", "briefSha256", "settingsSha256"]) {
			assert.equal(locked[key], snapshot[key], `${arm} locked ${key}`);
		}
		assert.deepEqual(locked.files, snapshot.files, `${arm} locked nonignored files`);
	}
}

export function assertManifestBrief(manifest, briefBytes) {
	const actual = manifest.briefSha256;
	assert.equal(actual, manifest.pairedBriefSha256, "pairedBriefSha256 must bind this arm's brief");
	assert.equal(actual, createSha256(briefBytes), "manifest briefSha256 must bind actual brief bytes");
}

export function assertSessionIdentityExample(brief, batchId, attemptId, pair = "<pair>", mode = "<mode>") {
	const batch = batchId.replace(/[^A-Za-z0-9._-]/g, "-");
	const expected = `nl-${batch}-${attemptId}-${pair}-${mode}`;
	assert.ok(brief.includes(expected), `brief must show sanitized session ID ${expected}`);
}

export function assertControllerFiles(lock, actualHashes) {
	for (const [name, actual] of Object.entries(actualHashes)) {
		assert.equal(lock.controllerFiles?.[name], actual, `controller lock ${name}`);
	}
}

export function assertRuntimeUserSettings(lock, loadedPath, bytes) {
	assert.equal(lock.runtime?.loadedUserSettingsPath, loadedPath, "runtime lock must identify the loaded user settings file");
	assert.equal(lock.settings?.runtimeUserSettingsSha256, createSha256(bytes), "runtime user settings hash");
}

function createSha256(value) {
	return createHash("sha256").update(value).digest("hex");
}
