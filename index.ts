/**
 * pi-planner-only: Native adds a neutral delegation instruction; Lite supplies
 * four tools, a short prompt, optional strict mode, and a cost line. Mode
 * preferences and session selection persist; delegated tasks have no ledger.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGENT_DIR, DEFAULT_LIMITS, loadConfig } from "./config.ts";
import type { DelegationLimits, PlannerMode } from "./config.ts";
import { ROLES, createCwdLocks, formatTimeoutLimit, runDelegation } from "./delegate.ts";
import type { DelegationParams, Role } from "./delegate.ts";
import { formatSeconds, formatTokens } from "./format.ts";
import { createHostAdapter, rootUsageOf } from "./host.ts";
import type { HostAdapter } from "./host.ts";
import { heatColor } from "./status-color.ts";
import type { HostColor } from "./status-color.ts";
export { rootUsageOf } from "./host.ts";
import { GIT_AUDIT_OPERATIONS, gitCommit, runGitAudit } from "./git.ts";
import type { GitAuditRequest, GitRunner } from "./git.ts";
import { loadArtifactDir } from "./subagent-artifacts.ts";
import { RootHandoff, handoffMode, handoffModeSetting, takeHandoffMode } from "./handoff.ts";
export { HANDOFF_PREFERENCE, handoffMode, formatStatusLines } from "./handoff.ts";

export const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
export const MODE_PREFERENCE = join(AGENT_DIR, "planner-only.mode");
const MODE_ENTRY = "planner-only-mode";
export const NATIVE_PROMPT = "实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。";
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

/** Legacy query for whether the fresh-session selection enables the Lite layer. */
export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
	return initialMode(env) === "lite";
}

function preference(): PlannerMode | undefined {
	try {
		const value = readFileSync(MODE_PREFERENCE, "utf8").trim();
		return value === "off" || value === "native" || value === "lite" ? value : undefined;
	} catch { return undefined; }
}

/** Explicit mode, legacy flag, persisted preference, legacy marker, default. */
export function initialMode(env: NodeJS.ProcessEnv = process.env): PlannerMode {
	const config = loadConfig(env);
	return config.mode ?? (config.enabled === undefined ? undefined : config.enabled ? "lite" : "off")
		?? preference() ?? (existsSync(OFF_MARKER) ? "off" : "lite");
}

export function isStrict(env: NodeJS.ProcessEnv = process.env): boolean {
	return loadConfig(env).strict;
}

export function plannerPrompt(strict: boolean, limits: DelegationLimits = DEFAULT_LIMITS): string {
	return [
		"[PLANNER-ONLY]",
		"You plan and review; children do most work via `delegate`.",
		strict
			? "- Strict mode: no edit, write, or bash; delegate implementation to \"worker\", checks to \"validator\"."
			: "- Do small things yourself (about ≤2 files or ≤10 minutes); send larger implementation straight to \"worker\".",
		"- Roles: \"explorer\" for reading-heavy logs/transcripts, findings only; \"validator\" runs checks and writes nothing; \"reviewer\" has no shell, uncommitted changes only: review before git_commit.",
		"- Children see only `task` and cannot ask mid-run. Decide scope, public interfaces, cross-module approach, and data flow first. Send an explorer first only when unknown facts could change those decisions or the split; local search, adjacent code, and tests stay with the executor.",
		"- Batch independent, lock-compatible tasks; role combinations are in the delegate description.",
		"- One delegation = one deliverable checkable on its own; fold setup in; merge edits sharing a check.",
		`- A child has ${formatTimeoutLimit(limits.timeoutMs)}. Do not delegate work that needs longer; split it.`,
		"- For another repository, pass `cwd` to delegate, git_audit, and git_commit.",
		"- Check diffs and output before accepting. Before reverting or reporting a child's change, check it against your task: yours or its own?",
		"- If a child fails, times out, or reports BLOCKED, first decide why, then delegate a corrected task (add context, settle the interface, split only if too big) with its report or last tool results (a timed-out child returns them) before doing the work yourself.",
		"- After accepting, commit with git_commit: pass paths when the work tree has unrelated changes.",
	].join("\n");
}

export interface RoleStats {
	calls: number;
	completed: number;
	timed_out: number;
	otherFailed: number;
	refused: number;
	durationMs: number;
	durationMissing: number;
}

export const emptyRoleStats = (): Record<Role, RoleStats> => ({
	worker: { calls: 0, completed: 0, timed_out: 0, otherFailed: 0, refused: 0, durationMs: 0, durationMissing: 0 },
	explorer: { calls: 0, completed: 0, timed_out: 0, otherFailed: 0, refused: 0, durationMs: 0, durationMissing: 0 },
	validator: { calls: 0, completed: 0, timed_out: 0, otherFailed: 0, refused: 0, durationMs: 0, durationMissing: 0 },
	reviewer: { calls: 0, completed: 0, timed_out: 0, otherFailed: 0, refused: 0, durationMs: 0, durationMissing: 0 },
});

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
 * Root accounting, Mode and Delegation state. Conversation-scoped fields are cleared by `reset()`
 * on session start; the process-scoped ones (`locks`, `delegationsInFlight`,
 * `hidLoader`) outlive a session because they track children and host tools
 * that do too.
 */
export class PlannerSession {
	/** Per-cwd child locks: worker/validator exclusive, explorers shared (owned by the delegation engine). */
	readonly locks = createCwdLocks();
	delegationsInFlight = 0;
	/** Whether we hid pi-subagents' loader tool and must restore it on `off`. */
	hidLoader = false;
	/** Native restores only the host tools that Lite actually hid. */
	hiddenNativeTools = new Set<string>();
	mode: PlannerMode = initialMode();
	modeBound = false;
	modeSessionId: string | undefined;
	totals: CostTotals = emptyTotals();
	roleStats: Record<Role, RoleStats> = emptyRoleStats();
	rootContext: number | undefined;
	contextWarned = false;
	nativeChild: { tokens: number; cost: number } | undefined;
	nativeGeneration = 0;

	reset(): void {
		this.totals = emptyTotals();
		this.roleStats = emptyRoleStats();
		this.rootContext = undefined;
		this.contextWarned = false;
		this.nativeChild = undefined;
		this.nativeGeneration++;
	}

	async trackDelegation<T>(run: () => Promise<T>): Promise<T> {
		this.delegationsInFlight += 1;
		try {
			return await run();
		} finally {
			this.delegationsInFlight -= 1;
		}
	}

	recordRoleDelegation(role: Role, status: string, durationMs?: number): void {
		const stats = this.roleStats[role];
		if (!stats) return;
		stats.calls += 1;
		if (status === "refused") {
			stats.refused += 1;
			return;
		}
		if (status === "completed") {
			stats.completed += 1;
		} else if (status === "timed_out") {
			stats.timed_out += 1;
		} else {
			stats.otherFailed += 1;
		}
		if (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0) {
			stats.durationMs += durationMs;
		} else {
			stats.durationMissing += 1;
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
}

interface PlannerRuntime {
	pi: ExtensionAPI;
	git: GitRunner;
	host: HostAdapter;
	session: PlannerSession;
	handoff: RootHandoff;
}

function modeOf({ session }: Pick<PlannerRuntime, "session">): PlannerMode {
	// Preserve the old live PI_PLANNER_ONLY flag behavior; explicit MODE selects new sessions.
	const enabled = loadConfig().enabled;
	return loadConfig().mode === undefined && enabled !== undefined ? enabled ? "lite" : "off" : session.mode;
}

function busy(session: PlannerSession): boolean {
	return session.delegationsInFlight > 0 || session.locks.size > 0;
}

const BUSY_MODE_MESSAGE = "mode change refused: Lite delegation is still running or its cwd remains held";

function guardSessionBoundary(runtime: PlannerRuntime, ctx: ExtensionContext): { cancel: true } | undefined {
	if (!busy(runtime.session)) return;
	if (ctx.hasUI) ctx.ui.notify(BUSY_MODE_MESSAGE, "warning");
	return { cancel: true };
}

function sessionEntry(ctx: ExtensionContext): PlannerMode | undefined {
	const entries = ctx.sessionManager?.getBranch?.() ?? [];
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === MODE_ENTRY) {
			const mode = (entry.data as { mode?: unknown } | undefined)?.mode;
			if (mode === "off" || mode === "native" || mode === "lite") return mode;
		}
	}
	return undefined;
}

function bindMode(runtime: PlannerRuntime, reason: string | undefined, ctx: ExtensionContext): boolean {
	const { session, pi } = runtime;
	const recorded = sessionEntry(ctx);
	const sessionId = ctx.sessionManager?.getSessionId?.();
	const fresh = reason === "new" || (!recorded && (!session.modeBound || (!!sessionId && session.modeSessionId !== sessionId)));
	const selected = fresh ? (reason === "new" ? takeHandoffMode() : undefined) ?? initialMode() : recorded ?? session.mode;
	if (selected !== modeOf(runtime) && busy(session)) return false;
	session.mode = selected;
	session.modeBound = true;
	session.modeSessionId = sessionId;
	if (fresh && typeof pi.appendEntry === "function") pi.appendEntry(MODE_ENTRY, { mode: selected });
	return true;
}

const textResult = <T>(text: string, details: T) => ({ content: [{ type: "text" as const, text }], details });
const refusal = (text: string) => textResult(text, { ok: false });

function statusTotals(session: PlannerSession): string {
	const ctx = session.rootContext && session.rootContext > 0 ? ` · ctx ${formatTokens(session.rootContext)}` : "";
	return `${formatTotals(session.totals)}${ctx}`;
}

function nativeTotals(session: PlannerSession): string {
	const child = session.nativeChild;
	const context = session.rootContext ? ` · ctx ${formatTokens(session.rootContext)}` : "";
	return `root ${formatTokens(session.totals.rootTokens)} $${session.totals.rootCost.toFixed(3)} · child ${child ? `≥${formatTokens(child.tokens)} ≥$${child.cost.toFixed(3)}` : "unavailable"}${context}`;
}

/** The theme surface the status line needs; `style` and `colors` exist only on pi >= 0.99. */
interface StatusTheme {
	fg: ExtensionContext["ui"]["theme"]["fg"];
	style?: unknown;
	colors?: unknown;
}

/** 0 at an empty context, 0.5 at half the warning threshold, 1 at the threshold and beyond. */
function contextHeat(session: PlannerSession): number {
	const threshold = contextWarnThreshold();
	if (!session.rootContext || session.rootContext <= 0 || threshold <= 0) return 0;
	return Math.min(session.rootContext / threshold, 1);
}

/**
 * Cool-to-hot status text: the theme accent at an empty context, the warning
 * color at half the threshold, the error color at the threshold. Hosts before
 * pi 0.99 have no theme `style`/`colors` and keep the plain warning/error tokens.
 */
function statusText(theme: StatusTheme, session: PlannerSession, mode: PlannerMode, label: string): string {
	if (mode === "off") return theme.fg("muted", label);
	const colors = theme.colors as Partial<Record<"accent" | "warning" | "error", HostColor>> | undefined;
	const style = theme.style;
	if (typeof style === "function" && colors?.accent && colors.warning && colors.error) {
		const fg = heatColor(contextHeat(session), colors.accent, colors.warning, colors.error);
		return (style as (text: string, options: { fg: HostColor }) => string).call(theme, label, { fg });
	}
	return theme.fg(session.highContext ? "error" : "warning", label);
}

function updateStatus(session: PlannerSession, ctx: ExtensionContext, mode: PlannerMode = session.mode): void {
	if (!ctx.hasUI) return;
	const label = mode === "lite" ? `planner-only${isStrict() ? " (strict)" : ""} · ${statusTotals(session)}` : mode === "native" ? `planner-only: native · ${nativeTotals(session)}` : `planner-only: ${mode}`;
	ctx.ui.setStatus(STATUS_KEY, statusText(ctx.ui.theme, session, mode, label));
}

/** Adds our tools and hides pi-subagents' loader while enabled; restores both when off. */
function syncTools(runtime: PlannerRuntime): void {
	const { pi, session } = runtime;
	const active = pi.getActiveTools();
	const ours = new Set<string>(PLUGIN_TOOLS);
	let next: string[];
	if (modeOf(runtime) === "lite") {
		for (const tool of HIDDEN_HOST_TOOLS) if (active.includes(tool)) session.hiddenNativeTools.add(tool);
		session.hidLoader ||= active.includes("subagents_enable");
		next = [...active, ...PLUGIN_TOOLS.filter((t) => !active.includes(t))]
			.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
	} else {
		next = active.filter((t) => !ours.has(t));
		if (modeOf(runtime) === "native" && !next.includes("handoff")) next.push("handoff");
		const restore = modeOf(runtime) === "native" ? session.hiddenNativeTools : session.hidLoader ? new Set(["subagents_enable"]) : new Set<string>();
		for (const tool of restore) if (!next.includes(tool)) next.push(tool);
		session.hidLoader = false;
		if (modeOf(runtime) === "native") session.hiddenNativeTools.clear();
	}
	if (next.length !== active.length || next.some((t, i) => t !== active[i])) pi.setActiveTools(next);
}

function sendContextWarning(host: HostAdapter, tokens: number): void {
	const advice = handoffMode() === "off"
		? "At a task boundary, suggest the user run /planner-only handoff for a fresh session from a brief, or use /compact with what to keep if the context is mostly stale exploration. This is advisory; do not initiate a handoff."
		: handoffMode() === "confirm"
			? "Finish the current bounded operation, then prepare a complete handoff brief with the handoff tool, even when continuing the same large task; the fresh session opens with the brief in the editor for the user to submit. Do not fabricate a brief or force a session replacement."
			: "Finish the current bounded operation, then prepare a complete handoff brief with the handoff tool, even when continuing the same large task; auto mode submits it in a fresh session automatically. Do not fabricate a brief or force a session replacement.";
	host.sendMessage({
		customType: "planner-only-context",
		content: `[planner-only] Root context is about ${formatTokens(tokens)} tokens (warning threshold ${formatTokens(contextWarnThreshold())}); every turn re-reads it. From now on delegate reading-heavy and multi-file work. ${advice}`,
		display: true,
	}, { deliverAs: "steer" });
}

async function executeDelegate(
	runtime: PlannerRuntime,
	params: DelegationParams,
	signal: AbortSignal | undefined,
	onUpdate: ((text: string) => void) | undefined,
	ctx: ExtensionContext,
) {
	if (modeOf(runtime) !== "lite") return refusal("Delegate unavailable: planner-only Lite mode is inactive.");
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
	const { usage, status, role } = outcome.details;
	session.recordRoleDelegation(role, status, usage?.durationMs);
	if (session.recordChildRun(status, usage)) updateStatus(session, ctx);
	return textResult(outcome.text, outcome.details);
}

async function executeGitAudit(runtime: PlannerRuntime, params: GitAuditRequest & { cwd?: string }, ctx: ExtensionContext) {
	if (modeOf(runtime) !== "lite") return refusal("Git audit unavailable: planner-only Lite mode is inactive.");
	const { git } = runtime;
	const { cwd, ...request } = params;
	// Models often send optional fields as ""; treat an empty path as "no path filter".
	if (request.path === "") delete request.path;
	const outcome = await runGitAudit(git, request, resolveCwd(ctx, cwd));
	return textResult(outcome.text, { ok: outcome.ok });
}

async function executeGitCommit(runtime: PlannerRuntime, params: { message: string; paths?: string[]; cwd?: string }, ctx: ExtensionContext) {
	if (modeOf(runtime) !== "lite") return refusal("Git commit unavailable: planner-only Lite mode is inactive.");
	const { git } = runtime;
	const outcome = await gitCommit(git, resolveCwd(ctx, params.cwd), params.message, params.paths);
	return textResult(outcome.text, { ok: outcome.ok });
}

function setEnabled(runtime: PlannerRuntime, enabled: boolean): void {
	if (busy(runtime.session) && modeOf(runtime) !== (enabled ? "lite" : "off")) return;
	if (enabled) rmSync(OFF_MARKER, { force: true });
	else {
		runtime.handoff.deactivate();
		mkdirSync(dirname(OFF_MARKER), { recursive: true });
		writeFileSync(OFF_MARKER, "");
	}
	mkdirSync(dirname(MODE_PREFERENCE), { recursive: true });
	writeFileSync(MODE_PREFERENCE, enabled ? "lite\n" : "off\n");
	runtime.session.mode = enabled ? "lite" : "off";
	runtime.session.modeBound = true;
	runtime.pi.appendEntry?.(MODE_ENTRY, { mode: runtime.session.mode });
	syncTools(runtime);
}

function formatRoleSummary(stats: RoleStats): string {
	const parts = [
		`${stats.completed} completed`,
		stats.timed_out ? `${stats.timed_out} timed_out` : "",
		stats.otherFailed ? `${stats.otherFailed} incomplete` : "",
		stats.refused ? `${stats.refused} refused` : "",
	].filter(Boolean).join(", ");
	const counts = parts ? `(${parts})` : "(0 completed)";
	const knownRuns = (stats.completed + stats.timed_out + stats.otherFailed) - stats.durationMissing;
	let dur = "";
	if (knownRuns > 0 && stats.durationMissing > 0) {
		dur = ` · cumulative duration ${formatSeconds(stats.durationMs)} (+${stats.durationMissing} missing)`;
	} else if (knownRuns > 0) {
		dur = ` · cumulative duration ${formatSeconds(stats.durationMs)}`;
	} else if (stats.durationMissing > 0) {
		dur = ` · cumulative duration missing (${stats.durationMissing})`;
	}
	return `${stats.calls} call${stats.calls === 1 ? "" : "s"} ${counts}${dur}`;
}

function notifyStatus(runtime: PlannerRuntime, ctx: ExtensionContext): void {
	const { session } = runtime;
	const mode = modeOf(runtime);
	const handoff = handoffModeSetting(process.env);
	updateStatus(session, ctx, mode);
	const env = process.env.PI_PLANNER_ONLY_MODE?.trim() ? ` (PI_PLANNER_ONLY_MODE=${process.env.PI_PLANNER_ONLY_MODE} selects new sessions)`
		: process.env.PI_PLANNER_ONLY ? ` (PI_PLANNER_ONLY=${process.env.PI_PLANNER_ONLY} overrides the marker)` : "";
	const roleLines = (ROLES as readonly Role[])
		.filter((r) => session.roleStats[r]?.calls > 0)
		.map((r) => `  ${r}: ${formatRoleSummary(session.roleStats[r])}`);
	const roleBlock = roleLines.length ? `\nRole stats (current session; completed = runtime terminal; cumulative duration includes concurrent child time, not total wall time):\n${roleLines.join("\n")}` : "";
	ctx.ui.notify(`planner-only ${mode === "lite" ? "on" : mode}${mode === "lite" && isStrict() ? ", strict" : ""}${env}; next fresh session: ${initialMode()}${preference() ? ` (preference: ${preference()})` : ""}; handoff: ${handoff.mode} (source: ${handoff.source})${mode === "native" ? `\n${nativeTotals(session)}\nChild usage is a recorded lower bound; missing or incomplete workflow receipts may omit usage.` : mode === "lite" ? `\n${statusTotals(session)}${roleBlock}` : ""}`, "info");
}

async function plannerCommand(runtime: PlannerRuntime, args: string, ctx: ExtensionCommandContext): Promise<void> {
	const raw = args.trim();
	const cmd = raw.toLowerCase();
	if (await runtime.handoff.command(raw, ctx)) return;
	if (cmd === "native" || cmd === "lite") {
		mkdirSync(dirname(MODE_PREFERENCE), { recursive: true });
		writeFileSync(MODE_PREFERENCE, `${cmd}\n`);
	} else if (cmd === "on" || cmd === "off") {
		if (busy(runtime.session) && modeOf(runtime) !== (cmd === "on" ? "lite" : "off")) {
			ctx.ui.notify(BUSY_MODE_MESSAGE, "warning");
			return;
		}
		setEnabled(runtime, cmd === "on");
	}
	notifyStatus(runtime, ctx);
}

function onMessageEnd(runtime: PlannerRuntime, message: Parameters<typeof rootUsageOf>[0], ctx: ExtensionContext): void {
	if (modeOf(runtime) === "off") return;
	const { host, session } = runtime;
	const usage = rootUsageOf(message);
	if (!usage) return;
	const context = host.contextTokens(ctx) ?? usage.context;
	session.recordRootTurn(usage, context);
	if (session.claimContextWarning()) sendContextWarning(host, context);
	updateStatus(session, ctx);
}

export default function plannerOnly(pi: ExtensionAPI, hostAdapter?: HostAdapter): void {
	if (process.env.PI_SUBAGENT_CHILD === "1") return;

	const git: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};
	const session = new PlannerSession();
	const host = hostAdapter ?? createHostAdapter(pi);
	const handoff = new RootHandoff({ pi, git, host, activity: session, mode: () => modeOf({ session }) });
	const runtime: PlannerRuntime = { pi, git, host, session, handoff };
	let nativeContext: ExtensionContext | undefined;
	let cancelNativeRequest: (() => void) | undefined;
	const refreshNativeCost = (ctx: ExtensionContext): void => {
		if (modeOf(runtime) !== "native") return;
		const sessionId = ctx.sessionManager.getSessionId();
		if (!sessionId) return;
		cancelNativeRequest?.();
		const generation = ++session.nativeGeneration;
		const requestId = randomUUID();
		const replyEvent = `subagents:rpc:v1:reply:${requestId}`;
		const current = () => modeOf(runtime) === "native" && session.nativeGeneration === generation && ctx.sessionManager.getSessionId() === sessionId;
		const timer = setTimeout(() => {
			if (cancelNativeRequest === cancel) cancel();
			if (current()) { session.nativeChild = undefined; updateStatus(session, ctx); }
		}, 5000);
		timer.unref();
		const unsubscribe = host.events.on(replyEvent, (raw: unknown) => {
			if (cancelNativeRequest === cancel) cancel();
			if (!current()) return;
			const reply = raw as { version?: unknown; requestId?: unknown; success?: unknown; data?: { version?: unknown; childTotal?: Record<string, unknown> } } | undefined;
			const u = reply?.data?.childTotal;
			const values = [u?.input, u?.output, u?.cacheRead, u?.cacheWrite, u?.cost];
			if (reply?.version !== 1 || reply.requestId !== requestId || reply.success !== true || reply.data?.version !== 1 || !values.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
				session.nativeChild = undefined;
			} else {
				const [input, output, cacheRead, cacheWrite, cost] = values as number[];
				session.nativeChild = { tokens: input + output + cacheRead + cacheWrite, cost };
			}
			updateStatus(session, ctx);
		});
		const cancel = () => { clearTimeout(timer); unsubscribe(); cancelNativeRequest = undefined; };
		cancelNativeRequest = cancel;
		host.events.emit("subagents:rpc:v1:request", { version: 1, requestId, method: "cost" });
	};
	const unsubscribeNativeComplete = host.events.on("subagent:async-complete", (raw: unknown) => {
		const event = raw as { sessionId?: unknown } | undefined;
		if (nativeContext && event?.sessionId === nativeContext.sessionManager.getSessionId()) refreshNativeCost(nativeContext);
	});

	pi.registerTool({
		name: "delegate",
		label: "Delegate",
		description: "Run one child agent on a self-contained task and wait for it. Returns the child's report, host status and usage, and a git summary of what changed. Worth it for multi-file work or long reading; outside strict mode, do small tasks (about ≤2 files) yourself. Batch calls in one message only when independent and lock-compatible: independent explorers may run together; a reviewer or another repository may run alongside; after implementation, a still-needed validator may join a reviewer only if the reviewer needs no check result and the checks change no source; do not batch worker and validator in one repository, where the second is refused and counted. Deliverables that require writing files (scripts, reports, output files) go to worker, not validator or reviewer. Runs that outlast the child time limit take two delegations: first implement the change and start the run as a background job that returns immediately with the job id, output path, and completion condition (an output file, exit code, or log marker); after the run finishes, delegate acceptance separately. While a background job runs, send only one bounded status check per job at a time; do not repeat identical wait commands in one turn. A \"completed\" result only means the child run ended; in your reply distinguish implementation done, checks passed, and real run passed.",
		promptSnippet: "delegate: hand a self-contained task to a cheaper child agent (worker, explorer, validator, reviewer)",
		parameters: Type.Object({
			role: Type.Union(ROLES.map((r) => Type.Literal(r)), {
				description: "worker: implement, including any deliverable that is a written file; explorer: search/read code, logs, or transcripts and return findings; validator: run existing checks only, writes no files; reviewer: independent read-only review; no shell, sees files and uncommitted changes (review before committing); for committed changes use base to supply the complete range diff.",
			}),
			task: Type.String({
				minLength: 1,
				description: "Self-contained task: goal as an observable result; scope (files/functions, what must not change); decisions already made (public interfaces, implementation approach, existing code to reuse; pseudocode only where a key algorithm is still ambiguous); acceptance with key edge cases; the exact check command and expected result. Ask only for checks that finish well within the child's time limit; keep long jobs (full pipelines, large data processing) out of the task and run them outside delegation (yourself, or hand them to the user). The child does not see this conversation.",
			}),
			cwd: Type.Optional(Type.String({
				description: "The repository or directory the child works in. Set it when the target is not the session cwd; the diff summary uses it, and the lock covers its whole repository.",
			})),
			base: Type.Optional(Type.String({ description: "Reviewer only: committed range base (HEAD, HEAD~N, named ref, or full commit ID). Requires a clean worktree, changed blobs at most 1 MiB each, and a nonempty text diff up to 32 KiB." })),
			timeoutSeconds: Type.Optional(Type.Integer({
				minimum: 1,
				maximum: 86400,
				description: "Per-delegation wall-clock timeout in seconds (1..86400). Defaults to the PI_PLANNER_ONLY_TIMEOUT_MS value in milliseconds (default 600000 = 10 minutes). Overrides only this run.",
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
		execute: (_toolCallId, params: GitAuditRequest & { cwd?: string }, _signal, _onUpdate, ctx) => executeGitAudit(runtime, params, ctx),
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
		execute: (_toolCallId, params: { message: string; paths?: string[]; cwd?: string }, _signal, _onUpdate, ctx) => executeGitCommit(runtime, params, ctx),
	});

	pi.registerTool({
		name: "handoff",
		label: "Handoff",
		description: "Start a fresh Root session from a complete, self-contained brief when the user asks or the context warning says to.",
		promptSnippet: "handoff: continue in a fresh session from a brief when the user asks",
		parameters: Type.Object({
			brief: Type.String({ minLength: 200, description: "Self-contained brief for the next Root session: goal, decisions made, approaches ruled out and why, constraints, relevant files/specs, what is done, how it was verified (command -> result; mark anything not verified as unverified), open items, known pitfalls, and the exact next step." }),
			cwd: Type.Optional(Type.String({ description: REPO_CWD_DESCRIPTION })),
		}),
		execute: async (_toolCallId, params: { brief: string; cwd?: string }, _signal, _onUpdate, ctx) => handoff.schedule(params, ctx),
	});

	pi.registerCommand("planner-only", {
		description: "planner-only on | off | native | lite | status | handoff-mode [off|confirm|auto] | handoff [goal]",
		handler: (args, ctx) => plannerCommand(runtime, args, ctx),
	});

	pi.on("session_start", async (event, ctx) => {
		if (!bindMode(runtime, event.reason, ctx)) {
			ctx.ui.notify(BUSY_MODE_MESSAGE, "warning");
			return;
		}
		cancelNativeRequest?.();
		session.reset();
		nativeContext = ctx;
		handoff.reset();
		syncTools(runtime);
		updateStatus(session, ctx, modeOf(runtime));
	});
	pi.on("session_before_switch", async (_event, ctx) => guardSessionBoundary(runtime, ctx));
	pi.on("session_before_fork", async (_event, ctx) => guardSessionBoundary(runtime, ctx));
	pi.on("session_before_tree", async (_event, ctx) => guardSessionBoundary(runtime, ctx));
	pi.on("session_tree", async (_event, ctx) => {
		cancelNativeRequest?.();
		if (bindMode(runtime, "resume", ctx)) syncTools(runtime);
		nativeContext = ctx;
		session.nativeChild = undefined;
		session.nativeGeneration++;
		updateStatus(session, ctx, modeOf(runtime));
		refreshNativeCost(ctx);
	});

	pi.on("agent_settled", async () => { handoff.settled(); if (nativeContext) refreshNativeCost(nativeContext); });
	pi.on("session_shutdown", async () => { handoff.deactivate(); cancelNativeRequest?.(); unsubscribeNativeComplete(); nativeContext = undefined; session.nativeGeneration++; });

	pi.on("before_agent_start", async (event) => {
		if (modeOf(runtime) === "lite") {
			const sel = event.systemPromptOptions?.selectedTools;
			if (sel) {
				const kept = sel.filter((t) => !HIDDEN_HOST_TOOL_SET.has(t));
				event.systemPromptOptions.selectedTools = [...kept, ...PLUGIN_TOOLS.filter((t) => !kept.includes(t))];
			}
		}
		else {
			const sel = event.systemPromptOptions?.selectedTools;
			if (sel) {
				const kept = sel.filter((t) => !PLUGIN_TOOLS.includes(t as typeof PLUGIN_TOOLS[number]));
				if (modeOf(runtime) === "native") kept.push("handoff");
				event.systemPromptOptions.selectedTools = kept;
			}
		}
		syncTools(runtime);
		if (modeOf(runtime) === "native") return { systemPrompt: `${event.systemPrompt}\n\n${NATIVE_PROMPT}` };
		if (modeOf(runtime) !== "lite") return;
		return { systemPrompt: `${event.systemPrompt}\n\n${plannerPrompt(isStrict(), loadConfig().limits)}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		if (modeOf(runtime) !== "lite") return;
		if (HIDDEN_HOST_TOOL_SET.has(event.toolName)) {
			return { block: true, reason: `planner-only: use the delegate tool instead of ${event.toolName}.` };
		}
		if (!isStrict() || !STRICT_BLOCKED_TOOLS.has(event.toolName)) return;
		if (ctx.hasUI) ctx.ui.notify(`planner-only strict: blocked ${event.toolName}`, "warning");
		return { block: true, reason: `planner-only strict mode: Root may not use ${event.toolName}. Delegate it (role "worker" to change files, "validator" to run commands).` };
	});

	pi.on("session_compact", async (_event, ctx) => {
		session.noteCompacted();
		updateStatus(session, ctx, modeOf(runtime));
	});

	pi.on("message_end", async (event, ctx) => { onMessageEnd(runtime, event.message, ctx); if (event.message.role === "assistant") refreshNativeCost(ctx); });
}
