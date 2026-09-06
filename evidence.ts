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
import { stableStringify } from "./report.ts";
import type {
	BinaryChange,
	DiffCheckResult,
	EvidenceRef,
	ReviewEvidencePacket,
	TaskScope,
	WorkerReport,
} from "./types.ts";

export type { GitRunner };

export interface GitProbe {
	available: boolean;
	head: string | null;
	statusPorcelain: string | null;
	statusHash: string | null;
	changedPaths: string[];
	diffStat: string | null;
	/** True when the status command itself failed; empty output is then unknown, not clean. */
	statusFailed: boolean;
}

const MAX_DIFF_STAT_CHARS = 2000;

/** Bounds for the Git evidence Root hands to a Fresh Reviewer. */
const MAX_REVIEW_PACKET_STATUS_CHARS = 4000;
const MAX_REVIEW_PACKET_FILES = 100;
const MAX_REVIEW_PACKET_DIFF_CHARS = 2000;
/** FR-05 §8.3 — patch budgets: total bytes, per-file bytes, and file count. */
const MAX_REVIEW_PACKET_PATCH_CHARS = 8000;
const MAX_REVIEW_PACKET_PATCH_FILE_CHARS = 4000;
const MAX_REVIEW_PACKET_PATCH_FILES = 50;

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
		statusFailed: false,
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
	// A failed status probe must not be folded into an empty (clean) tree:
	// empty output is only a valid result when the command succeeded (FR-02).
	const statusFailed = status.code !== 0;
	const porcelain = statusFailed ? null : status.stdout;

	return {
		available: true,
		head: head.code === 0 ? head.stdout.trim() || null : null,
		statusPorcelain: porcelain,
		statusHash: porcelain === null ? null : hashStatus(porcelain),
		changedPaths: porcelain === null ? [] : parseChangedPaths(porcelain),
		diffStat:
			diffStat.code === 0 && diffStat.stdout.trim()
				? diffStat.stdout.trim().slice(-MAX_DIFF_STAT_CHARS)
				: null,
		statusFailed,
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
		...(probe.statusFailed ? { statusProbeFailed: true } : {}),
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
 * §P1-2 / FR-05 — Root is the repository-state authority. Reviewer children
 * launch with `--no-extensions`, so they have no `git_audit`; Root samples the
 * tree and passes this bounded packet instead. The patch is computed against
 * the Task's start baseline (not HEAD) so staged, unstaged, and already
 * committed Task changes all stay reviewable. Omissions are explicit: a
 * truncated packet is never presented as complete.
 */
export interface ReviewPacketOptions {
	/** Task start ref the patch is computed against (the delegation-time A sample). */
	baselineRef?: string;
}

export async function captureReviewEvidencePacket(
	run: GitRunner,
	cwd: string,
	comparison?: EvidenceComparison,
	options: ReviewPacketOptions = {},
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

	const diffCheck = await boundedDiffCheck(run, target, GIT_READ_ARGV.diffCheck);
	const diffCheckStaged = await boundedDiffCheck(run, target, GIT_READ_ARGV.diffCheckStaged);
	const patch = await boundedPatchAgainstBaseline(run, target, options.baselineRef);

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
		diffCheck,
		diffCheckStaged,
		...(options.baselineRef ? { baselineRef: options.baselineRef } : {}),
		...patch,
		...attribution,
	};
}

/** Run one `diff --check` variant and keep exit code plus output (FR-05 §8.3). */
async function boundedDiffCheck(
	run: GitRunner,
	cwd: string,
	argv: readonly string[],
): Promise<DiffCheckResult> {
	try {
		const result = await run([...argv], cwd);
		const stdout = clip(result.stdout, MAX_REVIEW_PACKET_DIFF_CHARS);
		const stderr = clip(result.stderr ?? "", 400);
		return {
			exitCode: result.code,
			...(stdout ? { stdout } : {}),
			...(stderr ? { stderr } : {}),
		};
	} catch (error) {
		return { exitCode: -1, stderr: error instanceof Error ? error.message : String(error) };
	}
}

/** Split a unified diff into per-file chunks on `diff --git` boundaries. */
function splitPatchChunks(patch: string): { path: string; text: string }[] {
	const chunks: { path: string; text: string }[] = [];
	const lines = patch.split("\n");
	let current: string[] | undefined;
	let path: string | undefined;
	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			if (current && path) chunks.push({ path, text: current.join("\n") });
			// `diff --git a/<path> b/<path>`; the b/ side is the post-image name.
			const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
			path = match?.[2] ?? line.slice("diff --git ".length);
			current = [line];
			continue;
		}
		if (current) current.push(line);
	}
	if (current && path) chunks.push({ path, text: current.join("\n") });
	return chunks.filter((chunk) => chunk.text.trim());
}

/**
 * Bounded patch against the Task baseline. Oversized or over-budget files are
 * omitted by name (never silently), binary changes become fingerprints, and
 * the returned/total counts say whether the packet is whole.
 */
async function boundedPatchAgainstBaseline(
	run: GitRunner,
	cwd: string,
	baselineRef: string | undefined,
): Promise<Partial<ReviewEvidencePacket>> {
	if (!baselineRef) return {};
	if (!GIT_REF_PATTERN.test(baselineRef)) {
		return { patchUnavailable: "task baseline ref is not a valid commit ref" };
	}

	let patchText: string;
	try {
		const result = await run([...GIT_READ_ARGV.patchBetween, baselineRef], cwd);
		if (result.code !== 0) {
			return {
				patchUnavailable: `git diff ${baselineRef} failed (exit ${result.code})${
					result.stderr ? `: ${clip(result.stderr, 200) ?? ""}` : ""
				}`,
			};
		}
		patchText = result.stdout;
	} catch (error) {
		return { patchUnavailable: `git diff failed: ${error instanceof Error ? error.message : String(error)}` };
	}

	const binaryPaths: string[] = [];
	try {
		const numstat = await run([...GIT_READ_ARGV.numstatBetween, baselineRef], cwd);
		if (numstat.code === 0) {
			for (const line of numstat.stdout.split("\n")) {
				// Binary entries are `-\t-\t<path>` in numstat output.
				if (line.startsWith("-\t")) {
					const path = line.split("\t")[2]?.trim();
					if (path) binaryPaths.push(path);
				}
			}
		}
	} catch {
		// Fingerprints are best-effort; the patch itself stays honest.
	}

	const chunks = splitPatchChunks(patchText);
	const total = chunks.length;
	const omittedPaths: string[] = [];
	const included: string[] = [];
	let used = 0;
	for (const chunk of chunks) {
		if (
			included.length >= MAX_REVIEW_PACKET_PATCH_FILES ||
			used + chunk.text.length > MAX_REVIEW_PACKET_PATCH_CHARS ||
			chunk.text.length > MAX_REVIEW_PACKET_PATCH_FILE_CHARS
		) {
			omittedPaths.push(chunk.path);
			continue;
		}
		included.push(chunk.path);
		used += chunk.text.length;
	}
	const patch = chunks
		.filter((chunk) => !omittedPaths.includes(chunk.path))
		.map((chunk) => chunk.text)
		.join("\n");

	const fingerprints: BinaryChange[] = [];
	if (binaryPaths.length > 0) {
		const hashes = await hashDirtyPaths(run, cwd, binaryPaths.slice(0, MAX_REVIEW_PACKET_FILES));
		if (hashes) {
			for (const [path, hash] of Object.entries(hashes)) {
				fingerprints.push({ path, ...(hash ? { fingerprint: hash } : {}) });
			}
		}
	}

	return {
		...(patch.trim() ? { patch: patch.trimEnd() } : {}),
		...(omittedPaths.length > 0 ? { patchOmittedPaths: omittedPaths, patchTruncated: true } : {}),
		patchReturnedFiles: included.length,
		patchTotalFiles: total,
		...(fingerprints.length > 0 ? { binaryFiles: fingerprints } : {}),
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
	let verifiable = baseGit && currentGit;
	if (!verifiable) reasons.push("git evidence unavailable — freshness cannot be verified");
	// FR-02 — a failed status probe means the workspace state is unknown, never
	// an implicitly clean tree.
	if (base.statusProbeFailed || current.statusProbeFailed) {
		verifiable = false;
		reasons.push("git status probe failed — workspace state unknown");
	}

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

	// FR-01 — content binding between the sample the report was validated
	// against and the sample Root is comparing now: an unchanged porcelain
	// status must not hide content drift on paths both samples hashed.
	const reportedHashes = normalizedDirtyHashes(reported.dirtyPathHashes, reported.cwd || pathCwd);
	const currentHashes = normalizedDirtyHashes(current.dirtyPathHashes, current.cwd || pathCwd);
	const contentDrift: string[] = [];
	for (const [path, hash] of reportedHashes) {
		const nowHash = currentHashes.get(path);
		if (nowHash === undefined) continue;
		if (hash !== nowHash) contentDrift.push(path);
	}
	if (contentDrift.length > 0) {
		reasons.push(`content changed since the report: ${sorted(contentDrift).join(", ")}`);
		unexplained = true;
	}

	// FR-02 — a report that carries no Git binding evidence at all cannot be
	// called fresh: there is nothing to verify the validated content against.
	if (
		verifiable &&
		reported.finalGitRef === undefined &&
		reported.gitStatusHash === undefined &&
		reported.dirtyPathHashes === undefined
	) {
		verifiable = false;
		reasons.push("report evidence incomplete — no HEAD/status/content binding to verify");
	}

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
 * FR-03 / D09 — the workspace summary a report revision was validated
 * against. Reviews name this digest so a reviewer PASS can only be applied to
 * the workspace it actually saw. Ticket 10's WorkspaceSnapshot digest will
 * replace the inputs; the binding point stays the same.
 */
export function workspaceSummaryDigest(report: WorkerReport): string {
	const evidence = report.evidence;
	return createHash("sha256")
		.update(stableStringify({
			finalGitRef: evidence.finalGitRef ?? null,
			gitStatusHash: evidence.gitStatusHash ?? null,
			dirtyPathHashes: evidence.dirtyPathHashes ?? null,
		}))
		.digest("hex")
		.slice(0, 16);
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
