/**
 * TaskSpec construction/validation and the Task lifecycle store.
 *
 * WorkerReport protocol lives in report.ts. This module owns identity and the
 * state machine. Live write-lock ownership lives in Orchestration.
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
	MAX_REPORT_CORRECTIONS,
	MAX_REVIEW_ROUNDS,
	EXECUTING_STALE_MS,
	isFinalTaskState,
} from "./types.ts";
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
	TaskUsage,
	TaskValidation,
	WorkerReport,
} from "./types.ts";
import type { EvidenceComparison } from "./evidence.ts";
import type { WorkspaceSnapshotBinding } from "./workspace-snapshot.ts";
import { jsonCandidates } from "./report.ts";
import { emptyTaskUsage } from "./usage.ts";

const TASK_ROLES: readonly TaskRole[] = ["worker", "explorer", "validator", "reviewer"];

/**
 * FR-04 — capability profiles per role. The write lock follows actual write
 * ability, not the role's name: a validator with a general shell can mutate
 * the tree, and an unbounded worker keeps its own tools. roles.ts re-exports
 * this table so agent remapping and write coordination cannot drift apart.
 */
export const ROLE_TOOL_PROFILES: Record<TaskRole, readonly string[] | undefined> = {
	explorer: ["read", "grep", "find", "ls"],
	reviewer: ["read", "grep", "find", "ls"],
	validator: ["read", "grep", "find", "ls", "bash"],
	worker: undefined,
};

/** Tools that can mutate the working tree or execute arbitrary programs. */
export const MUTATING_TOOLS = ["edit", "write", "bash"] as const;

/** Whether the role's tool ceiling includes anything that can mutate the tree. */
export function roleAllowsMutatingTools(role: TaskRole): boolean {
	const tools = ROLE_TOOL_PROFILES[role];
	if (tools === undefined) return true;
	return tools.some((tool) => (MUTATING_TOOLS as readonly string[]).includes(tool));
}

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
	if (value.budget !== undefined) {
		if (!isPlainObject(value.budget)) {
			errors.push("budget must be an object when present");
		} else {
			const budget = value.budget as Record<string, unknown>;
			if (budget.tokens !== undefined) {
				if (typeof budget.tokens !== "number" || !Number.isFinite(budget.tokens) || budget.tokens <= 0) {
					errors.push("budget.tokens must be a positive finite number");
				}
			}
			if (budget.costUsd !== undefined) {
				if (typeof budget.costUsd !== "number" || !Number.isFinite(budget.costUsd) || budget.costUsd <= 0) {
					errors.push("budget.costUsd must be a positive finite number");
				}
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

/**
 * Roles whose tool ceiling lets them mutate the working tree. Only these
 * contend for the write lock.
 */
export function isWriterRole(role: TaskRole): boolean {
	return roleAllowsMutatingTools(role);
}

export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
	planning: ["executing", "blocked", "failed"],
	executing: ["reviewing", "blocked", "failed"],
	reviewing: ["completed", "changes_requested", "blocked", "failed"],
	changes_requested: ["executing", "blocked", "failed"],
	blocked: ["executing", "reviewing"],
	failed: ["executing", "reviewing"],
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
	/** Validator (oracle) reports recorded against this Task; not Worker reports. */
	validatorReports: WorkerReport[];
	reviews: ReviewResult[];
	overrides: ReviewOverride[];
	/** Model-chosen ids that still resolve to this Task. */
	aliases: string[];
	reportCorrections: number;
	/** Workspace sample taken right before the worker was dispatched. */
	baseEvidence?: EvidenceRef;
	/** `reports.length` when baseEvidence was sampled; a later recorded report ends that round. */
	baseReportCount?: number;
	/** Result of the most recent Root A-to-C evidence comparison. */
	lastComparison?: EvidenceComparison;
	/** Workspace snapshot bound to the latest recorded report (ticket 10). */
	snapshot?: WorkspaceSnapshotBinding;
	/** Reason for an operator-forced terminal state, when applicable. */
	stateReason?: string;
	/** Per-task usage snapshot; live totals live in UsageLedger. Initialised empty. */
	usage: TaskUsage;
	createdAt: string;
	updatedAt: string;
}

export interface TaskStoreOptions {
	now?: () => Date;
}

export class TaskStore {
	private readonly tasks = new Map<string, TaskRecord>();
	private readonly clock: () => Date;
	private sequence = 0;

	constructor(options: TaskStoreOptions = {}) {
		this.clock = options.now ?? (() => new Date());
	}

	now(): Date {
		return this.clock();
	}

	nextTaskId(): string {
		this.sequence += 1;
		return createTaskId(this.now(), this.sequence);
	}

	create(spec?: TaskSpec, alias?: string): TaskRecord {
		const taskId = spec?.taskId?.trim() || this.nextTaskId();
		if (this.tasks.has(taskId)) return this.tasks.get(taskId) as TaskRecord;
		const timestamp = this.now().toISOString();
		const aliases = alias && alias !== taskId ? [alias] : [];
		const record: TaskRecord = {
			taskId,
			...(spec ? { spec } : {}),
			role: spec?.role ?? "worker",
			cwd: spec?.cwd ?? "",
			state: "planning",
			reviewRound: 0,
			reviewMode: "root",
			reports: [],
			validatorReports: [],
			reviews: [],
			overrides: [],
			aliases,
			reportCorrections: 0,
			usage: emptyTaskUsage(),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.tasks.set(taskId, record);
		return record;
	}

	get(taskId: string): TaskRecord | undefined {
		const direct = this.tasks.get(taskId);
		if (direct) return direct;
		for (const task of this.tasks.values()) {
			if (task.aliases.includes(taskId)) return task;
		}
		return undefined;
	}

	require(taskId: string): TaskRecord {
		const record = this.get(taskId);
		if (!record) throw new Error(`unknown task: ${taskId}`);
		return record;
	}

	list(): TaskRecord[] {
		return [...this.tasks.values()];
	}

	/** Most recently updated task that is not in a terminal state. */
	active(): TaskRecord | undefined {
		return this.list()
			.filter((task) => !isFinalTaskState(task.state))
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
		if (record.cwd) return record;
		record.cwd = cwd;
		return this.touch(record);
	}

	setBaseEvidence(taskId: string, evidence: EvidenceRef): TaskRecord {
		const record = this.require(taskId);
		if (record.baseEvidence) return record;
		record.baseEvidence = evidence;
		record.baseReportCount = record.reports.length;
		return this.touch(record);
	}

	clearBaseEvidence(taskId: string): TaskRecord {
		const record = this.require(taskId);
		delete record.baseEvidence;
		delete record.baseReportCount;
		return this.touch(record);
	}

	/**
	 * L-2 — the base sample belongs to a review round. It is kept across
	 * corrections and re-binds (no report recorded since it was taken) and
	 * re-sampled only once a WorkerReport has been recorded against it.
	 */
	baseRoundEnded(taskId: string): boolean {
		const record = this.require(taskId);
		return record.baseEvidence !== undefined
			&& record.reports.length > (record.baseReportCount ?? 0);
	}

	setLastComparison(taskId: string, comparison: EvidenceComparison): TaskRecord {
		const record = this.require(taskId);
		record.lastComparison = comparison;
		return this.touch(record);
	}

	/** Bind the workspace snapshot that validated the latest report (ticket 10). */
	setSnapshot(taskId: string, binding: WorkspaceSnapshotBinding): TaskRecord {
		const record = this.require(taskId);
		record.snapshot = binding;
		return this.touch(record);
	}

	/**
	 * Record why a Task needs attention (e.g. a stale write-lock holder that
	 * needs reconcile). Task memory fields such as `stateReason` are written
	 * only here — Orchestration must not mutate a TaskRecord in place.
	 */
	setStateReason(taskId: string, reason: string): TaskRecord {
		const record = this.require(taskId);
		record.stateReason = reason;
		return this.touch(record);
	}

	recordReport(taskId: string, report: WorkerReport): TaskRecord {
		const record = this.require(taskId);
		record.reports.push(report);
		return this.touch(record);
	}

	recordValidatorReport(taskId: string, report: WorkerReport): TaskRecord {
		const record = this.require(taskId);
		record.validatorReports.push(report);
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
		if (isFinalTaskState(record.state)) {
			throw new Error(`cannot abandon terminal task: ${record.state}`);
		}
		this.transition(taskId, "failed");
		record.stateReason = reason;
		delete record.baseEvidence;
		delete record.baseReportCount;
		delete record.snapshot;
		return this.touch(record);
	}
}

/** The stale-duration in whole minutes, for human-readable lock messages. */
export function executingStaleMinutes(): number {
	return Math.round(EXECUTING_STALE_MS / 60000);
}

export function isExecutingStale(task: TaskRecord, now = Date.now()): boolean {
	if (task.state !== "executing") return false;
	const updated = Date.parse(task.updatedAt);
	return Number.isFinite(updated) && now - updated >= EXECUTING_STALE_MS;
}

/** A live lock holder is stale by age, independent of Task.state. */
export function isHolderStale(task: TaskRecord, now = Date.now()): boolean {
	if (isFinalTaskState(task.state)) return false;
	const updated = Date.parse(task.updatedAt);
	return Number.isFinite(updated) && now - updated >= EXECUTING_STALE_MS;
}

export interface WriterConflict {
	conflict: boolean;
	reason?: string;
	taskId?: string;
}

/**
 * FR-04 / D07 — at most one writable invocation per worktree at a time.
 *
 * This store-level helper keys on Task records and is not the live lock.
 * Live lock ownership is decided by Orchestration over its pending Delegations
 * (a live writable Delegation holds the lock even while its Task is reviewing
 * or blocked). The helper keeps the refusal-copy shape and cwd-alias policy
 * for unit tests of those pieces; do not treat `state === "executing"` here
 * as product behaviour.
 *
 * The lock follows actual write ability (`isWriterRole`), not the presence of
 * a TaskSpec or the worker role name: a warn-mode unstructured worker and a
 * shell-capable validator contend just the same, and a second call on the
 * *same* Task is not a free pass — re-entry goes through this check too.
 *
 * cwd identity is normalized through `realpath` so relative paths and symlink
 * aliases of one worktree collide; independent worktrees stay independent.
 *
 * A stale-looking holder still blocks: timeout is not exit. The lock is
 * released only when the child run is consumed (result, notice, or artifact
 * reconcile) or the operator abandons the Task.
 */
export function normalizeWorkspaceIdentity(cwd: string): string {
	const absolute = resolve(cwd);
	try {
		return realpathSync(absolute);
	} catch {
		// Unrenamed/uncreated paths still collide by resolved text.
		return absolute;
	}
}

export function findWriterConflict(
	tasks: readonly TaskRecord[],
	cwd: string,
	role: TaskRole,
	now: number = Date.now(),
): WriterConflict {
	if (!isWriterRole(role)) return { conflict: false };
	const target = normalizeWorkspaceIdentity(cwd);
	const holder = tasks.find(
		(task) =>
			isWriterRole(task.role) &&
			task.state === "executing" &&
			task.cwd !== "" &&
			normalizeWorkspaceIdentity(task.cwd) === target,
	);
	if (!holder) return { conflict: false };
	const stale = isExecutingStale(holder, now);
	return {
		conflict: true,
		taskId: holder.taskId,
		reason: [
			`Planner-only guard: task ${holder.taskId} already holds the write lock for ${target}.`,
			stale
				? `That task has been executing for over ${Math.round(EXECUTING_STALE_MS / 60000)} minutes and its child run has not been confirmed exited; reconcile the run (or abandon the task) before starting another writer.`
				: "Keep one writable invocation per worktree; even a second call on the same Task must wait.",
			"Wait for that run's result to release the lock, or delegate this one into a separate worktree.",
		].join("\n"),
	};
}
