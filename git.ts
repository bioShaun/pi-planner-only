/**
 * Root's Git access: fixed argv, never a shell.
 *
 * Repository config must not make Root run programs: every call disables
 * fsmonitor, and every diff disables external diff drivers and textconv.
 *
 * `--no-optional-locks` (git >= 2.15) only keeps Root from taking index.lock;
 * it is added when `git --version` says it is supported, and dropped on older
 * git (e.g. 1.8) or when the probe fails. Env vars are not an option: pi.exec
 * cannot pass them.
 */
import { clip } from "./format.ts";

export type GitRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<{ stdout: string; stderr?: string; code: number }>;

export const FSMONITOR_OFF = ["-c", "core.fsmonitor=false"] as const;
export const GIT_SAFE_PREFIX = ["--no-optional-locks", ...FSMONITOR_OFF] as const;
const DIFF_SAFE = ["--no-ext-diff", "--no-textconv"] as const;

export const GIT_AUDIT_OPERATIONS = ["status", "diff-stat", "diff", "log"] as const;
export type GitAuditOperation = (typeof GIT_AUDIT_OPERATIONS)[number];

export const MAX_GIT_OUTPUT_CHARS = 12_000;
const REF_PATTERN = /^(?:[0-9a-f]{7,40}|HEAD(?:~\d{1,3})?)$/;

export interface GitAuditRequest {
	operation: GitAuditOperation;
	base?: string;
	path?: string;
	maxEntries?: number;
}

/** True when `git --version` output reports 2.15 or later. */
export function supportsNoOptionalLocks(versionOutput: string): boolean {
	const m = /git version (\d+)\.(\d+)/.exec(versionOutput);
	if (!m) return false;
	const [major, minor] = [Number(m[1]), Number(m[2])];
	return major > 2 || (major === 2 && minor >= 15);
}

const prefixes = new WeakMap<GitRunner, Promise<readonly string[]>>();

/** The safe argv prefix for this runner; `git --version` is probed once per runner. */
export function gitSafePrefix(run: GitRunner, cwd: string): Promise<readonly string[]> {
	let prefix = prefixes.get(run);
	if (!prefix) {
		prefix = Promise.resolve()
			.then(() => run(["--version"], cwd))
			.then((r) => (r.code === 0 && supportsNoOptionalLocks(r.stdout) ? GIT_SAFE_PREFIX : FSMONITOR_OFF))
			.catch(() => FSMONITOR_OFF);
		prefixes.set(run, prefix);
	}
	return prefix;
}

async function git(run: GitRunner, args: readonly string[], cwd: string) {
	return run([...(await gitSafePrefix(run, cwd)), ...args], cwd);
}

/** `rev-parse --is-inside-work-tree`; false when git fails or reports "false" (inside .git). */
export async function isWorkTree(run: GitRunner, cwd: string): Promise<boolean> {
	const r = await git(run, ["rev-parse", "--is-inside-work-tree"], cwd);
	return r.code === 0 && r.stdout.trim() !== "false";
}

export const notWorkTree = (cwd: string) => `${cwd} is not inside a git work tree; pass cwd=<repo>`;

/** Build the argv for one git_audit operation, or explain why it is refused. */
export function auditArgv(request: GitAuditRequest): { ok: true; args: string[] } | { ok: false; error: string } {
	const { operation, base, path } = request;
	if (base !== undefined && !REF_PATTERN.test(base)) {
		return { ok: false, error: "base must be a commit sha (7-40 hex) or HEAD, HEAD~N" };
	}
	if (path !== undefined && (!path.trim() || path.startsWith("-"))) {
		return { ok: false, error: "path must be non-empty and must not start with '-'" };
	}
	const pathArgs = path ? ["--", path] : [];
	switch (operation) {
		case "status":
			return { ok: true, args: ["status", "--porcelain", "--branch", "--untracked-files=all", ...pathArgs] };
		case "diff-stat":
			return { ok: true, args: ["diff", "--stat", ...DIFF_SAFE, ...(base ? [base] : []), ...pathArgs] };
		case "diff":
			return { ok: true, args: ["diff", ...DIFF_SAFE, ...(base ? [base] : []), ...pathArgs] };
		case "log": {
			const n = Math.min(Math.max(Math.trunc(request.maxEntries ?? 10), 1), 50);
			return { ok: true, args: ["log", "--oneline", `-n${n}`, ...pathArgs] };
		}
		default:
			return { ok: false, error: `unknown operation ${String(operation)}` };
	}
}

export async function runGitAudit(run: GitRunner, request: GitAuditRequest, cwd: string): Promise<{ ok: boolean; text: string }> {
	const argv = auditArgv(request);
	if (!argv.ok) return { ok: false, text: `git_audit refused: ${argv.error}` };
	if (!(await isWorkTree(run, cwd))) return { ok: false, text: notWorkTree(cwd) };
	const result = await git(run, argv.args, cwd);
	if (result.code !== 0) return { ok: false, text: `git ${request.operation} failed: ${(result.stderr || result.stdout).trim()}` };
	return { ok: true, text: clip(result.stdout.trimEnd() || "(no output)", MAX_GIT_OUTPUT_CHARS) };
}

/** What the workspace looked like when a delegation started. */
export interface WorkBase {
	/** false: cwd is not in a git work tree; undefined: unknown (git threw). */
	inWorkTree?: boolean;
	head?: string;
	dirtyBefore: number;
	/**
	 * Content fingerprint (blob id, or "absent") of every path that was already
	 * uncommitted; undefined when not captured (too many paths, git failed).
	 */
	dirty?: Record<string, string>;
	/** Work-tree root; status/diff paths are relative to it, so later calls run there. */
	root?: string;
}

/** Above this many uncommitted paths, fingerprinting is skipped and the summary keeps the plain note. */
export const MAX_FINGERPRINT_PATHS = 500;
/** Above this many changed paths, the diff stat runs without a pathspec. */
const MAX_PATHSPEC_PATHS = 200;
/** Above this many files in one commit, the committed-files echo lists the first 100 plus `… N more`. */
const MAX_COMMIT_FILES = 100;
const ABSENT = "absent";

/** Paths from `status --porcelain -z`: `XY path\0`, renames/copies add `old\0` after the new path. */
export function parseStatusZ(out: string): string[] {
	const parts = out.split("\0");
	const paths: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const entry = parts[i];
		if (entry.length < 4 || entry[2] !== " ") continue;
		const xy = entry.slice(0, 2);
		paths.push(entry.slice(3));
		if (xy.includes("R") || xy.includes("C")) i++;
	}
	return paths;
}

/** Blob id per path via `hash-object` (works on git 1.8); a path that cannot be hashed is "absent". */
async function fingerprint(run: GitRunner, cwd: string, paths: string[]): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	if (!paths.length) return out;
	const all = await git(run, ["hash-object", "--", ...paths], cwd);
	const ids = all.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
	if (all.code === 0 && ids.length === paths.length) {
		paths.forEach((p, i) => { out[p] = ids[i]; });
		return out;
	}
	// One missing path fails the whole call: hash one by one.
	for (const p of paths) {
		const one = await git(run, ["hash-object", "--", p], cwd);
		out[p] = one.code === 0 && one.stdout.trim() ? one.stdout.trim() : ABSENT;
	}
	return out;
}

export async function captureBase(run: GitRunner, cwd: string): Promise<WorkBase> {
	if (!(await isWorkTree(run, cwd))) return { inWorkTree: false, dirtyBefore: 0 };
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code !== 0) return { inWorkTree: true, dirtyBefore: 0 };
	const top = await git(run, ["rev-parse", "--show-toplevel"], cwd);
	const root = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;
	const status = await git(run, ["status", "--porcelain", "-z", "--untracked-files=all"], root);
	if (status.code !== 0) return { inWorkTree: true, head: head.stdout.trim(), dirtyBefore: 0, root };
	const paths = parseStatusZ(status.stdout);
	const base: WorkBase = { inWorkTree: true, head: head.stdout.trim(), dirtyBefore: paths.length, root };
	if (paths.length <= MAX_FINGERPRINT_PATHS) base.dirty = await fingerprint(run, root, paths).catch(() => undefined);
	return base;
}

const listPaths = (paths: string[], max = 10) =>
	paths.slice(0, max).join(", ") + (paths.length > max ? `, … ${paths.length - max} more` : "");

/** How the paths that were already uncommitted at the base relate to the child's work. */
export interface ChangedPaths {
	/** Same content as before and not committed by the child: the child did not touch them. */
	untouched: Set<string>;
	/** Content changed, or committed by the child: their diff includes the earlier edits. */
	touchedDirty: string[];
}

/**
 * Pure reconciliation of the base fingerprints against the current ones.
 * A path the child committed is never "untouched", even if its work-tree
 * content is unchanged. Order of `touchedDirty` follows `before`.
 */
export function classifyChangedPaths(
	before: Record<string, string>,
	now: Record<string, string>,
	committed: ReadonlySet<string>,
): ChangedPaths {
	const untouched = new Set<string>();
	const touchedDirty: string[] = [];
	for (const p of Object.keys(before)) {
		if (now[p] === before[p] && !committed.has(p)) untouched.add(p);
		else touchedDirty.push(p);
	}
	return { untouched, touchedDirty };
}

const splitZ = (out: string) => out.split("\0").filter(Boolean);

/** `log --oneline base..HEAD` lines, or undefined when HEAD did not move or the log failed. */
async function listNewCommits(run: GitRunner, cwd: string, baseHead: string): Promise<string | undefined> {
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code !== 0 || head.stdout.trim() === baseHead) return undefined;
	const log = await git(run, ["log", "--oneline", "-n20", `${baseHead}..HEAD`], cwd);
	return log.code === 0 && log.stdout.trim() ? log.stdout.trimEnd() : "";
}

/**
 * Re-fingerprint the paths dirty at the base and classify them; undefined when
 * the base has no fingerprints or the current state cannot be determined.
 */
async function reconcileDirtyPaths(run: GitRunner, root: string, base: WorkBase, moved: boolean): Promise<ChangedPaths | undefined> {
	const before = base.dirty;
	if (!before || !base.head) return undefined;
	const now = await fingerprint(run, root, Object.keys(before)).catch(() => undefined);
	if (!now) return undefined;
	let committed = new Set<string>();
	if (moved) {
		const inCommits = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, base.head, "HEAD"], root);
		if (inCommits.code !== 0) return undefined; // cannot tell what the commits touched: keep the plain note
		committed = new Set(splitZ(inCommits.stdout));
	}
	return classifyChangedPaths(before, now, committed);
}

/**
 * `diff --stat` since the base, restricted to paths the child touched; undefined
 * when nothing remains. Above MAX_PATHSPEC_PATHS the pathspec is dropped.
 */
async function diffStatArgv(run: GitRunner, root: string, baseHead: string, untouched: ReadonlySet<string>): Promise<string[] | undefined> {
	const statArgs = ["diff", "--stat", ...DIFF_SAFE, baseHead];
	if (!untouched.size) return statArgs;
	const names = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, baseHead], root);
	if (names.code !== 0) return statArgs;
	const remaining = splitZ(names.stdout).filter((p) => !untouched.has(p));
	if (!remaining.length) return undefined;
	return remaining.length > MAX_PATHSPEC_PATHS ? statArgs : [...statArgs, "--", ...remaining];
}

async function diffStat(run: GitRunner, root: string, baseHead: string, untouched: ReadonlySet<string>): Promise<string> {
	const argv = await diffStatArgv(run, root, baseHead, untouched);
	const stat = argv ? await git(run, argv, root) : undefined;
	return stat && stat.code === 0 && stat.stdout.trim() ? `Diff since ${baseHead.slice(0, 8)}:\n${stat.stdout.trimEnd()}` : "Tracked files: no changes.";
}

/** Untracked, non-ignored files minus the ones the child did not touch. */
async function listUntracked(run: GitRunner, root: string, untouched: ReadonlySet<string>): Promise<string[]> {
	const untracked = await git(run, ["ls-files", "--others", "--exclude-standard", "-z"], root);
	return untracked.code === 0 ? splitZ(untracked.stdout).filter((p) => !untouched.has(p)) : [];
}

function dirtyNotes(base: WorkBase, changed: ChangedPaths | undefined): string[] {
	if (!changed) {
		return base.dirtyBefore > 0 ? [`Note: ${base.dirtyBefore} path(s) were already uncommitted before this delegation; the diff includes them.`] : [];
	}
	const lines: string[] = [];
	const excluded = [...changed.untouched];
	if (excluded.length) lines.push(`Unchanged by the child (already uncommitted before; excluded above): ${listPaths(excluded)}`);
	if (changed.touchedDirty.length) {
		lines.push(`Note: ${changed.touchedDirty.length} path(s) were already uncommitted before this delegation and changed again; their diff includes the earlier edits: ${listPaths(changed.touchedDirty)}`);
	}
	return lines;
}

/** Changes since the base: new commits, tracked diff stat, untracked files. */
export async function summarizeWork(run: GitRunner, cwd: string, base: WorkBase, maxChars = 3_000): Promise<string> {
	if (base.inWorkTree === false) {
		return `Workspace changes: ${cwd} is not a git work tree — if the child edited another repository, pass that repository as cwd next time.`;
	}
	if (!base.head) return "Workspace changes: not a git repository (or no commits); inspect the files directly.";
	const lines: string[] = [];
	// All path-level calls run at the work-tree root, where status/diff paths are anchored.
	const root = base.root ?? cwd;
	const commits = await listNewCommits(run, cwd, base.head);
	if (commits) lines.push("New commits:", commits);
	const changed = await reconcileDirtyPaths(run, root, base, commits !== undefined);
	const untouched = changed?.untouched ?? new Set<string>();
	lines.push(await diffStat(run, root, base.head, untouched));
	const files = await listUntracked(run, root, untouched);
	if (files.length) {
		lines.push(`Untracked files (${files.length}):`, ...files.slice(0, 30), ...(files.length > 30 ? [`… ${files.length - 30} more`] : []));
	}
	lines.push(...dirtyNotes(base, changed));
	return clip(lines.join("\n"), maxChars);
}

/** Stage and commit. Without paths, all changes (including untracked) are staged. */
export async function gitCommit(run: GitRunner, cwd: string, message: string, paths?: string[]): Promise<{ ok: boolean; text: string }> {
	if (!message.trim()) return { ok: false, text: "git_commit refused: message is empty" };
	if (paths?.some((p) => !p.trim() || p.startsWith("-"))) {
		return { ok: false, text: "git_commit refused: paths must be non-empty and must not start with '-'" };
	}
	if (!(await isWorkTree(run, cwd))) return { ok: false, text: notWorkTree(cwd) };
	const add = await git(run, paths?.length ? ["add", "--", ...paths] : ["add", "-A"], cwd);
	if (add.code !== 0) return { ok: false, text: `git add failed: ${(add.stderr || add.stdout).trim()}` };
	const commit = await git(run, ["commit", "-m", message], cwd);
	if (commit.code !== 0) return { ok: false, text: `git commit failed: ${(commit.stderr || commit.stdout).trim()}` };
	const files = await committedFiles(run, cwd);
	const show = await git(run, ["show", "--stat", "--oneline", ...DIFF_SAFE, "HEAD"], cwd);
	const stat = show.code === 0 ? show.stdout.trimEnd() : commit.stdout.trimEnd();
	let text = stat;
	if (files) {
		const [header, ...remaining] = stat.split("\n");
		text = [header, files, ...remaining].filter((line) => line !== undefined).join("\n");
	}
	return { ok: true, text: clip(text, 3_000) };
}

/** Paths changed by HEAD, so the commit result names every staged file even when `--stat` is clipped. */
async function committedFiles(run: GitRunner, cwd: string): Promise<string | undefined> {
	const names = await git(run, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", "-z", ...DIFF_SAFE, "HEAD"], cwd);
	if (names.code !== 0) return undefined;
	const files = splitZ(names.stdout).filter((p) => p.trim());
	if (!files.length) return undefined;
	const shown = files.slice(0, MAX_COMMIT_FILES);
	return `Committed files (${files.length}): ${shown.join(", ")}${files.length > shown.length ? `, … ${files.length - shown.length} more` : ""}`;
}
