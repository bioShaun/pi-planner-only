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

export type ExtractedOk = {
	ok: true;
	report: WorkerReport;
	repairs: string[];
	level: "schema-valid" | "repairable";
};

export type ExtractedErr = {
	ok: false;
	error: string;
	repairs: string[];
	/** Present when a report-shaped candidate was seen but could not be accepted. */
	level?: "irreparable";
	/** Keys of the best failed candidate, when known — diagnostic only, not trusted fields. */
	seenKeys?: string;
};

/**
 * Discriminated parse result. Success carries a schema-valid WorkerReport;
 * failure never pretends success fields exist (same honesty bar as host
 * SubagentDelegationInvalidResponse / invalid_request).
 */
export type ExtractedReport = ExtractedOk | ExtractedErr;

export function isExtractedOk(r: ExtractedReport): r is ExtractedOk {
	return r.ok === true;
}


export function isToolCallId(id: string | undefined): boolean {
	if (!id || typeof id !== "string") return false;
	const trimmed = id.trim();
	return trimmed.startsWith("call_") || trimmed.startsWith("tool_") || trimmed.startsWith("toolu_") || trimmed.includes("|");
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

/** Compact JSON shape shown to workers so a report-only round is not the first time they see it.
 * This is a copyable valid instance, not a value legend. Status enumerations
 * (completed|partial|blocked|failed) and validation enumerations
 * (type: test|build|lint|typecheck|manual|other; status: passed|failed|not-run)
 * live here in prose so the JSON itself passes validateWorkerReport. */
export function workerReportShapeReminder(taskId: string): string {
	return JSON.stringify({
		version: 1,
		taskId,
		status: "completed",
		summary: "Scoped change is done.",
		changedFiles: [],
		validation: [{
			command: "npm test",
			type: "test",
			status: "not-run",
			summary: "npm test was not run in this worker round",
		}],
		evidence: { taskId },
		risks: [],
		unresolved: [],
	});
}


export function stripContractReminders(text: string): string {
	return text.replace(
		/\[PLANNER-ONLY WORKER CONTRACT\][\s\S]*?(?:If a lockfile is modified anyway, list it in changedFiles\.|\n(?=[a-zA-Z0-9_\-\.\/]+:|\n|\Z))/g,
		"",
	);
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
	context: { round?: number; maxRounds?: number; state?: TaskState; evidence?: string; reviewMode?: ReviewMode; workspaceDigest?: string } = {},
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
		`  workspaceDigest: ${context.workspaceDigest ?? "(none)"}`,
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
