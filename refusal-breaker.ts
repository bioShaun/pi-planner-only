/**
 * Ticket 16 — repeated-refusal breaker.
 *
 * Refusal text is written for the model to read; three host observations
 * (2026-09-16, sessions including 01a0a9cc) showed the model can paraphrase
 * the guidance correctly and then re-emit the same arguments verbatim. Only a
 * mechanism that compares what was actually sent can falsify "I changed it
 * this time". This module is the session-level state machine behind that
 * comparison, shared by every Root tool execute wrapper in index.ts.
 *
 * Pure and I/O-free: no imports from index.ts, no pi runtime. The error
 * classes are duck-typed by `name` so this module does not depend on
 * delegate.ts / task.ts (cross-realm instances would fail instanceof anyway).
 */
import { createHash } from "node:crypto";

/** Second identical refusal appends the Repeat notice. */
export const NOTICE_AT = 2;
/** Third identical refusal prepends the STOP line and notifies the UI. */
export const HARD_STOP_AT = 3;
/** The BLOCK_AT-th identical call is intercepted by the tool_call hook and never executes. */
export const BLOCK_AT = 4;

export interface RefusalObservation {
	/** Times this (toolName, canonicalJson(params)) has been refused with the same code in a row, including this one. */
	count: number;
	/** toolCallId of the previous refusal in the streak (same code); absent on count 1. */
	previousToolCallId?: string;
	/** Paragraph to append to the refusal text; present from count NOTICE_AT on. */
	notice?: string;
	/** True from count HARD_STOP_AT on. */
	hardStop: boolean;
}

interface RefusalEntry {
	code: string;
	count: number;
	lastToolCallId: string;
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		// JSON.stringify renders undefined array slots as null — mirror that so
		// canonicalJson output matches what a JSON round-trip would produce.
		return value.map((item) => {
			const canonical = canonicalize(item);
			return canonical === undefined ? null : canonical;
		});
	}
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(value as Record<string, unknown>).sort()) {
			const canonical = canonicalize((value as Record<string, unknown>)[key]);
			if (canonical !== undefined) out[key] = canonical;
		}
		return out;
	}
	return value;
}

/**
 * Byte-stable serialization for comparison only (never shown, never parsed
 * back). Object keys sort recursively and undefined-valued keys drop out, so
 * key order and explicit-undefined noise do not count as different arguments.
 */
export function canonicalJson(value: unknown): string {
	try {
		return JSON.stringify(canonicalize(value)) ?? "null";
	} catch {
		// Params arrive host-decoded as JSON data; a value JSON cannot
		// represent (bigint, circular) falls back to its own string form.
		return String(value);
	}
}

/** Refusal identity: the structured code when the error carries one, else the first message line. */
export function refusalCodeOf(error: unknown): string {
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code === "string" && code) return code;
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n", 1)[0] ?? message;
}

const REFUSAL_MESSAGE_PATTERNS = [
	/^(?:planner_delegate|planner_redelegate|planner_verdict|planner_abort|git_commit) refused\b/,
	/^planner_verdict: unknown task\b/,
	/^planner_abort: unknown task\b/,
];

/**
 * True only for pre-launch refusals — the guard said no before anything ran.
 * `DelegationAborted` (the launch was accepted, then cancelled), abnormal
 * terminations returned via details.termination, and store errors are not
 * refusals: `planner_verdict` wraps operational failures as
 * "refused (store-error, …)", which is excluded explicitly.
 */
export function isRefusal(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	if (error.name === "DelegationAborted") return false;
	if (error.name === "DelegationRefused" || error.name === "TaskSpecContractError") return true;
	const message = error.message;
	if (/^planner_(?:verdict|abort) refused \(store-error/.test(message)) return false;
	return REFUSAL_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

export function summarizeMissingFields(params: unknown, error: unknown): string {
	const missing: string[] = [];
	if (params !== null && typeof params === "object") {
		const obj = params as Record<string, unknown>;
		if (obj.validation !== null && typeof obj.validation === "object") {
			const val = obj.validation as Record<string, unknown>;
			if (val.required === true && (!Array.isArray(val.commands) || val.commands.length === 0)) {
				missing.push("validation.commands");
			}
		}
	}
	const message = error instanceof Error ? error.message : String(error ?? "");
	if (/validation\.commands is required/i.test(message) && !missing.includes("validation.commands")) {
		missing.push("validation.commands");
	}
	if (/(?:missing|requires)\s+(?:task|taskId)/i.test(message) && !missing.includes("taskId")) {
		missing.push("taskId");
	}
	if (/envelope requires at least one of maxTokens/i.test(message) && !missing.includes("envelope")) {
		missing.push("envelope.(maxTokens|maxWallMs)");
	}
	return missing.length > 0 ? missing.join(", ") : "none";
}

export class RefusalBreaker {
	private readonly entries = new Map<string, RefusalEntry>();

	private static keyOf(toolName: string, params: unknown): string {
		const hash = createHash("sha256").update(canonicalJson(params)).digest("hex");
		return `${toolName}:${hash}`;
	}

	observeRefusal(toolName: string, toolCallId: string, params: unknown, error: unknown): RefusalObservation {
		const key = RefusalBreaker.keyOf(toolName, params);
		const code = refusalCodeOf(error);
		const previous = this.entries.get(key);
		const sameStreak = previous !== undefined && previous.code === code;
		// A different code on the same key is progress, not a repeat: restart.
		const count = sameStreak ? previous!.count + 1 : 1;
		const previousToolCallId = sameStreak ? previous!.lastToolCallId : undefined;
		this.entries.set(key, { code, count, lastToolCallId: toolCallId });
		const hardStop = count >= HARD_STOP_AT;
		let notice: string | undefined;
		if (count >= NOTICE_AT) {
			const missingSummary = summarizeMissingFields(params, error);
			const repeat = `Repeat notice: 本边界收到的规范化参数相同 (observed boundary: root tool input; previous toolCallId: ${previousToolCallId}; refusal code: ${code}; missing fields: ${missingSummary}). Read back the arguments actually received at this boundary before calling again.`;
			notice = hardStop
				? `STOP: this exact call has now been refused ${count} times with ${code}. Do not call ${toolName} again with these arguments. Report the received arguments verbatim to the user and wait for instruction.\n${repeat}`
				: repeat;
		}
		return {
			count,
			...(previousToolCallId !== undefined ? { previousToolCallId } : {}),
			...(notice !== undefined ? { notice } : {}),
			hardStop,
		};
	}

	/** A success on the same key ends the streak — the next refusal counts from 1 again. */
	observeSuccess(toolName: string, params: unknown): void {
		this.entries.delete(RefusalBreaker.keyOf(toolName, params));
	}

	/**
	 * Pre-execution gate for the tool_call hook: an identical call that would
	 * become the BLOCK_AT-th refusal is intercepted instead of executed.
	 */
	shouldBlock(toolName: string, params: unknown): { block: true; reason: string } | { block: false } {
		const entry = this.entries.get(RefusalBreaker.keyOf(toolName, params));
		if (!entry || entry.count + 1 < BLOCK_AT) return { block: false };
		return {
			block: true,
			reason: `planner-only: identical call refused ${entry.count} times with ${entry.code}; blocked. Change the arguments or ask the user.`,
		};
	}

	/** Session-scoped by construction — session_start clears the table. */
	reset(): void {
		this.entries.clear();
	}
}
