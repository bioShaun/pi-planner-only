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
import { DEFAULT_LIMITS, ROLES, formatTokens, loadLimits, runDelegation, timeoutMinutes } from "./delegate.ts";
import type { DelegationLimits, DelegationParams, EventBus } from "./delegate.ts";
import { GIT_AUDIT_OPERATIONS, gitCommit, gitSafePrefix, isWorkTree, runGitAudit } from "./git.ts";
import type { GitAuditRequest, GitRunner } from "./git.ts";
import { loadArtifactDir } from "./subagent-artifacts.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
export const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const STATUS_KEY = "planner-only";
const GIT_TIMEOUT_MS = 30_000;
export const MAX_COMMIT_MESSAGE_CHARS = 2_000;
export const PLUGIN_TOOLS = ["delegate", "git_audit", "git_commit", "handoff"] as const;
export const STRICT_BLOCKED_TOOLS = new Set(["edit", "write", "bash"]);
/** pi-subagents' own Root-facing tools; hidden while planner-only is enabled. */
export const HIDDEN_HOST_TOOLS = ["subagents_enable", "subagent"] as const;
const HIDDEN_HOST_TOOL_SET = new Set<string>(HIDDEN_HOST_TOOLS);

const REPO_CWD_DESCRIPTION = "Repository to run in (absolute or relative to the session cwd). Defaults to the session cwd.";
const resolveCwd = (ctx: { cwd: string }, cwd: string | undefined) => (cwd ? resolve(ctx.cwd, cwd) : ctx.cwd);

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

export function plannerPrompt(strict: boolean, limits: DelegationLimits = DEFAULT_LIMITS): string {
	return [
		"[PLANNER-ONLY]",
		"You plan and review; cheaper child agents do the bulk of the work through `delegate`.",
		strict
			? "- Strict mode: you cannot edit, write, or run bash yourself. Delegate implementation to role \"worker\" and check runs to \"validator\"."
			: "- Do small things yourself (about ≤2 files or ≤10 minutes of work). Delegate larger implementation to role \"worker\".",
		"- Other roles: \"explorer\" for broad code searches and reading-heavy work (logs/transcripts); only its findings enter your context. \"validator\" runs checks; \"reviewer\" is read-only, has no shell, and sees files plus uncommitted changes only, so run it before git_commit.",
		"- Children cannot see this conversation; give `task` the goal, paths, constraints, and verification.",
		`- A child has ${timeoutMinutes(limits)} minutes. Do not delegate work that needs longer; split it.`,
		"- For another repository, pass `cwd` to delegate, git_audit, and git_commit.",
		"- Check the diff and command output yourself before accepting; do not rely on child claims.",
		"- If a child fails or times out, delegate again with a narrower task and its report/last tool results before doing the work yourself.",
		"- A timed-out child's result includes its last tool results; reuse them.",
		"- Before reverting or reporting a child's change, check it against your task: yours or its own?",
		"- After accepting changes, commit with git_commit.",
	].join("\n");
}

interface CostTotals {
	rootTokens: number;
	rootCost: number;
	childTokens: number;
	childCost: number;
	children: number;
	/** children whose run did not complete (timed out, failed, stopped). */
	failed: number;
}

const emptyTotals = (): CostTotals => ({ rootTokens: 0, rootCost: 0, childTokens: 0, childCost: 0, children: 0, failed: 0 });

/** Tokens and cost from a pi-ai assistant message usage, tolerating missing fields. */
export function rootUsageOf(message: unknown): { tokens: number; context: number; cost: number } | undefined {
	const m = message as { role?: string; usage?: Record<string, unknown> } | undefined;
	if (m?.role !== "assistant" || !m.usage) return undefined;
	const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
	const u = m.usage;
	const cost = u.cost && typeof u.cost === "object" ? n((u.cost as Record<string, unknown>).total) : 0;
	return { tokens: n(u.input) + n(u.output) + n(u.cacheRead) + n(u.cacheWrite), context: n(u.input) + n(u.cacheRead) + n(u.cacheWrite), cost };
}

/**
 * `root 4.17M $3.854 · children(3, 1 failed) 2.82M $0.103 · root share 60% tok · 97% $`
 * Tokens include cache reads on both sides, so the two shares are comparable.
 */
export function formatTotals(t: CostTotals): string {
	const pct = (part: number, whole: number) => `${Math.round((part / whole) * 100)}%`;
	const tokenTotal = t.rootTokens + t.childTokens;
	const costTotal = t.rootCost + t.childCost;
	const shares = [
		tokenTotal > 0 ? `${pct(t.rootTokens, tokenTotal)} tok` : "",
		costTotal > 0 ? `${pct(t.rootCost, costTotal)} $` : "",
	].filter(Boolean);
	const share = t.children > 0 && shares.length ? ` · root share ${shares.join(" · ")}` : "";
	const kids = t.failed > 0 ? `children(${t.children}, ${t.failed} failed)` : `children(${t.children})`;
	return `root ${formatTokens(t.rootTokens)} $${t.rootCost.toFixed(3)} · ${kids} ${formatTokens(t.childTokens)} $${t.childCost.toFixed(3)}${share}`;
}

export default function plannerOnly(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};
	const busy = new Set<string>();
	let totals = emptyTotals();
	let rootContext: number | undefined;
	let contextWarned = false;
	let handoffRequested = false;
	let pendingHandoff: { brief: string; cwd: string; sessionFile?: string; manualOnly?: boolean } | undefined;
	let delegationsInFlight = 0;
	let hidLoader = false;
	const contextWarnThreshold = () => {
		const value = Number(process.env.PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS);
		return Number.isInteger(value) && value > 0 ? value : 150_000;
	};
	const sendContextWarning = (tokens: number) => {
		if (!isEnabled() || contextWarned || tokens <= contextWarnThreshold()) return;
		contextWarned = true;
		try {
			pi.sendMessage?.({
				customType: "planner-only-context",
				content: `[planner-only] Root context is about ${formatTokens(tokens)} tokens (warning threshold ${formatTokens(contextWarnThreshold())}); every turn re-reads it. From now on delegate reading-heavy and multi-file work. At the next task boundary: if the next step is a new task, call the handoff tool with a complete brief (it starts a fresh session automatically); if still mid-task and the context is mostly stale exploration, ask the user to run /compact with what to keep.`,
				display: true,
			}, { deliverAs: "nextTurn" });
		} catch { /* Warnings must never interrupt the host handler. */ }
	};
	const statusTotals = () => `${formatTotals(totals)}${rootContext && rootContext > 0 ? ` · ctx ${formatTokens(rootContext)}` : ""}`;

	const updateStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const highContext = rootContext !== undefined && rootContext > contextWarnThreshold();
		const label = isEnabled() ? `planner-only${isStrict() ? " (strict)" : ""} · ${statusTotals()}` : "planner-only: off";
		ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(!isEnabled() ? "muted" : highContext ? "error" : "warning", label));
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
				description: "worker: implement; explorer: search/read code, logs, or transcripts and return findings; validator: run tests/checks; reviewer: independent read-only review; no shell, sees files and uncommitted changes (review before committing).",
			}),
			task: Type.String({
				minLength: 1,
				description: "Self-contained instructions: goal, relevant paths, constraints, and how to verify. The child does not see this conversation.",
			}),
			cwd: Type.Optional(Type.String({
				description: "The repository or directory the child works in. Set it when the target is not the session cwd; the diff summary and the per-cwd lock use it.",
			})),
		}),
		async execute(_toolCallId, params: DelegationParams, signal, onUpdate, ctx) {
			delegationsInFlight += 1;
			let outcome;
			try {
				outcome = await runDelegation(
				{
					events: pi.events as unknown as EventBus,
					git: gitRunner,
					ownerRunId: ctx.sessionManager?.getSessionId?.() || randomUUID(),
					limits: loadLimits(),
					busy,
					sessionFile: ctx.sessionManager?.getSessionFile?.(),
					artifactDir: loadArtifactDir(),
				},
				{ ...params, cwd: resolveCwd(ctx, params.cwd) },
				signal,
				(text) => onUpdate?.({ content: [{ type: "text", text }], details: {} }),
				);
			} finally {
				delegationsInFlight -= 1;
			}
			const { usage, status } = outcome.details;
			// Refusals never launched a child; everything else counts, with or without usage.
			if (status !== "refused") {
				totals.children += 1;
				if (status !== "completed") totals.failed += 1;
				if (usage) {
					totals.childTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
					totals.childCost += usage.cost;
				}
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
			cwd: Type.Optional(Type.String({ description: REPO_CWD_DESCRIPTION })),
		}),
		async execute(_toolCallId, params: GitAuditRequest & { cwd?: string }, _signal, _onUpdate, ctx) {
			const { cwd, ...request } = params;
			// Models often send optional fields as ""; treat an empty path as "no path filter".
			if (request.path === "") delete request.path;
			const outcome = await runGitAudit(gitRunner, request, resolveCwd(ctx, cwd));
			return { content: [{ type: "text", text: outcome.text }], details: { ok: outcome.ok } };
		},
	});

	pi.registerTool({
		name: "git_commit",
		label: "Git Commit",
		description: "Stage and commit accepted changes. Without paths, stages everything (git add -A). Never pushes.",
		promptSnippet: "git_commit: commit accepted changes (optionally only the given paths)",
		parameters: Type.Object({
			message: Type.String({ minLength: 1, maxLength: MAX_COMMIT_MESSAGE_CHARS, description: "Subject line, optionally a blank line and a few short bullets." }),
			paths: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { description: "Only stage these paths (relative to cwd)." })),
			cwd: Type.Optional(Type.String({ description: REPO_CWD_DESCRIPTION })),
		}),
		async execute(_toolCallId, params: { message: string; paths?: string[]; cwd?: string }, _signal, _onUpdate, ctx) {
			const outcome = await gitCommit(gitRunner, resolveCwd(ctx, params.cwd), params.message, params.paths);
			return { content: [{ type: "text", text: outcome.text }], details: { ok: outcome.ok } };
		},
	});

	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description: "Start a fresh Root session with a complete, self-contained task brief.",
		promptSnippet: "handoff: at a task boundary when your context is large, continue in a fresh session from a brief",
		parameters: Type.Object({
			brief: Type.String({ minLength: 200, description: "Self-contained brief for the next Root session: goal, decisions made, constraints, relevant files/specs, what is done, open items, and the exact next step." }),
			cwd: Type.Optional(Type.String({ description: REPO_CWD_DESCRIPTION })),
		}),
		async execute(_toolCallId, params: { brief: string; cwd?: string }, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) return { content: [{ type: "text", text: "Handoff refused: a UI session is required." }], details: { ok: false } };
			if (busy.size > 0) return { content: [{ type: "text", text: "Handoff refused: an exclusive child is still running." }], details: { ok: false } };
			if (delegationsInFlight > 0) return { content: [{ type: "text", text: "Handoff refused: a delegated child is still running." }], details: { ok: false } };
			if (pendingHandoff) return { content: [{ type: "text", text: "Handoff refused: one is already pending." }], details: { ok: false } };
			const threshold = contextWarnThreshold();
			if (!handoffRequested && (rootContext ?? 0) <= threshold) return { content: [{ type: "text", text: `Handoff refused: your context is about ${formatTokens(rootContext ?? 0)} tokens, below the ${formatTokens(threshold)} threshold, and the user did not request a handoff. Continue the work in this session.` }], details: { ok: false } };
			if (params.brief.length < 200) return { content: [{ type: "text", text: "Handoff refused: brief must be at least 200 characters." }], details: { ok: false } };
			handoffRequested = false;
			pendingHandoff = { brief: params.brief, cwd: resolveCwd(ctx, params.cwd), sessionFile: ctx.sessionManager?.getSessionFile?.() };
			return { content: [{ type: "text", text: "Handoff scheduled: a new session will start with this brief after this turn ends. Stop working now; end your turn with a one-line note to the user." }], details: { ok: true } };
		},
	});

	pi.registerCommand("planner-only", {
		description: "planner-only on | off | status | handoff [goal]",
		handler: async (args, ctx) => {
			const raw = args.trim();
			const cmd = raw.toLowerCase();
			if (cmd === "handoff drop") {
				pendingHandoff = undefined;
				handoffRequested = false;
				ctx.ui.notify("handoff dropped", "info");
				return;
			}
			if (cmd === "handoff" || cmd.startsWith("handoff ")) {
				if (!pendingHandoff) {
					handoffRequested = true;
					const goal = raw.slice("handoff".length).trim();
					pi.sendUserMessage(`[planner-only] The user asked for a handoff${goal ? ` (next goal: ${goal})` : ""}. Call the handoff tool now with a complete brief.`, ctx.isIdle?.() ? undefined : { deliverAs: "followUp" });
					return;
				}
				const handoff = pendingHandoff;
				let facts: string;
				try {
					const prefix = await gitSafePrefix(gitRunner, handoff.cwd);
					if (!(await isWorkTree(gitRunner, handoff.cwd))) facts = "Not inside a git work tree.";
					else {
						const [status, log] = await Promise.all([
							gitRunner([...prefix, "status", "--porcelain"], handoff.cwd),
							gitRunner([...prefix, "log", "--oneline", "-n5"], handoff.cwd),
						]);
						facts = `git status (porcelain):\n${status.code === 0 ? status.stdout.split("\\n").slice(0, 30).join("\\n") || "(clean)" : (status.stderr || status.stdout).trim()}\n\ngit log --oneline -n5:\n${log.code === 0 ? log.stdout.trim() || "(no commits)" : (log.stderr || log.stdout).trim()}`;
					}
				} catch (error) {
					facts = `git facts unavailable: ${error instanceof Error ? error.message : String(error)}`;
				}
				const prompt = `[planner-only handoff] You are the new Root session. The previous session handed this work to you because its context was large. "This session"/"the next session" in the brief below both mean YOU: do the next step now. Do not call the handoff tool unless your own context grows past the warning threshold.\n\n## Brief\n${handoff.brief}\n\n## Facts from the previous session\nPrevious session file: ${handoff.sessionFile ?? "unknown"}\nRepository (git facts below): ${handoff.cwd}\n${facts}\n\nContinue as Root under planner-only; the brief is authoritative.`;
				const mode = (process.env.PI_PLANNER_ONLY_HANDOFF ?? "auto").trim().toLowerCase();
				try {
					const result = await ctx.newSession({ parentSession: handoff.sessionFile, withSession: async (rctx) => {
						rctx.ui.notify("planner-only: handoff from previous session", "info");
						if (mode === "confirm") {
							rctx.ui.setEditorText(prompt);
							rctx.ui.notify("Handoff ready. Submit when ready.", "info");
						} else await rctx.sendUserMessage(prompt);
					} });
					if (result?.cancelled) {
						pendingHandoff = { ...handoff, manualOnly: true };
						ctx.ui.notify("handoff cancelled; run /planner-only handoff to retry, or /planner-only handoff drop to discard it", "warning");
					} else pendingHandoff = undefined;
				} catch (error) {
					pendingHandoff = { ...handoff, manualOnly: true };
					const reason = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`handoff failed (${reason}); run /planner-only handoff to retry, or /planner-only handoff drop to discard it`, "warning");
				}
				return;
			}
			if (cmd === "on" || cmd === "off") {
				if (cmd === "off") {
					pendingHandoff = undefined;
					mkdirSync(dirname(OFF_MARKER), { recursive: true });
					writeFileSync(OFF_MARKER, "");
				} else rmSync(OFF_MARKER, { force: true });
				syncTools();
			}
			updateStatus(ctx);
			const env = process.env.PI_PLANNER_ONLY ? ` (PI_PLANNER_ONLY=${process.env.PI_PLANNER_ONLY} overrides the marker)` : "";
			ctx.ui.notify(`planner-only ${isEnabled() ? "on" : "off"}${isStrict() ? ", strict" : ""}${env}\n${statusTotals()}`, "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		totals = emptyTotals();
		rootContext = undefined;
		contextWarned = false;
		handoffRequested = false;
		pendingHandoff = undefined;
		syncTools();
		updateStatus(ctx);
	});

	pi.on("agent_settled", async () => {
		if (!isEnabled()) {
			pendingHandoff = undefined;
			return;
		}
		if (!pendingHandoff || pendingHandoff.manualOnly) return;
		try { pi.sendUserMessage("/planner-only handoff", { expandPromptTemplates: true }); }
		catch {
			pendingHandoff = undefined;
			pi.sendMessage?.({ customType: "planner-only-handoff", content: "[planner-only] Handoff dispatch failed; run /planner-only handoff manually.", display: true });
		}
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
		return { systemPrompt: `${event.systemPrompt}\n\n${plannerPrompt(isStrict(), loadLimits())}` };
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

	pi.on("session_compact", async (_event, ctx) => {
		rootContext = undefined;
		contextWarned = false;
		updateStatus(ctx);
	});

	pi.on("message_end", async (event, ctx) => {
		const usage = rootUsageOf(event.message);
		if (!usage) return;
		const contextUsage = (ctx as ExtensionContext & { getContextUsage?: () => { tokens?: unknown } }).getContextUsage?.()?.tokens;
		rootContext = typeof contextUsage === "number" && Number.isFinite(contextUsage) && contextUsage > 0
			? contextUsage
			: usage.context;
		if (rootContext <= contextWarnThreshold()) contextWarned = false;
		sendContextWarning(rootContext);
		totals.rootTokens += usage.tokens;
		totals.rootCost += usage.cost;
		updateStatus(ctx);
	});
}
