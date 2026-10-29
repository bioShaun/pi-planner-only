import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const testRoot = await mkdtemp(join(process.env.TMPDIR ?? "/project/tmp", "ledger-lock-preflight-"));
const freezeContract = await import("./freeze-contract.mjs");
const assertLedgerLockAbsent = (...args) => freezeContract.assertLedgerLockAbsent(...args);
async function fixture(name) {
	const dir = join(testRoot, name);
	await mkdir(dir);
	const ledger = join(dir, "budget-ledger.json");
	return { dir, ledger, lock: `${ledger}.lock` };
}

test.after(async () => rm(testRoot, { recursive: true, force: true }));

test("ledger preflight allows only a genuinely absent sibling lock", async () => {
	const { ledger } = await fixture("absent");
	await assertLedgerLockAbsent(ledger);
});

test("batch verifier checks the ledger lock before reading the ledger", async () => {
	const source = await readFile(new URL("./verify-batch.mjs", import.meta.url), "utf8");
	const guard = source.indexOf("await assertLedgerLockAbsent(ledgerPath)");
	const ledgerRead = source.indexOf("await readFile(ledgerPath, \"utf8\")");
	assert.ok(guard >= 0, "batch verifier must call the read-only lock check");
	assert.ok(ledgerRead > guard, "lock check must run before ledger snapshot verification");
});

test("ledger preflight rejects an empty lock and reports its identity", async () => {
	const { ledger, lock } = await fixture("empty");
	await writeFile(lock, "", { flag: "wx" });
	await assert.rejects(assertLedgerLockAbsent(ledger), error => {
		assert.match(error.message, /budget ledger lock exists/);
		assert.match(error.message, /type=regular/);
		assert.match(error.message, /inode=\d+/);
		assert.match(error.message, new RegExp(lock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		return true;
	});
	await rm(lock);
});

test("ledger preflight rejects a symbolic link without following it", async () => {
	const { dir, ledger, lock } = await fixture("symlink");
	const target = join(dir, "target");
	await writeFile(target, "target");
	await symlink(target, lock);
	await assert.rejects(assertLedgerLockAbsent(ledger), /budget ledger lock exists.*type=symlink/);
	await rm(lock);
});

test("ledger preflight rejects a directory at the lock path", async () => {
	const { ledger, lock } = await fixture("directory");
	await mkdir(lock);
	await assert.rejects(assertLedgerLockAbsent(ledger), /budget ledger lock exists.*type=directory/);
	await rm(lock, { recursive: true });
});

test("ledger preflight fails closed on errors other than ENOENT", async () => {
	const { ledger } = await fixture("permission-error");
	await assert.rejects(assertLedgerLockAbsent(ledger, {
		lstat: async () => { throw Object.assign(new Error("permission denied"), { code: "EACCES" }); },
	}), /unable to inspect budget ledger lock.*EACCES/);
});

test("ledger preflight rejects an unexpected filesystem error rather than treating it as absent", async () => {
	const { ledger } = await fixture("other-error");
	await assert.rejects(assertLedgerLockAbsent(ledger, {
		lstat: async () => { throw Object.assign(new Error("io failure"), { code: "EIO" }); },
	}), /unable to inspect budget ledger lock.*EIO/);
});
