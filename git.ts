/**
 * Root's Git access: fixed argv, never a shell.
 *
 * Repository config must not make Root run programs: every call disables
 * fsmonitor, and every diff disables external diff drivers and textconv.
 */
export type GitRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<{ stdout: string; stderr?: string; code: number }>;

export const GIT_SAFE_PREFIX = ["--no-optional-locks", "-c", "core.fsmonitor=false"] as const;
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

function git(run: GitRunner, args: readonly string[], cwd: string) {
	return run([...GIT_SAFE_PREFIX, ...args], cwd);
}

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
			return { ok: true, args: ["status", "--porcelain=v1", "--branch", "--untracked-files=all", ...pathArgs] };
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
	const result = await git(run, argv.args, cwd);
	if (result.code !== 0) return { ok: false, text: `git ${request.operation} failed: ${(result.stderr || result.stdout).trim()}` };
	return { ok: true, text: clip(result.stdout.trimEnd() || "(no output)") };
}

/** What the workspace looked like when a delegation started. */
export interface WorkBase {
	head?: string;
	dirtyBefore: number;
}

export async function captureBase(run: GitRunner, cwd: string): Promise<WorkBase> {
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code !== 0) return { dirtyBefore: 0 };
	const status = await git(run, ["status", "--porcelain=v1"], cwd);
	const dirtyBefore = status.code === 0 ? status.stdout.split("\n").filter(Boolean).length : 0;
	return { head: head.stdout.trim(), dirtyBefore };
}

/** Changes since the base: new commits, tracked diff stat, untracked files. */
export async function summarizeWork(run: GitRunner, cwd: string, base: WorkBase, maxChars = 3_000): Promise<string> {
	if (!base.head) return "Workspace changes: not a git repository (or no commits); inspect the files directly.";
	const lines: string[] = [];
	const head = await git(run, ["rev-parse", "HEAD"], cwd);
	if (head.code === 0 && head.stdout.trim() !== base.head) {
		const log = await git(run, ["log", "--oneline", "-n20", `${base.head}..HEAD`], cwd);
		if (log.code === 0 && log.stdout.trim()) lines.push("New commits:", log.stdout.trimEnd());
	}
	const stat = await git(run, ["diff", "--stat", ...DIFF_SAFE, base.head], cwd);
	lines.push(stat.code === 0 && stat.stdout.trim() ? `Diff since ${base.head.slice(0, 8)}:\n${stat.stdout.trimEnd()}` : "Tracked files: no changes.");
	const untracked = await git(run, ["ls-files", "--others", "--exclude-standard"], cwd);
	const files = untracked.code === 0 ? untracked.stdout.split("\n").filter(Boolean) : [];
	if (files.length) {
		lines.push(`Untracked files (${files.length}):`, ...files.slice(0, 30), ...(files.length > 30 ? [`… ${files.length - 30} more`] : []));
	}
	if (base.dirtyBefore > 0) {
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
	const add = await git(run, paths?.length ? ["add", "--", ...paths] : ["add", "-A"], cwd);
	if (add.code !== 0) return { ok: false, text: `git add failed: ${(add.stderr || add.stdout).trim()}` };
	const commit = await git(run, ["commit", "-m", message], cwd);
	if (commit.code !== 0) return { ok: false, text: `git commit failed: ${(commit.stderr || commit.stdout).trim()}` };
	const show = await git(run, ["show", "--stat", "--oneline", ...DIFF_SAFE, "HEAD"], cwd);
	return { ok: true, text: clip(show.code === 0 ? show.stdout.trimEnd() : commit.stdout.trimEnd(), 3_000) };
}
