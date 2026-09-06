/**
 * WorkerReport protocol: the only structured thing a Worker returns.
 *
 * JSON scrape, validation, compaction, and rendering live here so Reviewer
 * parsing and Task lifecycle do not share a kitchen-sink module.
 */

import {
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	WORKER_REPORT_VERSION,
} from "./types.ts";
import type {
	ReviewMode,
	TaskState,
	ValidationResult,
	ValidationStatus,
	ValidationType,
	WorkerReport,
	WorkerStatus,
} from "./types.ts";

const WORKER_STATUSES: readonly WorkerStatus[] = ["completed", "partial", "blocked", "failed"];
const VALIDATION_TYPES: readonly ValidationType[] = [
	"test",
	"build",
	"lint",
	"typecheck",
	"manual",
	"other",
];
const VALIDATION_STATUSES: readonly ValidationStatus[] = ["passed", "failed", "not-run"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function validateValidationResult(value: unknown, index: number): string[] {
	const label = `validation[${index}]`;
	if (!isPlainObject(value)) return [`${label} must be an object`];
	const errors: string[] = [];
	if (!isNonEmptyString(value.type) || !VALIDATION_TYPES.includes(value.type as ValidationType)) {
		errors.push(`${label}.type must be one of ${VALIDATION_TYPES.join(", ")}`);
	}
	if (
		!isNonEmptyString(value.status) ||
		!VALIDATION_STATUSES.includes(value.status as ValidationStatus)
	) {
		errors.push(`${label}.status must be one of ${VALIDATION_STATUSES.join(", ")}`);
	}
	if (!isNonEmptyString(value.summary)) errors.push(`${label}.summary must be a non-empty string`);
	if (value.exitCode !== undefined && !Number.isInteger(value.exitCode)) {
		errors.push(`${label}.exitCode must be an integer when present`);
	}
	return errors;
}

export function validateWorkerReport(value: unknown): string[] {
	if (!isPlainObject(value)) return ["WorkerReport must be an object"];
	const errors: string[] = [];
	if (value.version !== WORKER_REPORT_VERSION) {
		errors.push(`version must be ${WORKER_REPORT_VERSION}`);
	}
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.status) || !WORKER_STATUSES.includes(value.status as WorkerStatus)) {
		errors.push(`status must be one of ${WORKER_STATUSES.join(", ")}`);
	}
	if (typeof value.summary !== "string") errors.push("summary must be a string");
	for (const key of ["changedFiles", "risks", "unresolved"] as const) {
		if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
		else if (!isStringArray(value[key])) errors.push(`${key} must be an array of strings`);
	}
	if (!Array.isArray(value.validation)) errors.push("validation must be an array");
	else value.validation.forEach((item, index) => errors.push(...validateValidationResult(item, index)));
	if (!isPlainObject(value.evidence)) errors.push("evidence must be an object");
	else {
		if (!isNonEmptyString(value.evidence.taskId)) errors.push("evidence.taskId must be a non-empty string");
		if (isNonEmptyString(value.taskId) && value.evidence.taskId !== value.taskId) {
			errors.push("evidence.taskId must match taskId");
		}
	}
	if (value.notes !== undefined && !isStringArray(value.notes)) {
		errors.push("notes must be an array of strings when present");
	}
	return errors;
}

export function isWorkerReport(value: unknown): value is WorkerReport {
	return validateWorkerReport(value).length === 0;
}

export interface ExtractedReport {
	report?: WorkerReport;
	error?: string;
	repairs: string[];
}

export interface NormalisedReport {
	report: unknown;
	repairs: string[];
}

const VERSION_ONE_STRINGS = new Set(["1", "1.0"]);
const STATUS_TO_COMPLETED = new Set(["done", "success", "succeeded", "complete", "ok"]);
const STATUS_TO_PARTIAL = new Set(["in_progress", "in-progress", "incomplete", "partially_completed"]);
const STATUS_TO_FAILED = new Set(["error", "errored"]);
const LIST_OBJECT_KEYS = ["path", "file", "filePath", "name", "text", "summary", "description", "message"] as const;
const ALIAS_TO_CANONICAL: ReadonlyArray<readonly [string, "changedFiles" | "unresolved"]> = [
	["unresolvedItems", "unresolved"],
	["unresolved_items", "unresolved"],
	["changed_files", "changedFiles"],
	["changedPaths", "changedFiles"],
];
const TYPE_SUBSTRING_MAP: ReadonlyArray<readonly [readonly string[], ValidationType]> = [
	[["typecheck", "tsc", "type-check", "types"], "typecheck"],
	[["manual", "inspect", "review"], "manual"],
	[["test", "spec", "jest", "vitest", "pytest", "mocha"], "test"],
	[["lint", "eslint", "prettier", "biome"], "lint"],
	[["build", "compile", "bundle"], "build"],
];
const VALIDATION_STATUS_PASSED = new Set(["pass", "passed", "ok", "success", "green", "true"]);
const VALIDATION_STATUS_FAILED = new Set(["fail", "failed", "error", "red", "false"]);
const VALIDATION_STATUS_NOT_RUN = new Set(["skipped", "skip", "not-run", "not_run", "not run", "none", "n/a"]);

function cloneUnknown(value: unknown): unknown {
	if (value === undefined) return undefined;
	return JSON.parse(JSON.stringify(value));
}

function formatRaw(value: unknown): string {
	if (value === undefined) return "";
	if (typeof value === "string") return value;
	return String(value);
}

function token(value: unknown): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "string") return value.trim().toLowerCase();
	return "";
}

function isAcceptedVersion(raw: unknown): boolean {
	return raw === 1 || raw === undefined || (typeof raw === "string" && VERSION_ONE_STRINGS.has(raw));
}

function mapValidationType(raw: unknown): ValidationType {
	const text = typeof raw === "string" ? raw.toLowerCase() : "";
	for (const [needles, canonical] of TYPE_SUBSTRING_MAP) {
		if (needles.some((needle) => text.includes(needle))) return canonical;
	}
	return "other";
}

function mapValidationStatusToken(raw: unknown): ValidationStatus | undefined {
	const key = token(raw);
	if (VALIDATION_STATUS_PASSED.has(key)) return "passed";
	if (VALIDATION_STATUS_FAILED.has(key)) return "failed";
	if (VALIDATION_STATUS_NOT_RUN.has(key)) return "not-run";
	return undefined;
}

function mapListItem(item: unknown): unknown {
	if (!isPlainObject(item)) return item;
	for (const key of LIST_OBJECT_KEYS) {
		if (isNonEmptyString(item[key])) return item[key];
	}
	return item;
}

function repairStringList(
	target: Record<string, unknown>,
	key: "changedFiles" | "risks" | "unresolved" | "notes",
	repairs: string[],
	missingToEmpty: boolean,
): void {
	const value = target[key];
	if (typeof value === "string") {
		target[key] = [value];
		repairs.push(`${key} string wrapped in array`);
		return;
	}
	if (Array.isArray(value) && value.some((item) => isPlainObject(item))) {
		target[key] = value.map(mapListItem);
		repairs.push(`${key} objects mapped to strings`);
		return;
	}
	if (value === undefined && missingToEmpty) {
		target[key] = [];
		repairs.push(`${key} missing → []`);
	}
}

function repairValidationEntries(entries: unknown[], repairs: string[]): void {
	entries.forEach((item, index) => {
		if (!isPlainObject(item)) return;
		const label = `validation[${index}]`;
		const rawType = item.type;
		const mappedType = mapValidationType(rawType);
		if (rawType !== mappedType) {
			item.type = mappedType;
			repairs.push(`${label}.type "${formatRaw(rawType)}" → ${mappedType}`);
		}
		if (item.status !== undefined && item.status !== null && item.status !== "") {
			const mappedStatus = mapValidationStatusToken(item.status);
			if (mappedStatus && item.status !== mappedStatus) {
				const rawStatus = item.status;
				item.status = mappedStatus;
				repairs.push(`${label}.status "${formatRaw(rawStatus)}" → ${mappedStatus}`);
			}
		} else {
			let inferred: ValidationStatus = "not-run";
			if (item.exitCode === 0) inferred = "passed";
			else if (Number.isInteger(item.exitCode) && item.exitCode !== 0) inferred = "failed";
			item.status = inferred;
			repairs.push(`${label}.status missing → ${inferred}`);
		}
		if (!isNonEmptyString(item.summary)) {
			const fallback = isNonEmptyString(item.command)
				? item.command
				: typeof rawType === "string" && rawType.trim()
					? rawType
					: "(no summary)";
			item.summary = fallback;
			repairs.push(`${label}.summary missing → "${fallback}"`);
		}
		if (typeof item.exitCode === "string" && /^-?\d+$/.test(item.exitCode)) {
			const parsed = Number.parseInt(item.exitCode, 10);
			repairs.push(`${label}.exitCode "${item.exitCode}" → ${parsed}`);
			item.exitCode = parsed;
		}
	});
}

const GIT_STATUS_HASH_RE = /^[0-9a-f]{16}$/;

/**
 * Root-owned evidence fields a worker cannot know. `gitStatusHash` is Root's
 * own digest and `workerRunId` is the tool-call id minted at launch; a worker
 * that fills them in is guessing, and a guess would fail freshness or identity
 * on every round (observed 2026-09-05, re-measurement T4). Drop values that
 * cannot be right and stamp the run id the orchestrator knows.
 */
function hardenEvidence(
	evidence: Record<string, unknown>,
	repairs: string[],
	context?: { expectedWorkerRunId?: string },
): void {
	const hash = evidence.gitStatusHash;
	if (hash !== undefined && !(typeof hash === "string" && GIT_STATUS_HASH_RE.test(hash))) {
		delete evidence.gitStatusHash;
		repairs.push(`evidence.gitStatusHash "${formatRaw(hash)}" dropped (not a Root hash)`);
	}
	if (evidence.dirtyPathHashes !== undefined) {
		// Content binding is Root's own sample; a worker-supplied map would let
		// the report vouch for itself.
		delete evidence.dirtyPathHashes;
		repairs.push("evidence.dirtyPathHashes dropped (Root-owned binding)");
	}
	const expected = context?.expectedWorkerRunId;
	if (expected) {
		const runId = evidence.workerRunId;
		if (runId === undefined || runId === "") {
			evidence.workerRunId = expected;
			repairs.push(`evidence.workerRunId missing → ${expected}`);
		} else if (runId !== expected) {
			evidence.workerRunId = expected;
			repairs.push(`evidence.workerRunId "${formatRaw(runId)}" → ${expected} (worker cannot know the run id)`);
		}
	}
}

/**
 * Mechanically repair cheap-worker WorkerReport shapes before schema validation.
 * Repairs are idempotent and applied in spec §3 table order, except alias
 * rename runs immediately before missing-array defaults so unresolvedItems
 * is not discarded by `unresolved missing → []`.
 */
export function normalizeWorkerReport(
	value: unknown,
	context?: { expectedTaskId?: string; expectedWorkerRunId?: string },
): NormalisedReport {
	const report = cloneUnknown(value);
	if (!isPlainObject(report)) return { report, repairs: [] };
	const repairs: string[] = [];

	if (isAcceptedVersion(report.version) && report.version !== 1) {
		repairs.push(report.version === undefined ? "version missing → 1" : `version "${formatRaw(report.version)}" → 1`);
		report.version = 1;
	}

	const taskIdMissing = !isNonEmptyString(report.taskId);
	if (taskIdMissing && context?.expectedTaskId) {
		const evidenceId = isPlainObject(report.evidence) && isNonEmptyString(report.evidence.taskId)
			? report.evidence.taskId
			: undefined;
		const copied = evidenceId ?? context.expectedTaskId;
		report.taskId = copied;
		repairs.push(
			evidenceId
				? `taskId copied from evidence.taskId`
				: `taskId copied from expectedTaskId`,
		);
	}

	const statusKey = typeof report.status === "string" ? report.status.trim().toLowerCase() : "";
	if (STATUS_TO_COMPLETED.has(statusKey)) {
		repairs.push(`status "${formatRaw(report.status)}" → completed`);
		report.status = "completed";
	} else if (STATUS_TO_PARTIAL.has(statusKey)) {
		repairs.push(`status "${formatRaw(report.status)}" → partial`);
		report.status = "partial";
	} else if (STATUS_TO_FAILED.has(statusKey)) {
		repairs.push(`status "${formatRaw(report.status)}" → failed`);
		report.status = "failed";
	}

	if (report.summary === undefined) {
		report.summary = "";
		repairs.push(`summary missing → ""`);
	}

	for (const [alias, canonical] of ALIAS_TO_CANONICAL) {
		if (report[canonical] === undefined && report[alias] !== undefined) {
			report[canonical] = report[alias];
			delete report[alias];
			repairs.push(`${alias} renamed to ${canonical}`);
		}
	}

	repairStringList(report, "changedFiles", repairs, true);
	repairStringList(report, "risks", repairs, true);
	repairStringList(report, "unresolved", repairs, true);
	repairStringList(report, "notes", repairs, false);

	if (report.validation === undefined || report.validation === null) {
		repairs.push(report.validation === null ? `validation null → []` : `validation missing → []`);
		report.validation = [];
	} else if (isPlainObject(report.validation)) {
		report.validation = [report.validation];
		repairs.push(`validation object wrapped in array`);
	}
	if (Array.isArray(report.validation)) {
		repairValidationEntries(report.validation, repairs);
	}

	if (typeof report.evidence === "string") {
		// Root samples its own evidence; a prose "evidence" carries nothing the
		// comparison can use, so keep the text as a note and rebuild the object.
		const prose = report.evidence.trim();
		if (prose) {
			const notes = Array.isArray(report.notes) ? report.notes : [];
			report.notes = [...notes, `evidence (worker text): ${prose}`];
		}
		delete report.evidence;
		repairs.push(`evidence string → { taskId } (text kept in notes)`);
	}
	if (report.evidence === undefined) {
		const taskId = isNonEmptyString(report.taskId) ? report.taskId : "";
		report.evidence = { taskId };
		repairs.push(`evidence missing → { taskId }`);
	} else if (isPlainObject(report.evidence)) {
		if (!isNonEmptyString(report.evidence.taskId) && isNonEmptyString(report.taskId)) {
			report.evidence.taskId = report.taskId;
			repairs.push(`evidence.taskId copied from taskId`);
		}
	}
	if (isPlainObject(report.evidence)) hardenEvidence(report.evidence, repairs, context);

	return { report, repairs };
}

/** The task identity a Worker result must claim: the delegated task and run. */
export interface WorkerReportIdentity {
	taskId: string;
	aliases?: readonly string[];
	workerRunId?: string;
}

function identityMatches(value: string, expected: WorkerReportIdentity): boolean {
	return value === expected.taskId || (expected.aliases ?? []).includes(value);
}

/**
 * §P0-1 — a schema-valid WorkerReport may still belong to a different task.
 *
 * Identity is checked against the delegation, not the report itself:
 * `taskId`, `evidence.taskId` must match the delegated task or any alias, and
 * `evidence.workerRunId` must match the subagent call when both sides carry one.
 */
export function validateWorkerReportIdentity(
	report: WorkerReport,
	expected: WorkerReportIdentity,
): string[] {
	const errors: string[] = [];
	if (!identityMatches(report.taskId, expected)) {
		errors.push(
			`WorkerReport taskId mismatch: expected ${expected.taskId}, got ${report.taskId}`,
		);
	}
	if (!identityMatches(report.evidence.taskId, expected)) {
		errors.push(
			`WorkerReport evidence.taskId mismatch: expected ${expected.taskId}, got ${report.evidence.taskId}`,
		);
	}
	if (
		expected.workerRunId &&
		report.evidence.workerRunId &&
		report.evidence.workerRunId !== expected.workerRunId
	) {
		errors.push(
			`WorkerReport evidence.workerRunId mismatch: expected ${expected.workerRunId}, got ${report.evidence.workerRunId}`,
		);
	}
	return errors;
}

/** Scan for top-level `{...}` objects while ignoring braces inside strings. */
function scanBalancedObjects(text: string): string[] {
	const found: string[] = [];
	for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < text.length; index += 1) {
			const char = text[index];
			if (inString) {
				if (escaped) escaped = false;
				else if (char === "\\") escaped = true;
				else if (char === '"') inString = false;
				continue;
			}
			if (char === '"') inString = true;
			else if (char === "{") depth += 1;
			else if (char === "}") {
				depth -= 1;
				if (depth === 0) {
					found.push(text.slice(start, index + 1));
					break;
				}
			}
		}
	}
	return found;
}

export function jsonCandidates(text: string): string[] {
	const candidates = [text.trim()];
	for (const match of text.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)```/g)) {
		if (match[1]?.trim()) candidates.push(match[1].trim());
	}
	candidates.push(...scanBalancedObjects(text));
	return [...new Set(candidates)];
}

function looksLikeReport(value: unknown): boolean {
	return isPlainObject(value) && ("taskId" in value || "status" in value);
}

/**
 * Pull a WorkerReport out of free-form worker output.
 *
 * Workers are told to return a fenced JSON WorkerReport, but they routinely
 * wrap it in prose. Only a schema-valid report is accepted; anything else must
 * trigger a report-only correction rather than silent acceptance.
 */
export function extractWorkerReport(
	text: string,
	context?: { expectedTaskId?: string; expectedWorkerRunId?: string },
): ExtractedReport {
	if (typeof text !== "string" || !text.trim()) {
		return { error: "worker returned no output", repairs: [] };
	}

	let bestErrors: string[] | undefined;
	let bestRepairs: string[] = [];
	let sawReportShape = false;

	for (const candidate of jsonCandidates(text)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}
		if (!looksLikeReport(parsed)) continue;
		sawReportShape = true;
		const normalised = normalizeWorkerReport(parsed, context);
		const errors = validateWorkerReport(normalised.report);
		if (errors.length === 0) {
			return { report: normalised.report as WorkerReport, repairs: normalised.repairs };
		}
		if (!bestErrors || errors.length < bestErrors.length) {
			bestErrors = errors;
			bestRepairs = normalised.repairs;
		}
	}

	if (bestErrors) return { error: `invalid WorkerReport: ${bestErrors.join("; ")}`, repairs: bestRepairs };
	if (sawReportShape) return { error: "invalid WorkerReport", repairs: bestRepairs };
	return { error: "worker output did not contain a WorkerReport object", repairs: [] };
}

const COMPACTION_LEVELS = [
	{ notes: Number.POSITIVE_INFINITY, items: Number.POSITIVE_INFINITY, field: Number.POSITIVE_INFINITY },
	{ notes: 0, items: Number.POSITIVE_INFINITY, field: Number.POSITIVE_INFINITY },
	{ notes: 0, items: 40, field: 2000 },
	{ notes: 0, items: 20, field: 600 },
	{ notes: 0, items: 8, field: 240 },
	{ notes: 0, items: 4, field: 120 },
] as const;

function truncate(value: string, limit: number): string {
	if (value.length <= limit) return value;
	return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function clampList(values: readonly string[], limit: number, field: number): string[] {
	return values.slice(0, limit).map((value) => truncate(value, field));
}

function clampValidation(
	values: readonly ValidationResult[],
	limit: number,
	field: number,
): ValidationResult[] {
	return values.slice(0, limit).map((item) => ({ ...item, summary: truncate(item.summary, field) }));
}

function measure(report: WorkerReport): number {
	return stableStringify(report).length;
}

/**
 * Shrink a report until it fits the parent's context budget.
 *
 * Cutting order matters: notes go first, then list length and field size, and
 * the summary is only shortened when nothing else fits. Validation commands and
 * exit codes are never dropped — they are the part the parent actually reviews.
 */
export function compactWorkerReport(
	report: WorkerReport,
	maxChars: number = MAX_WORKER_REPORT_CHARS,
): { report: WorkerReport; compacted: boolean } {
	if (measure(report) <= maxChars) return { report, compacted: false };

	for (const level of COMPACTION_LEVELS) {
		const candidate: WorkerReport = {
			...report,
			summary: report.summary,
			changedFiles: clampList(report.changedFiles, level.items, level.field),
			validation: clampValidation(report.validation, level.items, level.field),
			risks: clampList(report.risks, level.items, level.field),
			unresolved: clampList(report.unresolved, level.items, level.field),
			...(report.notes ? { notes: clampList(report.notes, level.notes, level.field) } : {}),
		};
		if (measure(candidate) <= maxChars) return { report: candidate, compacted: true };
	}

	const minimal: WorkerReport = {
		...report,
		summary: truncate(report.summary, 400),
		changedFiles: clampList(report.changedFiles, 4, 120),
		validation: clampValidation(report.validation, 4, 120),
		risks: clampList(report.risks, 4, 120),
		unresolved: clampList(report.unresolved, 4, 120),
	};
	if (report.notes) minimal.notes = [];
	return { report: minimal, compacted: true };
}

function renderList(title: string, values: readonly string[]): string[] {
	if (values.length === 0) return [`${title}: (none)`];
	return [(`${title} (${values.length}):`), ...values.map((value) => `- ${value}`)];
}

export function renderValidationResults(values: readonly ValidationResult[]): string[] {
	if (values.length === 0) return ["Validation: (none reported)"];
	return ["Validation:", ...values.map((item) => {
		const parts = [
			item.command,
			Number.isInteger(item.exitCode) ? `exit ${item.exitCode}` : undefined,
		].filter(Boolean);
		const detail = parts.length > 0 ? `${parts.join(" ")} — ` : "";
		return `- [${item.status}] ${item.type}: ${detail}${item.summary}`;
	})];
}

export function renderWorkerReport(
	report: WorkerReport,
	context: { round?: number; maxRounds?: number; state?: TaskState; evidence?: string; reviewMode?: ReviewMode } = {},
): string {
	const lines: string[] = ["[PLANNER-ONLY WORKER REPORT]"];
	lines.push(`taskId: ${report.taskId}`);
	lines.push(`status: ${report.status}`);
	if (context.state) lines.push(`state: ${context.state}`);
	if (context.round !== undefined) {
		lines.push(`round: ${context.round}/${context.maxRounds ?? MAX_REVIEW_ROUNDS}`);
	}
	if (context.reviewMode) lines.push(`review mode: ${context.reviewMode}`);
	if (context.evidence) lines.push(`evidence: ${context.evidence}`);
	lines.push("");
	lines.push(`Summary: ${report.summary}`);
	lines.push("");
	lines.push(...renderList("Changed files", report.changedFiles));
	lines.push("");
	lines.push(...renderValidationResults(report.validation));
	lines.push("");
	lines.push(
		"Evidence ref (Worker declaration; Root A-to-C attribution is in the comparison):",
		`  cwd: ${report.evidence.cwd}`,
		`  run: ${report.evidence.workerRunId}`,
		`  base: ${report.evidence.baseGitRef ?? "(none)"}`,
		`  head: ${report.evidence.finalGitRef ?? "(none)"}`,
		`  statusHash: ${report.evidence.gitStatusHash ?? "(none)"}`,
		...(report.evidence.diffStat
			? [`  diffStat: ${report.evidence.diffStat.split("\n").pop()?.trim()}`]
			: []),
	);
	lines.push("");
	lines.push(...renderList("Risks", report.risks));
	lines.push("");
	lines.push(...renderList("Unresolved", report.unresolved));
	return lines.join("\n");
}
