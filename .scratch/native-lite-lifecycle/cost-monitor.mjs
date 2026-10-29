import { createHash, randomUUID } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function stateDirectory() {
	const value = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
	if (!value || !resolve(value).startsWith("/project/tmp/") || !statSync(value).isDirectory()) throw new Error("invalid monitor state directory");
	return resolve(value);
}

function writeAtomic(path, value) {
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
	renameSync(temp, path);
}

export function initializeCostState(dir) {
	if (!resolve(dir).startsWith("/project/tmp/") || !statSync(dir).isDirectory()) throw new Error("invalid monitor state directory");
	writeFileSync(join(dir, "initialized"), "1", { flag: "wx", mode: 0o600 });
	writeFileSync(join(dir, "observations.json"), JSON.stringify({ version: 1, records: [] }), { flag: "wx", mode: 0o600 });
}

function stop(dir, reason, observedUsd) {
	const path = join(dir, "stop.json");
	const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temp, JSON.stringify({ reason, observedUsd }), { mode: 0o600, flag: "wx" });
	try { linkSync(temp, path); } catch (error) { if (error.code !== "EEXIST") throw error; }
	finally { unlinkSync(temp); }
}

function validate(state) {
	if (!state || state.version !== 1 || !Array.isArray(state.records)) throw new Error("invalid observations");
	const keys = new Set();
	const entries = new Set();
	for (const record of state.records) {
		if (!record || typeof record.sessionId !== "string" || !record.sessionId || typeof record.nonce !== "string" || !record.nonce || !Number.isSafeInteger(record.sequence) || record.sequence < 1 || !Number.isFinite(record.costUsd) || record.costUsd < 0 || !/^[a-f0-9]{64}$/.test(record.messageHash) || !(record.entryId === null || typeof record.entryId === "string" && record.entryId)) throw new Error("invalid observation record");
		const key = `${record.sessionId}:${record.nonce}:${record.sequence}`;
		const entry = `${record.sessionId}:${record.entryId}`;
		if (keys.has(key) || (record.entryId && entries.has(entry))) throw new Error("observation identity conflict");
		keys.add(key);
		if (record.entryId) entries.add(entry);
	}
	if (!Number.isFinite(state.records.reduce((sum, record) => sum + record.costUsd, 0))) throw new Error("invalid observation total");
}

async function transaction(dir, action) {
	const lock = join(dir, "observations.lock");
	let acquired = false;
	for (let attempt = 0; attempt < 500; attempt++) {
		try { mkdirSync(lock, { mode: 0o700 }); acquired = true; break; }
		catch (error) { if (error.code !== "EEXIST") throw error; await sleep(10); }
	}
	if (!acquired) throw new Error("monitor lock unavailable");
	try {
		const path = join(dir, "observations.json");
		const marker = join(dir, "initialized");
		if (!existsSync(marker) || !existsSync(path)) throw new Error("monitor state missing");
		const state = JSON.parse(readFileSync(path, "utf8"));
		validate(state);
		await action(state);
		validate(state);
		writeAtomic(path, state);
		const total = state.records.reduce((sum, record) => sum + record.costUsd, 0);
		if (total >= 1.25 && !existsSync(join(dir, "stop.json"))) stop(dir, "threshold", total);
	} finally { rmSync(lock, { recursive: true }); }
}

export default function costMonitor(pi) {
	const nonce = randomUUID();
	let sequence = 0;
	const pending = new Map();
	const observedEvents = new WeakMap();
	const observedMessages = new WeakMap();
	const boundEvents = new WeakMap();
	let fault = null;
	function fail(error) {
		fault = error instanceof Error ? error.message : String(error);
		process.stderr.write(`native-lite cost monitor fault: ${fault}\n`);
		try { stop(stateDirectory(), `monitor invalid: ${fault}`); } catch (stopError) { process.stderr.write(`native-lite cost monitor evidence failed: ${stopError.message}\n`); }
	}
	pi.on("message_end", async (event, ctx) => {
		if (event.message?.role !== "assistant") return;
		try {
			const sessionId = ctx.sessionManager?.getSessionId?.();
			if (observedEvents.has(event)) {
				if (observedEvents.get(event) !== hash({ sessionId, message: event.message })) throw new Error("conflicting replayed assistant event");
				return;
			}
			const costUsd = event.message.usage?.cost?.total;
			if (!sessionId || typeof costUsd !== "number" || !Number.isFinite(costUsd) || costUsd < 0) throw new Error("invalid assistant identity or cost");
			const previous = pending.get(sessionId);
			const known = observedMessages.get(event.message);
			if (known) {
				if (known.record.sessionId !== sessionId || known.record.messageHash !== hash(event.message) || (previous && previous !== known)) throw new Error("conflicting replayed assistant identity");
				known.uncertainReplay = true;
				pending.set(sessionId, known);
				observedEvents.set(event, hash({ sessionId, message: event.message }));
				return;
			}
			if (previous) throw new Error("ambiguous pending assistant observation");
			const record = { sessionId, nonce, sequence: ++sequence, costUsd, messageHash: hash(event.message), entryId: null };
			await transaction(stateDirectory(), state => {
				if (state.records.some(item => item.sessionId === sessionId && item.entryId === null)) throw new Error("unbound observation from another instance");
				state.records.push(record);
			});
			const observation = { message: event.message, record, uncertainReplay: false };
			pending.set(sessionId, observation);
			observedMessages.set(event.message, observation);
			observedEvents.set(event, hash({ sessionId, message: event.message }));
		} catch (error) { fail(error); }
	});
	pi.on("turn_end", async (event, ctx) => {
		if (event.message?.role !== "assistant") return;
		try {
			const sessionId = ctx.sessionManager?.getSessionId?.();
			const entries = ctx.sessionManager?.getEntries?.();
			const entry = entries?.filter(item => item.type === "message" && item.message?.role === "assistant").at(-1);
			if (boundEvents.has(event)) {
				if (boundEvents.get(event) !== hash({ sessionId, entryId: entry?.id, message: event.message })) throw new Error("conflicting replayed turn event");
				return;
			}
			const observation = pending.get(sessionId);
			if (!observation || !entry?.id || hash(event.message) !== observation.record.messageHash || hash(entry.message) !== observation.record.messageHash) throw new Error("ambiguous assistant entry binding");
			if (observation.record.entryId !== null) {
				if (observation.message !== event.message || observation.record.entryId !== entry.id) throw new Error("conflicting replayed assistant entry identity");
				pending.delete(sessionId);
				boundEvents.set(event, hash({ sessionId, entryId: entry.id, message: event.message }));
				return;
			}
			await transaction(stateDirectory(), state => {
				const matches = state.records.filter(item => item.sessionId === sessionId && item.nonce === nonce && item.sequence === observation.record.sequence);
				if (matches.length !== 1 || matches[0].entryId !== null || state.records.some(item => item.sessionId === sessionId && item.entryId === entry.id)) throw new Error("assistant entry identity conflict");
				matches[0].entryId = entry.id;
			});
			observation.record.entryId = entry.id;
			pending.delete(sessionId);
			boundEvents.set(event, hash({ sessionId, entryId: entry.id, message: event.message }));
		} catch (error) { fail(error); }
	});
	pi.on("before_provider_request", async (_event, ctx) => {
		try {
			const dir = stateDirectory();
			const sessionId = ctx.sessionManager?.getSessionId?.();
			if (!sessionId || fault || existsSync(join(dir, "stop.json"))) throw new Error(fault ?? "cost stop or missing session identity");
			if ([...pending.values()].some(observation => observation.uncertainReplay)) throw new Error("ambiguous assistant replay awaiting entry identity");
			await transaction(dir, state => {
				if (state.records.some(record => record.sessionId === sessionId && record.entryId === null && record.nonce !== nonce)) throw new Error("unrecoverable unbound observation");
			});
			if (existsSync(join(dir, "stop.json"))) throw new Error("cost stop");
		} catch (error) { fail(error); process.exit(74); }
	});
}
