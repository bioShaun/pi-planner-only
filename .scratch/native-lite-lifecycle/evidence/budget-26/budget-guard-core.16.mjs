import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export const BUDGET_USD = 16;
export const MAX_OUTPUT_TOKENS = 16384;
export const BUDGET_EXIT_CODE = 73;
const STRUCTURE_TOKEN_MARGIN = 8192;
const OPENAI_RESPONSES_FIELDS = new Set([
	"model", "input", "stream", "prompt_cache_key", "prompt_cache_retention", "prompt_cache_options", "store",
	"max_output_tokens", "temperature", "service_tier", "tools", "tool_choice", "reasoning", "include",
	"top_p", "metadata", "parallel_tool_calls", "max_tool_calls", "truncation", "text", "instructions",
]);
const NON_TEXT_INPUT_TYPES = new Set([
	"input_image", "image", "input_audio", "audio", "input_file", "file", "file_search_call",
	"web_search_call", "computer_call", "code_interpreter_call",
]);
const MODELS = Object.freeze({
	"gpt-6.1-terra": { context: 500000, input: 1, cacheWrite: 1.25, output: 5 },
	"gpt-6-luna": { context: 1050000, input: 0.1, cacheWrite: 0.125, output: 0.5 },
});

function hash(value) {
	return createHash("sha256").update(value).digest("hex");
}

function seal(ledger) {
	const body = { version: ledger.version, reservedUsd: ledger.reservedUsd, events: ledger.events };
	return { ...body, checksum: hash(JSON.stringify(body)) };
}

function validateLedger(value) {
	if (!value || value.version !== 1 || !Array.isArray(value.events) || !Number.isFinite(value.reservedUsd) || value.reservedUsd < 0 || value.reservedUsd >= BUDGET_USD) {
		throw new Error("budget ledger invalid schema or total");
	}
	let sum = 0;
	for (const event of value.events) {
		if (!event || typeof event.model !== "string" || typeof event.sessionId !== "string" || typeof event.timestamp !== "string" || !/^[a-f0-9]{64}$/.test(event.payloadHash) || !Number.isFinite(event.reserveUsd) || event.reserveUsd <= 0) {
			throw new Error("budget ledger invalid event");
		}
		sum += event.reserveUsd;
	}
	const expected = seal({ version: value.version, reservedUsd: value.reservedUsd, events: value.events });
	if (Math.abs(sum - value.reservedUsd) > 1e-9 || value.checksum !== expected.checksum) throw new Error("budget ledger checksum or total mismatch");
	return value;
}

function validateTextInput(value) {
	if (Array.isArray(value)) {
		for (const item of value) validateTextInput(item);
		return;
	}
	if (!value || typeof value !== "object") return;
	if (typeof value.type === "string" && NON_TEXT_INPUT_TYPES.has(value.type)) throw new Error("budget guard denied non-text input");
	for (const key of Object.keys(value)) {
		if (["image_url", "audio_url", "file_id", "input_image", "input_audio", "input_file"].includes(key)) {
			throw new Error("budget guard denied non-text input");
		}
		validateTextInput(value[key]);
	}
}

export async function readLedger(path) {
	let parsed;
	try { parsed = JSON.parse(await readFile(path, "utf8")); }
	catch (error) { throw new Error(`budget ledger unavailable or malformed: ${error.message}`); }
	return validateLedger(parsed);
}

export async function createLedger(path, { initialReserveUsd = 1, sessionId = "preparation-unknown", now = new Date().toISOString() } = {}) {
	if (!Number.isFinite(initialReserveUsd) || initialReserveUsd < 0 || initialReserveUsd >= BUDGET_USD) throw new Error("invalid initial reserve");
	const events = initialReserveUsd === 0 ? [] : [{
		model: "tcuni/gpt-6-luna",
		reserveUsd: initialReserveUsd,
		sessionId,
		timestamp: now,
		payloadHash: hash(`preparation reserve ${sessionId}`),
	}];
	const value = seal({ version: 1, reservedUsd: initialReserveUsd, events });
	const handle = await open(path, "wx", 0o600);
	try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); }
	finally { await handle.close(); }
	return value;
}

async function withLedgerLock(path, fn) {
	const lockPath = `${path}.lock`;
	let lock;
	for (let attempt = 0; attempt < 500; attempt++) {
		try { lock = await open(lockPath, "wx", 0o600); break; }
		catch (error) {
			if (error.code !== "EEXIST") throw error;
			await delay(10);
		}
	}
	if (!lock) throw new Error("budget ledger lock timeout; fail closed");
	try { return await fn(); }
	finally { await lock.close(); await rm(lockPath, { force: true }); }
}

async function atomicWrite(path, value) {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	const handle = await open(temporary, "wx", 0o600);
	try { await handle.writeFile(`${JSON.stringify(seal(value))}\n`); await handle.sync(); }
	finally { await handle.close(); }
	await rename(temporary, path);
}

export function estimateReservation(payload, modelId) {
	const model = MODELS[modelId];
	if (!model) throw new Error("budget guard denied unknown model");
	if (!payload || Object.getPrototypeOf(payload) !== Object.prototype || typeof payload.model !== "string" || payload.model !== modelId || Object.hasOwn(payload, "max_tokens") || !Object.hasOwn(payload, "input")) {
		throw new Error("budget guard denied unknown provider request shape");
	}
	if (Object.keys(payload).some((key) => !OPENAI_RESPONSES_FIELDS.has(key))) throw new Error("budget guard denied unknown provider request field");
	if (Object.hasOwn(payload, "service_tier")) throw new Error("budget guard denied service-tier pricing overrides");
	validateTextInput(payload.input);
	if (payload.tools !== undefined && (!Array.isArray(payload.tools) || payload.tools.some((tool) => tool?.type !== "function"))) {
		throw new Error("budget guard denied server-side extra-charge tools");
	}
	if (payload.max_output_tokens !== undefined && (!Number.isInteger(payload.max_output_tokens) || payload.max_output_tokens < 1)) {
		throw new Error("budget guard denied invalid max_output_tokens");
	}
	let serialized;
	try { serialized = JSON.stringify(payload); }
	catch { throw new Error("budget guard denied unserializable request"); }
	if (typeof serialized !== "string") throw new Error("budget guard denied unserializable request");
	const inputUpperBound = Math.min(model.context, Buffer.byteLength(serialized, "utf8") + STRUCTURE_TOKEN_MARGIN);
	const inputRate = Math.max(model.input, model.cacheWrite);
	const outputTokenLimit = Math.min(payload.max_output_tokens ?? MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS);
	const reserveUsd = (inputUpperBound * inputRate + MAX_OUTPUT_TOKENS * model.output) / 1_000_000;
	const boundedPayload = { ...payload, max_output_tokens: outputTokenLimit };
	return { payload: boundedPayload, inputUpperBound, reserveUsd };
}

export async function reserveProviderRequest(payload, { provider, sessionId, ledgerPath, now = new Date().toISOString() } = {}) {
	if (provider !== "tcuni") throw new Error("budget guard denied provider outside allowlist");
	if (typeof sessionId !== "string" || !sessionId || typeof ledgerPath !== "string" || !ledgerPath) throw new Error("budget guard requires session id and shared ledger");
	const modelId = payload?.model;
	const estimate = estimateReservation(payload, modelId);
	return withLedgerLock(ledgerPath, async () => {
		const ledger = await readLedger(ledgerPath);
		const total = ledger.reservedUsd + estimate.reserveUsd;
		if (!Number.isFinite(total) || total >= BUDGET_USD) throw new Error("budget guard denied request at or above $16 reserve cap");
		const event = {
			model: `tcuni/${modelId}`,
			reserveUsd: estimate.reserveUsd,
			sessionId,
			timestamp: now,
			payloadHash: hash(JSON.stringify(estimate.payload)),
		};
		const next = { version: 1, reservedUsd: total, events: [...ledger.events, event] };
		await atomicWrite(ledgerPath, next);
		return { ...estimate, reservedUsd: estimate.reserveUsd };
	});
}
