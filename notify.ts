/**
 * Parse pi-subagents 0.65.1 `subagent-notify` completion text and locate the
 * saved child output for a runId. Read-only: never writes the filesystem.
 *
 * A single-run completion carries no runId in its text (pi-subagents only
 * emits `Child runs:` for workflow children), so callers must match the
 * notice to a delegation by the WorkerReport's own `taskId` first and fall
 * back to the agent name. `runIds` is populated when the text has them.
 */

import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const PREVIEW_TRUNCATED_MARKER = "...[preview truncated]";
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_META_BYTES = 2 * 1024 * 1024;
/** pi-subagents run-directory roots whose parent is the temp root. */
const RUN_ROOT_DIR_NAMES = new Set(["async-subagent-runs", "nested-subagent-runs"]);

export interface ParsedSubagentNotify {
	runIds: string[];
	status: string;
	agent: string;
	preview: string;
	truncated: boolean;
	/** First complete `"taskId": "…"` value found in the text, when any. */
	taskIdHint?: string;
}

const METADATA_PREFIXES = [
	"Child runs: ",
	"Workflow run: ",
	"Parallel handoff: ",
	"Reconciled detached child: ",
	"Watchdog blockers:",
];

function isMetadataLine(line: string): boolean {
	if (/^(Session|Session file|Session share error):\s+/.test(line)) return true;
	return METADATA_PREFIXES.some((prefix) => line.startsWith(prefix) || line === prefix.slice(0, -1));
}

function parseChildRunIds(line: string): string[] {
	if (!line.startsWith("Child runs: ")) return [];
	return line
		.slice("Child runs: ".length)
		.split(", ")
		.map((part) => {
			const trimmed = part.trim();
			const statusMatch = trimmed.match(/^(.*?)(?: \(([^)]*)\))?$/);
			const raw = statusMatch?.[1] ?? trimmed;
			const separator = raw.indexOf("=");
			return (separator >= 0 ? raw.slice(separator + 1) : raw).trim();
		})
		.filter(Boolean);
}

function collectRunIds(lines: readonly string[]): string[] {
	const runIds: string[] = [];
	for (const line of lines) {
		runIds.push(...parseChildRunIds(line));
	}
	return runIds;
}

function singlePreview(lines: readonly string[]): string {
	const body = lines.slice(2);
	let end = body.length;
	for (let i = 0; i < body.length; i++) {
		if (isMetadataLine(body[i] ?? "")) {
			end = i > 0 && (body[i - 1] ?? "").trim() === "" ? i - 1 : i;
			break;
		}
	}
	return body.slice(0, end).join("\n").trim() || "(no output)";
}

function groupedPreview(lines: readonly string[]): string {
	const blocks: string[] = [];
	let current: string[] = [];
	for (const line of lines.slice(2)) {
		if (/^\d+\.\s/.test(line)) {
			if (current.length) blocks.push(current.join("\n").trim());
			current = [];
			continue;
		}
		if (isMetadataLine(line)) continue;
		if (line.trim() === "" && current.length === 0) continue;
		current.push(line);
	}
	if (current.length) blocks.push(current.join("\n").trim());
	return blocks.filter(Boolean).join("\n\n") || "(no output)";
}

/** First complete `"taskId": "<value>"` in the text; a truncated value does not match. */
export function taskIdHintFromText(text: string): string | undefined {
	const match = text.match(/"taskId"\s*:\s*"([^"\\]{1,200})"/);
	return match?.[1];
}

/**
 * Parse the exact strings produced by pi-subagents 0.65.1
 * `formatSingleCompletion` / `formatGroupedCompletion`. Unparseable input
 * returns `undefined`. `runIds` is empty for single-run completions.
 */
export function parseSubagentNotify(content: string): ParsedSubagentNotify | undefined {
	if (typeof content !== "string" || !content.trim()) return undefined;
	const lines = content.split("\n");
	const first = lines[0] ?? "";
	const single = first.match(
		/^(Background task|Detached foreground task) (completed|failed|paused|stopped): \*\*(.+?)\*\*/,
	);
	const grouped = first.match(/^Background tasks completed \((\d+)\): (.+)$/);
	if (!single && !grouped) return undefined;

	const runIds = collectRunIds(lines);

	let status: string;
	let agent: string;
	let preview: string;
	if (single) {
		status = single[2] ?? "";
		agent = single[3] ?? "";
		preview = singlePreview(lines);
	} else {
		status = "completed";
		const agents = (grouped?.[2] ?? "").match(/\*\*(.+?)\*\*/g) ?? [];
		agent = (agents[0] ?? "").replace(/^\*\*|\*\*$/g, "");
		preview = groupedPreview(lines);
	}

	const taskIdHint = taskIdHintFromText(preview);
	return {
		runIds,
		status,
		agent,
		preview,
		truncated: preview.includes(PREVIEW_TRUNCATED_MARKER) || content.includes(PREVIEW_TRUNCATED_MARKER),
		...(taskIdHint ? { taskIdHint } : {}),
	};
}

function isUnsafeRunId(runId: string): boolean {
	return runId.length === 0 || runId.includes("/") || runId.includes("\\") || runId.includes("..");
}

/**
 * pi-subagents temp root for a launch receipt's `asyncDir`. The receipt points
 * at `<root>/async-subagent-runs/<id>` (or `<root>/nested-subagent-runs/<rootRun>/<id>`);
 * outputs live at `<root>/artifacts/outputs/<id>/`.
 */
export function tempRootFromAsyncDir(asyncDir: string): string | undefined {
	let current = asyncDir;
	for (let depth = 0; depth < 6; depth++) {
		const parent = dirname(current);
		if (parent === current) return undefined;
		if (RUN_ROOT_DIR_NAMES.has(basename(current))) return parent;
		current = parent;
	}
	return undefined;
}

/**
 * Read-only: the largest regular file ≤ 1 MiB under
 * `<tempRoot>/artifacts/outputs/<runId>/`. Missing or unreadable → undefined.
 */
export function readLargestRunOutput(asyncDir: string | undefined, runId: string): string | undefined {
	if (!asyncDir || isUnsafeRunId(runId)) return undefined;
	const root = tempRootFromAsyncDir(asyncDir);
	if (!root) return undefined;
	const dir = join(root, "artifacts", "outputs", runId);
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return undefined;
	}

	let best: { path: string; size: number } | undefined;
	for (const name of entries) {
		const path = join(dir, name);
		let st;
		try {
			st = statSync(path);
		} catch {
			continue;
		}
		if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) continue;
		if (!best || st.size > best.size || (st.size === best.size && path < best.path)) {
			best = { path, size: st.size };
		}
	}
	if (!best) return undefined;
	try {
		return readFileSync(best.path, "utf8");
	} catch {
		return undefined;
	}
}

export const ASYNC_PREVIEW_TRUNCATED_REASON = "async preview truncated";
export { PREVIEW_TRUNCATED_MARKER };

function childMetaNames(runId: string, agent: string): string[] {
	const safe = `${runId}_${agent.replace(/[^\w.-]/g, "_")}`;
	return [`${safe}_meta.json`, `${safe}_0_meta.json`];
}

/** What a child-run `_meta.json` yields: identity, terminal state, cost. */
export interface ChildRunMeta {
	runId: string;
	agent: string;
	/** Numeric exit code marks the run terminal; absent means state unknown. */
	exitCode?: number;
	model?: string;
	usage?: unknown;
}

function tryReadChildMetaFile(
	path: string,
	runId: string,
	agent: string,
): ChildRunMeta | undefined {
	let st;
	try {
		st = lstatSync(path);
	} catch {
		return undefined;
	}
	if (!st.isFile() || st.size > MAX_META_BYTES) return undefined;
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	const rec = parsed as Record<string, unknown>;
	if (rec.runId !== runId || rec.agent !== agent) return undefined;
	return {
		runId,
		agent,
		// A numeric exitCode marks the run as terminal even when the completion
		// notice was lost; its absence means the run state is unknown.
		...(typeof rec.exitCode === "number" ? { exitCode: rec.exitCode } : {}),
		...(typeof rec.model === "string" ? { model: rec.model } : {}),
		...("usage" in rec ? { usage: rec.usage } : {}),
	};
}

/**
 * Read a child run's `_meta.json` from artifact directories, in order.
 * Async runs write `<runId>_<agent>_meta.json`; sync writes `_0_meta.json`.
 * Both names are tried. Size cap 2 MiB; no symlink following; must echo runId and agent.
 * A numeric `exitCode` on the meta marks the run terminal.
 */
export function readChildMeta(
	artifactDirs: readonly string[],
	runId: string,
	agent: string,
): ChildRunMeta | undefined {
	if (isUnsafeRunId(runId) || !agent) return undefined;
	const names = childMetaNames(runId, agent);
	for (const dir of artifactDirs) {
		if (!dir) continue;
		for (const name of names) {
			const found = tryReadChildMetaFile(join(dir, name), runId, agent);
			if (found) return found;
		}
	}
	return undefined;
}
