/** Root handoff owns the brief from admission through session replacement and manual retry. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AGENT_DIR, loadConfig } from "./config.ts";
import type { HandoffMode, PlannerMode } from "./config.ts";
import { formatTokens } from "./format.ts";
import { gitSafePrefix, isWorkTree } from "./git.ts";
import type { GitRunner } from "./git.ts";
import type { HostAdapter } from "./host.ts";

export const HANDOFF_PREFERENCE = join(AGENT_DIR, "planner-only.handoff");

interface PendingHandoff {
	brief: string;
	cwd: string;
	sessionFile?: string;
	selection?: { provider: string; id: string; thinkingLevel?: string };
	/** Set after a failed or cancelled dispatch: only `/planner-only handoff` retries it. */
	manualOnly?: boolean;
}

function handoffPreference(): HandoffMode | undefined {
	try {
		const value = readFileSync(HANDOFF_PREFERENCE, "utf8").trim();
		return value === "off" || value === "confirm" || value === "auto" ? value : undefined;
	} catch { return undefined; }
}

export function handoffModeSetting(env: NodeJS.ProcessEnv): { mode: HandoffMode; source: "env" | "persisted" | "default" } {
	if (env.PI_PLANNER_ONLY_HANDOFF?.trim()) {
		const value = env.PI_PLANNER_ONLY_HANDOFF.trim().toLowerCase();
		return { mode: value === "confirm" || value === "auto" ? value : "off", source: "env" };
	}
	const saved = handoffPreference();
	return saved ? { mode: saved, source: "persisted" } : { mode: "off", source: "default" };
}

export function handoffMode(env: NodeJS.ProcessEnv = process.env): HandoffMode {
	return handoffModeSetting(env).mode;
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
	return `[planner-only handoff] You are the new Root session. The previous session handed this work to you because its context was large. "This session"/"the next session" in the brief below both mean YOU: do the next step now. ${handoffMode() === "off" ? "Do not call the handoff tool unless the user asks for one." : "Do not call the handoff tool unless your own context grows past the warning threshold."}\n\n## Brief\n${handoff.brief}\n\n## Facts from the previous session\nPrevious session file: ${handoff.sessionFile ?? "unknown"}\nRepository (git facts below): ${handoff.cwd}\n${facts}\n\nContinue as Root under planner-only; the brief is authoritative.`;
}

interface HandoffRuntime {
	pi: Pick<ExtensionAPI, "setModel" | "setThinkingLevel" | "sendUserMessage">;
	git: GitRunner;
	host: Pick<HostAdapter, "sessionFile" | "sendMessage">;
	activity: { readonly locks: { readonly size: number }; readonly delegationsInFlight: number; readonly rootContext: number | undefined };
	mode(): PlannerMode;
}

// Pi replaces extension instances during newSession. Only this module chooses
// the live owner; callers never transfer a pending brief between instances.
let activeHandoff: RootHandoff | undefined;
const result = (text: string, ok: boolean) => ({ content: [{ type: "text" as const, text }], details: { ok } });

export class RootHandoff {
	readonly #runtime: HandoffRuntime;
	#pending: PendingHandoff | undefined;
	#requested = false;

	constructor(runtime: HandoffRuntime) {
		this.#runtime = runtime;
		activeHandoff = this;
	}

	/** A new conversation discards its pending brief and explicit request. */
	reset(): void {
		this.#pending = undefined;
		this.#requested = false;
	}

	/** Turning Lite off cancels a pending dispatch, as before. */
	deactivate(): void { this.#pending = undefined; }

	schedule(params: { brief: string; cwd?: string }, ctx: ExtensionContext) {
		if (this.#runtime.mode() !== "lite") return result("Handoff unavailable: planner-only Lite mode is inactive.", false);
		if (!ctx.hasUI) return result("Handoff refused: a UI session is required.", false);
		const reason = this.#refusal(params.brief);
		if (reason) return result(`Handoff refused: ${reason}`, false);
		this.#requested = false;
		this.#pending = { brief: params.brief, cwd: params.cwd ? resolve(ctx.cwd, params.cwd) : ctx.cwd, sessionFile: this.#runtime.host.sessionFile(ctx) };
		return result("Handoff scheduled: a new session will start with this brief after this turn ends. Stop working now; end your turn with a one-line note to the user.", true);
	}

	/** Handles handoff commands; false leaves unrelated planner commands to Root. */
	async command(args: string, ctx: ExtensionCommandContext): Promise<boolean> {
		const raw = args.trim();
		const cmd = raw.toLowerCase();
		if (cmd === "handoff-mode" || cmd.startsWith("handoff-mode ")) {
			if (cmd !== "handoff-mode") {
				const value = cmd.slice("handoff-mode ".length).trim();
				if (value !== "off" && value !== "confirm" && value !== "auto") {
					ctx.ui.notify("Usage: /planner-only handoff-mode [off|confirm|auto]", "warning");
					return true;
				}
				mkdirSync(dirname(HANDOFF_PREFERENCE), { recursive: true });
				writeFileSync(HANDOFF_PREFERENCE, `${value}\n`);
			}
			const setting = handoffModeSetting(process.env);
			ctx.ui.notify(`handoff mode: ${setting.mode} (source: ${setting.source})`, "info");
			return true;
		}
		if (cmd === "handoff drop") {
			this.reset();
			ctx.ui.notify("handoff dropped", "info");
			return true;
		}
		if (cmd !== "handoff" && !cmd.startsWith("handoff ")) return false;
		if (this.#runtime.mode() !== "lite") {
			ctx.ui.notify("handoff requires planner-only Lite mode", "warning");
			return true;
		}
		if (!this.#pending) {
			this.#requested = true;
			const goal = raw.slice("handoff".length).trim();
			this.#runtime.pi.sendUserMessage(`[planner-only] The user asked for a handoff${goal ? ` (next goal: ${goal})` : ""}. Call the handoff tool now with a complete brief.`, ctx.isIdle?.() ? undefined : { deliverAs: "followUp" });
		} else await this.#dispatch(this.#pending, ctx);
		return true;
	}

	/** Dispatch happens after the tool turn, through the host command path. */
	settled(): void {
		if (this.#runtime.mode() !== "lite") { this.deactivate(); return; }
		if (!this.#pending || this.#pending.manualOnly) return;
		try { this.#runtime.pi.sendUserMessage("/planner-only handoff", { expandPromptTemplates: true }); }
		catch {
			this.deactivate();
			this.#runtime.host.sendMessage({ customType: "planner-only-handoff", content: "[planner-only] Handoff dispatch failed; run /planner-only handoff manually.", display: true });
		}
	}

	#defer(handoff: PendingHandoff): void {
		this.#pending = { ...handoff, manualOnly: true };
	}

	#refusal(brief: string): string | undefined {
		if (this.#runtime.activity.locks.size > 0) return "a child is still running.";
		if (this.#runtime.activity.delegationsInFlight > 0) return "a delegated child is still running.";
		if (this.#pending) return "one is already pending.";
		const threshold = loadConfig().contextWarnTokens;
		if (!this.#requested && handoffMode() === "off") {
			return "the user did not request a handoff and self-initiated handoff is off (enable it with /planner-only handoff-mode confirm|auto, or PI_PLANNER_ONLY_HANDOFF). Continue in this session, or suggest the user run /planner-only handoff at a task boundary.";
		}
		if (!this.#requested && (this.#runtime.activity.rootContext ?? 0) <= threshold) {
			return `your context is about ${formatTokens(this.#runtime.activity.rootContext ?? 0)} tokens, below the ${formatTokens(threshold)} threshold, and the user did not request a handoff. Continue the work in this session.`;
		}
		if (brief.length < 200) return "brief must be at least 200 characters.";
		return undefined;
	}

	async #dispatch(handoff: PendingHandoff, ctx: ExtensionCommandContext): Promise<void> {
		const { git } = this.#runtime;
		if (!handoff.selection) {
			const model = ctx.model;
			if (!model) {
				this.#defer(handoff);
				ctx.ui.notify("handoff refused: the current model cannot be identified; run /planner-only handoff to retry, or /planner-only handoff drop to discard it", "warning");
				return;
			}
			handoff.selection = { provider: model.provider, id: model.id, ...(ctx.thinkingLevel === undefined ? {} : { thinkingLevel: String(ctx.thinkingLevel) }) };
			this.#pending = handoff;
		}
		const prompt = handoffPrompt(handoff, await gatherGitFacts(git, handoff.cwd));
		const mode = handoffMode();
		try {
			const result = await ctx.newSession({ parentSession: handoff.sessionFile, withSession: async (rctx) => {
				rctx.ui.notify("planner-only: handoff from previous session", "info");
				try {
					const selection = handoff.selection;
					if (!selection) throw new Error("source model selection is missing");
					const pi = activeHandoff ? activeHandoff.#runtime.pi : undefined;
					if (!pi) throw new Error("live host model bridge is unavailable");
					const model = rctx.modelRegistry.find(selection.provider, selection.id);
					if (!model) throw new Error(`model ${selection.provider}/${selection.id} is unavailable in the new session`);
					if (!await pi.setModel(model)) throw new Error(`host refused model ${selection.provider}/${selection.id}`);
					if (selection.thinkingLevel !== undefined) (pi.setThinkingLevel as (level: string) => void)(selection.thinkingLevel);
					const current = rctx.model;
					if (!current || current.provider !== selection.provider || current.id !== selection.id) throw new Error(`active model did not match ${selection.provider}/${selection.id}`);
					if (selection.thinkingLevel !== undefined && rctx.thinkingLevel !== selection.thinkingLevel) throw new Error(`thinking level did not match ${selection.thinkingLevel}`);
					if (mode === "confirm") {
						rctx.ui.setEditorText(prompt);
						rctx.ui.notify(`Handoff ready. Submit when ready.${selection.thinkingLevel === undefined ? " Thinking level was not carried over." : ""}`, "info");
					} else {
						await rctx.sendUserMessage(prompt);
						if (selection.thinkingLevel === undefined) rctx.ui.notify("Thinking level was not carried over.", "info");
					}
				} catch (error) {
					const reason = error instanceof Error ? error.message : String(error);
					(activeHandoff ?? this).#defer({ ...handoff, selection: handoff.selection });
					rctx.ui.notify(`handoff settings could not be restored (${reason}); brief was not sent. Run /planner-only handoff to retry, or /planner-only handoff drop to discard it`, "warning");
				}
			} });
			if (result?.cancelled) {
				this.#defer(handoff);
				ctx.ui.notify("handoff cancelled; run /planner-only handoff to retry, or /planner-only handoff drop to discard it", "warning");
			} else this.deactivate();
		} catch (error) {
			const liveHandoff = activeHandoff ?? this;
			liveHandoff.#defer(handoff);
			const reason = error instanceof Error ? error.message : String(error);
			try {
				ctx.ui.notify(`handoff failed (${reason}); run /planner-only handoff to retry, or /planner-only handoff drop to discard it`, "warning");
			} catch {
				// Session replacement invalidates the old command context.
			}
		}
	}
}
