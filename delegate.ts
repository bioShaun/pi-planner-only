/**
 * One delegation = one child run through pi-subagents structured delegation.
 *
 * The child returns plain text. Root gets that text, the host's status and
 * usage, and a Git summary of what changed. Nothing is persisted: children
 * run in-process and end with Root.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_STARTED_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";
import type {
	SubagentDelegationRequest,
	SubagentDelegationResponse,
	SubagentDelegationUpdate,
	SubagentDelegationUsage,
} from "./subagent-delegation-contract.ts";
import { captureBase, clip, summarizeWork } from "./git.ts";
import type { GitRunner } from "./git.ts";

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
		closing: "Do not modify any files. End with the findings Root asked for, as compact as possible (paths, line numbers, short excerpts).",
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

export interface DelegationLimits {
	timeoutMs: number;
	maxTokens: number;
	startTimeoutMs: number;
	cancelGraceMs: number;
}

export const DEFAULT_LIMITS: DelegationLimits = {
	timeoutMs: 600_000,
	maxTokens: 1_500_000,
	startTimeoutMs: 30_000,
	cancelGraceMs: 5_000,
};

export function loadLimits(env: NodeJS.ProcessEnv = process.env): DelegationLimits {
	const num = (name: string, fallback: number) => {
		const value = Number(env[name]);
		return Number.isInteger(value) && value > 0 ? value : fallback;
	};
	return {
		timeoutMs: num("PI_PLANNER_ONLY_TIMEOUT_MS", DEFAULT_LIMITS.timeoutMs),
		maxTokens: num("PI_PLANNER_ONLY_MAX_TOKENS", DEFAULT_LIMITS.maxTokens),
		startTimeoutMs: num("PI_PLANNER_ONLY_START_TIMEOUT_MS", DEFAULT_LIMITS.startTimeoutMs),
		cancelGraceMs: num("PI_PLANNER_ONLY_CANCEL_GRACE_MS", DEFAULT_LIMITS.cancelGraceMs),
	};
}

export interface EventBus {
	on(event: string, handler: (data: unknown) => void): () => void;
	emit(event: string, data: unknown): void;
}

export interface DelegationDeps {
	events: EventBus;
	git: GitRunner;
	ownerRunId: string;
	limits: DelegationLimits;
	/** cwds held by a running exclusive child; shared across calls. */
	busy: Set<string>;
	/** Root's session file; locates pi-subagents artifacts after a failed run. */
	sessionFile?: string;
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

export function buildTaskText(role: Role, task: string, cwd: string, timeoutMs = DEFAULT_LIMITS.timeoutMs): string {
	const budget = `Time limit: ${timeoutMinutes({ timeoutMs })} minutes wall clock, then you are stopped and unsaved work is lost. Make edits early and in small steps. Do not start commands that cannot finish within the limit (full pipelines, long test suites); list them in your report instead.`;
	return `${task.trim()}\n\n---\nWorking directory: ${cwd}\n${budget}\n${ROLE_AGENTS[role].closing}`;
}

/** The last progress update seen for a child; pi-subagents sends these, bounded, during the run. */
export interface LastActivity {
	runId?: string;
	currentTool?: string;
	currentToolArgs?: string;
	recentOutput?: string;
}

const MAX_RECENT_OUTPUT_CHARS = 1_500;

/**
 * What a child that did not complete left behind, for Root.
 *
 * pi-subagents 0.71.0 withholds `result` unless the run completed and keeps
 * completion details to bounded routing evidence, so the partial output and
 * its timeout recovery summary reach only artifact files. Two sources, both
 * existing primitives:
 * - the last UPDATE event (runId, current tool, recent output);
 * - fallback that depends on the upstream layout: the output artifact at
 *   `<dirname(sessionFile)>/subagent-artifacts/<runId>_<agent>_0_output.md`,
 *   which assumes the default `artifactDir: "session"` (src/shared/artifacts.js
 *   getArtifactsDir / getArtifactPaths). With `temp` or `project` the files live
 *   elsewhere and only the runId is reported.
 */
export function recoverPartial(
	response: SubagentDelegationResponse,
	agent: string,
	sessionFile: string | undefined,
	last: LastActivity = {},
): { text?: string; lines: string[] } {
	const lines: string[] = [];
	const runId = response.runId ?? last.runId;
	if (runId) lines.push(`Run id: ${runId}`);
	if (last.currentTool) {
		const args = last.currentToolArgs ? ` ${clip(last.currentToolArgs.replace(/\s+/g, " "), 200)}` : "";
		lines.push(`Last activity: ${last.currentTool}${args}`);
	}
	const recent = last.recentOutput?.trim()
		? `(recent output from the last progress update)\n${clip(last.recentOutput.trim(), MAX_RECENT_OUTPUT_CHARS)}`
		: undefined;
	if (!runId) return { text: recent, lines };
	const safeName = /^[A-Za-z0-9_-]+$/;
	if (sessionFile && safeName.test(runId) && safeName.test(agent)) {
		const base = join(dirname(sessionFile), "subagent-artifacts", `${runId}_${agent}_0`);
		try {
			const text = readFileSync(`${base}_output.md`, "utf8");
			lines.push(`Transcript: ${base}_transcript.jsonl`);
			return { text: text.trim() ? text : recent, lines };
		} catch { /* fall through */ }
	}
	lines.push(`artifacts not found at the default location (pi-subagents artifactDir may be temp/project); runId=${runId}`);
	return { text: recent, lines };
}

/** Keep the head and the tail: children put the report at the end. */
export function clipChildText(text: string, max = MAX_CHILD_TEXT_CHARS): string {
	if (text.length <= max) return text;
	const head = Math.floor(max * 0.25);
	return `${text.slice(0, head)}\n… [${text.length - max} chars omitted] …\n${text.slice(text.length - (max - head))}`;
}

function formatTokens(n: number): string {
	return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatUsage(usage: SubagentDelegationUsage | undefined): string {
	if (!usage) return "usage unknown";
	const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return `${formatTokens(tokens)} tok · $${usage.cost.toFixed(4)} · ${usage.turns} turns · ${Math.round(usage.durationMs / 1000)}s`;
}

interface Terminal {
	response?: SubagentDelegationResponse;
	stopReason?: string;
	started: boolean;
	last: LastActivity;
}

export async function runDelegation(
	deps: DelegationDeps,
	params: DelegationParams,
	signal?: AbortSignal,
	onProgress?: (text: string) => void,
): Promise<DelegationOutcome> {
	const role = params.role;
	const profile = ROLE_AGENTS[role];
	if (!profile) {
		return { ok: false, text: `delegate refused: role must be one of ${ROLES.join(", ")}`, details: { role, agent: "", status: "refused" } };
	}
	const cwd = resolve(params.cwd || process.cwd());
	const details = { role, agent: profile.agent };
	if (!params.task?.trim()) return { ok: false, text: "delegate refused: task is empty", details: { ...details, status: "refused" } };
	if (profile.exclusive && deps.busy.has(cwd)) {
		return {
			ok: false,
			text: `delegate refused: another worker/explorer/validator child is still running in ${cwd}. Wait for it to finish, or use role "reviewer" (read-only).`,
			details: { ...details, status: "refused" },
		};
	}
	if (profile.exclusive) deps.busy.add(cwd);
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		if (profile.exclusive) deps.busy.delete(cwd);
	};

	let terminal: Terminal;
	const base = await captureBase(deps.git, cwd).catch(() => ({ dirtyBefore: 0 }));
	try {
		terminal = await launch(deps, {
			requestId: randomUUID(),
			ownerRunId: deps.ownerRunId,
			nodeId: `${role}-${randomUUID().slice(0, 8)}`,
			agent: profile.agent,
			task: buildTaskText(role, params.task, cwd, deps.limits.timeoutMs),
			context: "fresh",
			cwd,
			timeoutMs: deps.limits.timeoutMs,
			result: { kind: "text" },
		}, signal, onProgress, release);
	} catch (error) {
		release();
		throw error;
	}

	const response = terminal.response;
	if (!response) {
		// No terminal: the child may still be running, so the cwd stays held
		// until a late terminal arrives (launch keeps listening for it).
		const status = terminal.started ? "stop_unconfirmed" : "not_started";
		const why = terminal.started
			? `Stop was requested (${terminal.stopReason}) but the child has not confirmed it. It may still be writing in ${cwd}; this cwd stays locked until it ends.`
			: terminal.stopReason === "child did not start"
				? `pi-subagents did not start the child within ${Math.round(deps.limits.startTimeoutMs / 1000)}s. Check that pi-subagents is installed and loaded.`
				: `Not started: ${terminal.stopReason ?? "unknown reason"}.`;
		return { ok: false, text: `[${role}/${profile.agent}] ${status}\n${why}`, details: { ...details, status, stopReason: terminal.stopReason } };
	}

	const header = [`[${role}/${response.agent ?? profile.agent}] ${response.status}`, response.model, formatUsage(response.usage)]
		.filter(Boolean).join(" · ");
	const lines = [header];
	if (response.agent && response.agent !== profile.agent) lines.push(`WARNING: requested agent ${profile.agent}, host ran ${response.agent}.`);
	if (terminal.stopReason) lines.push(`Stopped: ${terminal.stopReason}.`);
	if (response.error) lines.push(`Error: ${clip(response.error, 1_000)}`);
	let childText = response.result?.kind === "text" ? response.result.text
		: response.result ? JSON.stringify(response.result.value) : "";
	if (response.status !== "completed") {
		const recovered = recoverPartial(response, response.agent ?? profile.agent, deps.sessionFile, terminal.last);
		lines.push(...recovered.lines);
		if (!childText.trim() && recovered.text) childText = recovered.text;
	}
	lines.push("", "Child report:", childText.trim() ? clipChildText(childText.trim()) : "(empty)");
	if (role !== "reviewer") lines.push("", await summarizeWork(deps.git, cwd, base).catch((e) => `Workspace changes: git failed (${String(e)})`));
	return {
		ok: response.status === "completed",
		text: lines.join("\n"),
		details: { ...details, status: response.status, model: response.model, usage: response.usage, stopReason: terminal.stopReason },
	};
}

/** Emit one request and wait for its terminal, a stop, or a start timeout. */
function launch(
	deps: DelegationDeps,
	request: SubagentDelegationRequest,
	signal: AbortSignal | undefined,
	onProgress: ((text: string) => void) | undefined,
	release: () => void,
): Promise<Terminal> {
	const { events, limits } = deps;
	return new Promise<Terminal>((resolveTerminal) => {
		const state: Terminal = { started: false, last: {} };
		let settled = false;
		let stopping = false;
		const timers: ReturnType<typeof setTimeout>[] = [];
		const mine = (data: unknown): data is SubagentDelegationUpdate => {
			const d = data as Partial<SubagentDelegationUpdate> | undefined;
			return Boolean(d) && d!.requestId === request.requestId
				&& (d!.nodeId === undefined || d!.nodeId === request.nodeId);
		};
		const offAll: Array<() => void> = [];
		const finish = () => {
			if (settled) return;
			settled = true;
			for (const t of timers) clearTimeout(t);
			signal?.removeEventListener("abort", onAbort);
			// A child that started but never sent a terminal may still be
			// running: keep the cwd held and wait for its late terminal.
			const mayStillRun = state.started && !state.response;
			for (const off of offAll.splice(0)) if (!(mayStillRun && off === offResponse)) off();
			if (!mayStillRun) release();
			resolveTerminal(state);
		};
		const stop = (reason: string) => {
			if (stopping || settled) return;
			stopping = true;
			state.stopReason = reason;
			try { events.emit(SUBAGENT_DELEGATION_CANCEL_EVENT, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId }); } catch { /* reported as unconfirmed */ }
			timers.push(setTimeout(finish, limits.cancelGraceMs));
		};
		const onAbort = () => stop("cancelled by Root");

		const offResponse = events.on(SUBAGENT_DELEGATION_RESPONSE_EVENT, (data) => {
			if (!mine(data)) return;
			if (settled) {
				// Late terminal after an unconfirmed stop: the child is gone now.
				offResponse();
				release();
				return;
			}
			state.response = data as SubagentDelegationResponse;
			state.started = true;
			finish();
		});
		offAll.push(offResponse);
		offAll.push(events.on(SUBAGENT_DELEGATION_STARTED_EVENT, (data) => {
			if (mine(data)) state.started = true;
		}));
		offAll.push(events.on(SUBAGENT_DELEGATION_UPDATE_EVENT, (data) => {
			if (!mine(data)) return;
			state.started = true;
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
		timers.push(setTimeout(() => {
			if (state.started || settled) return;
			stop("child did not start");
		}, limits.startTimeoutMs));
		try {
			events.emit(SUBAGENT_DELEGATION_REQUEST_EVENT, request);
		} catch (error) {
			state.stopReason = `request emission failed: ${error instanceof Error ? error.message : String(error)}`;
			stop(state.stopReason);
		}
	});
}
