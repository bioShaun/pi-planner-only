/**
 * TaskRecord snapshots on disk. Writes are atomic; readAll() replays them
 * at session start. Corrupt files are reported, never repaired or deleted.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { TaskRecord } from "./task.ts";

const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");

export const SAFE_TASK_ID = /^[A-Za-z0-9_.-]+$/;
let tmpSeq = 0;

export type LedgerCorrupt = { taskId: string; reason: string };

/**
 * Result of a targeted single-record read: the distinction diagnostics need
 * between "no record", "record exists but is damaged", and "cannot read".
 */
export type LedgerReadResult =
	| { status: "ok"; record: TaskRecord }
	| { status: "missing" }
	| { status: "invalid" }
	| { status: "unreadable"; reason: string }
	| { status: "corrupt"; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OPTIONAL_STRING_FIELDS = [
	"taskId",
	"role",
	"cwd",
	"state",
	"createdAt",
	"updatedAt",
	"parentTaskId",
	"stateReason",
	"sealedAt",
	"completionKind",
	"pendingRevalidationKey",
] as const;

const OPTIONAL_ARRAY_FIELDS = [
	"successors",
	"reports",
	"validatorReports",
	"reviews",
	"verdictRefusals",
	"overrides",
	"aliases",
	"findings",
	"recoveryStates",
	"recoveryDispatches",
	"recoveryHistory",
	"launchRefusals",
] as const;

const OPTIONAL_BOOLEAN_FIELDS = ["standaloneExplorer", "isPlaceholder", "titleAliasUsed"] as const;

function executionShapeError(value: unknown, index: number): string | undefined {
	const label = `task.executions[${index}]`;
	if (!isPlainObject(value)) return `${label} must be an object`;
	for (const field of ["executionId", "kind", "status", "capability", "capabilityBasis", "reportOnlyAgent", "reportOnlyCapabilityBasis", "runId", "cwd", "endedReason", "requestId", "launchedAt", "endedAt", "durationBasis", "requestClosed", "requestClosedAt", "confirmationBasis", "unacceptedReportReason"] as const) {
		if (value[field] !== undefined && typeof value[field] !== "string") return `${label}.${field} must be a string`;
	}
	if (value.startedAt !== undefined && value.startedAt !== null && typeof value.startedAt !== "string") return `${label}.startedAt must be a string or null`;
	if (value.durationMs !== undefined && (!Number.isSafeInteger(value.durationMs) || (value.durationMs as number) < 0)) return `${label}.durationMs must be a non-negative finite safe integer`;
	if (value.durationBasis !== undefined && value.durationBasis !== "request-outbound-to-finalization") return `${label}.durationBasis is invalid`;
	if (typeof value.executionId !== "string") return `${label}.executionId must be a string`;
	if (!isPlainObject(value.aRun)) return `${label}.aRun must be an object`;
	if (value.envelope !== undefined) {
		if (!isPlainObject(value.envelope)) return `${label}.envelope must be an object`;
		if (!["delegation-param", "default", "operator-config"].includes(value.envelope.source as string)) {
			return `${label}.envelope.source must be delegation-param, default, or operator-config`;
		}
		for (const field of ["maxTokens", "maxWallMs", "maxReadOnlyTools"] as const) {
			const bound = value.envelope[field];
			if (bound !== undefined && (!Number.isSafeInteger(bound) || (bound as number) <= 0)) {
				return `${label}.envelope.${field} must be a positive finite safe integer`;
			}
		}
		if (value.envelope.preparationTokensShare !== undefined && (typeof value.envelope.preparationTokensShare !== "number" || value.envelope.preparationTokensShare <= 0 || value.envelope.preparationTokensShare > 1)) {
			return `${label}.envelope.preparationTokensShare must be greater than 0 and at most 1`;
		}
		if (value.envelope.preparationTokensShare !== undefined && value.envelope.maxTokens === undefined) {
			return `${label}.envelope.preparationTokensShare requires maxTokens`;
		}
		if (value.envelope.maxTokens === undefined && value.envelope.maxWallMs === undefined && value.envelope.maxReadOnlyTools === undefined) {
			return `${label}.envelope requires a configured bound`;
		}
	}
	if (value.originalEnvelope !== undefined) {
		const originalError = envelopeShapeError(value.originalEnvelope, `${label}.originalEnvelope`);
		if (originalError) return originalError;
	}
	if (value.envelopeClamped !== undefined && typeof value.envelopeClamped !== "boolean") return `${label}.envelopeClamped must be a boolean`;
	const requestBudgetError = requestBudgetShapeError(value.requestBudget, `${label}.requestBudget`);
	if (requestBudgetError) return requestBudgetError;
	if (value.toolBudget !== undefined) {
		if (!isPlainObject(value.toolBudget)) return `${label}.toolBudget must be an object`;
		if (!Number.isSafeInteger(value.toolBudget.hard) || (value.toolBudget.hard as number) < 0) {
			return `${label}.toolBudget.hard must be a non-negative finite safe integer`;
		}
		if (value.toolBudget.soft !== undefined && (!Number.isSafeInteger(value.toolBudget.soft) || (value.toolBudget.soft as number) < 0)) {
			return `${label}.toolBudget.soft must be a non-negative finite safe integer`;
		}
		if (value.toolBudget.block !== undefined && value.toolBudget.block !== "*"
			&& (!Array.isArray(value.toolBudget.block) || value.toolBudget.block.some((item) => typeof item !== "string"))) {
			return `${label}.toolBudget.block must be "*" or an array of strings`;
		}
	}
	if (value.rawTerminal !== undefined && !isPlainObject(value.rawTerminal)) {
		return `${label}.rawTerminal must be an object`;
	}
	if (value.updateTrace !== undefined) {
		if (!Array.isArray(value.updateTrace) || value.updateTrace.length > 64) return `${label}.updateTrace must be an array of at most 64 entries`;
		for (let i = 0; i < value.updateTrace.length; i += 1) {
			const item = value.updateTrace[i];
			if (!isPlainObject(item)) return `${label}.updateTrace[${i}] must be an object`;
			if (typeof item.receivedAt !== "string" || !Number.isSafeInteger(item.ordinal) || (item.ordinal as number) <= 0) return `${label}.updateTrace[${i}] identity is invalid`;
			for (const field of ["tokens", "toolCount", "durationMs"] as const) if (item[field] !== undefined && (!Number.isSafeInteger(item[field]) || (item[field] as number) < 0)) return `${label}.updateTrace[${i}].${field} must be a non-negative safe integer`;
			for (const field of ["currentTool", "currentToolArgs"] as const) if (item[field] !== undefined && typeof item[field] !== "string") return `${label}.updateTrace[${i}].${field} must be a string`;
			if (item.recentTools !== undefined && (!Array.isArray(item.recentTools) || item.recentTools.length > 8)) return `${label}.updateTrace[${i}].recentTools must contain at most 8 entries`;
			if (Array.isArray(item.recentTools) && item.recentTools.some((tool) => !isPlainObject(tool) || typeof tool.tool !== "string" || typeof tool.args !== "string")) return `${label}.updateTrace[${i}].recentTools entries must contain string tool and args`;
			if (item.recentOutputLines !== undefined && (!Array.isArray(item.recentOutputLines) || item.recentOutputLines.length > 20 || item.recentOutputLines.some((line) => typeof line !== "string"))) return `${label}.updateTrace[${i}].recentOutputLines must contain at most 20 strings`;
		}
	}
	if (value.traceSummary !== undefined) {
		if (!isPlainObject(value.traceSummary)) return `${label}.traceSummary must be an object`;
		for (const field of ["firstNonReadOnlyToolOrdinal", "maxTokenDelta", "classifiedToolCalls", "observedToolCalls", "totalToolCalls", "coalescedToolCalls"] as const) {
			if (value.traceSummary[field] !== undefined && (!Number.isSafeInteger(value.traceSummary[field]) || (value.traceSummary[field] as number) < 0)) return `${label}.traceSummary.${field} must be a non-negative safe integer`;
		}
		if (typeof value.traceSummary.readOnlyToolFraction !== "number" || value.traceSummary.readOnlyToolFraction < 0 || value.traceSummary.readOnlyToolFraction > 1) return `${label}.traceSummary.readOnlyToolFraction is invalid`;
	}
	if (value.usageSnapshot !== undefined) {
		if (!isPlainObject(value.usageSnapshot) || value.usageSnapshot.snapshot !== true) return `${label}.usageSnapshot must be a snapshot object`;
		for (const field of ["input", "output", "cacheRead", "cacheWrite"] as const) if (value.usageSnapshot[field] !== null) return `${label}.usageSnapshot.${field} must be null`;
		if (!Number.isSafeInteger(value.usageSnapshot.totalTokens) || (value.usageSnapshot.totalTokens as number) < 0) return `${label}.usageSnapshot.totalTokens must be a non-negative safe integer`;
	}
	const probeFailuresError = (sample: Record<string, unknown>, sampleLabel: string): string | undefined => {
		if (sample.probeFailures === undefined) return undefined;
		if (!Array.isArray(sample.probeFailures)) return `${sampleLabel}.probeFailures must be an array`;
		for (let i = 0; i < sample.probeFailures.length; i += 1) {
			const failure = sample.probeFailures[i];
			const failureLabel = `${sampleLabel}.probeFailures[${i}]`;
			if (!isPlainObject(failure)) return `${failureLabel} must be an object`;
			for (const field of ["operation", "kind", "cwd"] as const) {
				if (typeof failure[field] !== "string") return `${failureLabel}.${field} must be a string`;
			}
			if (failure.error !== undefined && typeof failure.error !== "string") return `${failureLabel}.error must be a string`;
			for (const field of ["killed", "startupFailed", "truncated"] as const) {
				if (failure[field] !== undefined && typeof failure[field] !== "boolean") return `${failureLabel}.${field} must be a boolean`;
			}
			if (failure.exitCode !== undefined && typeof failure.exitCode !== "number") return `${failureLabel}.exitCode must be a number`;
		}
		return undefined;
	};
	let sampleError = probeFailuresError(value.aRun, `${label}.aRun`);
	if (sampleError) return sampleError;
	if (value.cReport !== undefined) {
		if (!isPlainObject(value.cReport)) return `${label}.cReport must be an object`;
		sampleError = probeFailuresError(value.cReport, `${label}.cReport`);
		if (sampleError) return sampleError;
	}
	if (value.stopSamples !== undefined) {
		if (!Array.isArray(value.stopSamples)) return `${label}.stopSamples must be an array`;
		for (let i = 0; i < value.stopSamples.length; i += 1) {
			const sample = value.stopSamples[i];
			if (!isPlainObject(sample)) return `${label}.stopSamples[${i}] must be an object`;
			sampleError = probeFailuresError(sample, `${label}.stopSamples[${i}]`);
			if (sampleError) return sampleError;
		}
	}
	if (value.worktreeRoots !== undefined && !Array.isArray(value.worktreeRoots)) {
		return `${label}.worktreeRoots must be an array`;
	}
	if (Array.isArray(value.worktreeRoots)) {
		for (let i = 0; i < value.worktreeRoots.length; i += 1) {
			if (typeof value.worktreeRoots[i] !== "string") return `${label}.worktreeRoots[${i}] must be a string`;
		}
	}
	if (value.unacceptedReport !== undefined) {
		if (!isPlainObject(value.unacceptedReport)) return `${label}.unacceptedReport must be an object`;
		for (const field of ["taskId", "status", "summary"] as const) {
			if (typeof value.unacceptedReport[field] !== "string") return `${label}.unacceptedReport.${field} must be a string`;
		}
		if (!isPlainObject(value.unacceptedReport.evidence)) return `${label}.unacceptedReport.evidence must be an object`;
		if (typeof value.unacceptedReport.evidence.workerRunId !== "string") return `${label}.unacceptedReport.evidence.workerRunId must be a string`;
	}
	return undefined;
}

function requestBudgetShapeError(value: unknown, label: string): string | undefined {
	if (value === undefined) return undefined;
	if (!isPlainObject(value)) return `${label} must be an object`;
	for (const field of ["requestId", "observedAt"] as const) if (typeof value[field] !== "string") return `${label}.${field} must be a string`;
	if (value.requestDeadline !== null && typeof value.requestDeadline !== "string") return `${label}.requestDeadline must be a string or null`;
	if (value.remainingMs !== null && (!Number.isSafeInteger(value.remainingMs) || (value.remainingMs as number) < 0)) return `${label}.remainingMs must be a non-negative safe integer or null`;
	if (value.availableMs !== null && !Number.isSafeInteger(value.availableMs)) return `${label}.availableMs must be a safe integer or null`;
	if (!Number.isSafeInteger(value.reserveMs) || (value.reserveMs as number) <= 0) return `${label}.reserveMs must be a positive safe integer`;
	if (value.unavailableReason !== undefined && !["request-not-started", "request-mismatch", "observation-failed"].includes(value.unavailableReason as string)) return `${label}.unavailableReason is invalid`;
	return undefined;
}

function envelopeShapeError(value: unknown, label: string): string | undefined {
	if (!isPlainObject(value)) return `${label} must be an object`;
	if (!["delegation-param", "default", "operator-config"].includes(value.source as string)) return `${label}.source is invalid`;
	for (const field of ["maxTokens", "maxWallMs", "maxReadOnlyTools"] as const) {
		const bound = value[field];
		if (bound !== undefined && (!Number.isSafeInteger(bound) || (bound as number) <= 0)) return `${label}.${field} must be a positive finite safe integer`;
	}
	if (value.preparationTokensShare !== undefined && (typeof value.preparationTokensShare !== "number" || value.preparationTokensShare <= 0 || value.preparationTokensShare > 1)) return `${label}.preparationTokensShare is invalid`;
	if (value.preparationTokensShare !== undefined && value.maxTokens === undefined) return `${label}.preparationTokensShare requires maxTokens`;
	if (value.maxTokens === undefined && value.maxWallMs === undefined && value.maxReadOnlyTools === undefined) return `${label} requires a configured bound`;
	return undefined;
}

function launchRefusalShapeError(value: unknown, index: number): string | undefined {
	const label = `task.launchRefusals[${index}]`;
	if (!isPlainObject(value)) return `${label} must be an object`;
	for (const field of ["executionId", "kind", "code", "reason"] as const) if (typeof value[field] !== "string") return `${label}.${field} must be a string`;
	if (value.code !== "REQUEST_REMAINING_INSUFFICIENT") return `${label}.code is invalid`;
	const envelopeError = envelopeShapeError(value.originalEnvelope, `${label}.originalEnvelope`);
	if (envelopeError) return envelopeError;
	if (value.requestBudget === undefined) return `${label}.requestBudget is required`;
	const requestError = requestBudgetShapeError(value.requestBudget, `${label}.requestBudget`);
	if (requestError) return requestError;
	if (value.reportOnly !== undefined && typeof value.reportOnly !== "boolean") return `${label}.reportOnly must be a boolean`;
	return undefined;
}

/**
 * R2 — a syntactically valid envelope can still carry a record whose fields
 * have the wrong shape; diagnostics dereferences executions, usage.children,
 * writerHold and recovery deeply enough that a wrong type throws instead of
 * reporting TASK_LEDGER_CORRUPT. Every check is validate-if-present: fields
 * a record predating them may simply lack stay tolerated (the restore path
 * has always defaulted missing collections), because missing is history,
 * wrong-typed is damage. The identity core (a matching string taskId) is
 * enforced separately in parseEnvelope.
 */
function recordShapeError(task: unknown): string | undefined {
	if (!isPlainObject(task)) return "task must be an object";
	for (const field of OPTIONAL_STRING_FIELDS) {
		if (task[field] !== undefined && typeof task[field] !== "string") return `task.${field} must be a string`;
	}
	for (const field of OPTIONAL_ARRAY_FIELDS) {
		if (task[field] !== undefined && !Array.isArray(task[field])) return `task.${field} must be an array`;
	}
	for (const field of OPTIONAL_BOOLEAN_FIELDS) {
		if (task[field] !== undefined && typeof task[field] !== "boolean") return `task.${field} must be a boolean`;
	}
	for (const field of ["reviewRound", "reportCorrections", "recoveryAttempts"] as const) {
		if (task[field] !== undefined && typeof task[field] !== "number") return `task.${field} must be a number`;
	}
	if (task.spec !== undefined && !isPlainObject(task.spec)) return "task.spec must be an object";
	if (Array.isArray(task.launchRefusals)) {
		for (let i = 0; i < task.launchRefusals.length; i += 1) {
			const error = launchRefusalShapeError(task.launchRefusals[i], i);
			if (error) return error;
		}
	}
	if (task.usage !== undefined) {
		if (!isPlainObject(task.usage)) return "task.usage must be an object";
		if (task.usage.children !== undefined) {
			if (!Array.isArray(task.usage.children)) return "task.usage.children must be an array";
			for (let i = 0; i < task.usage.children.length; i += 1) {
				if (!isPlainObject(task.usage.children[i])) return `task.usage.children[${i}] must be an object`;
			}
		}
	}
	if (task.writerHold !== undefined) {
		if (!isPlainObject(task.writerHold)) return "task.writerHold must be an object";
		for (const field of ["executionId", "reason", "since"] as const) {
			if (typeof task.writerHold[field] !== "string") return `task.writerHold.${field} must be a string`;
		}
	}
	if (task.recovery !== undefined) {
		if (!isPlainObject(task.recovery)) return "task.recovery must be an object";
		if (task.recovery.reason !== undefined && typeof task.recovery.reason !== "string") {
			return "task.recovery.reason must be a string";
		}
		if (task.recovery.executionId !== undefined && typeof task.recovery.executionId !== "string") {
			return "task.recovery.executionId must be a string";
		}
		if (task.recovery.required !== undefined && typeof task.recovery.required !== "boolean") {
			return "task.recovery.required must be a boolean";
		}
		if (task.recovery.required === true) {
			if (typeof task.recovery.reason !== "string") return "task.recovery.reason must be a string when recovery is required";
			if (typeof task.recovery.executionId !== "string") return "task.recovery.executionId must be a string when recovery is required";
		}
	}
	if (task.executions !== undefined) {
		if (!Array.isArray(task.executions)) return "task.executions must be an array";
		for (let i = 0; i < task.executions.length; i += 1) {
			const error = executionShapeError(task.executions[i], i);
			if (error) return error;
		}
	}
	if (task.revalidationDispatches !== undefined) {
		if (!Array.isArray(task.revalidationDispatches)) return "task.revalidationDispatches must be an array";
		for (const dispatch of task.revalidationDispatches) {
			if (!isPlainObject(dispatch)) return "revalidation dispatch must be an object";
			for (const field of ["executionId", "requestId", "evidenceKey", "committedAt"] as const) {
				if (typeof dispatch[field] !== "string" || !dispatch[field]) return `revalidation dispatch.${field} must be a non-empty string`;
			}
			if (dispatch.requestObservedAt !== undefined && typeof dispatch.requestObservedAt !== "string") return "revalidation dispatch.requestObservedAt must be a string";
		}
	}
	return undefined;
}

/** Validate one ledger envelope body; shared by readAll() and read(). */
function parseEnvelope(stem: string, raw: string): { record: TaskRecord } | { corrupt: string } {
	let envelope: unknown;
	try {
		envelope = JSON.parse(raw);
	} catch {
		return { corrupt: "unparseable JSON" };
	}
	if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
		return { corrupt: "unparseable JSON" };
	}
	const env = envelope as { version?: unknown; task?: unknown };
	if (env.version !== 1) {
		return { corrupt: `unsupported version: ${String(env.version)}` };
	}
	if (env.task === undefined || env.task === null || typeof env.task !== "object" || Array.isArray(env.task)) {
		return { corrupt: "missing task" };
	}
	const task = env.task as TaskRecord;
	if (task.taskId !== stem) {
		return { corrupt: `task.taskId does not match filename` };
	}
	const shapeError = recordShapeError(task);
	if (shapeError) return { corrupt: shapeError };
	return { record: task };
}

export class LedgerSnapshotStore {
	private readonly dir: string;
	private _lastWriteError: unknown;
	private readonly writeErrors = new Map<string, unknown>();
	private readonly quarantined = new Map<string, string>();
	private warnedIo = false;

	constructor(dir: string) {
		this.dir = dir;
	}

	get lastWriteError(): unknown {
		return this._lastWriteError;
	}

	writeErrorFor(taskId: string): unknown {
		return this.writeErrors.get(taskId);
	}

	/** Initial Task admission is the one lifecycle boundary that requires durability. */
	writeOrThrow(record: TaskRecord): void {
		if (!SAFE_TASK_ID.test(record.taskId)) {
			const err = new Error(`invalid ledger taskId: ${record.taskId}`);
			this._lastWriteError = err;
			throw err;
		}
		if (this.isQuarantined(record.taskId)) {
			const err = new Error(`quarantined: ${this.quarantined.get(record.taskId) ?? "unreadable snapshot"}`);
			this._lastWriteError = err;
			this.writeErrors.set(record.taskId, err);
			throw err;
		}
		try {
			this.writeAtomic(record);
			this.writeErrors.delete(record.taskId);
		} catch (err) {
			this._lastWriteError = err;
			this.writeErrors.set(record.taskId, err);
			this.warnIo(err);
			throw err;
		}
	}

	quarantine(taskId: string, reason: string): void {
		this.quarantined.set(taskId, reason);
	}

	isQuarantined(taskId: string): boolean {
		return this.quarantined.has(taskId);
	}

	write(record: TaskRecord): void {
		if (!SAFE_TASK_ID.test(record.taskId)) {
			const err = new Error(`invalid ledger taskId: ${record.taskId}`);
			this._lastWriteError = err;
			throw err;
		}
		if (this.isQuarantined(record.taskId)) {
			const reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
			const err = new Error(`quarantined: ${reason}`);
			this._lastWriteError = err;
			this.writeErrors.set(record.taskId, err);
			return;
		}
		try {
			this.writeAtomic(record);
			this.writeErrors.delete(record.taskId);
		} catch (err) {
			this._lastWriteError = err;
			this.writeErrors.set(record.taskId, err);
			this.warnIo(err);
		}
	}

	/**
	 * C09 — drop a rolled-back placeholder Task's snapshot so a refused launch
	 * cannot resurrect it on the next restore. Best-effort: a missing file is
	 * already removed.
	 */
	remove(taskId: string): void {
		if (!SAFE_TASK_ID.test(taskId)) return;
		const path = join(this.dir, "planner-only", "ledger", `${taskId}.json`);
		try {
			fs.unlinkSync(path);
			this.writeErrors.delete(taskId);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException | undefined)?.code;
			if (code === "ENOENT") return;
			this._lastWriteError = err;
			this.writeErrors.set(taskId, err);
			this.warnIo(err);
		}
	}

	readAll(): { records: TaskRecord[]; corrupt: LedgerCorrupt[] } {
		const ledgerDir = join(this.dir, "planner-only", "ledger");
		if (!fs.existsSync(ledgerDir)) {
			return { records: [], corrupt: [] };
		}
		let names: string[];
		try {
			names = fs.readdirSync(ledgerDir);
		} catch {
			return { records: [], corrupt: [] };
		}
		const records: TaskRecord[] = [];
		const corrupt: LedgerCorrupt[] = [];
		for (const name of names) {
			if (name.startsWith(".tmp-")) continue;
			if (!name.endsWith(".json")) continue;
			const stem = name.slice(0, -".json".length);
			if (!SAFE_TASK_ID.test(stem)) {
				corrupt.push({ taskId: stem, reason: "filename is not a safe taskId" });
				continue;
			}
			const path = join(ledgerDir, name);
			let raw: string;
			try {
				raw = fs.readFileSync(path, "utf8");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				corrupt.push({ taskId: stem, reason: `unreadable: ${message}` });
				continue;
			}
			const parsed = parseEnvelope(stem, raw);
			if ("corrupt" in parsed) {
				corrupt.push({ taskId: stem, reason: parsed.corrupt });
				continue;
			}
			records.push(parsed.record);
		}
		return { records, corrupt };
	}

	/**
	 * Ticket 06 — read exactly one ledger record by canonical id. Unlike
	 * readAll() this distinguishes the failure modes a diagnostic query must
	 * not collapse: missing, corrupt content, and unreadable are reported
	 * separately instead of all surfacing as "unknown Task".
	 */
	read(taskId: string): LedgerReadResult {
		if (!SAFE_TASK_ID.test(taskId)) return { status: "invalid" };
		const path = join(this.dir, "planner-only", "ledger", `${taskId}.json`);
		let raw: string;
		try {
			raw = fs.readFileSync(path, "utf8");
		} catch (err) {
			const code = (err as NodeJS.ErrnoException | undefined)?.code;
			if (code === "ENOENT" || code === "ENOTDIR") return { status: "missing" };
			return {
				status: "unreadable",
				reason: err instanceof Error ? err.message : String(err),
			};
		}
		const parsed = parseEnvelope(taskId, raw);
		if ("corrupt" in parsed) return { status: "corrupt", reason: parsed.corrupt };
		return { status: "ok", record: parsed.record };
	}

	private warnIo(err: unknown): void {
		if (this.warnedIo) return;
		this.warnedIo = true;
		const message = err instanceof Error ? err.message : String(err);
		console.error(`Planner-only: failed to persist ledger snapshot: ${message}`);
	}

	private writeAtomic(record: TaskRecord): void {
		const ledgerDir = join(this.dir, "planner-only", "ledger");
		const finalPath = join(ledgerDir, `${record.taskId}.json`);
		const tmpPath = join(ledgerDir, `.tmp-${process.pid}-${++tmpSeq}`);
		const body = JSON.stringify({
			version: 1,
			writtenAt: new Date().toISOString(),
			task: record,
		});
		fs.mkdirSync(ledgerDir, { recursive: true });
		try {
			fs.writeFileSync(tmpPath, body, "utf8");
			fs.renameSync(tmpPath, finalPath);
		} catch (err) {
			try {
				fs.unlinkSync(tmpPath);
			} catch {
				// temp may not exist yet
			}
			throw err;
		}
	}
}
