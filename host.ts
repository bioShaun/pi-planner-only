/**
 * Typed seam between the plugin and the Pi host. Every host capability the
 * tools and handlers need is declared here once, so host-shape drift is a
 * type error in this file and tests stub one small interface.
 */
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext, MessageEndEvent } from "@earendil-works/pi-coding-agent";
import type { EventBus } from "./delegate.ts";

export type HostMessage = MessageEndEvent["message"];
export type HostCustomMessage = Parameters<ExtensionAPI["sendMessage"]>[0];
export type HostSendOptions = Parameters<ExtensionAPI["sendMessage"]>[1];

export interface HostAdapter {
	/** The host event bus pi-subagents listens on; validated once at construction. */
	readonly events: EventBus;
	/** Root's session id; a fresh UUID when the host has none. */
	sessionId(ctx: ExtensionContext): string;
	/** Root's session file, when the host persists one. */
	sessionFile(ctx: ExtensionContext): string | undefined;
	/** Context tokens for the active model; undefined when the host does not report a positive finite number. */
	contextTokens(ctx: ExtensionContext): number | undefined;
	/** Best-effort custom message to the session; never throws into the host handler. */
	sendMessage(message: HostCustomMessage, options?: HostSendOptions): void;
}

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export class HostShapeError extends Error {
	constructor(what: string) {
		super(`planner-only: host ${what}; expected @earendil-works/pi-coding-agent >=0.84`);
		this.name = "HostShapeError";
	}
}

/** Wraps `pi.events` as this plugin's `EventBus`, rejecting hosts without `on`/`emit`. */
export function hostEventBus(events: ExtensionAPI["events"] | undefined): EventBus {
	if (!events || typeof events.on !== "function" || typeof events.emit !== "function") throw new HostShapeError("events bus lacks on/emit");
	return {
		on: (event, handler) => events.on(event, handler),
		emit: (event, data) => events.emit(event, data),
	};
}

/** Tokens and cost from a pi-ai assistant message usage, tolerating missing fields. */
export function rootUsageOf(message: HostMessage | undefined): { tokens: number; context: number; cost: number } | undefined {
	if (message?.role !== "assistant" || !message.usage) return undefined;
	const n = (v: unknown) => (isFiniteNumber(v) ? v : 0);
	const u = message.usage;
	const cost = u.cost && typeof u.cost === "object" ? n(u.cost.total) : 0;
	return { tokens: n(u.input) + n(u.output) + n(u.cacheRead) + n(u.cacheWrite), context: n(u.input) + n(u.cacheRead) + n(u.cacheWrite), cost };
}

export function createHostAdapter(pi: ExtensionAPI): HostAdapter {
	const events = hostEventBus(pi.events);
	return {
		events,
		sessionId(ctx) {
			const manager = ctx.sessionManager;
			const id = manager && typeof manager.getSessionId === "function" ? manager.getSessionId() : undefined;
			return typeof id === "string" && id.length > 0 ? id : randomUUID();
		},
		sessionFile(ctx) {
			const manager = ctx.sessionManager;
			const file = manager && typeof manager.getSessionFile === "function" ? manager.getSessionFile() : undefined;
			return typeof file === "string" && file.length > 0 ? file : undefined;
		},
		contextTokens(ctx) {
			const tokens = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage()?.tokens : undefined;
			return isFiniteNumber(tokens) && tokens > 0 ? tokens : undefined;
		},
		sendMessage(message, options) {
			if (typeof pi.sendMessage !== "function") return;
			try { pi.sendMessage(message, options); } catch { /* Messages must never interrupt the host handler. */ }
		},
	};
}
