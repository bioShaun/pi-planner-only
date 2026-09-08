/**
 * Write-only TaskRecord snapshots. Reload/replay is a later ticket;
 * this module must not read anything back.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import type { TaskRecord } from "./task.ts";

const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");

const SAFE_TASK_ID = /^[A-Za-z0-9_.-]+$/;
let tmpSeq = 0;

export class LedgerSnapshotStore {
	private readonly dir: string;
	private _lastWriteError: unknown;
	private warned = false;

	constructor(dir: string) {
		this.dir = dir;
	}

	get lastWriteError(): unknown {
		return this._lastWriteError;
	}

	write(record: TaskRecord): void {
		if (!SAFE_TASK_ID.test(record.taskId)) {
			const err = new Error(`invalid ledger taskId: ${record.taskId}`);
			this._lastWriteError = err;
			this.warn(err);
			throw err;
		}
		try {
			this.writeAtomic(record);
		} catch (err) {
			this._lastWriteError = err;
			this.warn(err);
		}
	}

	private warn(err: unknown): void {
		if (this.warned) return;
		this.warned = true;
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
