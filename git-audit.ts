/**
 * Git-read: Root's only Git access. Fixed, read-only argv — never a shell.
 *
 * git_audit (the parent tool), Evidence probe, and the leftover bash allowlist
 * all take argv from this module. One table, two adapters (pi.exec in prod,
 * in-memory in tests).
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEFAULT_GIT_AUDIT_ENTRIES,
	MAX_GIT_AUDIT_ENTRIES,
	MAX_GIT_AUDIT_OUTPUT_CHARS,
} from "./types.ts";

/** Shared runner seam for git_audit and Evidence capture. */
export type GitRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<{ stdout: string; stderr?: string; code: number }>;

/**
 * Argv owned by Git-read. Evidence probe and git_audit `status`/`head` share
 * these rows. Evidence's working-tree diff is `diff HEAD --stat` (includes
 * staged); the git_audit `diff-stat` tool stays `diff --stat` (unstaged).
 */
export const GIT_READ_ARGV = {
	gitDir: ["rev-parse", "--git-dir"],
	head: ["rev-parse", "HEAD"],
	status: ["status", "--porcelain=v2", "--branch"],
	evidenceDiffStat: ["diff", "HEAD", "--stat"],
	// Reviewer evidence packet only. git_audit's diff-* operations build their
	// own argv because they also support the staged variant.
	diffCheck: ["diff", "--check"],
	// RF-1 Evidence probe rows only — never reachable through the git_audit tool.
	// diffNamesBetween takes the two refs as trailing argv elements, each
	// validated against GIT_REF_PATTERN; hashObject takes dirty paths after `--`.
	diffNamesBetween: ["diff", "--name-only", "--no-ext-diff", "--no-textconv"],
	hashObject: ["hash-object", "--"],
} as const;

/** RF-1 — commit SHAs accepted as diff endpoints by the Evidence probe (full or abbreviated). */
export const GIT_REF_PATTERN = /^[0-9a-f]{7,40}$/;
export const GIT_AUDIT_OPERATIONS = [
	"status",
	"diff-stat",
	"diff-names",
	"diff-check",
	"head",
	"log",
] as const;

export type GitAuditOperation = (typeof GIT_AUDIT_OPERATIONS)[number];

/** §9.4 — subcommands that must never be reachable through this tool. */
export const FORBIDDEN_GIT_OPERATIONS = [
	"commit",
	"add",
	"reset",
	"checkout",
	"switch",
	"restore",
	"clean",
	"rebase",
	"merge",
	"cherry-pick",
	"push",
	"pull",
	"fetch",
	"config",
	"stash",
	"tag",
	"branch",
	"apply",
	"am",
	"bisect",
	"notes",
	"worktree",
] as const;

/** Shell metacharacters, command substitution, and redirection. */
export const SHELL_METACHARACTERS = /[;&|`$><\n\r\\]/;

export interface GitAuditRequest {
	operation: string;
	cwd?: string;
	staged?: boolean;
	maxEntries?: number;
}

export type ResolvedGitAudit =
	| { ok: true; operation: GitAuditOperation; argv: string[] }
	| { ok: false; error: string };

function isForbiddenOperation(operation: string): boolean {
	const normalized = operation.trim().toLowerCase();
	const tokens = normalized.split(/[\s-]+/).filter(Boolean);
	return tokens.some((token) => (FORBIDDEN_GIT_OPERATIONS as readonly string[]).includes(token));
}

function clampEntries(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_GIT_AUDIT_ENTRIES;
	return Math.min(MAX_GIT_AUDIT_ENTRIES, Math.max(1, Math.trunc(value)));
}

/**
 * Reject anything that is not a known operation, carries shell syntax, or names
 * a mutating Git subcommand. Returns a human-readable reason, or undefined when
 * the request is safe.
 */
function rejectGitAuditRequest(request: GitAuditRequest): string | undefined {
	const operation = request.operation;
	if (typeof operation !== "string" || !operation.trim()) {
		return "git_audit requires an operation";
	}
	if (SHELL_METACHARACTERS.test(operation)) {
		return `git_audit operation contains forbidden shell syntax: ${JSON.stringify(operation)}`;
	}
	if (isForbiddenOperation(operation)) {
		return `git_audit forbids the mutating git operation: ${operation.trim()}`;
	}
	if (!(GIT_AUDIT_OPERATIONS as readonly string[]).includes(operation.trim().toLowerCase())) {
		return `git_audit operation must be one of ${GIT_AUDIT_OPERATIONS.join(", ")}`;
	}
	if (request.cwd !== undefined) {
		if (typeof request.cwd !== "string") return "git_audit cwd must be a string";
		if (SHELL_METACHARACTERS.test(request.cwd)) {
			return `git_audit cwd contains forbidden shell syntax: ${JSON.stringify(request.cwd)}`;
		}
	}
	if (request.maxEntries !== undefined && !Number.isFinite(request.maxEntries)) {
		return "git_audit maxEntries must be a finite number";
	}
	return undefined;
}

/** Map a validated operation to a fixed argv. No shell is involved. */
export function resolveGitAudit(request: GitAuditRequest): ResolvedGitAudit {
	const rejection = rejectGitAuditRequest(request);
	if (rejection) return { ok: false, error: rejection };

	const operation = request.operation.trim().toLowerCase() as GitAuditOperation;
	const staged = request.staged === true;
	switch (operation) {
		case "status":
			return { ok: true, operation, argv: [...GIT_READ_ARGV.status] };
		case "diff-stat":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--stat"] };
		case "diff-names":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--name-status"] };
		case "diff-check":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--check"] };
		case "head":
			return { ok: true, operation, argv: [...GIT_READ_ARGV.head] };
		case "log":
			return {
				ok: true,
				operation,
				argv: ["log", "--oneline", "-n", String(clampEntries(request.maxEntries))],
			};
	}
}

export function validateGitAuditCwd(cwd: string): { ok: true; path: string } | { ok: false; error: string } {
	try {
		const stats = statSync(cwd);
		if (!stats.isDirectory()) return { ok: false, error: `git_audit cwd is not a directory: ${cwd}` };
		return { ok: true, path: cwd };
	} catch {
		return { ok: false, error: `git_audit cwd does not exist: ${cwd}` };
	}
}

export interface GitAuditCommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

const EMPTY_MESSAGES: Record<GitAuditOperation, string> = {
	status: "(clean working tree)",
	"diff-stat": "(no diff)",
	"diff-names": "(no changed paths)",
	"diff-check": "(no whitespace errors)",
	head: "(no commits yet)",
	log: "(no commits yet)",
};

/** Bound the output before it can reach the parent's context. */
function formatGitAudit(
	operation: GitAuditOperation,
	result: GitAuditCommandResult,
): string {
	const header = `git ${[operation, ...(result.code === 0 ? [] : [`exit ${result.code}`])].join(" ")}`;
	if (result.code !== 0) {
		const detail = result.stderr.trim() || result.stdout.trim() || "no output";
		return `${header}\n${detail.slice(0, MAX_GIT_AUDIT_OUTPUT_CHARS)}`;
	}
	const stdout = result.stdout.trimEnd();
	if (!stdout) return `${header}\n${EMPTY_MESSAGES[operation]}`;
	if (stdout.length <= MAX_GIT_AUDIT_OUTPUT_CHARS) return `${header}\n${stdout}`;
	return `${header}\n${stdout.slice(0, MAX_GIT_AUDIT_OUTPUT_CHARS)}\n… (truncated, ${stdout.length} chars total)`;
}

export type GitAuditRunner = GitRunner;

export interface GitAuditOutcome {
	ok: boolean;
	operation: string;
	text: string;
	code: number;
}

export async function runGitAudit(
	run: GitAuditRunner,
	request: GitAuditRequest,
	baseCwd: string,
): Promise<GitAuditOutcome> {
	const resolved = resolveGitAudit(request);
	if (!resolved.ok) return { ok: false, operation: request.operation, text: resolved.error, code: 1 };

	const target = resolve(baseCwd, request.cwd ?? ".");
	const cwdCheck = validateGitAuditCwd(target);
	if (!cwdCheck.ok) return { ok: false, operation: resolved.operation, text: cwdCheck.error, code: 1 };

	let result: GitAuditCommandResult;
	try {
		const raw = await run(resolved.argv, target);
		result = { stdout: raw.stdout, stderr: raw.stderr ?? "", code: raw.code };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, operation: resolved.operation, text: `git_audit failed: ${message}`, code: 1 };
	}

	return {
		ok: result.code === 0,
		operation: resolved.operation,
		text: formatGitAudit(resolved.operation, result),
		code: result.code,
	};
}

const SAFE_GIT_STATUS_FLAGS = new Set([
	"--short",
	"-s",
	"--branch",
	"-b",
	"--porcelain",
	"--porcelain=v1",
	"--porcelain=v2",
]);

const SAFE_GIT_DIFF_FLAGS = new Set([
	"--cached",
	"--staged",
	"--stat",
	"--numstat",
	"--shortstat",
	"--name-only",
	"--name-status",
	"--check",
	"--no-color",
	"--no-ext-diff",
	"--no-textconv",
]);

const SAFE_GIT_LOG_FLAGS = new Set([
	"--oneline",
	"--decorate",
	"--no-decorate",
	"--stat",
	"--no-color",
]);

function allFlagsAllowed(tokens: string[], allowed: Set<string>): boolean {
	return tokens.every((token) => allowed.has(token));
}

/**
 * Leftover bash allowlist for a stale `bash` tool call. Same Git-read module
 * owns the flags so the allowlist cannot drift from git_audit / Evidence.
 */
export function isSafeAuditCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed || SHELL_METACHARACTERS.test(trimmed)) return false;
	if (trimmed === "pwd") return true;

	const tokens = trimmed.split(/\s+/);
	if (tokens[0] !== "git" || tokens.length < 2) return false;

	const subcommand = tokens[1];
	const args = tokens.slice(2);
	if (subcommand === "status") return allFlagsAllowed(args, SAFE_GIT_STATUS_FLAGS);
	if (subcommand === "diff") return allFlagsAllowed(args, SAFE_GIT_DIFF_FLAGS);
	if (subcommand === "log") {
		return args.every((token) =>
			SAFE_GIT_LOG_FLAGS.has(token) ||
			/^-n\d+$/.test(token) ||
			/^--max-count=\d+$/.test(token),
		);
	}

	return false;
}
