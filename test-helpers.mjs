import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** In-memory pi.events stand-in that records emissions and live listeners. */
export function fakeBus() {
	const handlers = new Map();
	const emitted = [];
	return {
		emitted,
		on(event, handler) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(handler);
			return () => handlers.get(event)?.delete(handler);
		},
		emit(event, data) {
			emitted.push([event, data]);
			for (const handler of [...(handlers.get(event) ?? [])]) handler(data);
		},
		listeners(event) {
			return handlers.get(event)?.size ?? 0;
		},
		totalListeners() {
			return [...handlers.values()].reduce((n, set) => n + set.size, 0);
		},
	};
}

/** Git runner for a directory that is not a repository. */
export const noGit = async () => ({ stdout: "", stderr: "fatal: not a git repository", code: 128 });

export const usage = (over = {}) => ({ input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, cost: 0.0123, turns: 3, toolCalls: 4, durationMs: 12_000, ...over });

/** Temp dir; run tests with TMPDIR outside the repo (e.g. /project/tmp). */
export function tempDir(prefix) {
	return mkdtempSync(join(tmpdir(), prefix));
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
