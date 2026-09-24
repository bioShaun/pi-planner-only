/**
 * pi-planner-only (lite): Root plans and reviews, cheaper child agents do the
 * bulk of the work through `delegate`. The plugin adds three tools, a short
 * prompt, optional strict mode, and a cost line; it keeps no durable state.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ROLES, loadLimits, runDelegation } from "./delegate.ts";
import type { DelegationParams, EventBus } from "./delegate.ts";
import { GIT_AUDIT_OPERATIONS, gitCommit, runGitAudit } from "./git.ts";
import type { GitAuditRequest, GitRunner } from "./git.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
export const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const STATUS_KEY = "planner-only";
const GIT_TIMEOUT_MS = 30_000;
export const PLUGIN_TOOLS = ["delegate", "git_audit", "git_commit"] as const;
export const STRICT_BLOCKED_TOOLS = new Set(["edit", "write", "bash"]);
/** pi-subagents' own Root-facing tools; hidden while planner-only is enabled. */
export const HIDDEN_HOST_TOOLS = ["subagents_enable", "subagent"] as const;
const HIDDEN_HOST_TOOL_SET = new Set<string>(HIDDEN_HOST_TOOLS);

const flag = (value: string | undefined, set: string[]) => set.includes((value ?? "").trim().toLowerCase());

/** PI_PLANNER_ONLY=1 forces on, =0 forces off; otherwise the off marker decides. */
export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	if (flag(env.PI_PLANNER_ONLY, ["1", "true", "on"])) return true;
	if (flag(env.PI_PLANNER_ONLY, ["0", "false", "off"])) return false;
	return !existsSync(OFF_MARKER);
}

export function isStrict(env: NodeJS.ProcessEnv = process.env): boolean {
	return flag(env.PI_PLANNER_ONLY_STRICT, ["1", "true", "on"]);
}

export function plannerPrompt(strict: boolean): string {
	return [
		"[PLANNER-ONLY]",
		"You plan and review; cheaper child agents do the bulk of the work through `delegate`.",
		strict
			? "- Strict mode: you cannot edit, write, or run bash yourself. Delegate implementation to role \"worker\" and check runs to \"validator\"."
			: "- Do small things yourself (about ≤2 files or ≤10 minutes of work). Delegate larger implementation to role \"worker\".",
		"- Other roles: \"explorer\" for broad code searches, \"validator\" to run tests/checks, \"reviewer\" for an independent read-only review.",
		"- Children do not see this conversation. Put the goal, relevant paths, constraints, and how to verify into `task`.",
		"- Judge results by the returned diff summary and check output, not by the child's claims. Inspect the actual changes (read, git_audit) before accepting.",
		"- To fix a child's work, delegate again with its previous report and the specific corrections.",
		"- After accepting changes, commit with git_commit.",
	].join("\n");
}

interface CostTotals {
	rootTokens: number;
	rootCost: number;
	childTokens: number;
	childCost: number;
	children: number;
}

const emptyTotals = (): CostTotals => ({ rootTokens: 0, rootCost: 0, childTokens: 0, childCost: 0, children: 0 });

/** Tokens and cost from a pi-ai assistant message usage, tolerating missing fields. */
export function rootUsageOf(message: unknown): { tokens: number; cost: number } | undefined {
	const m = message as { role?: string; usage?: Record<string, unknown> } | undefined;
	if (m?.role !== "assistant" || !m.usage) return undefined;
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	const u = m.usage;
	const cost = u.cost && typeof u.cost === "object" ? n((u.cost as Record<string, unknown>).total) : 0;
	return { tokens: n(u.input) + n(u.output) + n(u.cacheRead) + n(u.cacheWrite), cost };
}

export function formatTotals(t: CostTotals): string {
	const k = (n: number) => `${(n / 1000).toFixed(0)}k`;
	const total = t.rootCost + t.childCost;
	const share = total > 0 ? ` · root ${Math.round((t.rootCost / total) * 100)}%` : "";
	return `root ${k(t.rootTokens)} $${t.rootCost.toFixed(3)} · children(${t.children}) ${k(t.childTokens)} $${t.childCost.toFixed(3)}${share}`;
}

export default function plannerOnly(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};
	const busy = new Set<string>();
	let totals = emptyTotals();
	let hidLoader = false;

	const updateStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const label = isEnabled() ? `planner-only${isStrict() ? " (strict)" : ""} · ${formatTotals(totals)}` : "planner-only: off";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(isEnabled() ? "warning" : "muted", label));
	};

	const syncTools = () => {
		const active = pi.getActiveTools();
		const ours = new Set<string>(PLUGIN_TOOLS);
		let next: string[];
		if (isEnabled()) {
			hidLoader ||= active.includes("subagents_enable");
			next = [...active, ...PLUGIN_TOOLS.filter((t) => !active.includes(t))]
				.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
		} else {
			next = active.filter((t) => !ours.has(t));
			if (hidLoader && !next.includes("subagents_enable")) next = [...next, "subagents_enable"];
			hidLoader = false;
		}
		if (next.length !== active.length || next.some((t, i) => t !== active[i])) pi.setActiveTools(next);
	};

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: "Run one child agent on a self-contained task and wait for it. Returns the child's report, host status and usage, and a git summary of what changed.",
		promptSnippet: "delegate: hand a self-contained task to a cheaper child agent (worker, explorer, validator, reviewer)",
		parameters: Type.Object({
			role: Type.Union(ROLES.map((r) => Type.Literal(r)), {
				description: "worker: implement; explorer: search/read code; validator: run tests/checks; reviewer: independent read-only review.",
			}),
			task: Type.String({
				minLength: 1,
				description: "Self-contained instructions: goal, relevant paths, constraints, and how to verify. The child does not see this conversation.",
			}),
			cwd: Type.Optional(Type.String({ description: "Working directory. Defaults to the session cwd." })),
		}),
		async execute(_toolCallId, params: DelegationParams, signal, onUpdate, ctx) {
			const outcome = await runDelegation(
				{
					events: pi.events as unknown as EventBus,
					git: gitRunner,
					ownerRunId: ctx.sessionManager?.getSessionId?.() || randomUUID(),
					limits: loadLimits(),
					busy,
				},
				{ ...params, cwd: params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd },
				signal,
				(text) => onUpdate?.({ content: [{ type: "text", text }], details: {} }),
			);
			const usage = outcome.details.usage;
			if (usage) {
				totals.children += 1;
				totals.childTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
				totals.childCost += usage.cost;
				updateStatus(ctx);
			}
			return { content: [{ type: "text", text: outcome.text }], details: outcome.details };
		},
	});

	pi.registerTool({
		name: "git_audit",
		label: "Git Audit",
		description: `Read-only git inspection. Operations: ${GIT_AUDIT_OPERATIONS.join(", ")}. Optional base (commit sha or HEAD~N) for diff/diff-stat, optional path filter.`,
		promptSnippet: "git_audit: read-only git status/diff/log for reviewing child work",
		parameters: Type.Object({
			operation: Type.Union(GIT_AUDIT_OPERATIONS.map((o) => Type.Literal(o))),
			base: Type.Optional(Type.String({ description: "Commit sha (7-40 hex) or HEAD / HEAD~N to diff against." })),
			path: Type.Optional(Type.String({ description: "Limit to one path." })),
			maxEntries: Type.Optional(Type.Integer({ minimum: 1, maximum: 50, description: "log only: number of commits." })),
		}),
		async execute(_toolCallId, params: GitAuditRequest, _signal, _onUpdate, ctx) {
			const outcome = await runGitAudit(gitRunner, params, ctx.cwd);
			return { content: [{ type: "text", text: outcome.text }], details: { ok: outcome.ok } };
		},
	});

	pi.registerTool({
		name: "git_commit",
		label: "Git Commit",
		description: "Stage and commit accepted changes. Without paths, stages everything (git add -A). Never pushes.",
		promptSnippet: "git_commit: commit accepted changes (optionally only the given paths)",
		parameters: Type.Object({
			message: Type.String({ minLength: 1, maxLength: 500 }),
			paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Only stage these paths." })),
		}),
		async execute(_toolCallId, params: { message: string; paths?: string[] }, _signal, _onUpdate, ctx) {
			const outcome = await gitCommit(gitRunner, ctx.cwd, params.message, params.paths);
			return { content: [{ type: "text", text: outcome.text }], details: { ok: outcome.ok } };
		},
	});

	pi.registerCommand("planner-only", {
		description: "planner-only on | off | status",
		handler: async (args, ctx) => {
			const cmd = args.trim().toLowerCase();
			if (cmd === "on" || cmd === "off") {
				if (cmd === "off") {
					mkdirSync(dirname(OFF_MARKER), { recursive: true });
					writeFileSync(OFF_MARKER, "");
				} else rmSync(OFF_MARKER, { force: true });
				syncTools();
			}
			updateStatus(ctx);
			const env = process.env.PI_PLANNER_ONLY ? ` (PI_PLANNER_ONLY=${process.env.PI_PLANNER_ONLY} overrides the marker)` : "";
			ctx.ui.notify(`planner-only ${isEnabled() ? "on" : "off"}${isStrict() ? ", strict" : ""}${env}\n${formatTotals(totals)}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		totals = emptyTotals();
		syncTools();
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (isEnabled()) {
			const sel = event.systemPromptOptions?.selectedTools;
			if (sel) {
				const kept = sel.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
				event.systemPromptOptions.selectedTools = [...kept, ...PLUGIN_TOOLS.filter((t) => !kept.includes(t))];
			}
		}
		syncTools();
		if (!isEnabled()) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${plannerPrompt(isStrict())}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isEnabled()) return;
		if (HIDDEN_HOST_TOOL_SET.has(event.toolName)) {
			return { block: true, reason: `planner-only: use the delegate tool instead of ${event.toolName}.` };
		}
		if (!isStrict() || !STRICT_BLOCKED_TOOLS.has(event.toolName)) return;
		if (ctx.hasUI) ctx.ui.notify(`planner-only strict: blocked ${event.toolName}`, "warning");
		return { block: true, reason: `planner-only strict mode: Root may not use ${event.toolName}. Delegate it (role "worker" to change files, "validator" to run commands).` };
	});

	pi.on("message_end", async (event, ctx) => {
		const usage = rootUsageOf(event.message);
		if (!usage) return;
		totals.rootTokens += usage.tokens;
		totals.rootCost += usage.cost;
		updateStatus(ctx);
	});
}
