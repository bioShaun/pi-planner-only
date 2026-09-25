/**
 * One delegation = one child run through pi-subagents structured delegation.
 *
 * The child returns plain text. Root gets that text, the host's status and
 * usage, and a Git summary of what changed. Nothing is persisted: children
 * run in-process and end with Root.
 */
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { DEFAULT_LIMITS, loadLimits } from "./config.ts";
import type { DelegationLimits } from "./config.ts";
import { clip, clipHeadTail, collapseWs, formatSeconds, formatTokens, formatUsage } from "./format.ts";
import { captureBase, gitSafePrefix, summarizeWork } from "./git.ts";
import type { GitRunner } from "./git.ts";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_STARTED_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";
import type {
	SubagentDelegationIdentity,
	SubagentDelegationRequest,
	SubagentDelegationResponse,
	SubagentDelegationUpdate,
	SubagentDelegationUsage,
} from "./subagent-delegation-contract.ts";
import { resolveArtifacts } from "./subagent-artifacts.ts";
import type { ArtifactDir } from "./subagent-artifacts.ts";

export const ROLES = ["worker", "explorer", "validator", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Builtin pi-subagents agents. Models come from the operator's
 * `subagents.agentOverrides` in pi settings, not from this plugin.
 * Every agent except reviewer has bash or write, so it holds the cwd.
 */
export const ROLE_AGENTS: Record<Role, { agent: string; exclusive: boolean; closing: string }> = {
	worker: {
		agent: "worker",
		exclusive: true,
		closing: "When you finish, end with a short report (3-10 lines): what you changed, how you verified it (commands and results), and anything left undone.",
	},
	explorer: {
		agent: "scout",
		exclusive: true,
		closing: "Do not modify project files; writing the report/output file the runtime names is allowed. End with the findings Root asked for, as compact as possible (paths, line numbers, short excerpts).",
	},
	validator: {
		agent: "oracle",
		exclusive: true,
		closing: "Do not modify any files. Run the requested checks and report each command with its exit code and the relevant failure lines.",
	},
	reviewer: {
		agent: "reviewer",
		exclusive: false,
		closing: "Do not modify any files. End with `VERDICT: PASS` or `VERDICT: CHANGES REQUESTED` followed by the concrete reasons.",
	},
};

export { DEFAULT_LIMITS, loadLimits };
export type { DelegationLimits };

export interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

/**
 * Per-cwd exclusivity for children that may write. One owner: created once
 * by the extension, shared by every delegation and by the handoff guard.
 */
export interface CwdLocks {
	/** Hold `cwd`; null when another exclusive child already holds it. The returned release is idempotent. */
	tryAcquire(cwd: string): (() => void) | null;
	isHeld(cwd: string): boolean;
	/** cwds currently held, in acquisition order. */
	held(): string[];
	readonly size: number;
}

/**
 * Lock identity for one cwd: the git work-tree root when inside a repository
 * (so `/repo` and `/repo/src` share one lock), else the resolved cwd itself.
 * Symlinks and `..` are normalized through `realpath`; when that fails the
 * unresolved path is used so a delegation is never refused by mistake.
 * The child's `cwd`, task text, and git summary keep using the resolved cwd.
 */
export async function resolveLockKey(git: GitRunner, cwd: string): Promise<string> {
	const canonical = (p: string): string => {
		try { return realpathSync(p); } catch { return p; }
	};
	try {
		const prefix = await gitSafePrefix(git, cwd);
		const top = await git([...prefix, "rev-parse", "--show-toplevel"], cwd);
		if (top.code === 0 && top.stdout.trim()) return canonical(top.stdout.trim());
	} catch { /* fall through to the cwd fallback */ }
	return canonical(cwd);
}

export function createCwdLocks(): CwdLocks {
	const held = new Set<string>();
	return {
		tryAcquire(cwd) {
			if (held.has(cwd)) return null;
			held.add(cwd);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				held.delete(cwd);
			};
		},
		isHeld: (cwd) => held.has(cwd),
		held: () => [...held],
		get size() {
			return held.size;
		},
	};
}

/** Timer facility used by launch; injectable so timing policy can run under a fake clock. */
export interface Timers {
	setTimeout(fn: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
}

const realTimers: Timers = {
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Root-side identity of one delegation. `requestId` (plus `nodeId`) matches
 * host events to this delegation and addresses the cancel; `ownerRunId` is
 * Root's session. The host's own `runId` is not minted here: it arrives on
 * updates/responses and only locates artifacts (see `hostRunId`).
 */
export type RunIdentity = SubagentDelegationIdentity;

export function newRunIdentity(role: Role, ownerRunId: string, uuid: () => string = randomUUID): RunIdentity {
	return { ownerRunId, requestId: uuid(), nodeId: `${role}-${uuid().slice(0, 8)}` };
}

/** True when a host event belongs to `identity`: same requestId, and the same nodeId when the host sends one. */
export function matchesIdentity(identity: RunIdentity, data: unknown): data is SubagentDelegationUpdate {
	const d = data as Partial<SubagentDelegationUpdate> | undefined;
	return Boolean(d) && d!.requestId === identity.requestId
		&& (d!.nodeId === undefined || d!.nodeId === identity.nodeId);
}

/** The host-assigned run id that keys artifacts: the terminal's, else the last update's. */
export function hostRunId(response: Pick<SubagentDelegationResponse, "runId">, last: LastActivity): string | undefined {
	return response.runId ?? last.runId;
}

export interface DelegationDeps {
	events: EventBus;
	git: GitRunner;
	ownerRunId: string;
	limits: DelegationLimits;
	/** cwds held by a running exclusive child; shared across calls. */
	locks: CwdLocks;
	/** Root's session file; locates pi-subagents artifacts after a failed run. */
	sessionFile?: string;
	/** Defaults to the global timers. */
	timers?: Timers;
	/** pi-subagents' configured `artifactDir`; see loadArtifactDir. Defaults to the upstream default. */
	artifactDir?: ArtifactDir;
}

export interface DelegationParams {
	role: Role;
	task: string;
	cwd?: string;
}

export interface DelegationOutcome {
	ok: boolean;
	text: string;
	details: {
		role: Role;
		agent: string;
		status: SubagentDelegationResponse["status"] | "refused" | "not_started" | "stop_unconfirmed";
		model?: string;
		usage?: SubagentDelegationUsage;
		stopReason?: string;
	};
}

export const MAX_CHILD_TEXT_CHARS = 4_000;

/** Whole minutes a child gets, at least 1. */
export function timeoutMinutes(limits: Pick<DelegationLimits, "timeoutMs">): number {
	return Math.max(1, Math.floor(limits.timeoutMs / 60_000));
}

/**
 * `home` is stated because a child without a shell (reviewer) cannot look it
 * up and guesses `/root` or other users' homes for `~` paths in the task.
 */
export function buildTaskText(role: Role, task: string, cwd: string, timeoutMs = DEFAULT_LIMITS.timeoutMs, home = homedir()): string {
	const budget = `Time limit: ${timeoutMinutes({ timeoutMs })} minutes wall clock, then you are stopped and unsaved work is lost. Make edits early and in small steps. Do not start commands that cannot finish within the limit (full pipelines, long test suites); list them in your report instead.`;
	const pacing = "Write your report as soon as the required checks pass; do optional checks only after that. Never search the whole filesystem (e.g. `find /`); wrap commands that may be slow in `timeout 60`.";
	return `${task.trim()}\n\n---\nWorking directory: ${cwd}\nHome directory: ${home} (\`~\` in paths means this directory)\n${budget}\n${pacing}\n${ROLE_AGENTS[role].closing}`;
}

/** The last progress update seen for a child; pi-subagents sends these, bounded, during the run. */
export interface LastActivity {
	runId?: string;
	currentTool?: string;
	currentToolArgs?: string;
	recentOutput?: string;
}

const MAX_RECENT_OUTPUT_CHARS = 1_500;

const TRANSCRIPT_TAIL_BYTES = 8 * 1024 * 1024;
/** Room for ~12 tool calls with full-command previews (om09 run4: the passing check was 11 calls back). */
export const MAX_TAIL_CALLS_CHARS = 6_500;

/**
 * One short line of tool args, clipped to 120 chars: the parsed argsPayload
 * (command, path, or first string field) first, since pi-subagents' argsPreview
 * is already cut to ~60 chars; argsPreview only as fallback.
 */
function transcriptArgsPreview(record: Record<string, unknown>): string {
	const clip120 = (text: string) => (text.length > 120 ? `${text.slice(0, 119)}…` : text);
	if (typeof record.argsPayload === "string") {
		try {
			const args = JSON.parse(record.argsPayload) as unknown;
			if (args && typeof args === "object") {
				const fields = args as Record<string, unknown>;
				const pick = [fields.command, fields.path, ...Object.values(fields)].find((v) => typeof v === "string" && v.trim());
				if (typeof pick === "string") return clip120(collapseWs(pick));
			}
		} catch { /* fall back to argsPreview */ }
	}
	return typeof record.argsPreview === "string" ? clip120(collapseWs(record.argsPreview)) : "";
}

/** One readable result line: newlines become " | ", long text keeps head 120 + tail 220. */
function transcriptResultExcerpt(text: string): string {
	// eslint-disable-next-line no-control-regex -- strip ANSI colour codes from tool output
	const plain = text.replace(/\x1b\[[0-9;?<=>]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "");
	const flat = plain.replace(/\s*\n\s*/g, " | ").replace(/\s+/g, " ").trim();
	return flat.length <= 340 ? flat : `${flat.slice(0, 120)} … ${flat.slice(-220)}`;
}

/** Offset `+mm:ss` from the transcript's first timestamp. */
function transcriptOffset(ts: number, base: number): string {
	const s = Math.max(0, Math.floor((ts - base) / 1000));
	return `+${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Compact tail of a child's JSONL artifact transcript for a run that did not
 * finish: slow tools, slow model turns (no tool running, e.g. a long thinking
 * turn), the last tool calls with offsets, durations and result excerpts, and
 * the last assistant text. Malformed lines are skipped;
 * undefined when nothing is parseable.
 */
export function summarizeTranscript(jsonlText: string): string | undefined {
	interface Call {
		startTs: number;
		tool: string;
		args: string;
		endTs?: number;
		isError?: boolean;
		result?: string;
	}
	const calls: Call[] = [];
	const byId = new Map<string, Call>();
	let firstTs: number | undefined;
	let lastTs: number | undefined;
	let lastText: string | undefined;
	// Model time: gaps with no tool running, from the last tool end (or the start) to the next tool start.
	let idleSince: number | undefined;
	let running = 0;
	const turns: Array<{ ms: number; at: number; next?: string }> = [];
	for (const line of jsonlText.split("\n")) {
		if (!line.trim()) continue;
		let record: Record<string, unknown>;
		try { record = JSON.parse(line); } catch { continue; }
		if (!record || typeof record !== "object") continue;
		const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : undefined;
		if (ts !== undefined) { firstTs ??= ts; lastTs = ts; idleSince ??= ts; }
		const id = typeof record.toolCallId === "string" ? record.toolCallId : undefined;
		if (record.recordType === "tool_start" && ts !== undefined) {
			const call: Call = { startTs: ts, tool: typeof record.toolName === "string" ? record.toolName : "tool", args: transcriptArgsPreview(record) };
			calls.push(call);
			if (id) byId.set(id, call);
			if (running === 0 && idleSince !== undefined) turns.push({ ms: ts - idleSince, at: idleSince, next: `${call.tool}: ${call.args}` });
			running++;
		} else if (record.recordType === "tool_end" && id) {
			const call = byId.get(id);
			if (call && ts !== undefined && call.endTs === undefined) {
				call.endTs = ts;
				call.isError = call.isError || record.isError === true;
				running = Math.max(0, running - 1);
				if (running === 0) idleSince = ts;
			}
		} else if (record.recordType === "message" && record.role === "toolResult" && id) {
			const call = byId.get(id);
			if (call) {
				if (typeof record.text === "string" && record.text) call.result = record.text;
				if (record.isError === true) call.isError = true;
			}
		} else if (record.recordType === "message" && record.role === "assistant") {
			const content = (record.message as { content?: unknown } | undefined)?.content;
			const parts = typeof content === "string" ? [content]
				: Array.isArray(content) ? content.flatMap((part) => {
					const item = part as { type?: unknown; text?: unknown } | null;
					return item && typeof item === "object" && item.type === "text" && typeof item.text === "string" ? [item.text] : [];
				}) : [];
			const text = parts.join(" ").trim();
			if (text) lastText = text;
		}
	}
	if (calls.length === 0 && !lastText) return undefined;
	const base = firstTs ?? 0;
	const ref = lastTs ?? base;
	if (running === 0 && idleSince !== undefined && lastTs !== undefined) turns.push({ ms: lastTs - idleSince, at: idleSince });
	const slowTurns = turns.filter((t) => t.ms >= 60_000).sort((a, b) => b.ms - a.ms).slice(0, 3)
		.map((t) => `- [${transcriptOffset(t.at, base)}] ${formatSeconds(t.ms)}, ${t.next ? `then ${t.next}` : "still in this turn when stopped"}`);
	const slow: Array<{ ms: number; line: string }> = [];
	const entries: string[] = [];
	for (const call of calls) {
		const running = call.endTs === undefined;
		const end = call.endTs ?? ref;
		const ms = Math.max(0, end - call.startTs);
		const dur = running ? `running when stopped, ${Math.round(ms / 1000)}s` : `${Math.round(ms / 1000)}s`;
		const err = call.isError ? " ERROR" : "";
		const head = `- [${transcriptOffset(call.startTs, base)}] ${call.tool} ${dur}${err}: ${call.args}`;
		const excerpt = call.result ? transcriptResultExcerpt(call.result) : "";
		entries.push(excerpt ? `${head}\n    result: ${excerpt}` : head);
		if (ms >= 60_000) slow.push({ ms, line: `- ${call.tool} ${dur}${err}: ${call.args}` });
	}
	// Newest 12 calls; the section stays <=MAX_TAIL_CALLS_CHARS, dropping the oldest entries first.
	let kept = entries.slice(-12);
	while (kept.length > 1 && kept.join("\n").length > MAX_TAIL_CALLS_CHARS) kept.shift();
	slow.sort((a, b) => b.ms - a.ms);
	const out = ["Transcript tail (child did not finish; newest last):"];
	if (slow.length) out.push("Slow tools (>=60s):", ...slow.slice(0, 3).map((s) => s.line));
	if (slowTurns.length) out.push("Slow model turns (>=60s with no tool running):", ...slowTurns);
	if (kept.length) out.push("Last tool calls:", ...kept);
	if (lastText) {
		const text = collapseWs(lastText);
		out.push(`Last assistant text: ${text.length > 500 ? `${text.slice(0, 499)}…` : text}`);
	}
	return out.length > 1 ? out.join("\n") : undefined;
}

/**
 * Read a child's transcript for summarizing. Over 8 MB reads only the last
 * 8 MB and drops the first partial line. Missing/unreadable -> undefined.
 */
function readTranscriptTail(path: string): string | undefined {
	try {
		const size = statSync(path).size;
		if (size <= TRANSCRIPT_TAIL_BYTES) return readFileSync(path, "utf8");
		const fd = openSync(path, "r");
		try {
			const buf = Buffer.alloc(TRANSCRIPT_TAIL_BYTES);
			const read = readSync(fd, buf, 0, TRANSCRIPT_TAIL_BYTES, size - TRANSCRIPT_TAIL_BYTES);
			const chunk = buf.toString("utf8", 0, read);
			const nl = chunk.indexOf("\n");
			return nl === -1 ? undefined : chunk.slice(nl + 1);
		} finally {
			closeSync(fd);
		}
	} catch {
		return undefined;
	}
}

/**
 * What a child that did not complete left behind, for Root.
 *
 * pi-subagents 0.71.0 withholds `result` unless the run completed and keeps
 * completion details to bounded routing evidence, so the partial output and
 * its timeout recovery summary reach only artifact files. Two sources, both
 * existing primitives:
 * - the last UPDATE event (runId, current tool, recent output);
 * - the output and transcript artifacts, located by the subagent-artifacts
 *   adapter for the configured `artifactDir` (session/temp/project).
 */
export interface ArtifactSource {
	sessionFile?: string;
	cwd: string;
	artifactDir?: ArtifactDir;
}

export function recoverPartial(
	response: SubagentDelegationResponse,
	agent: string,
	source: ArtifactSource,
	last: LastActivity = {},
): { text?: string; tail?: string; lines: string[] } {
	const lines: string[] = [];
	const runId = hostRunId(response, last);
	if (runId) lines.push(`Run id: ${runId}`);
	if (last.currentTool) {
		const args = last.currentToolArgs ? ` ${clip(last.currentToolArgs.replace(/\s+/g, " "), 200)}` : "";
		lines.push(`Last activity: ${last.currentTool}${args}`);
	}
	const recent = last.recentOutput?.trim()
		? `(recent output from the last progress update)\n${clip(last.recentOutput.trim(), MAX_RECENT_OUTPUT_CHARS)}`
		: undefined;
	if (!runId) return { text: recent, lines };
	const paths = resolveArtifacts({ runId, agent, ...source });
	if (paths) {
		try {
			const text = readFileSync(paths.outputPath, "utf8");
			lines.push(`Transcript: ${paths.transcriptPath}`);
			const jsonl = readTranscriptTail(paths.transcriptPath);
			const tail = jsonl ? summarizeTranscript(jsonl) : undefined;
			return { text: text.trim() ? text : recent, tail, lines };
		} catch { /* fall through */ }
	}
	lines.push(`artifacts not found (artifactDir=${source.artifactDir ?? "session"}${paths ? `, expected ${paths.outputPath}` : ""}); runId=${runId}`);
	return { text: recent, lines };
}

/** Children put the report at the end, so keep the head and the tail. */
export function clipChildText(text: string, max = MAX_CHILD_TEXT_CHARS): string {
	return clipHeadTail(text, max);
}

interface Terminal {
	response?: SubagentDelegationResponse;
	stopReason?: string;
	started: boolean;
	last: LastActivity;
}

type RoleProfile = (typeof ROLE_AGENTS)[Role];
type OutcomeDetails = Pick<DelegationOutcome["details"], "role" | "agent">;

function refusal(details: OutcomeDetails, why: string): DelegationOutcome {
	return { ok: false, text: `delegate refused: ${why}`, details: { ...details, status: "refused" } };
}

function outcome(
	ok: boolean,
	text: string,
	details: OutcomeDetails,
	status: DelegationOutcome["details"]["status"],
	extra: Pick<DelegationOutcome["details"], "model" | "usage" | "stopReason"> = {},
): DelegationOutcome {
	return { ok, text, details: { ...details, status, ...extra } };
}

export async function runDelegation(
	deps: DelegationDeps,
	params: DelegationParams,
	signal?: AbortSignal,
	onProgress?: (text: string) => void,
): Promise<DelegationOutcome> {
	const role = params.role;
	const profile = ROLE_AGENTS[role];
	if (!profile) return refusal({ role, agent: "" }, `role must be one of ${ROLES.join(", ")}`);
	const cwd = resolve(params.cwd || process.cwd());
	const details = { role, agent: profile.agent };
	if (!params.task?.trim()) return refusal(details, "task is empty");
	const lockKey = profile.exclusive ? await resolveLockKey(deps.git, cwd).catch(() => cwd) : cwd;
	const release = profile.exclusive ? deps.locks.tryAcquire(lockKey) : () => {};
	if (!release) {
		return refusal(details, `another worker/explorer/validator child is still running in repository ${lockKey}. Wait for it to finish, or use role "reviewer" (read-only).`);
	}

	const base = await captureBase(deps.git, cwd).catch(() => ({ dirtyBefore: 0 }));
	let terminal: Terminal;
	try {
		terminal = await launch(deps, buildRequest(deps, role, profile, params.task, cwd), signal, onProgress, release);
	} catch (error) {
		release();
		throw error;
	}
	return terminal.response
		? renderOutcome(deps, role, profile, cwd, base, terminal, terminal.response)
		: renderNoTerminal(deps, role, profile, cwd, terminal);
}

function buildRequest(deps: DelegationDeps, role: Role, profile: RoleProfile, task: string, cwd: string): SubagentDelegationRequest {
	return {
		...newRunIdentity(role, deps.ownerRunId),
		agent: profile.agent,
		task: buildTaskText(role, task, cwd, deps.limits.timeoutMs),
		context: "fresh",
		cwd,
		timeoutMs: deps.limits.timeoutMs,
		intercomBridge: { mode: "off" },
		result: { kind: "text" },
	};
}

/**
 * No terminal: the child may still be running, so the cwd stays held until a
 * late terminal arrives (launch keeps listening for it).
 */
function renderNoTerminal(deps: DelegationDeps, role: Role, profile: RoleProfile, cwd: string, terminal: Terminal): DelegationOutcome {
	const status = terminal.started ? "stop_unconfirmed" : "not_started";
	const why = terminal.started
		? `Stop was requested (${terminal.stopReason}) but the child has not confirmed it. It may still be writing in ${cwd}; this cwd stays locked until it ends.`
		: terminal.stopReason === "child did not start"
			? `pi-subagents did not start the child within ${Math.round(deps.limits.startTimeoutMs / 1000)}s. Check that pi-subagents is installed and loaded.`
			: `Not started: ${terminal.stopReason ?? "unknown reason"}.`;
	return outcome(false, `[${role}/${profile.agent}] ${status}\n${why}`, { role, agent: profile.agent }, status, { stopReason: terminal.stopReason });
}

/** Header, recovery lines, child report, transcript tail, workspace summary. */
async function renderOutcome(
	deps: DelegationDeps,
	role: Role,
	profile: RoleProfile,
	cwd: string,
	base: Awaited<ReturnType<typeof captureBase>>,
	terminal: Terminal,
	response: SubagentDelegationResponse,
): Promise<DelegationOutcome> {
	const header = [`[${role}/${response.agent ?? profile.agent}] ${response.status}`, response.model, formatUsage(response.usage)]
		.filter(Boolean).join(" · ");
	const lines = [header];
	if (response.agent && response.agent !== profile.agent) lines.push(`WARNING: requested agent ${profile.agent}, host ran ${response.agent}.`);
	if (terminal.stopReason) lines.push(`Stopped: ${terminal.stopReason}.`);
	if (response.error) lines.push(`Error: ${clip(response.error, 1_000)}`);
	let childText = response.result?.kind === "text" ? response.result.text
		: response.result ? JSON.stringify(response.result.value) : "";
	let tail: string | undefined;
	if (response.status !== "completed") {
		const recovered = recoverPartial(response, response.agent ?? profile.agent, { sessionFile: deps.sessionFile, cwd, artifactDir: deps.artifactDir }, terminal.last);
		lines.push(...recovered.lines);
		if (!childText.trim() && recovered.text) childText = recovered.text;
		tail = recovered.tail;
	}
	lines.push("", "Child report:", childText.trim() ? clipChildText(childText.trim()) : "(empty)");
	if (tail) lines.push("", tail);
	if (role !== "reviewer") lines.push("", await summarizeWork(deps.git, cwd, base).catch((e) => `Workspace changes: git failed (${String(e)})`));
	return outcome(response.status === "completed", lines.join("\n"), { role, agent: profile.agent }, response.status, {
		model: response.model,
		usage: response.usage,
		stopReason: terminal.stopReason,
	});
}

/**
 * Child lifecycle as seen by Root:
 *   pending_start -> running            (STARTED/UPDATE/RESPONSE for this request)
 *   pending_start | running -> stopping (abort, token cap, start timeout, emit failure)
 *   any active -> settled               (terminal received, or stop confirmed/never started)
 *   any active -> awaiting_late_terminal (stop requested, child started, no terminal:
 *                                         the cwd stays held until its late RESPONSE)
 *   awaiting_late_terminal -> settled   (late RESPONSE releases the cwd)
 */
type LaunchPhase = "pending_start" | "running" | "stopping" | "settled" | "awaiting_late_terminal";

const ACTIVE_PHASES: ReadonlySet<LaunchPhase> = new Set(["pending_start", "running", "stopping"]);

/** Emit one request and wait for its terminal, a stop, or a start timeout. */
function launch(
	deps: DelegationDeps,
	request: SubagentDelegationRequest,
	signal: AbortSignal | undefined,
	onProgress: ((text: string) => void) | undefined,
	release: () => void,
): Promise<Terminal> {
	const { events, limits } = deps;
	const timers = deps.timers ?? realTimers;
	return new Promise<Terminal>((resolveTerminal) => {
		const state: Terminal = { started: false, last: {} };
		let phase: LaunchPhase = "pending_start";
		const active = () => ACTIVE_PHASES.has(phase);
		const pendingTimers: unknown[] = [];
		const after = (ms: number, fn: () => void) => pendingTimers.push(timers.setTimeout(fn, ms));
		const offAll: Array<() => void> = [];

		// --- timeout / cancel policy ---
		const markStarted = () => {
			state.started = true;
			if (phase === "pending_start") phase = "running";
		};
		const finish = () => {
			if (!active()) return;
			for (const t of pendingTimers.splice(0)) timers.clearTimeout(t);
			signal?.removeEventListener("abort", onAbort);
			const mayStillRun = state.started && !state.response;
			phase = mayStillRun ? "awaiting_late_terminal" : "settled";
			for (const off of offAll.splice(0)) if (!(mayStillRun && off === offResponse)) off();
			if (!mayStillRun) release();
			resolveTerminal(state);
		};
		const stop = (reason: string) => {
			if (!active() || phase === "stopping") return;
			phase = "stopping";
			state.stopReason = reason;
			try { events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, identity); } catch { /* reported as unconfirmed */ }
			after(limits.cancelGraceMs, finish);
		};
		const onAbort = () => stop("cancelled by Root");
		const onLateTerminal = () => {
			// Late terminal after an unconfirmed stop: the child is gone now.
			phase = "settled";
			offResponse();
			release();
		};

		// --- event wiring ---
		const identity: RunIdentity = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
		const offResponse = events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (data) => {
			if (!matchesIdentity(identity, data)) return;
			if (!active()) return onLateTerminal();
			state.response = data as SubagentDelegationResponse;
			markStarted();
			finish();
		});
		offAll.push(offResponse);
		offAll.push(events.on(SUBAGENT_DELEGATION_STARTED_EVENT, (data) => {
			if (matchesIdentity(identity, data)) markStarted();
		}));
		offAll.push(events.on(SUBAGENT_DELEGATION_UPDATE_EVENT, (data) => {
			if (!matchesIdentity(identity, data)) return;
			markStarted();
			// Updates are replacement snapshots, not deltas: keep the latest fields.
			const recentOutput = data.recentOutputLines?.length ? data.recentOutputLines.join("\n") : data.recentOutput;
			// A tool_execution_end update (also sent when a timeout kills the tool)
			// clears currentTool; fall back to the newest ended tool, then the previous one.
			const ended = data.recentTools?.at(-1);
			const tool = data.currentTool
				? { currentTool: data.currentTool, currentToolArgs: data.currentToolArgs }
				: ended ? { currentTool: ended.tool, currentToolArgs: ended.args }
				: { currentTool: state.last.currentTool, currentToolArgs: state.last.currentToolArgs };
			state.last = {
				runId: data.runId ?? state.last.runId,
				...tool,
				recentOutput: recentOutput ?? state.last.recentOutput,
			};
			const tokens = data.tokens ?? 0;
			if (tokens > limits.maxTokens) stop(`token cap ${limits.maxTokens} exceeded (${tokens})`);
			onProgress?.(`${request.agent}: ${data.toolCount ?? 0} tools${data.currentTool ? ` · ${data.currentTool}` : ""} · ${formatTokens(tokens)} tok`);
		}));

		if (signal?.aborted) {
			state.stopReason = "cancelled by Root before launch";
			finish();
			return;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		after(limits.startTimeoutMs, () => {
			if (state.started || !active()) return;
			stop("child did not start");
		});
		try {
			events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
		} catch (error) {
			state.stopReason = `request emission failed: ${error instanceof Error ? error.message : String(error)}`;
			stop(state.stopReason);
		}
	});
}
