/**
 * `git_audit` — a bounded, read-only Git tool for the parent (spec §9).
 *
 * The parent needs Git evidence to review worker output, but must not regain a
 * general shell. Every operation maps to a fixed argv built here; nothing is
 * ever handed to a shell, so injection is structurally impossible. The explicit
 * input validation exists so a malformed or hostile `operation` is rejected
 * with a clear message instead of silently doing nothing.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEFAULT_GIT_AUDIT_ENTRIES,
	MAX_GIT_AUDIT_ENTRIES,
	MAX_GIT_AUDIT_OUTPUT_CHARS,
} from "./types.ts";

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

export function clampEntries(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return DEFAULT_GIT_AUDIT_ENTRIES;
	return Math.min(MAX_GIT_AUDIT_ENTRIES, Math.max(1, Math.trunc(value)));
}

/**
 * Reject anything that is not a known operation, carries shell syntax, or names
 * a mutating Git subcommand. Returns a human-readable reason, or undefined when
 * the request is safe.
 */
export function rejectGitAuditRequest(request: GitAuditRequest): string | undefined {
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
			return { ok: true, operation, argv: ["status", "--porcelain=v2", "--branch"] };
		case "diff-stat":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--stat"] };
		case "diff-names":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--name-status"] };
		case "diff-check":
			return { ok: true, operation, argv: ["diff", ...(staged ? ["--cached"] : []), "--check"] };
		case "head":
			return { ok: true, operation, argv: ["rev-parse", "HEAD"] };
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
export function formatGitAudit(
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

export type GitAuditRunner = (
	args: readonly string[],
	cwd: string,
) => Promise<GitAuditCommandResult>;

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
		result = await run(resolved.argv, target);
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
