/**
 * Evidence capture and freshness checking (spec §10).
 *
 * The parent never accepts a worker report on the worker's word alone: a report
 * is only meaningful while it still describes the current workspace. Git is
 * probed with fixed, read-only argv — never through a shell.
 */

import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { GIT_READ_ARGV } from "./git-audit.ts";
import type { GitRunner } from "./git-audit.ts";
import type { EvidenceRef, TaskScope, WorkerReport } from "./types.ts";

export type { GitRunner };

export interface GitProbe {
	available: boolean;
	head: string | null;
	statusPorcelain: string | null;
	statusHash: string | null;
	changedPaths: string[];
	diffStat: string | null;
}

const MAX_DIFF_STAT_CHARS = 2000;

export function hashStatus(porcelain: string): string {
	return createHash("sha256").update(porcelain).digest("hex").slice(0, 16);
}

/**
 * Parse `git status --porcelain=v2` into changed paths.
 *
 * Only entry lines are relevant: `1` (ordinary), `2` (rename/copy), `u`
 * (unmerged) and `?` (untracked). Branch header lines start with `#`.
 */
export function parseChangedPaths(porcelain: string): string[] {
	const paths: string[] = [];
	for (const rawLine of porcelain.split("\n")) {
		const line = rawLine.replace(/\r$/, "");
		if (!line || line.startsWith("#")) continue;
		if (line.startsWith("? ")) {
			paths.push(line.slice(2));
			continue;
		}
		const fields = line.split(" ");
		const kind = fields[0];
		// `1 XY sub mH mI mW hH hI path`           -> path at 8
		// `2 XY sub mH mI mW hH hI Xscore path`    -> path at 9
		// `u XY sub m1 m2 m3 m4 path`              -> path at 7
		const pathIndex = kind === "1" ? 8 : kind === "2" ? 9 : kind === "u" ? 7 : -1;
		if (pathIndex === -1 || fields.length <= pathIndex) continue;
		// Renames carry "new<SEP>old"; keep the new path.
		paths.push(fields.slice(pathIndex).join(" ").split(/[\0\t]/)[0]);
	}
	return [...new Set(paths.filter(Boolean))].sort();
}

export async function probeGit(run: GitRunner, cwd: string): Promise<GitProbe> {
	const empty: GitProbe = {
		available: false,
		head: null,
		statusPorcelain: null,
		statusHash: null,
		changedPaths: [],
		diffStat: null,
	};

	let gitDir: { stdout: string; code: number };
	try {
		gitDir = await run([...GIT_READ_ARGV.gitDir], cwd);
	} catch {
		return empty;
	}
	if (gitDir.code !== 0) return empty;

	const head = await run([...GIT_READ_ARGV.head], cwd);
	const status = await run([...GIT_READ_ARGV.status], cwd);
	const diffStat = await run([...GIT_READ_ARGV.evidenceDiffStat], cwd);
	const porcelain = status.code === 0 ? status.stdout : "";

	return {
		available: true,
		head: head.code === 0 ? head.stdout.trim() || null : null,
		statusPorcelain: porcelain,
		statusHash: hashStatus(porcelain),
		changedPaths: parseChangedPaths(porcelain),
		diffStat:
			diffStat.code === 0 && diffStat.stdout.trim()
				? diffStat.stdout.trim().slice(-MAX_DIFF_STAT_CHARS)
				: null,
	};
}

export interface CaptureEvidenceOptions {
	cwd: string;
	taskId: string;
	workerRunId: string;
	baseGitRef?: string;
}

/**
 * Snapshot the workspace. Non-Git directories degrade to a cwd-only ref rather
 * than failing the lifecycle (spec §19.4).
 */
export async function captureEvidence(
	run: GitRunner,
	options: CaptureEvidenceOptions,
): Promise<EvidenceRef> {
	const cwd = resolve(options.cwd);
	const generatedAt = new Date().toISOString();
	let probe: GitProbe;
	try {
		probe = await probeGit(run, cwd);
	} catch {
		probe = {
			available: false,
			head: null,
			statusPorcelain: null,
			statusHash: null,
			changedPaths: [],
			diffStat: null,
		};
	}

	if (!probe.available) {
		return { cwd, taskId: options.taskId, workerRunId: options.workerRunId, gitAvailable: false, generatedAt };
	}

	return {
		cwd,
		taskId: options.taskId,
		workerRunId: options.workerRunId,
		...(options.baseGitRef ? { baseGitRef: options.baseGitRef } : {}),
		...(probe.head ? { finalGitRef: probe.head } : {}),
		...(probe.statusHash ? { gitStatusHash: probe.statusHash } : {}),
		changedPaths: probe.changedPaths,
		...(probe.diffStat ? { diffStat: probe.diffStat } : {}),
		gitAvailable: true,
		generatedAt,
	};
}

export function normalizeEvidencePaths(paths: readonly string[], cwd: string): string[] {
	return paths.map((path) => (path.startsWith("/") ? path : resolve(cwd, path)));
}

export interface EvidenceComparison {
	fresh: boolean;
	reasons: string[];
	/** Paths changed after the report that fall inside the task's scope. */
	overlappingPaths: string[];
	/** Paths changed after the report that fall outside the task's scope. */
	unrelatedPaths: string[];
	/** Paths the report claimed were changed but that are clean now. */
	missingPaths: string[];
	/** True when the drift cannot be fully attributed to out-of-scope paths. */
	unexplained: boolean;
}

export interface CompareEvidenceOptions {
	scope?: TaskScope;
	superseded?: boolean;
}

function sameCwd(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

/**
 * Compare a worker report's evidence against a fresh sample of the workspace.
 *
 * Path sets alone cannot detect every overlap: an external edit to a file the
 * worker already reported leaves the path set unchanged while invalidating the
 * report. So a status-hash change is only excused when every newly changed path
 * falls outside the task's scope (spec §10.2).
 */
export function compareEvidence(
	report: WorkerReport,
	current: EvidenceRef,
	options: CompareEvidenceOptions = {},
): EvidenceComparison {
	const reported = report.evidence;
	const reasons: string[] = [];
	let unexplained = false;

	if (reported.cwd && current.cwd && !sameCwd(reported.cwd, current.cwd)) {
		reasons.push(`cwd changed (${reported.cwd} -> ${current.cwd})`);
		unexplained = true;
	}
	if (options.superseded) {
		reasons.push("task superseded");
		unexplained = true;
	}

	const reportedGit = reported.gitAvailable !== false;
	const currentGit = current.gitAvailable !== false;
	const comparable = reportedGit && currentGit;

	let headChanged = false;
	if (comparable) {
		if (reported.finalGitRef && current.finalGitRef && reported.finalGitRef !== current.finalGitRef) {
			headChanged = true;
			reasons.push(`HEAD changed (${reported.finalGitRef} -> ${current.finalGitRef})`);
			unexplained = true;
		}
	}

	const reportedPaths = new Set(
		normalizeEvidencePaths(reported.changedPaths ?? report.changedFiles ?? [], reported.cwd || current.cwd),
	);
	const scopePaths = new Set([
		...reportedPaths,
		...normalizeEvidencePaths(options.scope?.allowedPaths ?? [], reported.cwd || current.cwd),
	]);
	const currentPaths = new Set(normalizeEvidencePaths(current.changedPaths ?? [], current.cwd));

	const overlappingPaths: string[] = [];
	const unrelatedPaths: string[] = [];
	for (const path of currentPaths) {
		if (reportedPaths.has(path)) continue;
		(scopePaths.has(path) ? overlappingPaths : unrelatedPaths).push(path);
	}

	const missingPaths: string[] = [];
	if (comparable && !headChanged) {
		for (const path of reportedPaths) {
			if (!currentPaths.has(path)) missingPaths.push(path);
		}
	}
	if (missingPaths.length > 0) {
		reasons.push(`reported changes no longer present: ${missingPaths.join(", ")}`);
		unexplained = true;
	}
	if (overlappingPaths.length > 0) {
		reasons.push(`in-scope paths changed after the report: ${overlappingPaths.join(", ")}`);
		unexplained = true;
	}

	if (comparable && reported.gitStatusHash && current.gitStatusHash) {
		if (reported.gitStatusHash !== current.gitStatusHash) {
			reasons.push("working tree changed since the report");
			// Excused only when the drift is fully explained by out-of-scope paths.
			if (!(unrelatedPaths.length > 0 && overlappingPaths.length === 0 && missingPaths.length === 0)) {
				unexplained = true;
			}
		}
	}

	if (unrelatedPaths.length > 0 && overlappingPaths.length === 0) {
		reasons.push(`out-of-scope paths changed: ${unrelatedPaths.join(", ")}`);
	}

	return {
		fresh: reasons.length === 0,
		reasons,
		overlappingPaths: overlappingPaths.sort(),
		unrelatedPaths: unrelatedPaths.sort(),
		missingPaths: missingPaths.sort(),
		unexplained,
	};
}

export function isEvidenceStale(report: WorkerReport, current: EvidenceRef): boolean {
	return !compareEvidence(report, current).fresh;
}

/**
 * §10.2 — stale evidence never passes directly. Overlapping or unexplained
 * drift requires fresh validation; purely out-of-scope drift may continue to
 * review.
 */
export function evidenceAction(comparison: EvidenceComparison): "review" | "revalidate" {
	if (comparison.fresh) return "review";
	return comparison.unexplained ? "revalidate" : "review";
}

export function describeComparison(comparison: EvidenceComparison): string {
	if (comparison.fresh) return "fresh";
	const label = evidenceAction(comparison) === "revalidate" ? "stale (revalidate)" : "stale (out-of-scope only)";
	return `${label}: ${comparison.reasons.join("; ")}`;
}
