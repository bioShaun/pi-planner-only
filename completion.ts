import { createHash } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import type { LoadedPluginFingerprint } from "./types.ts";

export type CompletionSource = "sync" | "bg-wait" | "notify" | "reconcile";
export type TerminalSource = "host-meta" | "host-exit" | "host-notify" | "reconcile" | "report-only";
export type TerminalErrorClass = "provider-error" | "process-error" | "missing-report";
export type OutputState = "present" | "absent" | "unknown";

export interface OutputReference {
	outputPath?: string;
	archivePath?: string;
}

export interface CompletionReceipt {
	version: 1;
	source: CompletionSource;
	runId?: string;
	executionId?: string;
	previousRunId?: string;
	action?: string;
	taskIdHint?: string;
	agent?: string;
	observedAt: string;
	/** Optional host-reported child usage, forwarded to the accounting hook. */
	usage?: unknown;
	/** Explicit host/reconcile provenance; report text is never a terminal source. */
	terminalSource?: TerminalSource;
	terminal?: { state: string; exitCode?: number };
	outputState: OutputState;
	outputRef?: OutputReference;
	inlineOutput?: string;
	/** Host preview marker. A preview is never accepted as final output. */
	previewTruncated?: boolean;
}

export type OutputResolution =
	| { kind: "loaded"; text: string; digest: string; source: string }
	| { kind: "pending"; code: string; attempted: string[] }
	| { kind: "unavailable"; code: string; attempted: string[] };

export interface RunRecord {
	version: 1;
	sessionId: string;
	workspaceId: string;
	taskId: string;
	executionId: string;
	runId?: string;
	previousRunId?: string;
	agent: string;
	role: string;
	executionState: "launching" | "running" | "terminal" | "launch-failed";
	ingestionState: "waiting" | "output-pending" | "loaded" | "report-invalid" | "recorded" | "unavailable";
	terminalReason?: string;
	terminalSource?: TerminalSource;
	terminalErrorClass?: TerminalErrorClass;
	nextAction?: string;
	/** Durable release-once marker; survives a new orchestrator instance. */
	slotReleased?: boolean;
	slotReleasedAt?: string;
	outputRef?: OutputReference;
	outputDigest?: string;
	reportRevision?: number;
	/** Loaded build/session provenance captured before this execution started. */
	loadedProvenance?: LoadedPluginFingerprint;
	/**
	 * RS-05 Batch-1 identity linkage. This is an index only; detailed evidence
	 * remains on the Task and execution records.
	 */
	identityIndex?: Array<{
		taskId: string;
		executionId: string;
		hostRunId?: string;
		reportRevision?: number;
		childSessionFile?: string;
	}>;
	lastError?: { code: string; message: string };
	/** The report commit completed, but the host acknowledgement did not. */
	acknowledged?: boolean;
	/** Idempotency key for this run's persisted state machine. */
	commitKey?: string;
	updatedAt?: string;
	/** Number of distinct automatic output-location attempts consumed. */
	outputAttempts?: number;
	outputAttemptKeys?: string[];
}

export const OUTPUT_PENDING = "OUTPUT_PENDING";
export const OUTPUT_UNAVAILABLE = "OUTPUT_UNAVAILABLE";
export const OUTPUT_AMBIGUOUS = "OUTPUT_AMBIGUOUS";
export const OUTPUT_NOT_READABLE = "OUTPUT_NOT_READABLE";
export const OUTPUT_TOO_LARGE = "OUTPUT_TOO_LARGE";
export const ARCHIVE_UNSUPPORTED = "ARCHIVE_UNSUPPORTED";
export const MAX_OUTPUT_RETRIES = 3;

const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_ARCHIVE_BYTES = 4 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9_.-]+$/;
let tempSequence = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function outputReference(value: unknown): OutputReference | undefined {
	if (!isRecord(value)) return undefined;
	const outputPath = nonEmptyString(value.outputPath);
	const archivePath = nonEmptyString(value.archivePath);
	return outputPath || archivePath ? { ...(outputPath ? { outputPath } : {}), ...(archivePath ? { archivePath } : {}) } : undefined;
}

function terminalOf(value: unknown): CompletionReceipt["terminal"] {
	if (!isRecord(value)) return undefined;
	const state = nonEmptyString(value.state);
	if (!state) return undefined;
	return {
		state,
		...(typeof value.exitCode === "number" ? { exitCode: value.exitCode } : {}),
	};
}

/** Convert the host's several completion envelopes into one stable receipt. */
export function normalizeCompletionReceipt(value: unknown, source: CompletionSource = "sync"): CompletionReceipt | undefined {
	if (!isRecord(value)) return undefined;
	const details = isRecord(value.details) ? value.details : value;
	const paths = outputReference(details.outputRef) ?? outputReference(details.artifactPaths) ?? outputReference(value.outputRef) ?? outputReference(value.artifactPaths);
	const inline = nonEmptyString(details.inlineOutput) ?? nonEmptyString(details.output);
	const outputState = details.outputState === "present" || details.outputState === "absent" || details.outputState === "unknown"
		? details.outputState
		: inline !== undefined || paths ? "present" : "unknown";
	const observedAt = nonEmptyString(details.observedAt) ?? nonEmptyString(value.observedAt) ?? new Date().toISOString();
	const terminal = terminalOf(details.terminal) ?? (typeof details.exitCode === "number" ? terminalOf(details) : undefined);
	const rawTerminalSource = nonEmptyString(details.terminalSource);
	const terminalSource = terminal
		? (rawTerminalSource === "host-meta" || rawTerminalSource === "host-exit" || rawTerminalSource === "host-notify" || rawTerminalSource === "reconcile" || rawTerminalSource === "report-only"
			? rawTerminalSource
			: source === "reconcile" ? "reconcile" : source === "notify" ? "host-notify" : "host-meta")
		: undefined;
	return {
		version: 1,
		source,
		...(nonEmptyString(details.runId) ?? nonEmptyString(details.newRunId) ?? nonEmptyString(value.runId) ?? nonEmptyString(value.newRunId) ? { runId: nonEmptyString(details.runId) ?? nonEmptyString(details.newRunId) ?? nonEmptyString(value.runId) ?? nonEmptyString(value.newRunId) } : {}),
		...(nonEmptyString(details.executionId) ?? nonEmptyString(value.executionId) ? { executionId: nonEmptyString(details.executionId) ?? nonEmptyString(value.executionId) } : {}),
		...(nonEmptyString(details.previousRunId) ?? nonEmptyString(value.previousRunId) ? { previousRunId: nonEmptyString(details.previousRunId) ?? nonEmptyString(value.previousRunId) } : {}),
		...(nonEmptyString(details.action) ?? nonEmptyString(value.action) ? { action: nonEmptyString(details.action) ?? nonEmptyString(value.action) } : {}),
		...(nonEmptyString(details.taskIdHint) ?? nonEmptyString(details.taskId) ?? nonEmptyString(value.taskIdHint) ?? nonEmptyString(value.taskId) ? { taskIdHint: nonEmptyString(details.taskIdHint) ?? nonEmptyString(details.taskId) ?? nonEmptyString(value.taskIdHint) ?? nonEmptyString(value.taskId) } : {}),
		...(nonEmptyString(details.agent) ? { agent: nonEmptyString(details.agent) } : {}),
		observedAt,
		...(details.usage !== undefined ? { usage: details.usage } : value.usage !== undefined ? { usage: value.usage } : {}),
		...(terminal ? { terminal } : {}),
		...(terminalSource ? { terminalSource } : {}),
		outputState,
		...(paths ? { outputRef: paths } : {}),
		...(inline !== undefined ? { inlineOutput: inline } : {}),
		...(details.previewTruncated === true || details.truncated === true ? { previewTruncated: true } : {}),
	};
}

function digest(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

function withinRoots(path: string, roots: readonly string[]): boolean {
	if (roots.length === 0) return true;
	const target = resolve(path);
	return roots.some((root) => {
		const rel = relative(resolve(root), target);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

function readRegularFile(path: string, maxBytes: number): { text?: string; code?: string } {
	let stat;
	try {
		stat = lstatSync(path);
	} catch {
		return { code: OUTPUT_PENDING };
	}
	if (!stat.isFile()) return { code: OUTPUT_NOT_READABLE };
	if (stat.size > maxBytes) return { code: OUTPUT_TOO_LARGE };
	try {
		return { text: readFileSync(path, "utf8") };
	} catch {
		return { code: OUTPUT_NOT_READABLE };
	}
}

function archiveOutput(raw: string, receipt: CompletionReceipt): { text?: string; code?: string } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { code: ARCHIVE_UNSUPPORTED };
	}
	const candidates: unknown[] = Array.isArray(parsed)
		? parsed
		: isRecord(parsed)
			? (Array.isArray(parsed.completions) ? parsed.completions
				: Array.isArray(parsed.results) ? parsed.results
					: Array.isArray(parsed.runs) ? parsed.runs
						: Array.isArray(parsed.children) ? parsed.children
							: Array.isArray(parsed.outputs) ? parsed.outputs : [parsed])
			: [];
	const matching = candidates.filter((candidate) => {
		if (!isRecord(candidate)) return false;
		const runId = nonEmptyString(candidate.runId) ?? nonEmptyString(candidate.run_id);
		const agent = nonEmptyString(candidate.agent);
		return (!receipt.runId || runId === receipt.runId) && (!receipt.agent || !agent || agent === receipt.agent);
	});
	if (matching.length !== 1) return { code: matching.length > 1 ? OUTPUT_AMBIGUOUS : OUTPUT_UNAVAILABLE };
	const candidate = matching[0];
	if (typeof candidate === "string") return { text: candidate };
	if (!isRecord(candidate)) return { code: ARCHIVE_UNSUPPORTED };
	const text = nonEmptyString(candidate.inlineOutput) ?? nonEmptyString(candidate.output) ?? nonEmptyString(candidate.text) ?? (isRecord(candidate.report) ? JSON.stringify(candidate.report) : undefined);
	return text === undefined ? { code: ARCHIVE_UNSUPPORTED } : { text };
}

/** Bounded, deterministic output resolver. It never ranks candidates by size. */
export class OutputResolver {
	private readonly maxOutputBytes: number;
	private readonly maxArchiveBytes: number;
	private readonly trustedRoots: readonly string[];

	constructor(options: { maxOutputBytes?: number; maxArchiveBytes?: number; trustedRoots?: readonly string[] } = {}) {
		this.maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
		this.maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
		this.trustedRoots = options.trustedRoots ?? [];
	}

	resolve(receipt: CompletionReceipt): OutputResolution {
		const attempted: string[] = [];
		if (receipt.previewTruncated) return { kind: "pending", code: OUTPUT_PENDING, attempted: ["inline:preview-truncated"] };
		if (receipt.inlineOutput !== undefined) return { kind: "loaded", text: receipt.inlineOutput, digest: digest(receipt.inlineOutput), source: "inline" };
		const refs = receipt.outputRef;
		if (!refs) {
			return receipt.outputState === "unknown"
				? { kind: "pending", code: OUTPUT_PENDING, attempted }
				: { kind: "unavailable", code: OUTPUT_UNAVAILABLE, attempted };
		}
		let failureCode: string | undefined;
		if (refs.outputPath) {
			attempted.push(refs.outputPath);
			if (!withinRoots(refs.outputPath, this.trustedRoots)) return { kind: "unavailable", code: OUTPUT_NOT_READABLE, attempted };
			const loaded = readRegularFile(refs.outputPath, this.maxOutputBytes);
			if (loaded.text !== undefined) return { kind: "loaded", text: loaded.text, digest: digest(loaded.text), source: refs.outputPath };
			if (loaded.code === OUTPUT_TOO_LARGE || loaded.code === OUTPUT_NOT_READABLE) return { kind: "unavailable", code: loaded.code, attempted };
			failureCode = loaded.code;
		}
		if (refs.archivePath) {
			attempted.push(refs.archivePath);
			if (!withinRoots(refs.archivePath, this.trustedRoots)) return { kind: "unavailable", code: OUTPUT_NOT_READABLE, attempted };
			const loaded = readRegularFile(refs.archivePath, this.maxArchiveBytes);
			if (loaded.text !== undefined) {
				const archive = archiveOutput(loaded.text, receipt);
				if (archive.text !== undefined) return { kind: "loaded", text: archive.text, digest: digest(archive.text), source: refs.archivePath };
				if (archive.code === OUTPUT_AMBIGUOUS) return { kind: "unavailable", code: OUTPUT_AMBIGUOUS, attempted };
				if (archive.code) failureCode = archive.code;
			} else if (loaded.code) {
				failureCode = loaded.code;
			}
		}
		if (failureCode && failureCode !== OUTPUT_PENDING) return { kind: "unavailable", code: failureCode, attempted };
		return receipt.outputState === "unknown" || receipt.outputState === "present"
			? { kind: "pending", code: OUTPUT_PENDING, attempted }
			: { kind: "unavailable", code: OUTPUT_UNAVAILABLE, attempted };
	}

	/** Alias used by adapters that describe resolution as locating output. */
	locate(receipt: CompletionReceipt): OutputResolution {
		return this.resolve(receipt);
	}

	resolveOutput(receipt: CompletionReceipt): OutputResolution {
		return this.resolve(receipt);
	}
}

export function resolveOutput(receipt: CompletionReceipt, options: ConstructorParameters<typeof OutputResolver>[0] = {}): OutputResolution {
	return new OutputResolver(options).resolve(receipt);
}

export const normalizeCompletion = normalizeCompletionReceipt;

function recordFile(dir: string, record: RunRecord): string {
	const key = `${record.sessionId}-${record.workspaceId}-${record.executionId}`;
	const safe = key.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 220);
	return join(dir, `${safe}.json`);
}

/** Atomic RunRecord store with a journal that makes both commit crash points recoverable. */
export class RunRecordStore {
	private readonly dir: string;
	private readonly records = new Map<string, RunRecord>();
	private readonly fault?: (point: "before-report" | "after-report") => void;

	constructor(dir: string, options: { fault?: (point: "before-report" | "after-report") => void } = {}) {
		this.dir = dir;
		this.fault = options.fault;
	}

	private key(record: Pick<RunRecord, "sessionId" | "workspaceId" | "executionId">): string {
		return `${record.sessionId}\u0000${record.workspaceId}\u0000${record.executionId}`;
	}

	private persist(record: RunRecord): void {
		mkdirSync(this.dir, { recursive: true });
		const path = recordFile(this.dir, record);
		const temporary = join(dirname(path), `.tmp-${process.pid}-${++tempSequence}`);
		writeFileSync(temporary, `${JSON.stringify(record)}\n`, "utf8");
		renameSync(temporary, path);
	}

	put(record: RunRecord): RunRecord {
		const next = { ...record, version: 1 as const, updatedAt: new Date().toISOString() };
		this.persist(next);
		this.records.set(this.key(next), next);
		return next;
	}

	get(sessionId: string, workspaceId: string, executionId: string): RunRecord | undefined {
		return this.records.get(`${sessionId}\u0000${workspaceId}\u0000${executionId}`);
	}

	list(): RunRecord[] {
		return [...this.records.values()].map((record) => ({ ...record }));
	}

	/** Find a persisted execution by its exact host run id. */
	findByRunId(runId: string, workspaceId?: string): RunRecord | undefined {
		const id = runId.trim();
		if (!id) return undefined;
		return this.list().find((record) => record.runId === id &&
			(workspaceId === undefined || record.workspaceId === workspaceId));
	}

	load(): RunRecord[] {
		mkdirSync(this.dir, { recursive: true });
		for (const name of readdirSync(this.dir)) {
			if (!name.endsWith(".json") || name.startsWith(".tmp-")) continue;
			try {
				const value = JSON.parse(readFileSync(join(this.dir, name), "utf8")) as RunRecord;
				if (value?.version === 1 && typeof value.executionId === "string") this.records.set(this.key(value), value);
			} catch {
				// Corrupt run records remain on disk for diagnosis and are ignored.
			}
		}
		return this.list();
	}

	/** Persist loaded output before invoking the report commit callback. */
	commitLoaded(record: RunRecord, resolution: Extract<OutputResolution, { kind: "loaded" }>, commitReport: () => number): RunRecord {
		const loaded = this.put({ ...record, ingestionState: "loaded", outputDigest: resolution.digest, outputRef: record.outputRef, commitKey: this.key(record), acknowledged: false });
		this.fault?.("before-report");
		const reportRevision = commitReport();
		this.fault?.("after-report");
		return this.put({ ...loaded, ingestionState: "recorded", reportRevision, acknowledged: false });
	}

	async commitLoadedAsync(record: RunRecord, resolution: Extract<OutputResolution, { kind: "loaded" }>, commitReport: () => Promise<number>): Promise<RunRecord> {
		const loaded = this.put({ ...record, ingestionState: "loaded", outputDigest: resolution.digest, outputRef: record.outputRef, commitKey: this.key(record), acknowledged: false });
		this.fault?.("before-report");
		const reportRevision = await commitReport();
		this.fault?.("after-report");
		return this.put({ ...loaded, ingestionState: "recorded", reportRevision, acknowledged: false });
	}

	commitReport(record: RunRecord, reportRevision: number): RunRecord {
		return this.put({ ...record, ingestionState: "recorded", reportRevision, acknowledged: false });
	}

	pendingCommits(): RunRecord[] {
		return this.list().filter((record) => record.ingestionState === "loaded");
	}

	recordOutputAttempt(record: RunRecord, attemptKey: string): RunRecord {
		const keys = [...new Set(record.outputAttemptKeys ?? [])];
		if (keys.includes(attemptKey)) return record;
		if (keys.length >= MAX_OUTPUT_RETRIES) {
			return this.put({ ...record, ingestionState: "unavailable", lastError: { code: OUTPUT_UNAVAILABLE, message: "automatic output retries exhausted" }, outputAttemptKeys: keys, outputAttempts: keys.length });
		}
		keys.push(attemptKey);
		return this.put({ ...record, outputAttemptKeys: keys, outputAttempts: keys.length });
	}

	canRetryOutput(record: RunRecord, attemptKey: string): boolean {
		return (record.outputAttemptKeys ?? []).includes(attemptKey) || (record.outputAttemptKeys ?? []).length < MAX_OUTPUT_RETRIES;
	}

	ack(record: RunRecord): RunRecord {
		return this.put({ ...record, acknowledged: true });
	}
}

export function makeRunRecord(input: Omit<RunRecord, "version" | "updatedAt">): RunRecord {
	return { version: 1, ...input };
}

export const COMPLETION_MAX_OUTPUT_BYTES = DEFAULT_MAX_OUTPUT_BYTES;
export const COMPLETION_MAX_ARCHIVE_BYTES = DEFAULT_MAX_ARCHIVE_BYTES;
export { digest as outputDigest };

// Kept local to this module so accidental path-derived ids cannot escape its store.
export function safeRunId(value: string): boolean {
	return SAFE_ID.test(value) && value.length <= 256;
}
