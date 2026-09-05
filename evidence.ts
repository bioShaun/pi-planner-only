/**
 * Evidence capture and freshness checking (spec §10).
 *
 * The parent never accepts a worker report on the worker's word alone. Root
 * samples Git at delegation start (A) and at result handling (C); the A-to-C
 * delta is the authoritative changed set. The Worker report is a bounded
 * declaration cross-checked against that delta. Git is probed with fixed,
 * read-only argv — never through a shell.
 */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { GIT_READ_ARGV, GIT_REF_PATTERN } from "./git-audit.ts";
import type { GitRunner } from "./git-audit.ts";
import { MAX_BASELINE_HASH_PATHS } from "./types.ts";
import type { EvidenceRef, ReviewEvidencePacket, TaskScope, WorkerReport } from "./types.ts";

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

/** Bounds for the Git evidence Root hands to a Fresh Reviewer. */
const MAX_REVIEW_PACKET_STATUS_CHARS = 4000;
const MAX_REVIEW_PACKET_FILES = 100;
const MAX_REVIEW_PACKET_DIFF_CHARS = 2000;

export function hashStatus(porcelain: string): string {
	const entries = porcelain
		.split("\n")
		.filter((line) => line && !line.startsWith("#"))
		.join("\n");
	return createHash("sha256").update(entries).digest("hex").slice(0, 16);
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

function unavailableProbe(): GitProbe {
	return {
		available: false,
		head: null,
		statusPorcelain: null,
		statusHash: null,
		changedPaths: [],
		diffStat: null,
	};
}

export async function probeGit(run: GitRunner, cwd: string): Promise<GitProbe> {
	const empty = unavailableProbe();

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

function isHashableFilePath(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

/**
 * RF-1 — one `git hash-object -- <paths…>` call (no `-w`) over the sample's
 * dirty paths. Deleted, unreadable, or non-file paths hash to `null` without
 * entering the argv (git aborts the whole call on the first unreadable path).
 * Above MAX_BASELINE_HASH_PATHS the call is skipped and the map is omitted;
 * a failing call also omits the map so T3 stays empty rather than
 * mis-attributing.
 */
async function hashDirtyPaths(
	run: GitRunner,
	cwd: string,
	paths: readonly string[],
): Promise<Record<string, string | null> | undefined> {
	if (paths.length === 0 || paths.length > MAX_BASELINE_HASH_PATHS) return undefined;
	const hashes: Record<string, string | null> = {};
	const hashable: string[] = [];
	for (const path of paths) {
		if (isHashableFilePath(resolve(cwd, path))) hashable.push(path);
		else hashes[path] = null;
	}
	if (hashable.length > 0) {
		let result: { stdout: string; code: number };
		try {
			result = await run([...GIT_READ_ARGV.hashObject, ...hashable], cwd);
		} catch {
			return undefined;
		}
		const lines = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
		if (result.code !== 0 || lines.length !== hashable.length) return undefined;
		hashable.forEach((path, index) => {
			hashes[path] = lines[index] ?? null;
		});
	}
	return hashes;
}

function parseDiffNames(stdout: string): string[] {
	return [...new Set(stdout.split("\n").map((line) => line.trim()).filter(Boolean))].sort();
}

/**
 * RF-1 — T2 input: paths changed between the delegation-time ref and the
 * current HEAD. Runs only at the C sample, when both refs exist; equal refs
 * yield `[]` without a git call. Refs must each match GIT_REF_PATTERN before
 * they are appended to the argv. A failing call returns `undefined` (no T2
 * data) rather than an empty delta.
 */
async function diffNamesBetweenRefs(
	run: GitRunner,
	cwd: string,
	baseGitRef: string,
	head: string,
): Promise<string[] | undefined> {
	if (!GIT_REF_PATTERN.test(baseGitRef) || !GIT_REF_PATTERN.test(head)) return undefined;
	if (baseGitRef === head) return [];
	let result: { stdout: string; code: number };
	try {
		result = await run([...GIT_READ_ARGV.diffNamesBetween, baseGitRef, head], cwd);
	} catch {
		return undefined;
	}
	return result.code === 0 ? parseDiffNames(result.stdout) : undefined;
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
		probe = unavailableProbe();
	}

	if (!probe.available) {
		return { cwd, taskId: options.taskId, workerRunId: options.workerRunId, gitAvailable: false, generatedAt };
	}

	// RF-1 — every sample (A and C) hashes its own dirty paths so compareEvidence
	// can detect content changes on paths that were already dirty at A (T3).
	const dirtyPathHashes = await hashDirtyPaths(run, cwd, probe.changedPaths);
	// RF-1 — only the C sample carries a baseGitRef to diff against (T2).
	const committedPaths = options.baseGitRef && probe.head
		? await diffNamesBetweenRefs(run, cwd, options.baseGitRef, probe.head)
		: undefined;

	return {
		cwd,
		taskId: options.taskId,
		workerRunId: options.workerRunId,
		...(options.baseGitRef ? { baseGitRef: options.baseGitRef } : {}),
		...(probe.head ? { finalGitRef: probe.head } : {}),
		...(probe.statusHash ? { gitStatusHash: probe.statusHash } : {}),
		changedPaths: probe.changedPaths,
		...(dirtyPathHashes ? { dirtyPathHashes } : {}),
		...(committedPaths ? { committedPaths } : {}),
		...(probe.diffStat ? { diffStat: probe.diffStat } : {}),
		gitAvailable: true,
		generatedAt,
	};
}

function clip(value: string | null | undefined, limit: number): string | undefined {
	const trimmed = value?.trimEnd();
	if (!trimmed) return undefined;
	return trimmed.length <= limit
		? trimmed
		: `${trimmed.slice(0, limit)}\n… (truncated, ${trimmed.length} chars total)`;
}

/**
 * §P1-2 — Root is the repository-state authority. Reviewer children launch
 * with `--no-extensions`, so they have no `git_audit`; Root samples the tree
 * and passes this bounded packet instead. No full diff ever crosses the seam.
 */
export async function captureReviewEvidencePacket(
	run: GitRunner,
	cwd: string,
	comparison?: EvidenceComparison,
): Promise<ReviewEvidencePacket> {
	const target = resolve(cwd);
	let probe: GitProbe;
	try {
		probe = await probeGit(run, target);
	} catch {
		probe = unavailableProbe();
	}

	const attribution = attributionFields(comparison);
	if (!probe.available) return { gitAvailable: false, ...attribution };

	let diffCheck: string | undefined;
	try {
		const result = await run([...GIT_READ_ARGV.diffCheck], target);
		diffCheck = clip(result.stdout, MAX_REVIEW_PACKET_DIFF_CHARS);
	} catch {
		diffCheck = undefined;
	}

	return {
		gitAvailable: true,
		...(probe.head ? { head: probe.head } : {}),
		...(probe.statusPorcelain
			? { status: clip(probe.statusPorcelain, MAX_REVIEW_PACKET_STATUS_CHARS) }
			: {}),
		...(probe.changedPaths.length
			? { changedFiles: probe.changedPaths.slice(0, MAX_REVIEW_PACKET_FILES) }
			: {}),
		...(probe.diffStat ? { diffStat: clip(probe.diffStat, MAX_REVIEW_PACKET_DIFF_CHARS) } : {}),
		...(diffCheck ? { diffCheck } : {}),
		...attribution,
	};
}

function attributionFields(comparison?: EvidenceComparison): Pick<
	ReviewEvidencePacket,
	"attributedFiles" | "undeclaredFiles" | "extraDeclaredFiles"
> {
	if (!comparison?.verifiable) return {};
	return {
		...(comparison.truthPaths.length
			? { attributedFiles: comparison.truthPaths.slice(0, MAX_REVIEW_PACKET_FILES) }
			: {}),
		...(comparison.undeclaredPaths.length
			? { undeclaredFiles: comparison.undeclaredPaths.slice(0, MAX_REVIEW_PACKET_FILES) }
			: {}),
		...(comparison.extraDeclaredPaths.length
			? { extraDeclaredFiles: comparison.extraDeclaredPaths.slice(0, MAX_REVIEW_PACKET_FILES) }
			: {}),
	};
}

export function normalizeEvidencePaths(paths: readonly string[], cwd: string): string[] {
	return paths.map((path) => (path.startsWith("/") ? path : resolve(cwd, path)));
}

export interface EvidenceComparison {
	/** False when Git state could not be sampled on Root's A or C endpoint. */
	verifiable: boolean;
	fresh: boolean;
	reasons: string[];
	/** Authoritative paths introduced between Root base (A) and Root current (C). */
	truthPaths: string[];
	/** truthPaths absent from the Worker declaration. */
	undeclaredPaths: string[];
	/** Declared paths absent from truthPaths. */
	extraDeclaredPaths: string[];
	/** Undeclared attributed paths that fall inside the task's scope. */
	overlappingPaths: string[];
	/** Undeclared attributed paths that fall outside the task's scope. */
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

function sorted(paths: readonly string[]): string[] {
	return [...paths].sort();
}

/** RF-1 — normalize a dirtyPathHashes record into absolute-path keys. */
function normalizedDirtyHashes(
	hashes: Record<string, string | null> | undefined,
	cwd: string,
): Map<string, string | null> {
	const normalized = new Map<string, string | null>();
	if (!hashes) return normalized;
	for (const [path, hash] of Object.entries(hashes)) {
		normalized.set(normalizeEvidencePaths([path], cwd)[0], hash ?? null);
	}
	return normalized;
}

/**
 * Compare Root's delegation-time sample (A) with Root's result-time sample (C),
 * then cross-check the Worker declaration (B) against that delta.
 *
 * `truthPaths` is the scope denominator: the union of newly-dirty paths (T1),
 * paths committed between the A and C refs (T2), and baseline-dirty paths
 * whose working-tree blob hash changed between the samples (T3). Worker
 * `changedFiles` / evidence paths are declaration data only: mismatches are
 * findings and must not hide attributed paths from scope or PASS decisions.
 *
 * A Worker status-hash is only an optional freshness cross-check; when present,
 * a hash change is excused only when every undeclared attributed path falls
 * outside the task's scope (spec §10.2).
 */
export function compareEvidence(
	base: EvidenceRef,
	current: EvidenceRef,
	report: WorkerReport,
	options: CompareEvidenceOptions = {},
): EvidenceComparison {
	const reported = report.evidence;
	const reasons: string[] = [];
	let unexplained = false;

	if (base.cwd && current.cwd && !sameCwd(base.cwd, current.cwd)) {
		reasons.push(`cwd changed (${base.cwd} -> ${current.cwd})`);
		unexplained = true;
	}
	if (reported.cwd && current.cwd && !sameCwd(reported.cwd, current.cwd)) {
		reasons.push(`cwd changed (${reported.cwd} -> ${current.cwd})`);
		unexplained = true;
	}
	if (options.superseded) {
		reasons.push("task superseded");
		unexplained = true;
	}

	const baseGit = base.gitAvailable !== false;
	const currentGit = current.gitAvailable !== false;
	const verifiable = baseGit && currentGit;
	if (!verifiable) reasons.push("git evidence unavailable — freshness cannot be verified");

	let headChanged = false;
	if (verifiable && reported.finalGitRef && current.finalGitRef && reported.finalGitRef !== current.finalGitRef) {
		headChanged = true;
		reasons.push(`HEAD changed (${reported.finalGitRef} -> ${current.finalGitRef})`);
		unexplained = true;
	}

	const pathCwd = current.cwd || reported.cwd || base.cwd;
	const basePaths = new Set(normalizeEvidencePaths(base.changedPaths ?? [], base.cwd || pathCwd));
	const currentPaths = new Set(normalizeEvidencePaths(current.changedPaths ?? [], current.cwd || pathCwd));
	// RF-1 — truthPaths is the union of three Root-derived sets:
	//   T1 = current.changedPaths − base.changedPaths                       (newly dirty)
	//   T2 = paths committed between base.finalGitRef and current.finalGitRef
	//   T3 = baseline-dirty paths whose working-tree blob hash changed A→C
	const t1 = [...currentPaths].filter((path) => !basePaths.has(path));
	const committedPaths = new Set(
		normalizeEvidencePaths(current.committedPaths ?? [], current.cwd || pathCwd),
	);
	const t2 = [...committedPaths];
	const t3: string[] = [];
	const baselineDirtyCount = base.changedPaths?.length ?? 0;
	if (baselineDirtyCount > MAX_BASELINE_HASH_PATHS) {
		// Above the cap the A sample carries no hashes; T3 stays empty and the
		// omission is visible in reasons.
		reasons.push(`baseline hash skipped (${baselineDirtyCount} dirty paths)`);
	} else {
		const baselineHashes = normalizedDirtyHashes(base.dirtyPathHashes, base.cwd || pathCwd);
		const resultHashes = normalizedDirtyHashes(current.dirtyPathHashes, current.cwd || pathCwd);
		for (const path of basePaths) {
			if (!currentPaths.has(path)) continue;
			const baseHash = baselineHashes.get(path);
			const currentHash = resultHashes.get(path);
			if (baseHash === undefined || currentHash === undefined) continue;
			if (baseHash !== currentHash) t3.push(path);
		}
	}
	const t3Set = new Set(t3);
	const truthSet = new Set([...t1, ...t2, ...t3]);

	const declaredPaths = new Set(
		normalizeEvidencePaths(reported.changedPaths ?? report.changedFiles ?? [], reported.cwd || pathCwd),
	);
	const allowedPaths = new Set(
		normalizeEvidencePaths(options.scope?.allowedPaths ?? [], reported.cwd || pathCwd),
	);
	const hasAllowList = allowedPaths.size > 0;
	const inScope = (path: string): boolean => (hasAllowList ? allowedPaths.has(path) : true);

	const undeclaredPaths: string[] = [];
	for (const path of truthSet) {
		if (!declaredPaths.has(path)) undeclaredPaths.push(path);
	}
	const extraDeclaredPaths: string[] = [];
	for (const path of declaredPaths) {
		if (!truthSet.has(path)) extraDeclaredPaths.push(path);
	}

	const overlappingPaths: string[] = [];
	const unrelatedPaths: string[] = [];
	for (const path of undeclaredPaths) {
		(inScope(path) ? overlappingPaths : unrelatedPaths).push(path);
	}

	const missingPaths: string[] = [];
	if (verifiable && !headChanged) {
		for (const path of declaredPaths) {
			if (currentPaths.has(path)) continue;
			// RF-1 — paths committed (T2) or content-changed on a baseline-dirty
			// path (T3) are still present as far as attribution is concerned.
			if (committedPaths.has(path) || t3Set.has(path)) continue;
			missingPaths.push(path);
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
	if (undeclaredPaths.length > 0) {
		reasons.push(`under-reported: ${sorted(undeclaredPaths).join(", ")}`);
	}
	if (extraDeclaredPaths.length > 0) {
		reasons.push(`over-reported / unreliable declaration: ${sorted(extraDeclaredPaths).join(", ")}`);
		unexplained = true;
	}

	if (verifiable && reported.gitStatusHash && current.gitStatusHash) {
		if (reported.gitStatusHash !== current.gitStatusHash) {
			reasons.push("working tree changed since the report");
			if (!(unrelatedPaths.length > 0 && overlappingPaths.length === 0 && missingPaths.length === 0)) {
				unexplained = true;
			}
		}
	}

	if (unrelatedPaths.length > 0 && overlappingPaths.length === 0) {
		reasons.push(`out-of-scope paths changed: ${unrelatedPaths.join(", ")}`);
	}

	return {
		verifiable,
		fresh: reasons.length === 0,
		reasons,
		truthPaths: sorted([...truthSet]),
		undeclaredPaths: sorted(undeclaredPaths),
		extraDeclaredPaths: sorted(extraDeclaredPaths),
		overlappingPaths: sorted(overlappingPaths),
		unrelatedPaths: sorted(unrelatedPaths),
		missingPaths: sorted(missingPaths),
		unexplained,
	};
}

export function isEvidenceStale(
	base: EvidenceRef,
	current: EvidenceRef,
	report: WorkerReport,
	options: CompareEvidenceOptions = {},
): boolean {
	return !compareEvidence(base, current, report, options).fresh;
}

/**
 * §10.2 — stale evidence never passes directly. Overlapping or unexplained
 * drift requires fresh validation; purely out-of-scope drift may continue to
 * review.
 */
export function evidenceAction(comparison: EvidenceComparison): "review" | "revalidate" {
	if (!comparison.verifiable) return "revalidate";
	if (comparison.fresh) return "review";
	return comparison.unexplained ? "revalidate" : "review";
}

export function describeComparison(comparison: EvidenceComparison): string {
	if (!comparison.verifiable) return `unverifiable: ${comparison.reasons.join("; ")}`;
	const attributed = `attributed ${comparison.truthPaths.length} path${comparison.truthPaths.length === 1 ? "" : "s"}`;
	if (comparison.fresh) return `fresh (${attributed})`;
	const label = evidenceAction(comparison) === "revalidate" ? "stale (revalidate)" : "stale (out-of-scope only)";
	return `${label}: ${comparison.reasons.join("; ")}`;
}
