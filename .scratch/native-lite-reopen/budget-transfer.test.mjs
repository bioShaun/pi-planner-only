import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const transferPath = process.env.PI_BUDGET_TRANSFER_MODULE;
const transferModule = transferPath
	? await import(pathToFileURL(resolve(transferPath)).href)
	: await import("./budget-transfer.mjs");
const appendBudgetTransfer = transferModule.appendBudgetTransfer;
const hash = value => createHash("sha256").update(value).digest("hex");
const seal = ({ version, reservedUsd, events }) => ({ version, reservedUsd, events, checksum: hash(JSON.stringify({ version, reservedUsd, events })) });

async function fixture(reservedUsd = 4.60623375) {
	const directory = await mkdtemp("/project/tmp/pi-native-lite-reopen-control/ledger-fixture-");
	const ledgerPath = join(directory, "budget-ledger.json");
	const events = Array.from({ length: 19 }, (_, index) => ({
		model: "tcuni/gpt-6-luna",
		reserveUsd: index === 0 ? reservedUsd - 0.18 : 0.01,
		sessionId: `existing-${index}`,
		timestamp: "2026-10-27T00:00:00Z",
		payloadHash: hash(`existing-${index}`),
	}));
	const ledger = seal({ version: 1, reservedUsd, events });
	await writeFile(ledgerPath, `${JSON.stringify(ledger)}\n`, { flag: "wx" });
	const bytes = await readFile(ledgerPath);
	const additions = [
		{ model: "tcuni/gpt-6-luna", reserveUsd: 1.58301852, sessionId: "native-lite-reopen-control-overage-test", timestamp: "2026-10-28T01:15:19Z", payloadHash: hash("transfer-overage") },
		{ model: "tcuni/gpt-6-luna", reserveUsd: 1, sessionId: "native-lite-reopen-control-reserve-test", timestamp: "2026-10-28T01:15:19Z", payloadHash: hash("transfer-reserve") },
	];
	return {
		directory,
		ledgerPath,
		original: ledger,
		plan: {
			version: 1,
			ledgerPath,
			expectedLedgerSha256: hash(bytes),
			expectedPrefixCount: events.length,
			expectedPrefixEventsSha256: hash(JSON.stringify(events)),
			expectedReservedUsd: reservedUsd,
			events: additions,
		},
	};
}

async function cleanup(f) { await rm(f.directory, { recursive: true, force: true }); }

test("budget transfer exposes a guarded atomic append operation", () => {
	assert.equal(typeof transferModule.appendBudgetTransfer, "function");
});

test("atomic transfer preserves the old prefix, verifies checksum, and removes lock/temp files", async t => {
	const f = await fixture();
	try {
		const result = await appendBudgetTransfer(f.plan);
		const bytes = await readFile(f.ledgerPath);
		const value = JSON.parse(bytes);
		assert.deepEqual(value.events.slice(0, 19), f.original.events);
		assert.deepEqual(value.events.slice(19), f.plan.events);
		assert.equal(value.reservedUsd, f.original.reservedUsd + 2.58301852);
		assert.equal(value.checksum, seal(value).checksum);
		assert.equal(result.fileSha256, hash(bytes));
		assert.deepEqual(await readdir(f.directory), ["budget-ledger.json"]);
	} finally { await cleanup(f); }
});

test("prefix changes fail closed without writing", async t => {
	const f = await fixture();
	try {
		const changedEvents = f.original.events.map((event, index) => index === 4 ? { ...event, sessionId: "changed-prefix" } : event);
		const changed = seal({ version: 1, reservedUsd: f.original.reservedUsd, events: changedEvents });
		await writeFile(f.ledgerPath, `${JSON.stringify(changed)}\n`);
		const before = await readFile(f.ledgerPath);
		await assert.rejects(appendBudgetTransfer(f.plan), /prefix|hash mismatch/i);
		assert.deepEqual(await readFile(f.ledgerPath), before);
	} finally { await cleanup(f); }
});

test("replaying a committed transfer is rejected as duplicate without a second append", async t => {
	const f = await fixture();
	try {
		await appendBudgetTransfer(f.plan);
		const before = await readFile(f.ledgerPath);
		await assert.rejects(appendBudgetTransfer(f.plan), /duplicate/i);
		assert.deepEqual(await readFile(f.ledgerPath), before);
	} finally { await cleanup(f); }
});

test("a transfer at or above the USD 16 guard ceiling is rejected unchanged", async t => {
	const f = await fixture(15.5);
	try {
		const before = await readFile(f.ledgerPath);
		await assert.rejects(appendBudgetTransfer(f.plan), /16|budget/i);
		assert.deepEqual(await readFile(f.ledgerPath), before);
		assert.deepEqual(await readdir(f.directory), ["budget-ledger.json"]);
	} finally { await cleanup(f); }
});

test("an existing same-ledger lock is not bypassed or removed", async t => {
	const f = await fixture();
	try {
		const lockPath = `${f.ledgerPath}.lock`;
		await writeFile(lockPath, "other writer\n", { flag: "wx" });
		const before = await readFile(f.ledgerPath);
		await assert.rejects(appendBudgetTransfer(f.plan), /lock/i);
		assert.deepEqual(await readFile(f.ledgerPath), before);
		assert.equal(await readFile(lockPath, "utf8"), "other writer\n");
	} finally { await cleanup(f); }
});
