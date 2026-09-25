/**
 * Domain-agnostic text, number and duration formatters shared by the git,
 * delegation and extension modules.
 */
import type { SubagentDelegationUsage } from "./subagent-delegation-contract.ts";

/** Keep the head only, noting how much was dropped. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

/** Keep the head and the tail: children put the report at the end. */
export function clipHeadTail(text: string, max: number): string {
	if (text.length <= max) return text;
	const head = Math.floor(max * 0.25);
	return `${text.slice(0, head)}\n… [${text.length - max} chars omitted] …\n${text.slice(text.length - (max - head))}`;
}

export function collapseWs(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/** 45s, 8m21s */
export function formatSeconds(ms: number): string {
	const s = Math.round(ms / 1000);
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** Token counts with k/M/B units, about three significant digits, no trailing zeros: 950, 3.5k, 65.4k, 806k, 1.36M, 2.1B. */
export function formatTokens(n: number): string {
	if (!Number.isFinite(n)) return "0";
	const units: Array<[number, string]> = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
	for (let i = 0; i < units.length; i++) {
		const [size, unit] = units[i];
		if (Math.abs(n) < size) continue;
		const v = n / size;
		const digits = Math.abs(v) < 10 ? 2 : Math.abs(v) < 100 ? 1 : 0;
		const trim = (s: string) => (s.includes(".") ? s.replace(/\.?0+$/, "") : s);
		const text = v.toFixed(digits);
		// 999.5k rounds to "1000k": promote to the next unit instead.
		if (i > 0 && Math.abs(Number(text)) >= 1000) return `${trim((n / units[i - 1][0]).toFixed(2))}${units[i - 1][1]}`;
		return `${trim(text)}${unit}`;
	}
	return String(Math.round(n));
}

export function formatUsage(usage: SubagentDelegationUsage | undefined): string {
	if (!usage) return "usage unknown";
	const tokens = usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	return `${formatTokens(tokens)} tok · $${usage.cost.toFixed(4)} · ${usage.turns} turns · ${Math.round(usage.durationMs / 1000)}s`;
}
