/**
 * TaskSpec construction/validation and the Task lifecycle store.
 *
 * WorkerReport protocol lives in report.ts. This module owns identity, the
 * state machine, and the one-writer-per-cwd lock.
 */

import { resolve } from "node:path";
import {
	MAX_REPORT_CORRECTIONS,
	MAX_REVIEW_ROUNDS,
	EXECUTING_STALE_MS,
	isTerminalTaskState,
} from "./types.ts";
import type { EvidenceComparison } from "./evidence.ts";
import { jsonCandidates } from "./report.ts";
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
	WorkerReport,
} from "./types.ts";

const TASK_ROLES: readonly TaskRole[] = ["worker", "explorer", "validator", "reviewer"];

/** Roles that may mutate the working tree. Only these take the write lock. */
const WRITER_ROLES: readonly TaskRole[] = ["worker"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function uniqueNonEmpty(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

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

/** Pull a TaskSpec the parent embedded in a delegation prompt. */
export function extractTaskSpec(text: string): TaskSpec | undefined {
	if (!text.trim()) return undefined;
	for (const candidate of jsonCandidates(text)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed) ||
			!("objective" in parsed)
		) {
			continue;
		}
		if (validateTaskSpec(parsed).length === 0) return parsed as TaskSpec;
	}
	return undefined;
}

/** Roles the spec says a reviewer may never hold mutating tools in. */
export function isWriterRole(role: TaskRole): boolean {
	return WRITER_ROLES.includes(role);
}

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
	/** Result of the most recent Root A-to-C evidence comparison. */
	lastComparison?: EvidenceComparison;
	/** Reason for an operator-forced terminal state, when applicable. */
	stateReason?: string;
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

	private touch(record: TaskRecord): TaskRecord {
		record.updatedAt = this.now().toISOString();
		return record;
	}

	transition(taskId: string, next: TaskState): TaskRecord {
		const record = this.require(taskId);
		if (record.state === next) return record;
		if (!canTransition(record.state, next)) {
			throw new Error(`illegal task transition: ${record.state} -> ${next}`);
		}
		record.state = next;
		return this.touch(record);
	}

	bindSpec(taskId: string, spec: TaskSpec): TaskRecord {
		const record = this.require(taskId);
		record.spec = spec;
		record.role = spec.role;
		record.cwd = spec.cwd;
		return this.touch(record);
	}

	ensureCwd(taskId: string, cwd: string): TaskRecord {
		const record = this.require(taskId);
		if (!record.cwd) record.cwd = cwd;
		return this.touch(record);
	}

	setBaseEvidence(taskId: string, evidence: EvidenceRef): TaskRecord {
		const record = this.require(taskId);
		record.baseEvidence = evidence;
		return this.touch(record);
	}

	setLastComparison(taskId: string, comparison: EvidenceComparison): TaskRecord {
		const record = this.require(taskId);
		record.lastComparison = comparison;
		return this.touch(record);
	}

	recordReport(taskId: string, report: WorkerReport): TaskRecord {
		const record = this.require(taskId);
		record.reports.push(report);
		return this.touch(record);
	}

	recordReview(taskId: string, review: ReviewResult): TaskRecord {
		const record = this.require(taskId);
		record.reviews.push(review);
		return this.touch(record);
	}

	/** §12 — the parent may override a reviewer, but the reason is recorded. */
	recordOverride(taskId: string, override: Omit<ReviewOverride, "taskId" | "at">): TaskRecord {
		const record = this.require(taskId);
		record.overrides.push({ ...override, taskId, at: this.now().toISOString() });
		return this.touch(record);
	}

	setReviewMode(taskId: string, mode: ReviewMode): TaskRecord {
		const record = this.require(taskId);
		record.reviewMode = mode;
		return this.touch(record);
	}

	/** A requested fix or revalidation; bounded by MAX_REVIEW_ROUNDS. */
	incrementRound(taskId: string): TaskRecord {
		const record = this.require(taskId);
		record.reviewRound += 1;
		return this.touch(record);
	}

	countReportCorrections(taskId: string): number {
		return this.require(taskId).reportCorrections;
	}

	useReportCorrection(taskId: string): TaskRecord {
		const record = this.require(taskId);
		record.reportCorrections += 1;
		return this.touch(record);
	}

	canRequestAnotherFix(taskId: string): boolean {
		return this.require(taskId).reviewRound < MAX_REVIEW_ROUNDS;
	}

	canCorrectReport(taskId: string): boolean {
		return this.require(taskId).reportCorrections < MAX_REPORT_CORRECTIONS;
	}

	/** Release a stuck task through the operator escape hatch. */
	abandon(taskId: string, reason = "abandoned by operator"): TaskRecord {
		const record = this.require(taskId);
		if (isTerminalTaskState(record.state)) {
			throw new Error(`cannot abandon terminal task: ${record.state}`);
		}
		this.transition(taskId, "failed");
		record.stateReason = reason;
		return this.touch(record);
	}
}

export function isExecutingStale(task: TaskRecord, now = Date.now()): boolean {
	if (task.state !== "executing") return false;
	const updated = Date.parse(task.updatedAt);
	return Number.isFinite(updated) && now - updated >= EXECUTING_STALE_MS;
}

export interface WriterConflict {
	conflict: boolean;
	reason?: string;
	taskId?: string;
}

/**
 * §14 — at most one writer per cwd at a time.
 *
 * Exact cwd equality only: a writer in `/repo` and another in
 * `/repo/packages/a` do not conflict. Path-prefix / worktree overlap is a
 * known limitation; the A-to-C evidence model attributes every change in its
 * window to the delegation, so this lock is a precondition for correct
 * attribution, not merely a convenience.
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
			!isExecutingStale(task) &&
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
