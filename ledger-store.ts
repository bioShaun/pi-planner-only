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
