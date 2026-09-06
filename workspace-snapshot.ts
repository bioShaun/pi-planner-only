/**
 * FR-01 — versioned workspace snapshot (ticket 10).
 *
 * The PASS boundary compares a snapshot digest computed from a normalized,
 * sorted manifest of content hashes — never from mtimes, sizes, or status
 * fingerprints. File kind, symlink target, and the execute bit participate.
 * Hitting a budget, an unreadable path, or unstable sampling yields a snapshot
 * in `unknown` state with a reason: an unknown snapshot never reads as fresh,
 * and a truncated manifest is never presented as complete.
 *
 * Sampling covers the declared verification inputs: the task's exact scope
 * paths plus the paths Git reports changed. Ignored files are not swept.
 * Symlinks are recorded (kind + target) but never followed outside the tree.
 */

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { stableStringify } from "./report.ts";

export type EvidenceState = "fresh" | "stale" | "unknown";

export interface SnapshotEntry {
	/** Workspace-relative POSIX path. */
	path: string;
	kind: "file" | "symlink" | "missing";
	/** Raw-byte SHA-256 for regular files. */
	contentHash?: string;
	/** The symlink's target text; links are never followed. */
	linkTarget?: string;
	executable?: boolean;
	size?: number;
}

export interface WorkspaceSnapshot {
	version: 1;
	taskId: string;
	invocationId: string;
	/** Absolute, realpath-normalized workspace root this snapshot was taken in. */
	workspaceId: string;
	state: EvidenceState;
	/** Digest over the normalized sorted manifest; absent while unknown. */
	digest?: string;
	unknownReason?: string;
	capturedAt: string;
	entries?: SnapshotEntry[];
}

/** The snapshot binding Root keeps per recorded report. */
export interface WorkspaceSnapshotBinding {
	version: 1;
	digest: string;
	/** Report revision (task.reports.length) this snapshot validated. */
	reportRevision: number;
	capturedAt: string;
}

export interface SnapshotLimits {
	maxFiles?: number;
	maxTotalBytes?: number;
	deadlineMs?: number;
}

export interface SnapshotOptions extends SnapshotLimits {
	cwd: string;
	taskId: string;
	invocationId: string;
	/** Exact verification-input paths: task scope plus Git-reported changes. */
	paths: readonly string[];
}

const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const DEFAULT_DEADLINE_MS = 2000;

export function snapshotDigest(entries: readonly SnapshotEntry[]): string {
	const sorted = [...entries].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
	return createHash("sha256").update(stableStringify(sorted)).digest("hex").slice(0, 16);
}

function workspaceIdOf(cwd: string): string {
	const absolute = resolve(cwd);
	try {
		// Match the write lock's worktree identity (realpath aliases collide).
		return realpathSync(absolute);
	} catch {
		return absolute;
	}
}

function toWorkspacePath(cwd: string, input: string): string {
	const absolute = resolve(cwd, input);
	const rel = relative(cwd, absolute);
	return rel.split(sep).join("/");
}

function unknownSnapshot(options: SnapshotOptions, workspaceId: string, reason: string, capturedAt: string): WorkspaceSnapshot {
	return {
		version: 1,
		taskId: options.taskId,
		invocationId: options.invocationId,
		workspaceId,
		state: "unknown",
		unknownReason: reason,
		capturedAt,
	};
}

interface BudgetState {
	files: number;
	bytes: number;
}

/**
 * One sampling pass over the deduped path set. Returns the manifest, or the
 * reason sampling could not complete. Unreadable paths and unsupported kinds
 * are hard failures (unknown), never silent omissions.
 */
function samplingPass(options: SnapshotOptions, cwd: string, budget: BudgetState, startedAt: number, limits: Required<SnapshotLimits>): { entries: SnapshotEntry[] } | { error: string } {
	const entries: SnapshotEntry[] = [];

	const walkFile = (relPath: string, absPath: string): string | undefined => {
		budget.files += 1;
		if (budget.files > limits.maxFiles) return `file budget exceeded (${limits.maxFiles} files)`;
		let stats;
		try {
			stats = lstatSync(absPath);
		} catch (error) {
			return `cannot stat ${relPath}: ${errorCode(error)}`;
		}
		budget.bytes += stats.size;
		if (budget.bytes > limits.maxTotalBytes) return `byte budget exceeded (${limits.maxTotalBytes} bytes)`;
		if (Date.now() - startedAt > limits.deadlineMs) return "sampling deadline exceeded";
		let content: Buffer;
		try {
			content = readFileSync(absPath);
		} catch (error) {
			return `cannot read ${relPath}: ${errorCode(error)}`;
		}
		entries.push({
			path: relPath,
			kind: "file",
			contentHash: createHash("sha256").update(content).digest("hex"),
			executable: (stats.mode & 0o111) !== 0,
			size: stats.size,
		});
		return undefined;
	};

	const walkEntry = (relPath: string): string | undefined => {
		const absPath = resolve(cwd, relPath);
		let stats;
		try {
			stats = lstatSync(absPath);
		} catch (error) {
			if (errorCode(error) === "ENOENT") {
				entries.push({ path: relPath, kind: "missing" });
				return undefined;
			}
			return `cannot stat ${relPath}: ${errorCode(error)}`;
		}
		if (stats.isSymbolicLink()) {
			let target: string;
			try {
				target = readlinkSync(absPath);
			} catch (error) {
				return `cannot read symlink ${relPath}: ${errorCode(error)}`;
			}
			entries.push({ path: relPath, kind: "symlink", linkTarget: target });
			return undefined;
		}
		if (stats.isDirectory()) {
			let names: string[];
			try {
				names = readdirSync(absPath).sort();
			} catch (error) {
				return `cannot list ${relPath}: ${errorCode(error)}`;
			}
			for (const name of names) {
				if (name === ".git") continue;
				const childRel = relPath ? `${relPath}/${name}` : name;
				const error = walkEntry(childRel);
				if (error) return error;
			}
			return undefined;
		}
		if (!stats.isFile()) return `unsupported entry kind at ${relPath}`;
		return walkFile(relPath, absPath);
	};

	const seen = new Set<string>();
	for (const input of options.paths) {
		const trimmed = typeof input === "string" ? input.trim() : "";
		if (!trimmed) continue;
		const relPath = toWorkspacePath(cwd, trimmed);
		if (seen.has(relPath)) continue;
		seen.add(relPath);
		const error = walkEntry(relPath);
		if (error) return { error };
	}
	return { entries };
}

function errorCode(error: unknown): string {
	const code = (error as { code?: unknown })?.code;
	if (typeof code === "string") return code;
	return error instanceof Error ? error.message : String(error);
}

/**
 * Sample the declared verification inputs. The manifest is taken twice (with
 * one bounded retry when the passes disagree); only two consecutive agreeing
 * passes produce a `fresh` snapshot with a digest.
 */
export function captureWorkspaceSnapshot(options: SnapshotOptions): WorkspaceSnapshot {
	const capturedAt = new Date().toISOString();
	const startedAt = Date.now();
	const limits: Required<SnapshotLimits> = {
		maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
		maxTotalBytes: options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
		deadlineMs: options.deadlineMs ?? DEFAULT_DEADLINE_MS,
	};
	const workspaceId = workspaceIdOf(options.cwd);

	const passes: string[] = [];
	let lastEntries: SnapshotEntry[] = [];
	for (let pass = 0; pass < 3; pass += 1) {
		const result = samplingPass(options, workspaceId, { files: 0, bytes: 0 }, startedAt, limits);
		if ("error" in result) return unknownSnapshot(options, workspaceId, result.error, capturedAt);
		const digest = snapshotDigest(result.entries);
		if (passes.length > 0 && passes[passes.length - 1] === digest) {
			return {
				version: 1,
				taskId: options.taskId,
				invocationId: options.invocationId,
				workspaceId,
				state: "fresh",
				digest,
				capturedAt,
				entries: lastEntries,
			};
		}
		passes.push(digest);
		lastEntries = result.entries;
	}
	return unknownSnapshot(options, workspaceId, "workspace changed while sampling (unstable)", capturedAt);
}

/**
 * Compare the snapshot Root bound to the validated report with the snapshot
 * taken at the acceptance boundary. Unknown anywhere means unknown; content
 * difference means stale; only equal digests are fresh.
 */
export function compareSnapshotBinding(
	bound: WorkspaceSnapshotBinding | undefined,
	current: WorkspaceSnapshot,
	latestReportRevision: number,
): { state: EvidenceState; reason?: string } {
	if (current.state === "unknown") {
		return { state: "unknown", reason: `workspace snapshot unknown: ${current.unknownReason}` };
	}
	if (!bound) {
		return {
			state: "unknown",
			reason: "pre-snapshot report: no workspace snapshot binds the validated report; a new report is required",
		};
	}
	if (bound.reportRevision !== latestReportRevision) {
		return {
			state: "unknown",
			reason: `workspace snapshot is bound to report revision ${bound.reportRevision}, but the latest report is revision ${latestReportRevision}; a new report is required`,
		};
	}
	if (bound.digest !== current.digest) {
		return {
			state: "stale",
			reason: `workspace snapshot changed since the report (${bound.digest} -> ${current.digest})`,
		};
	}
	return { state: "fresh" };
}
