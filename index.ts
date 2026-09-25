/**
 * pi-planner-only (lite): Root plans and reviews, cheaper child agents do the
 * bulk of the work through `delegate`. The plugin adds three tools, a short
 * prompt, optional strict mode, and a cost line; it keeps no durable state.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_LIMITS, loadConfig } from "./config.ts";
import type { DelegationLimits } from "./config.ts";
import { ROLES, createCwdLocks, runDelegation, timeoutMinutes } from "./delegate.ts";
import type { DelegationParams } from "./delegate.ts";
import { formatTokens } from "./format.ts";
import { createHostAdapter, rootUsageOf } from "./host.ts";
import type { HostAdapter } from "./host.ts";
export { rootUsageOf } from "./host.ts";
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

/** PI_PLANNER_ONLY=1 forces on, =0 forces off; otherwise the off marker decides. */
export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return loadConfig(env).enabled ?? !existsSync(OFF_MARKER);
}

export function isStrict(env: NodeJS.ProcessEnv = process.env): boolean {
	return loadConfig(env).strict;
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
		"- After accepting changes, commit with git_commit: pass paths when the work tree has unrelated changes.",
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

export interface PendingHandoff {
	brief: string;
	cwd: string;
	sessionFile?: string;
	/** Set after a failed or cancelled dispatch: only `/planner-only handoff` retries it. */
	manualOnly?: boolean;
}

export type ChildRunStatus = "completed" | "refused" | (string & {});

export interface ChildRunUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export function contextWarnThreshold(env: NodeJS.ProcessEnv = process.env): number {
	return loadConfig(env).contextWarnTokens;
}

/**
 * All mutable plugin state. Conversation-scoped fields are cleared by `reset()`
 * on session start; the process-scoped ones (`locks`, `delegationsInFlight`,
 * `hidLoader`) outlive a session because they track children and host tools
 * that do too.
 */
export class PlannerSession {
	/** Exclusive per-cwd child locks (owned by the delegation engine). */
	readonly locks = createCwdLocks();
	delegationsInFlight = 0;
	/** Whether we hid pi-subagents' loader tool and must restore it on `off`. */
	hidLoader = false;
	totals: CostTotals = emptyTotals();
	rootContext: number | undefined;
	contextWarned = false;
	handoffRequested = false;
	pendingHandoff: PendingHandoff | undefined;

	reset(): void {
		this.totals = emptyTotals();
		this.rootContext = undefined;
		this.contextWarned = false;
		this.handoffRequested = false;
		this.pendingHandoff = undefined;
	}

	async trackDelegation<T>(run: () => Promise<T>): Promise<T> {
		this.delegationsInFlight += 1;
		try {
			return await run();
		} finally {
			this.delegationsInFlight -= 1;
		}
	}

	/** Refusals never launched a child; everything else counts, with or without usage. */
	recordChildRun(status: ChildRunStatus, usage: ChildRunUsage | undefined): boolean {
		if (status === "refused") return false;
		this.totals.children += 1;
		if (status !== "completed") this.totals.failed += 1;
		if (usage) {
			this.totals.childTokens += usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
			this.totals.childCost += usage.cost;
		}
		return true;
	}

	recordRootTurn(usage: { tokens: number; cost: number }, context: number): void {
		this.rootContext = context;
		if (context <= contextWarnThreshold()) this.contextWarned = false;
		this.totals.rootTokens += usage.tokens;
		this.totals.rootCost += usage.cost;
	}

	/** True once per threshold crossing: the caller owns sending the warning. */
	claimContextWarning(): boolean {
		if (this.contextWarned || !this.highContext) return false;
		this.contextWarned = true;
		return true;
	}

	noteCompacted(): void {
		this.rootContext = undefined;
		this.contextWarned = false;
	}

	get highContext(): boolean {
		return this.rootContext !== undefined && this.rootContext > contextWarnThreshold();
	}

	/** Why a handoff cannot be scheduled right now, or undefined when it can. */
	handoffRefusal(brief: string): string | undefined {
		if (this.locks.size > 0) return "an exclusive child is still running.";
		if (this.delegationsInFlight > 0) return "a delegated child is still running.";
		if (this.pendingHandoff) return "one is already pending.";
		const threshold = contextWarnThreshold();
		if (!this.handoffRequested && (this.rootContext ?? 0) <= threshold) {
			return `your context is about ${formatTokens(this.rootContext ?? 0)} tokens, below the ${formatTokens(threshold)} threshold, and the user did not request a handoff. Continue the work in this session.`;
		}
		if (brief.length < 200) return "brief must be at least 200 characters.";
		return undefined;
	}

	scheduleHandoff(handoff: PendingHandoff): void {
		this.handoffRequested = false;
		this.pendingHandoff = handoff;
	}

	requestHandoff(): void {
		this.handoffRequested = true;
	}

	/** Dispatch failed or was cancelled: keep the brief, but stop auto-dispatching it. */
	deferHandoff(handoff: PendingHandoff): void {
		this.pendingHandoff = { ...handoff, manualOnly: true };
	}

	dropHandoff(): void {
		this.pendingHandoff = undefined;
		this.handoffRequested = false;
	}

	clearPendingHandoff(): void {
		this.pendingHandoff = undefined;
	}
}

interface PlannerRuntime {
	pi: ExtensionAPI;
	git: GitRunner;
	host: HostAdapter;
	session: PlannerSession;
}

const textResult = <T>(text: string, details: T) => ({ content: [{ type: "text" as const, text }], details });
const refusal = (text: string) => textResult(text, { ok: false });

function statusTotals(session: PlannerSession): string {
	const ctx = session.rootContext && session.rootContext > 0 ? ` · ctx ${formatTokens(session.rootContext)}` : "";
	return `${formatTotals(session.totals)}${ctx}`;
}

function updateStatus(session: PlannerSession, ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	const label = isEnabled() ? `planner-only${isStrict() ? " (strict)" : ""} · ${statusTotals(session)}` : "planner-only: off";
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(!isEnabled() ? "muted" : session.highContext ? "error" : "warning", label));
}

/** Adds our tools and hides pi-subagents' loader while enabled; restores both when off. */
function syncTools({ pi, session }: PlannerRuntime): void {
	const active = pi.getActiveTools();
	const ours = new Set<string>(PLUGIN_TOOLS);
	let next: string[];
	if (isEnabled()) {
		session.hidLoader ||= active.includes("subagents_enable");
		next = [...active, ...PLUGIN_TOOLS.filter((t) => !active.includes(t))]
			.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
	} else {
		next = active.filter((t) => !ours.has(t));
		if (session.hidLoader && !next.includes("subagents_enable")) next = [...next, "subagents_enable"];
		session.hidLoader = false;
	}
	if (next.length !== active.length || next.some((t, i) => t !== active[i])) pi.setActiveTools(next);
}

function sendContextWarning(host: HostAdapter, tokens: number): void {
	host.sendMessage({
		customType: "planner-only-context",
		content: `[planner-only] Root context is about ${formatTokens(tokens)} tokens (warning threshold ${formatTokens(contextWarnThreshold())}); every turn re-reads it. From now on delegate reading-heavy and multi-file work. At the next task boundary: if the next step is a new task, call the handoff tool with a complete brief (it starts a fresh session automatically); if still mid-task and the context is mostly stale exploration, ask the user to run /compact with what to keep.`,
		display: true,
	}, { deliverAs: "nextTurn" });
}

async function executeDelegate(
	runtime: PlannerRuntime,
	params: DelegationParams,
	signal: AbortSignal | undefined,
	onUpdate: ((text: string) => void) | undefined,
	ctx: ExtensionContext,
) {
	const { git, session, host } = runtime;
	const outcome = await session.trackDelegation(() => runDelegation(
		{
			events: host.events,
			git,
			ownerRunId: host.sessionId(ctx),
			limits: loadConfig().limits,
			locks: session.locks,
			sessionFile: host.sessionFile(ctx),
			artifactDir: loadArtifactDir(),
		},
		{ ...params, cwd: resolveCwd(ctx, params.cwd) },
		signal,
		(text) => onUpdate?.(text),
	));
	const { usage, status } = outcome.details;
	if (session.recordChildRun(status, usage)) updateStatus(session, ctx);
	return textResult(outcome.text, outcome.details);
}

async function executeGitAudit(git: GitRunner, params: GitAuditRequest & { cwd?: string }, ctx: ExtensionContext) {
	const { cwd, ...request } = params;
	// Models often send optional fields as ""; treat an empty path as "no path filter".
	if (request.path === "") delete request.path;
	const outcome = await runGitAudit(git, request, resolveCwd(ctx, cwd));
	return textResult(outcome.text, { ok: outcome.ok });
}

async function executeGitCommit(git: GitRunner, params: { message: string; paths?: string[]; cwd?: string }, ctx: ExtensionContext) {
	const outcome = await gitCommit(git, resolveCwd(ctx, params.cwd), params.message, params.paths);
	return textResult(outcome.text, { ok: outcome.ok });
}

function executeHandoff(session: PlannerSession, host: HostAdapter, params: { brief: string; cwd?: string }, ctx: ExtensionContext) {
	if (!ctx.hasUI) return refusal("Handoff refused: a UI session is required.");
	const reason = session.handoffRefusal(params.brief);
	if (reason) return refusal(`Handoff refused: ${reason}`);
	session.scheduleHandoff({ brief: params.brief, cwd: resolveCwd(ctx, params.cwd), sessionFile: host.sessionFile(ctx) });
	return textResult("Handoff scheduled: a new session will start with this brief after this turn ends. Stop working now; end your turn with a one-line note to the user.", { ok: true });
}

export function formatStatusLines(stdout: string, max = 30): string {
	const body = stdout.endsWith("\n") ? stdout.slice(0, -1) : stdout;
	if (!body) return "(clean)";
	const lines = body.split("\n");
	if (lines.length <= max) return body;
	return [...lines.slice(0, max), `… ${lines.length - max} more`].join("\n");
}

async function gatherGitFacts(git: GitRunner, cwd: string): Promise<string> {
	try {
		const prefix = await gitSafePrefix(git, cwd);
		if (!(await isWorkTree(git, cwd))) return "Not inside a git work tree.";
		const [status, log] = await Promise.all([
			git([...prefix, "status", "--porcelain"], cwd),
			git([...prefix, "log", "--oneline", "-n5"], cwd),
		]);
		const statusText = status.code === 0 ? formatStatusLines(status.stdout) : (status.stderr || status.stdout).trim();
		return `git status (porcelain):\n${statusText}\n\ngit log --oneline -n5:\n${log.code === 0 ? log.stdout.trim() || "(no commits)" : (log.stderr || log.stdout).trim()}`;
	} catch (error) {
		return `git facts unavailable: ${error instanceof Error ? error.message : String(error)}`;
	}
}

function handoffPrompt(handoff: PendingHandoff, facts: string): string {
	return `[planner-only handoff] You are the new Root session. The previous session handed this work to you because its context was large. "This session"/"the next session" in the brief below both mean YOU: do the next step now. Do not call the handoff tool unless your own context grows past the warning threshold.\n\n## Brief\n${handoff.brief}\n\n## Facts from the previous session\nPrevious session file: ${handoff.sessionFile ?? "unknown"}\nRepository (git facts below): ${handoff.cwd}\n${facts}\n\nContinue as Root under planner-only; the brief is authoritative.`;
}

/** Starts the new Root session from the pending brief; on failure or cancel the brief stays for a manual retry. */
async function dispatchHandoff({ git, session }: PlannerRuntime, handoff: PendingHandoff, ctx: ExtensionCommandContext): Promise<void> {
	const prompt = handoffPrompt(handoff, await gatherGitFacts(git, handoff.cwd));
	const mode = loadConfig().handoffMode;
	try {
		const result = await ctx.newSession({ parentSession: handoff.sessionFile, withSession: async (rctx) => {
			rctx.ui.notify("planner-only: handoff from previous session", "info");
			if (mode === "confirm") {
				rctx.ui.setEditorText(prompt);
				rctx.ui.notify("Handoff ready. Submit when ready.", "info");
			} else await rctx.sendUserMessage(prompt);
		} });
		if (result?.cancelled) {
			session.deferHandoff(handoff);
			ctx.ui.notify("handoff cancelled; run /planner-only handoff to retry, or /planner-only handoff drop to discard it", "warning");
		} else session.clearPendingHandoff();
	} catch (error) {
		session.deferHandoff(handoff);
		const reason = error instanceof Error ? error.message : String(error);
		ctx.ui.notify(`handoff failed (${reason}); run /planner-only handoff to retry, or /planner-only handoff drop to discard it`, "warning");
	}
}

/** `/planner-only handoff [goal]`: asks Root for a brief, or dispatches the one already scheduled. */
async function commandHandoff(runtime: PlannerRuntime, goal: string, ctx: ExtensionCommandContext): Promise<void> {
	const { pi, session } = runtime;
	if (!session.pendingHandoff) {
		session.requestHandoff();
		pi.sendUserMessage(`[planner-only] The user asked for a handoff${goal ? ` (next goal: ${goal})` : ""}. Call the handoff tool now with a complete brief.`, ctx.isIdle?.() ? undefined : { deliverAs: "followUp" });
		return;
	}
	await dispatchHandoff(runtime, session.pendingHandoff, ctx);
}

function setEnabled(runtime: PlannerRuntime, enabled: boolean): void {
	if (enabled) rmSync(OFF_MARKER, { force: true });
	else {
		runtime.session.clearPendingHandoff();
		mkdirSync(dirname(OFF_MARKER), { recursive: true });
		writeFileSync(OFF_MARKER, "");
	}
	syncTools(runtime);
}

function notifyStatus(session: PlannerSession, ctx: ExtensionContext): void {
	updateStatus(session, ctx);
	const env = process.env.PI_PLANNER_ONLY ? ` (PI_PLANNER_ONLY=${process.env.PI_PLANNER_ONLY} overrides the marker)` : "";
	ctx.ui.notify(`planner-only ${isEnabled() ? "on" : "off"}${isStrict() ? ", strict" : ""}${env}\n${statusTotals(session)}`, "info");
}

async function plannerCommand(runtime: PlannerRuntime, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const raw = args.trim();
	const cmd = raw.toLowerCase();
	if (cmd === "handoff drop") {
		runtime.session.dropHandoff();
		ctx.ui.notify("handoff dropped", "info");
		return;
	}
	if (cmd === "handoff" || cmd.startsWith("handoff ")) {
		await commandHandoff(runtime, raw.slice("handoff".length).trim(), ctx);
		return;
	}
	if (cmd === "on" || cmd === "off") setEnabled(runtime, cmd === "on");
	notifyStatus(runtime.session, ctx);
}

/** After Root's turn: kick off a scheduled handoff through the command so it runs outside the tool call. */
function onAgentSettled({ pi, session, host }: PlannerRuntime): void {
	if (!isEnabled()) {
		session.clearPendingHandoff();
		return;
	}
	if (!session.pendingHandoff || session.pendingHandoff.manualOnly) return;
	try { pi.sendUserMessage("/planner-only handoff", { expandPromptTemplates: true }); }
	catch {
		session.clearPendingHandoff();
		host.sendMessage({ customType: "planner-only-handoff", content: "[planner-only] Handoff dispatch failed; run /planner-only handoff manually.", display: true });
	}
}

function onMessageEnd({ host, session }: PlannerRuntime, message: Parameters<typeof rootUsageOf>[0], ctx: ExtensionContext): void {
	const usage = rootUsageOf(message);
	if (!usage) return;
	const context = host.contextTokens(ctx) ?? usage.context;
	session.recordRootTurn(usage, context);
	if (isEnabled() && session.claimContextWarning()) sendContextWarning(host, context);
	updateStatus(session, ctx);
}

export default function plannerOnly(pi: ExtensionAPI, hostAdapter?: HostAdapter): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	const git: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};
	const runtime: PlannerRuntime = { pi, git, host: hostAdapter ?? createHostAdapter(pi), session: new PlannerSession() };
	const { session } = runtime;

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: "Run one child agent on a self-contained task and wait for it. Returns the child's report, host status and usage, and a git summary of what changed. Worth it for multi-file work or long reading; outside strict mode, do small tasks (about ≤2 files) yourself.",
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
		execute: (_toolCallId, params: DelegationParams, signal, onUpdate, ctx) =>
			executeDelegate(runtime, params, signal, (text) => onUpdate?.(textResult(text, {})), ctx),
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
		execute: (_toolCallId, params: GitAuditRequest & { cwd?: string }, _signal, _onUpdate, ctx) => executeGitAudit(git, params, ctx),
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
		execute: (_toolCallId, params: { message: string; paths?: string[]; cwd?: string }, _signal, _onUpdate, ctx) => executeGitCommit(git, params, ctx),
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
		execute: async (_toolCallId, params: { brief: string; cwd?: string }, _signal, _onUpdate, ctx) => executeHandoff(session, runtime.host, params, ctx),
	});

	pi.registerCommand("planner-only", {
		description: "planner-only on | off | status | handoff [goal]",
		handler: (args, ctx) => plannerCommand(runtime, args, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		session.reset();
		syncTools(runtime);
		updateStatus(session, ctx);
	});

	pi.on("agent_settled", async () => onAgentSettled(runtime));

	pi.on("before_agent_start", async (event) => {
		if (isEnabled()) {
			const sel = event.systemPromptOptions?.selectedTools;
			if (sel) {
				const kept = sel.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
				event.systemPromptOptions.selectedTools = [...kept, ...PLUGIN_TOOLS.filter((t) => !kept.includes(t))];
			}
		}
		syncTools(runtime);
		if (!isEnabled()) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${plannerPrompt(isStrict(), loadConfig().limits)}` };
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
		session.noteCompacted();
		updateStatus(session, ctx);
	});

	pi.on("message_end", async (event, ctx) => onMessageEnd(runtime, event.message, ctx));
}
