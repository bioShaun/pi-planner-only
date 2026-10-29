import { createHash, randomUUID } from "node:crypto";
import { open, readFile, realpath, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BUDGET_USD, readLedger } from "../native-lite-lifecycle/budget-guard-core.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const seal = ledger => {
	const body = { version: ledger.version, reservedUsd: ledger.reservedUsd, events: ledger.events };
	return { ...body, checksum: hash(JSON.stringify(body)) };
};

function validatePlan(plan) {
	if (!plan || plan.version !== 1 || typeof plan.ledgerPath !== "string" || !resolve(plan.ledgerPath).startsWith("/project/tmp/")) {
		throw new Error("budget transfer requires a version 1 ledger plan under /project/tmp");
	}
	if (!/^[a-f0-9]{64}$/.test(plan.expectedLedgerSha256 ?? "")
		|| !Number.isSafeInteger(plan.expectedPrefixCount) || plan.expectedPrefixCount < 1
		|| !/^[a-f0-9]{64}$/.test(plan.expectedPrefixEventsSha256 ?? "")
		|| !Number.isFinite(plan.expectedReservedUsd) || plan.expectedReservedUsd < 0
		|| !Array.isArray(plan.events) || plan.events.length < 1) {
		throw new Error("budget transfer plan is incomplete");
	}
	const sessionIds = new Set();
	for (const event of plan.events) {
		if (event?.model !== "tcuni/gpt-6-luna" || !Number.isFinite(event.reserveUsd) || event.reserveUsd <= 0
			|| typeof event.sessionId !== "string" || !event.sessionId
			|| typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp))
			|| !/^[a-f0-9]{64}$/.test(event.payloadHash ?? "") || sessionIds.has(event.sessionId)) {
			throw new Error("budget transfer contains an invalid or duplicate reservation event");
		}
		sessionIds.add(event.sessionId);
	}
	return sessionIds;
}

export async function appendBudgetTransfer(plan) {
	const sessionIds = validatePlan(plan);
	const ledgerPath = resolve(plan.ledgerPath);
	const resolvedLedgerPath = await realpath(ledgerPath);
	if (resolvedLedgerPath !== ledgerPath || !resolvedLedgerPath.startsWith("/project/tmp/")) {
		throw new Error("budget transfer ledger must be a canonical file under /project/tmp");
	}
	const lockPath = `${ledgerPath}.lock`;
	let lock;
	try { lock = await open(lockPath, "wx", 0o600); }
	catch (error) {
		if (error.code === "EEXIST") throw new Error("budget ledger lock exists; refusing concurrent transfer");
		throw error;
	}
	const lockToken = `${process.pid} ${randomUUID()}\n`;
	let temporaryPath;
	try {
		await lock.writeFile(lockToken);
		await lock.sync();
		const originalBytes = await readFile(ledgerPath);
		const ledger = await readLedger(ledgerPath);
		if (ledger.events.some(event => sessionIds.has(event.sessionId))) {
			throw new Error("duplicate budget transfer event already exists");
		}
		if (hash(originalBytes) !== plan.expectedLedgerSha256) throw new Error("budget ledger file hash mismatch; re-review current prefix");
		const prefix = ledger.events.slice(0, plan.expectedPrefixCount);
		if (prefix.length !== plan.expectedPrefixCount
			|| hash(JSON.stringify(prefix)) !== plan.expectedPrefixEventsSha256
			|| Math.abs(prefix.reduce((sum, event) => sum + event.reserveUsd, 0) - plan.expectedReservedUsd) > 1e-9
			|| ledger.reservedUsd + 1e-9 < plan.expectedReservedUsd) {
			throw new Error("budget ledger history prefix mismatch");
		}
		const addedUsd = plan.events.reduce((sum, event) => sum + event.reserveUsd, 0);
		const reservedUsd = ledger.reservedUsd + addedUsd;
		if (!Number.isFinite(reservedUsd) || reservedUsd >= BUDGET_USD) {
			throw new Error(`budget transfer would reach or exceed $${BUDGET_USD}`);
		}
		const next = seal({ version: ledger.version, reservedUsd, events: [...ledger.events, ...plan.events] });
		temporaryPath = `${ledgerPath}.${process.pid}.${randomUUID()}.tmp`;
		const temporary = await open(temporaryPath, "wx", 0o600);
		try {
			await temporary.writeFile(`${JSON.stringify(next)}\n`);
			await temporary.sync();
		} finally { await temporary.close(); }
		await rename(temporaryPath, ledgerPath);
		temporaryPath = undefined;
		const verified = await readLedger(ledgerPath);
		if (verified.events.length !== ledger.events.length + plan.events.length
			|| !verified.events.slice(0, ledger.events.length).every((event, index) => JSON.stringify(event) === JSON.stringify(ledger.events[index]))
			|| !verified.events.slice(ledger.events.length).every((event, index) => JSON.stringify(event) === JSON.stringify(plan.events[index]))) {
			throw new Error("budget transfer post-write verification failed");
		}
		return { eventCount: verified.events.length, reservedUsd: verified.reservedUsd, fileSha256: hash(await readFile(ledgerPath)) };
	} finally {
		if (temporaryPath) await rm(temporaryPath, { force: true });
		await lock.close();
		try {
			if (await readFile(lockPath, "utf8") === lockToken) await rm(lockPath);
		} catch (error) { if (error.code !== "ENOENT") throw error; }
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 4 || process.argv[2] !== "--apply") throw new Error("usage: budget-transfer.mjs --apply <approved-plan.json>");
	const plan = JSON.parse(await readFile(process.argv[3], "utf8"));
	console.log(JSON.stringify(await appendBudgetTransfer(plan)));
}
