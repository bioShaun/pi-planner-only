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

export function clip(text: string, max = MAX_GIT_OUTPUT_CHARS): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
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
	return { ok: true, text: clip(result.stdout.trimEnd() || "(no output)") };
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

/** Changes since the base: new commits, tracked diff stat, untracked files. */
export async function summarizeWork(run: GitRunner, cwd: string, base: WorkBase, maxChars = 3_000): Promise<string> {
	if (base.inWorkTree === false) {
		return `Workspace changes: ${cwd} is not a git work tree — if the child edited another repository, pass that repository as cwd next time.`;
	}
	if (!base.head) return "Workspace changes: not a git repository (or no commits); inspect the files directly.";
	const lines: string[] = [];
	// All path-level calls run at the work-tree root, where status/diff paths are anchored.
	const root = base.root ?? cwd;
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	const moved = head.code === 0 && head.stdout.trim() !== base.head;
	if (moved) {
		const log = await git(run, ["log", "--oneline", "-n20", `${base.head}..HEAD`], cwd);
		if (log.code === 0 && log.stdout.trim()) lines.push("New commits:", log.stdout.trimEnd());
	}
	// Paths that were uncommitted before and still have the same content: the child did not touch them.
	// A path the child committed is never "untouched", even if its work-tree content is unchanged.
	const untouched = new Set<string>();
	const touchedDirty: string[] = [];
	const before = base.dirty;
	let now = before ? await fingerprint(run, root, Object.keys(before)).catch(() => undefined) : undefined;
	let committed = new Set<string>();
	if (now && moved) {
		const inCommits = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, base.head, "HEAD"], root);
		if (inCommits.code === 0) committed = new Set(inCommits.stdout.split("\0").filter(Boolean));
		else now = undefined; // cannot tell what the commits touched: keep the plain note
	}
	if (before && now) {
		for (const p of Object.keys(before)) {
			if (now[p] === before[p] && !committed.has(p)) untouched.add(p);
			else touchedDirty.push(p);
		}
	}
	let statArgs: string[] | undefined = ["diff", "--stat", ...DIFF_SAFE, base.head];
	if (untouched.size) {
		const names = await git(run, ["diff", "--name-only", "--no-renames", "-z", ...DIFF_SAFE, base.head], root);
		if (names.code === 0) {
			const remaining = names.stdout.split("\0").filter((p) => p && !untouched.has(p));
			statArgs = !remaining.length ? undefined
				: remaining.length > MAX_PATHSPEC_PATHS ? statArgs
				: [...statArgs, "--", ...remaining];
		}
	}
	const stat = statArgs ? await git(run, statArgs, root) : undefined;
	lines.push(stat && stat.code === 0 && stat.stdout.trim() ? `Diff since ${base.head.slice(0, 8)}:\n${stat.stdout.trimEnd()}` : "Tracked files: no changes.");
	const untracked = await git(run, ["ls-files", "--others", "--exclude-standard", "-z"], root);
	const files = untracked.code === 0 ? untracked.stdout.split("\0").filter((p) => p && !untouched.has(p)) : [];
	if (files.length) {
		lines.push(`Untracked files (${files.length}):`, ...files.slice(0, 30), ...(files.length > 30 ? [`… ${files.length - 30} more`] : []));
	}
	if (before && now) {
		const excluded = [...untouched];
		if (excluded.length) lines.push(`Unchanged by the child (already uncommitted before; excluded above): ${listPaths(excluded)}`);
		if (touchedDirty.length) {
			lines.push(`Note: ${touchedDirty.length} path(s) were already uncommitted before this delegation and changed again; their diff includes the earlier edits: ${listPaths(touchedDirty)}`);
		}
	} else if (base.dirtyBefore > 0) {
		lines.push(`Note: ${base.dirtyBefore} path(s) were already uncommitted before this delegation; the diff includes them.`);
	}
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
	const show = await git(run, ["show", "--stat", "--oneline", ...DIFF_SAFE, "HEAD"], cwd);
	return { ok: true, text: clip(show.code === 0 ? show.stdout.trimEnd() : commit.stdout.trimEnd(), 3_000) };
}
