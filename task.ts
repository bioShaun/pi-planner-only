/**
 * TaskSpec construction/validation, WorkerReport validation/compaction, and
 * the task lifecycle state machine.
 *
 * Everything here is pure: no process spawning, no extension API. The
 * `tool_result` hook feeds worker text into `extractWorkerReport` and hands the
 * parent a bounded, validated report instead of a raw transcript.
 */

import { resolve } from "node:path";
import {
	MAX_REPORT_CORRECTIONS,
	MAX_REVIEW_ROUNDS,
	MAX_WORKER_REPORT_CHARS,
	WORKER_REPORT_VERSION,
	isTerminalTaskState,
} from "./types.ts";
import type { EvidenceComparison } from "./evidence.ts";
import type {
	EvidenceRef,
	ExpectedEvidence,
	ReviewMode,
	ReviewOverride,
	ReviewResult,
	TaskRole,
	TaskScope,
	TaskSpec,
	TaskState,
	TaskValidation,
	ValidationResult,
	ValidationStatus,
	ValidationType,
	WorkerReport,
	WorkerStatus,
} from "./types.ts";

const WORKER_STATUSES: readonly WorkerStatus[] = ["completed", "partial", "blocked", "failed"];
const TASK_ROLES: readonly TaskRole[] = ["worker", "explorer", "validator", "reviewer"];
const VALIDATION_TYPES: readonly ValidationType[] = [
	"test",
	"build",
	"lint",
	"typecheck",
	"manual",
	"other",
];
const VALIDATION_STATUSES: readonly ValidationStatus[] = ["passed", "failed", "not-run"];

/** Roles that may mutate the working tree. Only these take the write lock. */
const WRITER_ROLES: readonly TaskRole[] = ["worker"];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

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

function uniqueNonEmpty(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// TaskSpec
// ---------------------------------------------------------------------------

export interface CreateTaskSpecInput {
	taskId?: string;
	objective: string;
	cwd: string;
	role?: TaskRole;
	scope?: TaskScope;
	constraints?: string[];
	acceptanceCriteria?: string[];
	validation?: Partial<TaskValidation>;
	expectedEvidence?: ExpectedEvidence;
	stopConditions?: string[];
	parentEvidenceRef?: EvidenceRef;
}

export function createTaskId(now: Date = new Date(), sequence = 1): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const index = String(Math.max(1, Math.trunc(sequence))).padStart(3, "0");
	return `T-${year}${month}${day}-${index}`;
}

export function createTaskSpec(input: CreateTaskSpecInput, taskId = createTaskId()): TaskSpec {
	return {
		taskId: input.taskId?.trim() || taskId,
		objective: input.objective.trim(),
		cwd: resolve(input.cwd),
		role: input.role ?? "worker",
		scope: {
			...(input.scope?.allowedPaths ? { allowedPaths: uniqueNonEmpty(input.scope.allowedPaths) } : {}),
			...(input.scope?.forbiddenPaths
				? { forbiddenPaths: uniqueNonEmpty(input.scope.forbiddenPaths) }
				: {}),
		},
		constraints: uniqueNonEmpty(input.constraints ?? []),
		acceptanceCriteria: uniqueNonEmpty(input.acceptanceCriteria ?? []),
		validation: {
			required: input.validation?.required ?? false,
			...(input.validation?.commands?.length
				? { commands: uniqueNonEmpty(input.validation.commands) }
				: {}),
			...(input.validation?.expected?.length
				? { expected: uniqueNonEmpty(input.validation.expected) }
				: {}),
		},
		expectedEvidence: input.expectedEvidence ?? {},
		stopConditions: uniqueNonEmpty(input.stopConditions ?? []),
		...(input.parentEvidenceRef ? { parentEvidenceRef: input.parentEvidenceRef } : {}),
	};
}

export function validateTaskSpec(value: unknown): string[] {
	if (!isPlainObject(value)) return ["TaskSpec must be an object"];
	const errors: string[] = [];
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.objective)) errors.push("objective must be a non-empty string");
	if (!isNonEmptyString(value.cwd)) errors.push("cwd must be a non-empty string");
	if (!isNonEmptyString(value.role) || !TASK_ROLES.includes(value.role as TaskRole)) {
		errors.push(`role must be one of ${TASK_ROLES.join(", ")}`);
	}
	if (value.scope !== undefined && !isPlainObject(value.scope)) {
		errors.push("scope must be an object when present");
	}
	if (value.constraints !== undefined && !isStringArray(value.constraints)) {
		errors.push("constraints must be an array of strings");
	}
	if (value.acceptanceCriteria !== undefined && !isStringArray(value.acceptanceCriteria)) {
		errors.push("acceptanceCriteria must be an array of strings");
	}
	if (value.stopConditions !== undefined && !isStringArray(value.stopConditions)) {
		errors.push("stopConditions must be an array of strings");
	}
	if (value.validation !== undefined) {
		if (!isPlainObject(value.validation)) errors.push("validation must be an object when present");
		else {
			if (typeof value.validation.required !== "boolean") {
				errors.push("validation.required must be a boolean");
			}
			if (value.validation.commands !== undefined && !isStringArray(value.validation.commands)) {
				errors.push("validation.commands must be an array of strings");
			}
		}
	}
	return errors;
}

/** Roles the spec says a reviewer may never hold mutating tools in. */
export function isWriterRole(role: TaskRole): boolean {
	return WRITER_ROLES.includes(role);
}

// ---------------------------------------------------------------------------
// WorkerReport
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// WorkerReport extraction
// ---------------------------------------------------------------------------

export interface ExtractedReport {
	report?: WorkerReport;
	error?: string;
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
export function extractWorkerReport(text: string): ExtractedReport {
	if (typeof text !== "string" || !text.trim()) return { error: "worker returned no output" };

	let bestErrors: string[] | undefined;
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
		const errors = validateWorkerReport(parsed);
		if (errors.length === 0) return { report: parsed as WorkerReport };
		if (!bestErrors || errors.length < bestErrors.length) bestErrors = errors;
	}

	if (bestErrors) return { error: `invalid WorkerReport: ${bestErrors.join("; ")}` };
	if (sawReportShape) return { error: "invalid WorkerReport" };
	return { error: "worker output did not contain a WorkerReport object" };
}

// ---------------------------------------------------------------------------
// WorkerReport compaction
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

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
		"Evidence ref:",
		`  cwd: ${report.evidence.cwd}`,
		`  run: ${report.evidence.workerRunId}`,
		`  base: ${report.evidence.baseGitRef ?? "(none)"}`,
		`  head: ${report.evidence.finalGitRef ?? report.evidence.baseGitRef ?? "(none)"}`,
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

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
	planning: ["executing", "blocked", "failed"],
	executing: ["reviewing", "blocked", "failed"],
	reviewing: ["completed", "changes_requested", "blocked", "failed"],
	changes_requested: ["executing", "blocked", "failed"],
	blocked: ["executing"],
	failed: ["executing"],
	completed: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
	return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Task store
// ---------------------------------------------------------------------------

export interface TaskRecord {
	taskId: string;
	spec?: TaskSpec;
	role: TaskRole;
	cwd: string;
	state: TaskState;
	reviewRound: number;
	reviewMode: ReviewMode;
	reports: WorkerReport[];
	reviews: ReviewResult[];
	overrides: ReviewOverride[];
	reportCorrections: number;
	/** Workspace sample taken right before the worker was dispatched. */
	baseEvidence?: EvidenceRef;
	/** Result of the most recent freshness check. */
	lastComparison?: EvidenceComparison;
	createdAt: string;
	updatedAt: string;
}

export interface TaskStoreOptions {
	now?: () => Date;
}

export class TaskStore {
	private readonly tasks = new Map<string, TaskRecord>();
	private readonly now: () => Date;
	private sequence = 0;

	constructor(options: TaskStoreOptions = {}) {
		this.now = options.now ?? (() => new Date());
	}

	nextTaskId(): string {
		this.sequence += 1;
		return createTaskId(this.now(), this.sequence);
	}

	create(spec?: TaskSpec): TaskRecord {
		const taskId = spec?.taskId?.trim() || this.nextTaskId();
		if (this.tasks.has(taskId)) return this.tasks.get(taskId) as TaskRecord;
		const timestamp = this.now().toISOString();
		const record: TaskRecord = {
			taskId,
			...(spec ? { spec } : {}),
			role: spec?.role ?? "worker",
			cwd: spec?.cwd ?? "",
			state: "planning",
			reviewRound: 0,
			reviewMode: "root",
			reports: [],
			reviews: [],
			overrides: [],
			reportCorrections: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.tasks.set(taskId, record);
		return record;
	}

	get(taskId: string): TaskRecord | undefined {
		return this.tasks.get(taskId);
	}

	require(taskId: string): TaskRecord {
		const record = this.tasks.get(taskId);
		if (!record) throw new Error(`unknown task: ${taskId}`);
		return record;
	}

	list(): TaskRecord[] {
		return [...this.tasks.values()];
	}

	/** Most recently updated task that is not in a terminal state. */
	active(): TaskRecord | undefined {
		return this.list()
			.filter((task) => !isTerminalTaskState(task.state))
			.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0];
	}

	transition(taskId: string, next: TaskState): TaskRecord {
		const record = this.require(taskId);
		if (record.state === next) return record;
		if (!canTransition(record.state, next)) {
			throw new Error(`illegal task transition: ${record.state} -> ${next}`);
		}
		record.state = next;
		record.updatedAt = this.now().toISOString();
		return record;
	}

	recordReport(taskId: string, report: WorkerReport): TaskRecord {
		const record = this.require(taskId);
		record.reports.push(report);
		record.updatedAt = this.now().toISOString();
		return record;
	}

	recordReview(taskId: string, review: ReviewResult): TaskRecord {
		const record = this.require(taskId);
		record.reviews.push(review);
		record.updatedAt = this.now().toISOString();
		return record;
	}

	/** §12 — the parent may override a reviewer, but the reason is recorded. */
	recordOverride(taskId: string, override: Omit<ReviewOverride, "taskId" | "at">): TaskRecord {
		const record = this.require(taskId);
		record.overrides.push({ ...override, taskId, at: this.now().toISOString() });
		record.updatedAt = this.now().toISOString();
		return record;
	}

	setReviewMode(taskId: string, mode: ReviewMode): TaskRecord {
		const record = this.require(taskId);
		record.reviewMode = mode;
		record.updatedAt = this.now().toISOString();
		return record;
	}

	/** A requested fix or revalidation; bounded by MAX_REVIEW_ROUNDS. */
	incrementRound(taskId: string): TaskRecord {
		const record = this.require(taskId);
		record.reviewRound += 1;
		record.updatedAt = this.now().toISOString();
		return record;
	}

	countReportCorrections(taskId: string): number {
		return this.require(taskId).reportCorrections;
	}

	useReportCorrection(taskId: string): TaskRecord {
		const record = this.require(taskId);
		record.reportCorrections += 1;
		record.updatedAt = this.now().toISOString();
		return record;
	}

	canRequestAnotherFix(taskId: string): boolean {
		return this.require(taskId).reviewRound < MAX_REVIEW_ROUNDS;
	}

	canCorrectReport(taskId: string): boolean {
		return this.require(taskId).reportCorrections < MAX_REPORT_CORRECTIONS;
	}
}

// ---------------------------------------------------------------------------
// One writer per cwd
// ---------------------------------------------------------------------------

export interface WriterConflict {
	conflict: boolean;
	reason?: string;
	taskId?: string;
}

/**
 * §14 — at most one writer per cwd at a time.
 *
 * Only enforced when the incoming task positively declares a writer role; an
 * unknown role must not block a read-only delegation.
 */
export function findWriterConflict(
	tasks: readonly TaskRecord[],
	cwd: string,
	role: TaskRole,
	selfTaskId?: string,
): WriterConflict {
	if (!isWriterRole(role)) return { conflict: false };
	const target = resolve(cwd);
	const holder = tasks.find(
		(task) =>
			task.taskId !== selfTaskId &&
			isWriterRole(task.role) &&
			task.state === "executing" &&
			task.cwd !== "" &&
			resolve(task.cwd) === target,
	);
	if (!holder) return { conflict: false };
	return {
		conflict: true,
		taskId: holder.taskId,
		reason: [
			`Planner-only guard: task ${holder.taskId} already holds the write lock for ${target}.`,
			"Keep one writer per cwd. Use isolated worktrees for concurrent writers.",
			"Wait for that task to finish, or delegate this one into a separate worktree.",
		].join("\n"),
	};
}
