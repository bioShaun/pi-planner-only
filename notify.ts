/**
 * Parse pi-subagents 0.65.1 `subagent-notify` completion text and locate the
 * saved child output for a runId. Read-only: never writes the filesystem.
 *
 * A single-run completion carries no runId in its text (pi-subagents only
 * emits `Child runs:` for workflow children), so callers must match the
 * notice to a delegation by the WorkerReport's own `taskId` first and fall
 * back to the agent name. `runIds` is populated when the text has them.
 */

import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { childOutcomeFromExitCode, childUsageFromValue } from "./usage.ts";
import { extractFinalAssistantText, type FinalAssistantOptions } from "./report.ts";
import type { ChildProvenance, ChildUsage, DelegationKind } from "./types.ts";

const PREVIEW_TRUNCATED_MARKER = "...[preview truncated]";
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_META_BYTES = 2 * 1024 * 1024;
export interface SessionBindingContext {
	asyncDir?: string;
	statusRunId?: string;
	sessionDir?: string;
	expectedSessionFile?: string;
	stepIndex?: number;
	agent?: string;
	meta?: { childSessionFile?: string; sourceDir?: string; runId?: string };
}

/**
 * Verify that a candidate session file is authentically bound to the specified runId.
 * Prevents sibling-run ingestion, symlink escapes, and unauthorized file traversal.
 * Session body text matching is strictly forbidden as an identity proof; fails closed
 * when independent trusted binding is unavailable.
 */
export function verifySessionFileBinding(
	sessionPath: string,
	runId: string,
	context: SessionBindingContext = {},
): boolean {
	if (!sessionPath || !runId) return false;
	if (context.statusRunId !== undefined && (!context.statusRunId || context.statusRunId !== runId)) return false;

	let realSession: string;
	try {
		realSession = realpathSync(sessionPath);
		const st = lstatSync(realSession);
		if (!st.isFile()) return false;
	} catch {
		return false;
	}

	if (context.asyncDir) {
		const statusPath = join(context.asyncDir, "status.json");
		let statusText: string | undefined;
		try {
			const st = lstatSync(statusPath);
			if (st.isFile() && st.size <= MAX_OUTPUT_BYTES) {
				statusText = readFileSync(statusPath, "utf8");
			}
		} catch {}

		if (statusText) {
			try {
				const status = JSON.parse(statusText) as {
					runId?: string;
					steps?: Array<{ agent?: string; sessionFile?: string }>;
					sessionFile?: string;
				};
				// Strict trust root: status.runId MUST strictly equal runId
				if (!status.runId || status.runId !== runId) return false;

				const steps = Array.isArray(status?.steps) ? status.steps : [];
				let targetFile: string | undefined;

				if (context.stepIndex !== undefined) {
					if (context.stepIndex < 0 || context.stepIndex >= steps.length) {
						return false; // Out of bounds step
					}
					const step = steps[context.stepIndex];
					if (context.agent && step?.agent && step.agent !== context.agent) {
						return false; // Agent mismatch
					}
					targetFile = step?.sessionFile;
				} else if (steps.length === 1) {
					const step0 = steps[0];
					if (context.agent && step0?.agent && step0.agent !== context.agent) {
						return false; // Agent mismatch
					}
					targetFile = step0?.sessionFile ?? status.sessionFile;
				} else if (steps.length > 1) {
					if (context.agent) {
						const matching = steps.filter((s) => s.agent === context.agent);
						if (matching.length === 1) {
							targetFile = matching[0]?.sessionFile;
						} else {
							return false; // Ambiguous same-named agent or 0 matches
						}
					} else {
						return false; // Ambiguous multiple steps without binding
					}
				} else {
					if (typeof status?.sessionFile === "string") {
						targetFile = status.sessionFile;
					}
				}

				if (typeof targetFile === "string") {
					if (!isAbsolute(targetFile)) {
						const resolved = resolve(context.asyncDir, targetFile);
						const relToAsync = relative(context.asyncDir, resolved);
						if (relToAsync.startsWith("..") || isAbsolute(relToAsync)) {
							return false; // Relative path traversal escaping asyncDir!
						}
					}
					const resolvedTarget = isAbsolute(targetFile)
						? targetFile
						: resolve(context.asyncDir, targetFile);
					try {
						const realExpected = realpathSync(resolvedTarget);
						const realAsync = realpathSync(context.asyncDir);
						const relDeclared = relative(context.asyncDir, resolvedTarget);
						const isDeclaredInside = !relDeclared.startsWith("..") && !isAbsolute(relDeclared);
						if (isDeclaredInside) {
							const relReal = relative(realAsync, realExpected);
							if (relReal.startsWith("..") || isAbsolute(relReal)) {
								return false; // Symlink escaping asyncDir!
							}
						}
						if (realExpected === realSession) return true;
					} catch {}
					return false;
				}
			} catch {
				return false; // Malformed status.json
			}
		}

		// Modern async runs require strict status.runId + exact sessionFile binding.
		// Missing, empty, unreadable, or mismatched status.json MUST NOT fall back to directory membership.
		return false;
	}

	if (context.expectedSessionFile) {
		try {
			const realExpected = realpathSync(context.expectedSessionFile);
			if (realExpected === realSession) return true;
		} catch {}
		return false;
	}

	if (context.meta && (!context.meta.runId || context.meta.runId === runId)) {
		if (context.meta.childSessionFile) {
			try {
				if (realpathSync(context.meta.childSessionFile) === realSession) return true;
			} catch {}
		}
	}

	return false;
}

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

export interface RunOutputBinding extends FinalAssistantOptions {}

/**
 * Read the host-saved output for a run from its runId-keyed artifact directory
 * (`<tempRoot>/artifacts/outputs/<runId>`). Only a bounded, unambiguous single
 * file qualifies, and a structured transcript is reduced to its final assistant
 * text so prompt/tool echoes are never mistaken for the report.
 */
function readSavedArtifactOutput(
	dir: string,
	deterministicNames: readonly string[],
	binding?: RunOutputBinding,
): string | undefined {
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return undefined;
	}
	const deterministic = new Set(deterministicNames);
	const candidates: string[] = [];
	for (const name of entries) {
		if (!deterministic.has(name)) continue;
		const path = join(dir, name);
		let st;
		try {
			st = lstatSync(path);
		} catch {
			continue;
		}
		if (st.isFile() && st.size <= MAX_OUTPUT_BYTES) candidates.push(path);
	}
	if (candidates.length === 0) {
		for (const name of entries) {
			const path = join(dir, name);
			let st;
			try {
				st = lstatSync(path);
			} catch {
				continue;
			}
			if (st.isFile() && st.size <= MAX_OUTPUT_BYTES) candidates.push(path);
		}
	}
	if (candidates.length !== 1) return undefined;
	try {
		const text = readFileSync(candidates[0] as string, "utf8");
		const assistant = extractFinalAssistantText(text, binding);
		if (assistant.ambiguous) return undefined;
		return assistant.hasRoles ? assistant.text : text;
	} catch {
		return undefined;
	}
}

/**
 * Read a legacy run output only when its filename is deterministic. The old
 * largest-file heuristic was unsafe because previews, logs, and reports can
 * coexist in the same directory. An ambiguous directory is deliberately left
 * unresolved so callers can retry with an explicit host output reference.
 */
export function readLargestRunOutput(
	asyncDir: string | undefined,
	runId: string,
	binding?: RunOutputBinding,
): string | undefined {
	if (!asyncDir || isUnsafeRunId(runId)) return undefined;

	// Structured events stream in asyncDir carries authoritative role-bound messages.
	// Prefer extracting the final assistant response to avoid treating the entire
	// runner log (prompt, tool echoes) as the worker's output.
	const eventsPath = join(asyncDir, "events.jsonl");
	let eventsText: string | undefined;
	try {
		const st = lstatSync(eventsPath);
		if (st.isFile() && st.size <= MAX_OUTPUT_BYTES) {
			eventsText = readFileSync(eventsPath, "utf8");
		}
	} catch {
		// Proceed if events.jsonl is not readable
	}
	if (eventsText) {
		const assistant = extractFinalAssistantText(eventsText, binding);
		if (assistant.hasRoles && assistant.text) {
			return assistant.text;
		}
	}

	const statusPath = join(asyncDir, "status.json");
	let statusText: string | undefined;
	try {
		const st = lstatSync(statusPath);
		if (st.isFile() && st.size <= MAX_OUTPUT_BYTES) {
			statusText = readFileSync(statusPath, "utf8");
		}
	} catch {
		// Proceed if status.json is not present or readable
	}

	if (statusText) {
		try {
			const status = JSON.parse(statusText) as {
				runId?: string;
				steps?: Array<{ agent?: string; sessionFile?: string; status?: string }>;
				sessionFile?: string;
				sessionDir?: string;
			};
			if (!runId || (status.runId && status.runId === runId)) {
				let targetSessionFile: string | undefined;
				const steps = Array.isArray(status?.steps) ? status.steps : [];
				if (steps.length === 0) {
					if (typeof status?.sessionFile === "string") {
						targetSessionFile = status.sessionFile;
					}
				} else if (steps.length === 1) {
					const step0 = steps[0];
					const matchStep = binding?.stepIndex === undefined || binding.stepIndex === 0;
					const matchAgent = !binding?.agent || !step0?.agent || step0.agent === binding.agent;
					if (matchStep && matchAgent) {
						targetSessionFile = step0?.sessionFile ?? status.sessionFile;
					}
				} else {
					// Multiple steps: select by exact binding; never silently pick steps[0] or arbitrary last
					if (binding?.stepIndex !== undefined) {
						const step = steps[binding.stepIndex];
						if (step && (!binding.agent || !step.agent || step.agent === binding.agent)) {
							targetSessionFile = step.sessionFile;
						}
					} else if (binding?.agent) {
						const matching = steps.filter((s) => s.agent === binding.agent);
						if (matching.length === 1) {
							targetSessionFile = matching[0]?.sessionFile;
						}
					}
				}

				if (typeof targetSessionFile === "string") {
					const sessionPath = isAbsolute(targetSessionFile)
						? targetSessionFile
						: resolve(asyncDir, targetSessionFile);
					const effectiveRunId = runId ?? status.runId ?? "";
					if (verifySessionFileBinding(sessionPath, effectiveRunId, {
						asyncDir,
						statusRunId: status.runId,
						sessionDir: status.sessionDir,
						expectedSessionFile: sessionPath,
						stepIndex: binding?.stepIndex,
						agent: binding?.agent,
					})) {
						try {
							const sessionText = readFileSync(sessionPath, "utf8");
							const assistant = extractFinalAssistantText(sessionText, binding);
							if (assistant.hasRoles && assistant.text) {
								return assistant.text;
							}
						} catch {
							// sessionFile unreadable
						}
					}
				}
			}
		} catch {
			// Malformed status.json
		}
	}

	// Host-saved output artifacts live in `<tempRoot>/artifacts/outputs/<runId>` — an
	// explicit, runId-keyed directory owned by the host, not the runner log. It stays
	// a valid source even when the modern async control dir has no bound status.json.
	const root = tempRootFromAsyncDir(asyncDir);
	const deterministicNames = [
		"result.json",
		"output.json",
		"output.md",
		`${runId}.json`,
		`${runId}.md`,
	];
	if (root) {
		const saved = readSavedArtifactOutput(join(root, "artifacts", "outputs", runId), deterministicNames, binding);
		if (saved !== undefined) return saved;
	}

	// Modern async runs must never fall back to runner stdout (output-0.log /
	// output.log) or to a bare file inside the control directory itself.
	const isModernAsync =
		eventsText !== undefined ||
		statusText !== undefined ||
		existsSync(statusPath) ||
		existsSync(join(asyncDir, "events.jsonl")) ||
		existsSync(join(asyncDir, "output-0.log")) ||
		existsSync(join(asyncDir, "mission.json")) ||
		existsSync(join(asyncDir, "process-terminal.json")) ||
		RUN_ROOT_DIR_NAMES.has(basename(dirname(asyncDir)));

	if (isModernAsync) {
		return undefined;
	}

	const directCandidates = deterministicNames
		.map((name) => join(asyncDir, name))
		.filter((path, index, paths) => paths.indexOf(path) === index);
	for (const path of directCandidates) {
		let st;
		try {
			st = lstatSync(path);
		} catch {
			continue;
		}
		if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) continue;
		try {
			return readFileSync(path, "utf8");
		} catch {
			continue;
		}
	}
	return undefined;
}

export const readDeterministicRunOutput = readLargestRunOutput;

export const ASYNC_PREVIEW_TRUNCATED_REASON = "async preview truncated";
export { PREVIEW_TRUNCATED_MARKER };

/**
 * Derive the trusted source session from a child meta (NX-01): an explicit
 * session field first, else the transcript/meta path leaf. "unknown" values
 * are never trusted as a final identity.
 */
export function sourceSessionFromMeta(meta: ChildRunMeta): string | undefined {
	const explicit = [meta.sourceSessionId, meta.sessionId, meta.childSessionFile, meta.transcriptPath].find((value) => typeof value === "string" && value.trim() && value.trim() !== "unknown" && value.trim() !== "unknown-session");
	if (explicit) {
		const parts = explicit.split(/[\\/]/).filter(Boolean);
		const leaf = parts.at(-1);
		if (leaf) return leaf.replace(/\.(?:jsonl?|log)$/i, "");
	}
	if (meta.metaPath) {
		const parts = meta.metaPath.split(/[\\/]/).filter(Boolean);
		const marker = parts.lastIndexOf("subagent-artifacts");
		if (marker > 0) return parts[marker - 1];
	}
	return undefined;
}

/**
 * Map a child-run meta to ledger usage. The provenance clump is built once
 * here (issue 05): owner/task/execution bindings come from the meta, the
 * session hint is the trusted source session, and an untrusted source stays
 * unknown with its reason instead of being guessed into a Task/session.
 */
export function childFromMeta(
	meta: ChildRunMeta,
	kind: DelegationKind,
	observedInSessionId?: string,
): ChildUsage | undefined {
	const sourceSessionId = sourceSessionFromMeta(meta);
	const provenance: ChildProvenance = {
		...(meta.ownerRootSessionId ? { ownerRootSessionId: meta.ownerRootSessionId } : {}),
		...(meta.taskId ? { taskId: meta.taskId } : {}),
		...(meta.executionId ? { executionId: meta.executionId } : {}),
		...(sourceSessionId ? { sourceSessionId, sessionHint: sourceSessionId } : {}),
		...(meta.transcriptPath ? { transcriptPath: meta.transcriptPath } : {}),
		...(!sourceSessionId ? { unknownReason: "no trusted source session in child metadata or meta location" } : {}),
	};
	const child = childUsageFromValue(meta.usage, kind, {
		runId: meta.runId,
		...provenance,
		...(observedInSessionId ? { observedInSessionId } : {}),
		agent: meta.agent,
		...(meta.model ? { model: meta.model } : {}),
		...(meta.thinking ? { thinking: meta.thinking } : {}),
		source: "meta-file",
		pending: false,
	});
	if (!child) return undefined;
	return { ...child, outcome: childOutcomeFromExitCode(meta.exitCode) };
}

function childMetaNames(runId: string, agent: string): string[] {
	const safe = `${runId}_${agent.replace(/[^\w.-]/g, "_")}`;
	return [`${safe}_meta.json`, `${safe}_0_meta.json`];
}

/** What a child-run `_meta.json` yields: identity, terminal state, cost. */
export interface ChildRunMeta extends ChildProvenance {
	runId: string;
	agent: string;
	/** Numeric exit code marks the run terminal; absent means state unknown. */
	exitCode?: number;
	model?: string;
	thinking?: string;
	usage?: unknown;
	stopReason?: string;
	childSessionFile?: string;
	sourceDir?: string;
	metaPath?: string;
	error?: string;
}

export function is403RateLimit(value: unknown): boolean {
	if (!value) return false;
	if (typeof value === "string") {
		return /403|permission_error|usage\s*limit|five-hour/i.test(value);
	}
	if (typeof value === "object") {
		const rec = value as Record<string, unknown>;
		return is403RateLimit(rec.error) ||
			is403RateLimit(rec.stopReason) ||
			is403RateLimit(rec.message) ||
			is403RateLimit(rec.status);
	}
	return false;
}

/** Spread-helper: `{ [key]: value }` when the field is a string, else `{}`. */
function pickStringField(rec: Record<string, unknown>, key: string): Record<string, string> {
	return typeof rec[key] === "string" ? { [key]: rec[key] as string } : {};
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
	const errorStr = typeof rec.error === "string"
		? rec.error
		: rec.error && typeof rec.error === "object" && typeof (rec.error as Record<string, unknown>).message === "string"
			? (rec.error as Record<string, unknown>).message as string
			: undefined;
	return {
		runId,
		agent,
		// A numeric exitCode marks the run as terminal even when the completion
		// notice was lost; its absence means the run state is unknown.
		...(typeof rec.exitCode === "number" ? { exitCode: rec.exitCode } : {}),
		...pickStringField(rec, "model"),
		...pickStringField(rec, "thinking"),
		...("usage" in rec ? { usage: rec.usage } : {}),
		...pickStringField(rec, "sourceSessionId"),
		...pickStringField(rec, "sessionId"),
		...pickStringField(rec, "ownerRootSessionId"),
		...pickStringField(rec, "taskId"),
		...pickStringField(rec, "executionId"),
		...pickStringField(rec, "transcriptPath"),
		...pickStringField(rec, "childSessionFile"),
		...pickStringField(rec, "sourceDir"),
		metaPath: path,
		...pickStringField(rec, "stopReason"),
		...(errorStr ? { error: errorStr } : {}),
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

/**
 * Ticket 12 — deterministic saved-output artifacts of a run:
 * `<runId>_<agent>_output.md|json` (pi-subagents `getArtifactPaths`). Matched
 * by runId alone: the persisted/default agent name may differ from the agent
 * actually delegated (e.g. an explorer-kind run delegated to the reviewer
 * agent). Size-capped, no symlink following; zero, one, or more candidates —
 * more than one is ambiguous and callers must fail closed.
 */
export function findRunOutputArtifacts(
	artifactDirs: readonly string[],
	runId: string,
): string[] {
	if (isUnsafeRunId(runId)) return [];
	const prefix = `${runId}_`;
	const found: string[] = [];
	const seen = new Set<string>();
	for (const dir of artifactDirs) {
		if (!dir) continue;
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.startsWith(prefix) || !/_output\.(?:md|json)$/.test(entry)) continue;
			const path = join(dir, entry);
			if (seen.has(path)) continue;
			try {
				const st = lstatSync(path);
				if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) continue;
			} catch {
				continue;
			}
			seen.add(path);
			found.push(path);
		}
	}
	return found;
}

/** Size-capped read of one saved-output artifact; no symlink following. */
export function readRunOutputArtifact(path: string): string | undefined {
	try {
		const st = lstatSync(path);
		if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) return undefined;
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}
