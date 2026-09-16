/**
 * TaskSpec construction/validation and the Task lifecycle store.
 *
 * WorkerReport protocol lives in report.ts. This module owns identity and the
 * state machine. Live write-lock ownership lives in Orchestration.
 */

import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	realpathSync,
	readdirSync,
	renameSync,
	statSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
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
	RootVerdictRefusalRecord,
	TaskExecutionRecord,
	TaskFinding,
	TaskRole,
	TaskScope,
	TaskSpec,
	TaskState,
	TaskUsage,
	TaskValidation,
	WorkerReport,
} from "./types.ts";
import { normalizeRepoRelativePath, type EvidenceComparison } from "./evidence.ts";
import type { WorkspaceSnapshotBinding } from "./workspace-snapshot.ts";
import { emptyTaskUsage } from "./usage.ts";
import { SAFE_TASK_ID } from "./ledger-store.ts";

const TASK_ROLES: readonly TaskRole[] = ["worker", "explorer", "validator", "reviewer"];
const explicitlyNoValidation = new WeakSet<TaskSpec>();
const generatedTaskIdSpecs = new WeakSet<TaskSpec>();


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

function describeFinding(kind: TaskFinding["kind"], paths: readonly string[]): string {
	const list = paths.join(", ");
	switch (kind) {
		case "undeclared":
			return `in-scope changes the report did not declare: ${list}`;
		case "scope":
			return `attributed changes outside the TaskSpec scope: ${list}`;
		case "over-declared":
			return `declared paths with no attributed change: ${list}`;
		case "missing":
			return `declared changes no longer present: ${list}`;
		case "drift":
			return `workspace changed after the report: ${list}`;
		case "superseded":
			return `workspace change attributed to a successor Task: ${list}`;
		case "committed":
			return `workspace change attributed to a committed successor Task: ${list}`;
	}
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
	/** Ticket 42 — explicit report-only correction marker. */
	reportOnly?: boolean;
	/** Explicit additional linked-worktree roots; resolved absolute, cwd omitted. */
	additionalWorktreeRoots?: string[];
	/** Pre-located evidence fragments for the worker. */
	contextPack?: TaskSpec["contextPack"];
	/** Files to read first; used to calculate the exploration warning. */
	readFirst?: string[];
	/** Parent Task for a derived correction or commit Task. */
	parentTaskId?: string;
	/** Existing Task whose work this Task commits. */
	commitOf?: string;
}

/**
 * IS-01 — structured, actionable Task identity failures. Codes are stable
 * contract surface: adapters and tests match on `code`, never on message
 * text.
 */
export type TaskIdentityErrorCode =
	| "TASK_ID_CONFLICT"
	| "TASK_ID_ALLOCATION_FAILED"
	| "TASK_WORKSPACE_MISMATCH"
	| "TASK_ALIAS_CONFLICT"
	| "TASK_NOT_FOUND";

export class TaskIdentityError extends Error {
	readonly code: TaskIdentityErrorCode;
	/** True when re-trying the same operation later may succeed (lock contention). */
	readonly retryable: boolean;
	readonly taskId?: string;

	constructor(
		code: TaskIdentityErrorCode,
		message: string,
		options: { retryable?: boolean; taskId?: string } = {},
	) {
		super(message);
		this.name = "TaskIdentityError";
		this.code = code;
		this.retryable = options.retryable ?? false;
		this.taskId = options.taskId;
	}
}

const IDENTITY_LOCK_STALE_MS = 30_000;
const IDENTITY_LOCK_RETRY_MS = 10;
const IDENTITY_LOCK_TIMEOUT_MS = 10_000;

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export interface TaskIdAllocatorOptions {
	now?: () => Date;
	/** A lock file older than this is treated as left by a dead process. */
	staleMs?: number;
	/** Test seam: total wait for the allocation lock before failing retryable. */
	acquireTimeoutMs?: number;
	/**
	 * Test seam (I05 fault injection): invoked while holding the lock, just
	 * before the claim is persisted. Throwing simulates a crash between
	 * reservation and commit; nothing may be left half-associated.
	 */
	hooks?: { beforeClaim?: (taskId: string) => void };
}

/**
 * IS-01 — global Task identity allocator over a persistent ledger root.
 *
 * Identity reservation is atomic and cross-process safe: an exclusive lock
 * file serializes allocation, and the chosen id is persisted as a claim file
 * (write-temp-then-rename) before the lock is released. Occupancy is derived
 * from the file namespace — every `*.json` under the ledger directory and
 * every claim, whether loaded, over the restore cap, terminal, quarantined,
 * or unparseable — so a restored or crashed-once id is never reissued.
 * Numbering may contain holes; a claim whose Task snapshot later appears is
 * pruned so the claims directory stays bounded.
 */
export class TaskIdAllocator {
	private readonly root: string;
	private readonly clock: () => Date;
	private readonly staleMs: number;
	private readonly acquireTimeoutMs: number;
	private readonly hooks?: { beforeClaim?: (taskId: string) => void };

	constructor(ledgerRoot: string, options: TaskIdAllocatorOptions = {}) {
		this.root = ledgerRoot;
		this.clock = options.now ?? (() => new Date());
		this.staleMs = options.staleMs ?? IDENTITY_LOCK_STALE_MS;
		this.acquireTimeoutMs = options.acquireTimeoutMs ?? IDENTITY_LOCK_TIMEOUT_MS;
		this.hooks = options.hooks;
	}

	/** The ledger directory whose file namespace owns id occupancy. */
	get ledgerDir(): string {
		return join(this.root, "planner-only", "ledger");
	}

	private get identityDir(): string {
		return join(this.root, "planner-only", "identity");
	}

	private get lockPath(): string {
		return join(this.identityDir, ".allocate.lock");
	}

	private get claimsDir(): string {
		return join(this.identityDir, "claims");
	}

	/** Every valid-named snapshot/claim file reserves its id, loaded or not. */
	occupiedIds(): Set<string> {
		const occupied = new Set<string>();
		const collect = (dir: string, pruneClaimed: boolean): void => {
			let names: string[];
			try {
				names = readdirSync(dir);
			} catch {
				return;
			}
			for (const name of names) {
				if (name.startsWith(".tmp-")) continue;
				if (!name.endsWith(".json")) continue;
				const stem = name.slice(0, -".json".length);
				if (!SAFE_TASK_ID.test(stem)) continue;
				occupied.add(stem);
				if (pruneClaimed) {
					// The Task snapshot is the durable record; drop the redundant claim.
					try {
						if (existsSync(join(this.ledgerDir, name))) unlinkSync(join(dir, name));
					} catch {
						// Pruning is best-effort; occupancy is unaffected.
					}
				}
			}
		};
		collect(this.ledgerDir, false);
		collect(this.claimsDir, true);
		return occupied;
	}

	/** Atomically reserve a globally free Task id in the persistent namespace. */
	allocate(): string {
		try {
			mkdirSync(this.claimsDir, { recursive: true });
		} catch (err) {
			throw new TaskIdentityError(
				"TASK_ID_ALLOCATION_FAILED",
				`cannot create identity namespace under ${this.identityDir}: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true },
			);
		}
		this.acquireLock();
		try {
			const occupied = this.occupiedIds();
			for (let index = 1; index <= 999; index += 1) {
				const taskId = createTaskId(this.clock(), index);
				if (occupied.has(taskId)) continue;
				this.hooks?.beforeClaim?.(taskId);
				this.writeClaimAtomic(taskId);
				return taskId;
			}
			throw new TaskIdentityError(
				"TASK_ID_ALLOCATION_FAILED",
				`no free Task id remains for ${createTaskId(this.clock(), 1).slice(0, 12)} under ${this.ledgerDir}`,
				{ retryable: true },
			);
		} finally {
			this.releaseLock();
		}
	}

	/** Atomically reserve an explicitly requested Task id. */
	reserve(taskId: string): void {
		if (!SAFE_TASK_ID.test(taskId)) {
			throw new TaskIdentityError(
				"TASK_ID_ALLOCATION_FAILED",
				`cannot reserve invalid Task id ${taskId}`,
				{ taskId },
			);
		}
		try {
			mkdirSync(this.claimsDir, { recursive: true });
		} catch (err) {
			throw new TaskIdentityError(
				"TASK_ID_ALLOCATION_FAILED",
				`cannot create identity namespace under ${this.identityDir}: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true, taskId },
			);
		}
		this.acquireLock();
		try {
			if (this.occupiedIds().has(taskId)) {
				throw new TaskIdentityError(
					"TASK_ID_CONFLICT",
					`task id ${taskId} is already occupied; identity is never reused, continue the existing Task explicitly instead`,
					{ taskId },
				);
			}
			this.writeClaimAtomic(taskId);
		} finally {
			this.releaseLock();
		}
	}

	private writeClaimAtomic(taskId: string): void {
		const finalPath = join(this.claimsDir, `${taskId}.json`);
		const tmpPath = join(this.claimsDir, `.tmp-${process.pid}-${Date.now()}`);
		const body = JSON.stringify({
			version: 1,
			taskId,
			claimedAt: new Date().toISOString(),
			pid: process.pid,
		});
		try {
			const fd = openSync(tmpPath, "wx");
			try {
				writeSync(fd, body);
			} finally {
				closeSync(fd);
			}
			renameSync(tmpPath, finalPath);
		} catch (err) {
			try {
				unlinkSync(tmpPath);
			} catch {
				// temp may not exist yet
			}
			throw new TaskIdentityError(
				"TASK_ID_ALLOCATION_FAILED",
				`failed to persist the id claim for ${taskId}: ${err instanceof Error ? err.message : String(err)}`,
				{ retryable: true, taskId },
			);
		}
	}

	private acquireLock(): void {
		const deadline = Date.now() + this.acquireTimeoutMs;
		for (;;) {
			try {
				const fd = openSync(this.lockPath, "wx");
				try {
					writeSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
				} finally {
				closeSync(fd);
			}
				return;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
					throw new TaskIdentityError(
						"TASK_ID_ALLOCATION_FAILED",
						`cannot create the allocation lock: ${err instanceof Error ? err.message : String(err)}`,
						{ retryable: true },
					);
				}
				if (this.lockStale()) {
					// Crash recovery: the holder is gone past the TTL; steal the lock.
					try {
						unlinkSync(this.lockPath);
					} catch {
						// Lost the steal race; retry the exclusive create.
					}
					continue;
				}
				if (Date.now() >= deadline) {
					throw new TaskIdentityError(
						"TASK_ID_ALLOCATION_FAILED",
						`timed out after ${this.acquireTimeoutMs} ms waiting for the Task id allocation lock at ${this.lockPath}`,
						{ retryable: true },
					);
				}
				sleepSync(IDENTITY_LOCK_RETRY_MS);
			}
		}
	}

	private lockStale(): boolean {
		try {
			return Date.now() - statSync(this.lockPath).mtimeMs > this.staleMs;
		} catch {
			return true;
		}
	}

	private releaseLock(): void {
		try {
			unlinkSync(this.lockPath);
		} catch {
			// The lock is best-effort cleanup; a leftover file is handled by staleness.
		}
	}
}


export type TaskSpecContractErrorCode = "TASKSPEC_VALIDATION_INCOMPLETE";

/**
 * Ticket 45 — a TaskSpec constructor was handed a contradictory validation
 * definition. Adapters and tests match on `code`, never on message text.
 */
export class TaskSpecContractError extends Error {
	readonly code: TaskSpecContractErrorCode;

	constructor(code: TaskSpecContractErrorCode, message: string) {
		super(message);
		this.name = "TaskSpecContractError";
		this.code = code;
	}
}

export function createTaskId(now: Date = new Date(), sequence = 1): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const index = String(Math.max(1, Math.trunc(sequence))).padStart(3, "0");
	return `T-${year}${month}${day}-${index}`;
}

export function createTaskSpec(input: CreateTaskSpecInput, taskId?: string): TaskSpec {
	// Ticket 45 — refuse rather than invent intent. Dropping the empty command
	// list would relax a mandatory validation; inventing commands would
	// fabricate acceptance criteria. Either way the caller must decide.
	if (isValidationDefinitionIncomplete(input.validation)) {
		throw new TaskSpecContractError(
			"TASKSPEC_VALIDATION_INCOMPLETE",
			`createTaskSpec refused: ${VALIDATION_COMMANDS_REQUIRED_ERROR}. Supply the commands, or set validation.required to false when no validation is mandatory.`,
		);
	}
	const suppliedTaskId = input.taskId?.trim();
	const effectiveTaskId = taskId ?? createTaskId();
	const spec: TaskSpec = {
		taskId: suppliedTaskId || effectiveTaskId,
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
		...(input.contextPack?.length ? { contextPack: input.contextPack.map((entry) => ({ ...entry })) } : {}),
		...(input.readFirst?.length ? { readFirst: uniqueNonEmpty(input.readFirst) } : {}),
		...(input.parentTaskId?.trim() ? { parentTaskId: input.parentTaskId.trim() } : {}),
		...(input.commitOf?.trim() ? { commitOf: input.commitOf.trim() } : {}),
		...(input.reportOnly ? { reportOnly: true } : {}),
		...(input.additionalWorktreeRoots?.length
			? {
				additionalWorktreeRoots: [
					...new Set(
						uniqueNonEmpty(input.additionalWorktreeRoots)
							.map((root) => resolve(root))
							.filter((root) => root !== resolve(input.cwd)),
					),
				],
			}
			: {}),
	};
	if (spec.additionalWorktreeRoots && spec.additionalWorktreeRoots.length === 0) {
		delete (spec as { additionalWorktreeRoots?: string[] }).additionalWorktreeRoots;
	}
	if (!suppliedTaskId && taskId === undefined) generatedTaskIdSpecs.add(spec);
	if (input.validation?.required === false) explicitlyNoValidation.add(spec);
	return spec;
}

export function hasGeneratedTaskId(spec: TaskSpec | undefined): boolean {
	return Boolean(spec && generatedTaskIdSpecs.has(spec));
}

export function isExplicitlyNoValidation(spec: TaskSpec | undefined): boolean {
	return spec !== undefined && explicitlyNoValidation.has(spec);
}

/** Runtime knobs that must not ride on TaskSpec (ticket 43). Business `budget` / `cumulativeBudget` stay allowed. */
export const TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS = [
	"model",
	"thinking",
	"timeoutMs",
	"toolBudget",
	"usageBudget",
] as const;

export function validateTaskSpec(value: unknown): string[] {
	if (!isPlainObject(value)) return ["TaskSpec must be an object"];
	const errors: string[] = [];
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.objective)) errors.push("objective must be a non-empty string");
	if (!isNonEmptyString(value.cwd)) errors.push("cwd must be a non-empty string");
	if (!isNonEmptyString(value.role) || !TASK_ROLES.includes(value.role as TaskRole)) {
		errors.push(`role must be one of ${TASK_ROLES.join(", ")}`);
	}
	if (value.scope !== undefined) {
		if (!isPlainObject(value.scope)) {
			errors.push("scope must be an object when present");
		} else {
			const scope = value.scope as Record<string, unknown>;
			if (scope.allowedPaths !== undefined) {
				if (!isStringArray(scope.allowedPaths)) {
					errors.push("scope.allowedPaths must be an array of strings when present");
				} else {
					for (const p of scope.allowedPaths) {
						if (normalizeRepoRelativePath(p) === null) {
							errors.push(`scope path escapes the workspace: ${p}`);
						}
					}
				}
			}
			if (scope.forbiddenPaths !== undefined) {
				if (!isStringArray(scope.forbiddenPaths)) {
					errors.push("scope.forbiddenPaths must be an array of strings when present");
				} else {
					for (const p of scope.forbiddenPaths) {
						if (normalizeRepoRelativePath(p) === null) {
							errors.push(`scope path escapes the workspace: ${p}`);
						}
					}
				}
			}
		}
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
	if (value.additionalWorktreeRoots !== undefined) {
		if (!isStringArray(value.additionalWorktreeRoots)) {
			errors.push("additionalWorktreeRoots must be an array of strings");
		} else if (value.additionalWorktreeRoots.some((root) => !root.trim())) {
			errors.push("additionalWorktreeRoots entries must be non-empty strings");
		}
	}
	if (value.readFirst !== undefined && (!isStringArray(value.readFirst) || value.readFirst.some((path) => !path.trim()))) {
		errors.push("readFirst must be an array of non-empty strings when present");
	}
	if (value.contextPack !== undefined) {
		if (!Array.isArray(value.contextPack)) {
			errors.push("contextPack must be an array when present");
		} else {
			value.contextPack.forEach((entry, index) => {
				if (!isPlainObject(entry) || !isNonEmptyString(entry.path)) errors.push(`contextPack[${index}].path must be a non-empty string`);
				if (!isPlainObject(entry) || !isNonEmptyString(entry.summary)) errors.push(`contextPack[${index}].summary must be a non-empty string`);
				if (isPlainObject(entry) && entry.startLine !== undefined && (!Number.isInteger(entry.startLine) || (entry.startLine as number) < 1)) errors.push(`contextPack[${index}].startLine must be a positive integer when present`);
				if (isPlainObject(entry) && entry.endLine !== undefined && (!Number.isInteger(entry.endLine) || (entry.endLine as number) < 1)) errors.push(`contextPack[${index}].endLine must be a positive integer when present`);
			});
		}
	}
	if (value.parentTaskId !== undefined && !isNonEmptyString(value.parentTaskId)) {
		errors.push("parentTaskId must be a non-empty string when present");
	}
	if (value.commitOf !== undefined && !isNonEmptyString(value.commitOf)) {
		errors.push("commitOf must be a non-empty string when present");
	}
	if (value.reportOnly !== undefined && typeof value.reportOnly !== "boolean") {
		errors.push("reportOnly must be a boolean when present");
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
			// Ticket 45 — the validator guard refuses this shape, so the schema
			// must refuse it too: one judgment, decided here and named after the
			// field that is actually missing.
			if (isValidationDefinitionIncomplete(value.validation)) {
				errors.push(VALIDATION_COMMANDS_REQUIRED_ERROR);
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
	if (value.cumulativeBudget !== undefined) {
		if (!isPlainObject(value.cumulativeBudget)) {
			errors.push("cumulativeBudget must be an object when present");
		} else {
			const cumulativeBudget = value.cumulativeBudget as Record<string, unknown>;
			if (cumulativeBudget.tokens !== undefined) {
				if (typeof cumulativeBudget.tokens !== "number" || !Number.isFinite(cumulativeBudget.tokens) || cumulativeBudget.tokens <= 0) {
					errors.push("cumulativeBudget.tokens must be a positive finite number");
				}
			}
			if (cumulativeBudget.costUsd !== undefined) {
				if (typeof cumulativeBudget.costUsd !== "number" || !Number.isFinite(cumulativeBudget.costUsd) || cumulativeBudget.costUsd <= 0) {
					errors.push("cumulativeBudget.costUsd must be a positive finite number");
				}
			}
		}
	}
	// TaskSpec is the business contract. Runtime execution controls belong on
	// the delegation/host input (or role policy / host defaults), not here.
	for (const key of TASKSPEC_FORBIDDEN_EXECUTION_CONTROLS) {
		if (value[key] !== undefined) {
			errors.push(
				`${key} is an execution control and must not appear on TaskSpec; set it on the delegation/host input instead`,
			);
		}
	}
	return errors;
}

export const TASKSPEC_CHARACTERISTIC_FIELDS = [
	"taskId",
	"objective",
	"title",
	"acceptanceCriteria",
	"scope",
	"validation",
	"expectedEvidence",
	"stopConditions",
	"constraints",
	"budget",
	"contextPack",
	"readFirst",
	"parentTaskId",
	"commitOf",
] as const;

/**
 * R01 — the documented example-JSON `taskId` sentinel. Orchestration always
 * replaces it with a generated canonical id and never stores it as an alias,
 * so pasting the same example JSON a second time starts a new Task.
 */
export const TASKSPEC_EXAMPLE_SENTINEL = "T-pending";

const EXAMPLE_INSPECT_TOOLS = new Set(["read", "grep", "find", "ls"]);

const EXAMPLE_WORKER_REPORT_CONTRACT =
	"Return only a valid WorkerReport JSON object (version, taskId, status, summary, changedFiles, validation, evidence, risks, unresolved) using the canonical Task id from your launch packet; you must not ask Root or supervisor for the taskId. The top-level status must be exactly completed, partial, blocked, or failed. The validation status must be exactly passed, failed, or not-run. Your final message must contain only the WorkerReport JSON.";

export interface TaskSpecExampleInput {
	toolName: string;
	/** The refused tool call's input (inspect path, bash command, edit target…). */
	input?: unknown;
	/** Adapter workspace the refusal happened in. */
	cwd?: string;
	/** An invalid TaskSpec candidate whose valid fields should be preserved. */
	submitted?: Record<string, unknown>;
	/** Ticket 50 — where `submitted` came from, so a repair line can name it
	 * honestly: a validator refusal reuses the reviewed Task's own spec. */
	roleOrigin?: "submitted" | "reviewed-task";
}

function exampleStringField(input: unknown, keys: readonly string[]): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function validBudget(value: unknown): boolean {
	if (!isPlainObject(value)) return false;
	const budget = value as Record<string, unknown>;
	const dimension = (raw: unknown): boolean =>
		raw === undefined || (typeof raw === "number" && Number.isFinite(raw) && raw > 0);
	return dimension(budget.tokens) && dimension(budget.costUsd);
}

/** Ticket 45 — the schema error that names the field actually missing. */
export const VALIDATION_COMMANDS_REQUIRED_ERROR =
	"validation.commands must be a non-empty array of strings when validation.required is true";

/**
 * Ticket 45 — the one definition of "this validation block cannot be honoured".
 *
 * `required: true` means the commands are mandatory, so a definition with no
 * *usable* command is unsatisfiable. "Usable" is deliberately not `length > 0`:
 * `uniqueNonEmpty` (used by the constructor and the repair renderer) trims and
 * drops blanks, so `["  "]` normalises down to no commands at all. Counting
 * length there re-opened the very gap this ticket exists to close — a shape the
 * schema accepts and the validator guard then refuses.
 *
 * The schema (`validateTaskSpec`), the constructor (`createTaskSpec`), the
 * repair renderer (`repairSubmittedValidation`) and the validator guard
 * (`roles.ts`) all ask this single question, so the two judgments can no longer
 * drift apart.
 *
 * A malformed `commands` value is deliberately NOT this predicate's business:
 * the shape checks report it separately, and double-reporting one field helps
 * nobody.
 */
export function isValidationDefinitionIncomplete(validation: unknown): boolean {
	if (!isPlainObject(validation)) return false;
	const { required, commands } = validation as { required?: unknown; commands?: unknown };
	if (required !== true) return false;
	if (commands === undefined) return true;
	if (!isStringArray(commands)) return false;
	return commands.every((command) => command.trim() === "");
}

/**
 * Ticket 48 — how a *submitted* validation definition disagrees with the one a
 * Task already carries, or `undefined` when they agree.
 *
 * A Validator bound to an existing Task is judged against that Task's stored
 * definition. If the submitted spec can silently replace it, the operator can be
 * "validated" under commands the worker was never asked to meet — and ticket
 * 45's stored-task refusal becomes bypassable by the same move.
 *
 * `required: false` carries no command obligation, so its commands are not
 * compared — only `required` must match. Commands are compared as *usable* sets
 * (`uniqueNonEmpty`), matching how they are normalised everywhere else.
 */
export function describeValidationConflict(
	submitted: unknown,
	stored: unknown,
): string | undefined {
	if (!isPlainObject(submitted) || !isPlainObject(stored)) return undefined;
	const from = submitted as { required?: unknown; commands?: unknown };
	const to = stored as { required?: unknown; commands?: unknown };
	if (from.required !== to.required) {
		return `validation.required differs (submitted ${JSON.stringify(from.required)}, stored ${JSON.stringify(to.required)})`;
	}
	if (from.required !== true) return undefined;
	const submittedCommands = isStringArray(from.commands) ? uniqueNonEmpty(from.commands) : [];
	const storedCommands = isStringArray(to.commands) ? uniqueNonEmpty(to.commands) : [];
	const same = submittedCommands.length === storedCommands.length
		&& submittedCommands.every((command) => storedCommands.includes(command));
	if (same) return undefined;
	return `validation.commands differ (submitted [${submittedCommands.join(", ") || "none"}], stored [${storedCommands.join(", ") || "none"}])`;
}

function validValidation(value: unknown): boolean {
	if (!isPlainObject(value)) return false;
	const validation = value as Record<string, unknown>;
	if (typeof validation.required !== "boolean") return false;
	if (validation.commands !== undefined && !isStringArray(validation.commands)) return false;
	return !isValidationDefinitionIncomplete(value);
}

/**
 * R01 — the one example-TaskSpec renderer shared by the Policy parent-tool
 * refusal and the Orchestration invalid-TaskSpec refusal. The renderer keeps
 * the IS-02 fidelity contract: a valid submitted role wins; a missing role
 * falls back to the tool intent and then to the host-resolved delegated role
 * (agent), never a blanket Explorer; permissions are never inferred from
 * objective wording alone. Submitted fields that pass per-field validation
 * are preserved, except the example sentinel `taskId`. Budget, evidence,
 * extra worktree roots, and test commands are never invented.
 */
export function buildTaskSpecExample(options: TaskSpecExampleInput): Record<string, unknown> {
	const repair = buildTaskSpecRepair(options);
	if (repair.example) return repair.example;
	throw new Error(
		`TaskSpec repair needs input before an example can be built: ${repair.unresolvedFields.join(", ")}`,
	);
}

export interface TaskSpecRepairChange {
	field: string;
	reason: string;
}

/**
 * IS-02 — the fidelity contract of a refused TaskSpec repair. `repairable`
 * means the example can be resubmitted as-is without changing the delegated
 * role or relaxing validation; `needs-input` means some field cannot be
 * repaired losslessly and the original submission stays refused.
 */
export interface TaskSpecRepairResult {
	status: "repairable" | "needs-input";
	example?: Record<string, unknown>;
	changes: TaskSpecRepairChange[];
	unresolvedFields: string[];
}

interface SubmittedValidationRepair {
	validation?: { required: boolean; commands?: string[] };
	changes: TaskSpecRepairChange[];
	/** Guidance when the submitted shape cannot be converted without losing intent. */
	unresolved?: string;
}

/**
 * IS-02 — validation intent is never silently dropped. A valid definition is
 * kept verbatim; a losslessly convertible shape (a plain command list, or an
 * object whose commands are valid strings) is repaired with the intent made
 * explicit; anything else is unresolved, so the refusal cannot downgrade a
 * mandatory validation to `required: false`.
 *
 * Ticket 45 — "valid" now means complete: `required: true` without a non-empty
 * command list is unresolved rather than kept, because keeping it would hand
 * the operator a template that the validator guard is bound to refuse.
 */
function repairSubmittedValidation(raw: unknown): SubmittedValidationRepair {
	if (raw === undefined) {
		return { validation: { required: false }, changes: [] };
	}
	if (validValidation(raw)) {
		const validation = raw as Record<string, unknown>;
		return {
			validation: {
				required: validation.required as boolean,
				...(isStringArray(validation.commands) && validation.commands.length > 0
					? { commands: uniqueNonEmpty(validation.commands) }
					: {}),
			},
			changes: [{ field: "validation", reason: "kept the submitted validation definition" }],
		};
	}
	if (Array.isArray(raw) && raw.length === 0) {
		return {
			validation: { required: false },
			changes: [{ field: "validation", reason: "dropped the empty validation list; it carries no validation intent" }],
		};
	}
	if (Array.isArray(raw) && raw.every((item) => typeof item === "string" && item.trim())) {
		return {
			validation: { required: true, commands: uniqueNonEmpty(raw as string[]) },
			changes: [{
				field: "validation",
				reason: "converted the submitted command list into a validation object with required: true",
			}],
		};
	}
	if (isPlainObject(raw) && Array.isArray(raw.commands)
		&& raw.commands.length > 0
		&& raw.commands.every((item) => typeof item === "string" && item.trim())
		&& (raw.required === undefined || raw.required === true)) {
		return {
			validation: { required: true, commands: uniqueNonEmpty(raw.commands as string[]) },
			changes: [{
				field: "validation",
				reason: "repaired validation.required to the boolean true (intent: the listed commands are mandatory)",
			}],
		};
	}
	if (isPlainObject(raw) && (raw as Record<string, unknown>).required === true) {
		// Ticket 45 — reached only when `commands` is absent or empty (the two
		// branches above claim every complete definition). Nothing can be
		// converted here: the commands are the only thing that could make a
		// mandatory validation satisfiable, so guessing them would fabricate
		// acceptance and dropping them would relax the requirement.
		return {
			changes: [{
				field: "validation",
				reason: "validation.required is true but no usable validation.commands were supplied",
			}],
			unresolved: "validation.required is true, which makes validation.commands mandatory, but the submission carries no usable command list. Supply validation.commands as a non-empty array of strings, or set validation.required to false when no validation is mandatory.",
		};
	}
	return {
		changes: [{
			field: "validation",
			reason: "the submitted validation shape cannot be converted without losing the validation intent",
		}],
		unresolved: "validation must be a self-consistent object shaped { required: boolean, commands?: string[] }: required states whether validation is mandatory, and when required is true, commands must be a non-empty array of strings listing the applicable validation definitions. The submitted shape cannot be converted without losing that intent.",
	};
}

export function buildTaskSpecRepair(options: TaskSpecExampleInput): TaskSpecRepairResult {
	const toolName = options.toolName;
	const submitted = isPlainObject(options.submitted) ? options.submitted : undefined;
	const adapterCwd = typeof options.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : undefined;

	const isInspect = EXAMPLE_INSPECT_TOOLS.has(toolName);
	const isShell = toolName === "bash";
	const isMutate = toolName === "write" || toolName === "edit";

	const path = exampleStringField(options.input, ["path", "file", "filePath", "file_path", "pattern", "glob"]);
	const command = exampleStringField(options.input, ["command", "cmd"]);

	const submittedRole = submitted && isNonEmptyString(submitted.role) && TASK_ROLES.includes(submitted.role as TaskRole)
		? (submitted.role as TaskRole)
		: undefined;
	// IS-02 role source priority: the submitted role wins; otherwise the
	// refused tool's intent (mutate → Worker, inspect/shell → Explorer).
	// Direct refusals of generic tools keep the historical minimal Explorer
	// suggestion (the read-only ceiling, not a widening); the role is never
	// guessed from objective wording.
	const toolRole: TaskRole | undefined = isMutate
		? "worker"
		: isInspect || isShell
			? "explorer"
			: undefined;
	const fallbackRole: TaskRole | undefined = submittedRole || toolRole ? undefined : "explorer";
	const role = submittedRole ?? toolRole ?? fallbackRole;

	const changes: TaskSpecRepairChange[] = [];
	const unresolvedFields: string[] = [];
	if (submittedRole) {
		// Ticket 50 — when the "submitted" spec is really the *reviewed Task's* own
		// spec (a validator refusal against a named Task), say so: "kept the
		// submitted role" reads as an instruction to resubmit a spec of that role.
		changes.push({
			field: "role",
			reason: options.roleOrigin === "reviewed-task"
				? `kept the reviewed Task's role "${submittedRole}"`
				: `kept the submitted role "${submittedRole}"`,
		});
	} else if (toolRole) {
		changes.push({ field: "role", reason: `derived role "${toolRole}" from the refused ${toolName} tool` });
	} else if (fallbackRole) {
		changes.push({ field: "role", reason: `suggested the minimal read-only role "explorer" for this generic tool refusal` });
	} else {
		unresolvedFields.push("role");
	}

	const submittedObjective = submitted && isNonEmptyString(submitted.objective)
		? submitted.objective
		: submitted && isNonEmptyString(submitted.title)
			? submitted.title
			: undefined;
	const objective = submittedObjective
		?? (isShell && command
			? `Run this command and report its output: ${command}`
			: isMutate && path
				? `Apply the requested change to ${path}.`
				: isInspect && path
					? `Inspect ${path} and report the findings.`
					: "Describe the requested work for the worker in one or two sentences.");
	if (submittedObjective) {
		changes.push({ field: "objective", reason: "kept the submitted objective" });
	}

	const constraints: string[] = submitted && isStringArray(submitted.constraints)
		? submitted.constraints.filter((item) => item.trim())
		: [];
	if (isInspect && path) constraints.push(`Inspect ${path} and report the findings; do not modify it.`);
	if (role === "explorer") constraints.push(EXAMPLE_WORKER_REPORT_CONTRACT);
	if (isMutate) constraints.push("Stay inside the objective and list every changed file in the WorkerReport.");

	const validationRepair = repairSubmittedValidation(submitted?.validation);
	changes.push(...validationRepair.changes);
	if (validationRepair.unresolved) unresolvedFields.push("validation");

	if (unresolvedFields.length > 0 || !role) {
		// Not lossless: no resubmittable template is produced. The caller keeps
		// refusing the original submission until the outstanding fields arrive.
		return { status: "needs-input", changes, unresolvedFields };
	}

	const example: Record<string, unknown> = {
		// The documented sentinel: replaced by a generated canonical id at
		// Delegation, never stored as an alias.
		taskId: TASKSPEC_EXAMPLE_SENTINEL,
		objective,
		cwd: adapterCwd ?? (submitted && isNonEmptyString(submitted.cwd) ? submitted.cwd : undefined) ?? (typeof process !== "undefined" ? process.cwd() : "."),
		role,
		...(submitted && isPlainObject(submitted.scope) ? { scope: submitted.scope } : {}),
		constraints,
		...(submitted && isStringArray(submitted.acceptanceCriteria)
			? { acceptanceCriteria: submitted.acceptanceCriteria.filter((item) => item.trim()) }
			: {}),
		...(validationRepair.validation ? { validation: validationRepair.validation } : {}),
		...(submitted && isPlainObject(submitted.expectedEvidence) ? { expectedEvidence: submitted.expectedEvidence } : {}),
		...(submitted && isStringArray(submitted.stopConditions)
			? { stopConditions: submitted.stopConditions.filter((item) => item.trim()) }
			: {}),
		...(submitted && isStringArray(submitted.additionalWorktreeRoots)
			? { additionalWorktreeRoots: submitted.additionalWorktreeRoots.filter((item) => item.trim()) }
			: {}),
		...(submitted && Array.isArray(submitted.contextPack) ? { contextPack: submitted.contextPack } : {}),
		...(submitted && isStringArray(submitted.readFirst) ? { readFirst: submitted.readFirst } : {}),
		...(submitted && validBudget(submitted.budget) ? { budget: submitted.budget } : {}),
		...(submitted && validBudget(submitted.cumulativeBudget) ? { cumulativeBudget: submitted.cumulativeBudget } : {}),
	};

	// A submitted taskId that already passes validation is preserved; the
	// example sentinel itself is never treated as a submitted identity.
	const submittedTaskId = submitted && isNonEmptyString(submitted.taskId) ? submitted.taskId.trim() : undefined;
	if (submittedTaskId && submittedTaskId !== TASKSPEC_EXAMPLE_SENTINEL) {
		example.taskId = submittedTaskId;
	}

	// Safety net: the renderer's contract is a zero-error example. If some
	// preserved field slipped through, fall back to the guaranteed-minimal shape.
	if (validateTaskSpec(example).length > 0) {
		const minimal: Record<string, unknown> = {
			taskId: TASKSPEC_EXAMPLE_SENTINEL,
			objective,
			cwd: adapterCwd ?? (typeof process !== "undefined" ? process.cwd() : "."),
			role,
			constraints,
			acceptanceCriteria: [],
			validation: { required: false },
			stopConditions: [],
		};
		return { status: "repairable", example: minimal, changes, unresolvedFields: [] };
	}
	return { status: "repairable", example, changes, unresolvedFields: [] };
}

/**
 * IS-02 — render a repair result next to a refusal. The field-change summary
 * and the outstanding list are always shown; the copyable template and the
 * "resubmit as-is" claim appear only for a lossless (repairable) result, so
 * a template can never silently widen or narrow the delegated capability.
 */
export function appendTaskSpecRepair(reason: string, repair: TaskSpecRepairResult): string {
	const lines = [reason, "", "TaskSpec repair summary:"];
	if (repair.changes.length === 0) lines.push("- (no fields changed)");
	for (const change of repair.changes) lines.push(`- ${change.field}: ${change.reason}`);
	if (repair.unresolvedFields.length > 0) {
		lines.push("", "Outstanding — supply these before resubmission:");
		for (const field of repair.unresolvedFields) {
			lines.push(field === "role"
				? "- role: one of worker, explorer, validator, reviewer (or the host agent name). Permissions are never inferred from objective wording."
				: `- ${field}: ${repair.changes.some((change) => change.field === field) ? repair.changes.find((change) => change.field === field)?.reason : "see the submitted field"}`);
		}
		lines.push(
			"The original submission stays refused until the outstanding fields are supplied; validation requirements are never relaxed to make a template pass.",
		);
		return lines.join("\n");
	}
	lines.push(
		"",
		"The repaired TaskSpec is faithful to the submitted intent and can be resubmitted as-is:",
		"```json",
		JSON.stringify(repair.example, null, 2),
		"```",
	);
	return lines.join("\n");
}

/**
 * R01 — append the shared example JSON to a block reason. The reason's
 * existing first lines are kept; the instruction tells Root to embed the
 * object in the next Delegation.
 */
export function appendTaskSpecExample(reason: string, example: Record<string, unknown>): string {
	return [
		reason,
		"",
		"Pass this TaskSpec to planner_delegate:",
		"```json",
		JSON.stringify(example, null, 2),
		"```",
	].join("\n");
}


export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
	planning: ["executing", "blocked", "failed", "report-invalid"],
	executing: ["reviewing", "report-invalid", "blocked", "failed"],
	reviewing: ["completed", "closed-superseded", "changes_requested", "report-invalid", "blocked", "failed"],
	changes_requested: ["executing", "report-invalid", "blocked", "failed"],
	"report-invalid": ["executing", "reviewing", "completed", "changes_requested", "blocked", "failed"],
	blocked: ["executing", "reviewing", "report-invalid", "failed"],
	failed: ["executing", "reviewing", "report-invalid"],
	completed: [],
	"closed-superseded": [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
	return TASK_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface TaskRecord {
	taskId: string;
	spec?: TaskSpec;
	/** Report text retained when the envelope was irreparable; Root may judge it directly. */
	rawReport?: {
		executionId: string;
		text: string;
		error: string;
		receivedAt: string;
	};
	/** Parent Task when this record is a derived correction or commit. */
	parentTaskId?: string;
	/** Successor Task ids that may account for later workspace changes. */
	successors: string[];
	/** Why this Task reached completed/closed-superseded. */
	completionKind?: import("./types.ts").TaskCompletionKind;
	role: TaskRole;
	cwd: string;
	state: TaskState;
	reviewRound: number;
	reviewMode: ReviewMode;
	reports: WorkerReport[];
	/** Validator (oracle) reports recorded against this Task; not Worker reports. */
	validatorReports: WorkerReport[];
	reviews: ReviewResult[];
	/** optional: ledgers written before this field exist. */
	verdictRefusals?: RootVerdictRefusalRecord[];
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
	/**
	 * E01 — Root-owned evidence records, one per actual child execution, in
	 * launch order. Each carries its own A_run/C_report pair and the per-round
	 * attribution that links it to the previous execution.
	 */
	executions: TaskExecutionRecord[];
	/**
	 * E01 — findings that outlive their execution. A later execution may prove
	 * a change was restored, but only a recorded review closes the finding.
	 */
	findings: TaskFinding[];
	/**
	 * R02 — this Task was created by (or continues) a standalone Explorer
	 * Delegation: its terminal result is processed like a WorkerReport and it
	 * closes through the normal review loop. Ownership survives restore so a
	 * continuation is still standalone and an assisted Worker/Validator Task
	 * is never mistaken for one.
	 */
	standaloneExplorer?: boolean;
	/**
	 * E02 — how many automatic recovery/revalidation attempts this Task has
	 * been granted (bounded by MAX_RECOVERY_ATTEMPTS) and the evidence-state
	 * keys already attempted: the same state never gets a second automatic
	 * retry, and restarts or reason rewrites cannot reset either.
	 */
	recoveryAttempts: number;
	recoveryStates: string[];
	/**
	 * E02 (spec L106) — evidence-state keys whose automatic revalidation was
	 * actually dispatched. Distinct from recoveryStates, which records states
	 * already granted a revalidation for no-progress detection regardless of
	 * dispatch outcome.
	 */
	recoveryDispatches?: string[];
	/** E02 — a granted-but-not-yet-dispatched revalidation evidence key. */
	pendingRevalidationKey?: string;
	/** E02 — the most recent automatic recovery attempt, for no-progress checks. */
	lastRecovery?: {
		reportRevision: number;
		evidenceKey: string;
		at: string;
	};
	/** Reason for an operator-forced terminal state, when applicable. */
	stateReason?: string;
	/**
	 * Set when the Task enters `blocked` (ticket 41). Marks the Task as sealed
	 * against late child receipts without a new state enum: receipts park into
	 * history only. Cleared when leaving `blocked` (e.g. Root verdict reopen).
	 */
	sealedAt?: string;
	/** Per-task usage snapshot; live totals live in UsageLedger. Initialised empty. */
	usage: TaskUsage;
	createdAt: string;
	updatedAt: string;
	/** Whether this Task was created as a placeholder without parent TaskSpec. */
	isPlaceholder?: boolean;
	/** Whether the embedded TaskSpec used 'title' as an alias for 'objective'. */
	titleAliasUsed?: boolean;
}

export interface TaskStoreOptions {
	now?: () => Date;
	onPersist?: (record: TaskRecord) => void;
	/**
	 * IS-01 — persistent cross-process identity allocator bound to the ledger
	 * root. When present, `nextTaskId()` reserves globally unique ids from the
	 * shared namespace instead of the process-local sequence.
	 */
	allocator?: TaskIdAllocator;
	/** C09 — sink for rolling back a never-dispatched placeholder Task. */
	onRemove?: (taskId: string) => void;
}

const RESTORED_ID_SHAPE = /^T-(\d{8})-(\d{3,})$/;

export class TaskStore {
	private readonly tasks = new Map<string, TaskRecord>();
	private readonly clock: () => Date;
	private readonly onPersist?: (record: TaskRecord) => void;
	private readonly onRemove?: (taskId: string) => void;
	private readonly allocator?: TaskIdAllocator;
	private sequence = 0;

	constructor(options: TaskStoreOptions = {}) {
		this.clock = options.now ?? (() => new Date());
		this.onPersist = options.onPersist;
		this.onRemove = options.onRemove;
		this.allocator = options.allocator;
	}

	now(): Date {
		return this.clock();
	}

	nextTaskId(): string {
		if (this.allocator) return this.allocator.allocate();
		this.sequence += 1;
		return createTaskId(this.now(), this.sequence);
	}

	/**
	 * Ticket 46 — an alias that is already somebody's canonical id, or already
	 * claimed by another Task, can never resolve: `get()` prefers the canonical
	 * match, so the alias would be permanently shadowed and the operator's
	 * "reuse this id" intent would silently land on a different Task.
	 *
	 * Pure in-memory: callers that can also see the ledger (the delegation path)
	 * must check there too, because such a shadowing id is exactly the kind of
	 * record the session restore cap leaves out of memory.
	 */
	aliasConflict(alias: string, ownerTaskId?: string): { taskId: string; kind: "canonical" | "alias" } | undefined {
		const canonical = this.tasks.get(alias);
		if (canonical && canonical.taskId !== ownerTaskId) {
			return { taskId: canonical.taskId, kind: "canonical" };
		}
		for (const task of this.tasks.values()) {
			if (task.taskId === ownerTaskId) continue;
			if (Array.isArray(task.aliases) && task.aliases.includes(alias)) {
				return { taskId: task.taskId, kind: "alias" };
			}
		}
		return undefined;
	}

	/**
	 * IS-01 — build a fresh record for an id the caller has already proven free.
	 */
	private insertNew(taskId: string, spec: TaskSpec | undefined, alias: string | undefined): TaskRecord {
		const timestamp = this.now().toISOString();
		// Ticket 46 — never register an alias that could not resolve.
		if (alias && alias !== taskId) {
			const conflict = this.aliasConflict(alias, taskId);
			if (conflict) {
				throw new TaskIdentityError(
					"TASK_ALIAS_CONFLICT",
					conflict.kind === "canonical"
						? `alias ${alias} is already the canonical id of Task ${conflict.taskId}; an alias must not shadow a canonical id`
						: `alias ${alias} is already claimed by Task ${conflict.taskId}; an alias resolves to one Task only`,
					{ taskId },
				);
			}
		}
		const aliases = alias && alias !== taskId ? [alias] : [];
		const record: TaskRecord = {
			taskId,
			...(spec ? { spec } : {}),
			parentTaskId: spec?.parentTaskId ?? spec?.commitOf,
			role: spec?.role ?? "worker",
			successors: [],
			cwd: spec?.cwd ?? "",
			state: "planning",
			reviewRound: 0,
			reviewMode: process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1" ? "fresh" : "root",
			reports: [],
			validatorReports: [],
			reviews: [],
			verdictRefusals: [],
			overrides: [],
			aliases,
			reportCorrections: 0,
			executions: [],
			findings: [],
			recoveryAttempts: 0,
			recoveryStates: [],
			usage: emptyTaskUsage(),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		this.tasks.set(taskId, record);
		this.linkSuccessor(spec?.parentTaskId, taskId);
		this.linkSuccessor(spec?.commitOf, taskId);
		this.persist(record);
		return record;
	}

	/**
	 * Insert a record after `nextTaskId()` has already claimed its id. This
	 * keeps allocation and Task snapshot creation as one explicit association.
	 */
	createAllocated(taskId: string, spec?: TaskSpec, alias?: string): TaskRecord {
		if (this.tasks.has(taskId)) {
			throw new TaskIdentityError(
				"TASK_ID_CONFLICT",
				`task id ${taskId} is already occupied; identity is never reused, continue the existing Task explicitly instead`,
				{ taskId },
			);
		}
		return this.insertNew(taskId, spec, alias);
	}

	/**
	 * Legacy create remains compatible for injected in-memory stores. A
	 * ledger-backed store reserves explicit ids before writing their snapshot.
	 */
	create(spec?: TaskSpec, alias?: string): TaskRecord {
		const suppliedTaskId = spec?.taskId?.trim();
		if (!suppliedTaskId || (this.allocator && hasGeneratedTaskId(spec))) {
			const taskId = this.nextTaskId();
			return this.insertNew(taskId, spec ? { ...spec, taskId } : spec, alias);
		}
		if (this.tasks.has(suppliedTaskId)) return this.tasks.get(suppliedTaskId) as TaskRecord;
		if (this.allocator) this.allocator.reserve(suppliedTaskId);
		return this.insertNew(suppliedTaskId, spec, alias);
	}

	/**
	 * IS-01 `createTask` — create only: an occupied id is a structured
	 * TASK_ID_CONFLICT. The old record's spec, cwd, aliases, state, reports,
	 * evidence, reviews, and usage are never touched, and no snapshot is
	 * overwritten.
	 */
	createTask(spec?: TaskSpec, alias?: string): TaskRecord {
		const suppliedTaskId = spec?.taskId?.trim();
		if (!suppliedTaskId || (this.allocator && hasGeneratedTaskId(spec))) {
			const taskId = this.nextTaskId();
			return this.insertNew(taskId, spec ? { ...spec, taskId } : spec, alias);
		}
		const taskId = suppliedTaskId;
		if (this.tasks.has(taskId)) {
			throw new TaskIdentityError(
				"TASK_ID_CONFLICT",
				`task id ${taskId} is already occupied; identity is never reused, continue the existing Task explicitly instead`,
				{ taskId },
			);
		}
		if (this.allocator) this.allocator.reserve(taskId);
		return this.insertNew(taskId, spec, alias);
	}

	/**
	 * C09 — roll back a Task this invocation created as a dispatch placeholder
	 * (generated id): a refused precheck must not leave a seemingly-active
	 * Task behind. Explicitly named Tasks are never removed here — a
	 * legitimately created planning Task survives a failed launch. Reciprocal
	 * successor links and the persisted snapshot are removed with it.
	 */
	remove(taskId: string): boolean {
		const record = this.tasks.get(taskId);
		if (!record) return false;
		for (const parent of this.tasks.values()) {
			const index = parent.successors.indexOf(taskId);
			if (index >= 0) {
				parent.successors.splice(index, 1);
				this.touch(parent);
			}
		}
		this.tasks.delete(taskId);
		try {
			this.onRemove?.(taskId);
		} catch {
			// Removal must not crash the launch path; the in-memory rollback stands.
		}
		return true;
	}

	/**
	 * IS-01 `continueTask` — explicit continuation: resolve the canonical id or
	 * a registered alias, verify the workspace, and hand the record to the
	 * caller, which applies the existing lifecycle rules. An auto-generated id
	 * collision is never reinterpreted as a continuation.
	 */
	continueTask(taskId: string, cwd: string): TaskRecord {
		const record = this.get(taskId);
		if (!record) {
			throw new TaskIdentityError(
				"TASK_NOT_FOUND",
				`unknown task: ${taskId}; continuing requires an explicit canonical id or a registered alias`,
				{ taskId },
			);
		}
		if (record.cwd) {
			const current = normalizeWorkspaceIdentity(record.cwd);
			const target = normalizeWorkspaceIdentity(cwd);
			if (current !== target) {
				throw new TaskIdentityError(
					"TASK_WORKSPACE_MISMATCH",
					`task ${record.taskId} belongs to workspace ${record.cwd}, not ${cwd}; cross-workspace continuation is refused`,
					{ taskId: record.taskId },
				);
			}
		}
		return record;
	}

	/**
	 * Ticket 46 — every Task a lookup would match: the canonical id (which always
	 * wins, so it is the only candidate) or, failing that, every Task that claims
	 * the string as an alias. Callers that must not guess use this; `get` is the
	 * convenience view.
	 */
	resolveCandidates(taskId: string): TaskRecord[] {
		const direct = this.tasks.get(taskId);
		if (direct) return [direct];
		return [...this.tasks.values()].filter(
			(task) => Array.isArray(task.aliases) && task.aliases.includes(taskId),
		);
	}

	get(taskId: string): TaskRecord | undefined {
		// Ticket 46 — never silently pick the first of several alias holders: an
		// alias shared by two Tasks resolves to neither. Callers that need to say
		// why use `resolveCandidates`.
		const candidates = this.resolveCandidates(taskId);
		return candidates.length === 1 ? candidates[0] : undefined;
	}

	/** Record a reciprocal parent/successor link when both Tasks are known. */
	linkSuccessor(parentTaskId: string | undefined, successorTaskId: string): TaskRecord | undefined {
		if (!parentTaskId || parentTaskId === successorTaskId) return undefined;
		const parent = this.get(parentTaskId);
		if (!parent || parent.successors.includes(successorTaskId)) return parent;
		parent.successors.push(successorTaskId);
		return this.touch(parent);
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

	/** Most recently updated non-terminal task for the workspace identity. */
	activeForCwd(cwd: string): TaskRecord | undefined {
		const target = normalizeWorkspaceIdentity(cwd);
		return this.list()
			.filter(
				(task) =>
					!isFinalTaskState(task.state) &&
					task.cwd !== "" &&
					normalizeWorkspaceIdentity(task.cwd) === target,
			)
			.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))[0];
	}

	persist(record: TaskRecord): void {
		try {
			this.onPersist?.(record);
		} catch {
			// The sink records lastWriteError. Task memory must not die with a snapshot.
		}
	}

	/**
	 * Install a snapshot from disk. Loading is not a mutation: do not touch()
	 * or persist() (that would rewrite updatedAt). An in-memory record of the
	 * same id wins over a stale snapshot. E01 fields default to empty so a
	 * record written before per-execution evidence existed still loads; its
	 * missing A_run/C_report material then fails closed at the PASS gate.
	 */
	restore(record: TaskRecord): void {
		if (this.tasks.has(record.taskId)) return;
		if (!Array.isArray(record.executions)) record.executions = [];
		if (!Array.isArray(record.findings)) record.findings = [];
		if (!Array.isArray(record.successors)) record.successors = [];
		if (!Array.isArray(record.recoveryStates)) record.recoveryStates = [];
		if (!Number.isFinite(record.recoveryAttempts) || record.recoveryAttempts < 0) {
			record.recoveryAttempts = 0;
		}
		this.tasks.set(record.taskId, record);
		for (const candidate of this.tasks.values()) {
			const parentId = candidate.spec?.parentTaskId ?? candidate.spec?.commitOf ?? candidate.parentTaskId;
			const parent = parentId ? this.get(parentId) : undefined;
			if (parent && candidate.taskId !== parent.taskId && !parent.successors.includes(candidate.taskId)) {
				parent.successors.push(candidate.taskId);
			}
		}
		// IS-01 — a restored record keeps its id occupied: advance the
		// process-local sequence past any same-day restored suffix so in-memory
		// allocation can never reissue it (ledger-backed stores reserve through
		// the allocator's file-namespace scan instead).
		const match = RESTORED_ID_SHAPE.exec(record.taskId);
		if (match) {
			const restoredStamp = match[1];
			const localStamp = createTaskId(this.now(), 1).slice(2, 10);
			if (restoredStamp === localStamp) {
				this.sequence = Math.max(this.sequence, Number.parseInt(match[2], 10));
			}
		}
	}

	private touch(record: TaskRecord): TaskRecord {
		record.updatedAt = this.now().toISOString();
		this.persist(record);
		return record;
	}

	transition(taskId: string, next: TaskState): TaskRecord {
		const record = this.require(taskId);
		if (record.state === next) return record;
		if (!canTransition(record.state, next)) {
			throw new Error(`illegal task transition: ${record.state} -> ${next}`);
		}
		record.state = next;
		if (next === "blocked") {
			if (!record.sealedAt) record.sealedAt = this.now().toISOString();
		} else if (record.sealedAt) {
			delete record.sealedAt;
		}
		return this.touch(record);
	}

	bindSpec(taskId: string, spec: TaskSpec): TaskRecord {
		const record = this.require(taskId);
		record.spec = spec;
		record.role = spec.role;
		record.cwd = spec.cwd;
		record.parentTaskId = spec.parentTaskId ?? spec.commitOf ?? record.parentTaskId;
		record.isPlaceholder = false;
		this.linkSuccessor(spec.parentTaskId, record.taskId);
		this.linkSuccessor(spec.commitOf, record.taskId);
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

	/** E01 — start a per-execution evidence record with this execution's A_run. */
	beginExecution(taskId: string, execution: Omit<TaskExecutionRecord, "taskId">): TaskRecord {
		const record = this.require(taskId);
		record.executions.push({ ...execution, taskId });
		return this.touch(record);
	}

	/** E01 — fill in the result-receive sample (C_report) and attribution. */
	completeExecution(
		taskId: string,
		executionId: string,
		patch: Partial<Omit<TaskExecutionRecord, "taskId" | "executionId">>,
	): TaskRecord {
		const record = this.require(taskId);
		const execution = record.executions.find((item) => item.executionId === executionId);
		if (!execution) return record;
		Object.assign(execution, patch);
		return this.touch(record);
	}

	executionById(taskId: string, executionId: string): TaskExecutionRecord | undefined {
		return this.require(taskId).executions.find((item) => item.executionId === executionId);
	}

	/**
	 * E01 — replace this execution's open findings for the recomputed kinds.
	 * Findings recorded by earlier executions are never touched here, so a
	 * later round cannot wash them away by moving its own baseline.
	 */
	recordExecutionFindings(
		taskId: string,
		executionId: string,
		drafts: readonly { kind: TaskFinding["kind"]; paths: readonly string[] }[],
		detectedAt: string,
		recomputeKinds?: readonly TaskFinding["kind"][],
	): TaskRecord {
		const record = this.require(taskId);
		const kinds = new Set(recomputeKinds ?? drafts.map((draft) => draft.kind));
		record.findings = record.findings.filter(
			(finding) =>
				!(
					finding.status === "open"
					&& finding.executionId === executionId
					&& kinds.has(finding.kind)
				),
		);
		for (const draft of drafts) {
			// A HEAD-only drift has no paths; the note carries the meaning.
			if (draft.paths.length === 0 && draft.kind !== "drift") continue;
			record.findings.push({
				id: `${taskId}-F${record.findings.length + 1}`,
				kind: draft.kind,
				executionId,
				paths: [...draft.paths],
				status: "open",
				detectedAt,
				note: describeFinding(draft.kind, draft.paths),
			});
		}
		return this.touch(record);
	}

	/**
	 * E01 — a later execution whose window shows a finding's paths changed and
	 * now clean has produced evidence of a restore. The finding stays open:
	 * only a recorded review closes it (net-diff disappearance is not enough).
	 * Scope and undeclared findings resolve through a proven revert; drift
	 * findings resolve when a new revision's baseline incorporates the drift.
	 */
	markFindingEvidenceResolved(
		taskId: string,
		restoredPaths: readonly string[],
		executionId: string,
		kinds: readonly TaskFinding["kind"][] = ["scope", "undeclared", "drift"],
	): TaskRecord {
		const restored = new Set(restoredPaths);
		if (restored.size === 0) return this.require(taskId);
		const allowed = new Set(kinds);
		const record = this.require(taskId);
		let changed = false;
		for (const finding of record.findings) {
			if (finding.status !== "open" || finding.evidenceResolvedBy) continue;
			if (!allowed.has(finding.kind)) continue;
			if (!finding.paths.every((path) => restored.has(path))) continue;
			finding.evidenceResolvedBy = executionId;
			changed = true;
		}
		if (changed) return this.touch(record);
		return record;
	}

	/** E01 — close findings whose restore a review has now confirmed. */
	resolveFindings(taskId: string, resolvedBy: string): TaskRecord {
		const record = this.require(taskId);
		let changed = false;
		for (const finding of record.findings) {
			if (finding.status !== "open" || !finding.evidenceResolvedBy) continue;
			finding.status = "resolved";
			finding.resolvedBy = resolvedBy;
			changed = true;
		}
		if (changed) return this.touch(record);
		return record;
	}

	openFindings(taskId: string): TaskFinding[] {
		return this.require(taskId).findings.filter((finding) => finding.status === "open");
	}

	/**
	 * E02 (spec L106) — a revalidate decision grants one bounded revalidation
	 * for this evidence state: the key joins recoveryStates for no-progress
	 * detection immediately, but the budget counter is only spent when the
	 * revalidation run is actually dispatched (recordRecoveryAttempt). A
	 * restart or a rewritten reason text cannot reset either.
	 */
	markRevalidationGranted(taskId: string, evidenceKey: string): TaskRecord {
		const record = this.require(taskId);
		if (!record.recoveryStates.includes(evidenceKey)) record.recoveryStates.push(evidenceKey);
		record.pendingRevalidationKey = evidenceKey;
		record.lastRecovery = {
			reportRevision: record.reports.length,
			evidenceKey,
			at: this.now().toISOString(),
		};
		return this.touch(record);
	}

	/** Consume the pending revalidation key at the successful dispatch boundary. */
	takePendingRevalidation(taskId: string): string | undefined {
		const record = this.get(taskId);
		if (!record?.pendingRevalidationKey) return undefined;
		const evidenceKey = record.pendingRevalidationKey;
		delete record.pendingRevalidationKey;
		return evidenceKey;
	}

	/**
	 * E02 (spec L106) — +1 only here, at the real automatic-revalidation
	 * dispatch. Pure verdict rewrites, refused dispatches, and duplicate
	 * requests never reach this; replaying the same dispatch is idempotent
	 * by evidence key.
	 */
	recordRecoveryAttempt(taskId: string, evidenceKey: string): TaskRecord {
		const record = this.require(taskId);
		const dispatches = record.recoveryDispatches ?? (record.recoveryDispatches = []);
		if (dispatches.includes(evidenceKey)) return record;
		dispatches.push(evidenceKey);
		record.recoveryAttempts += 1;
		record.lastRecovery = {
			reportRevision: record.reports.length,
			evidenceKey,
			at: this.now().toISOString(),
		};
		return this.touch(record);
	}

	/** Stamp the decision advanceReview applied onto the newest review (audit). */
	annotateReviewDecision(taskId: string, appliedDecision: string): TaskRecord {
		const record = this.require(taskId);
		const review = record.reviews.at(-1);
		if (review) review.appliedDecision = appliedDecision;
		return this.touch(record);
	}

	setExecutionDrift(
		taskId: string,
		executionId: string,
		drift: NonNullable<TaskExecutionRecord["drift"]>,
	): TaskRecord {
		const record = this.require(taskId);
		const execution = record.executions.find((item) => item.executionId === executionId);
		if (!execution) return record;
		execution.drift = drift;
		return this.touch(record);
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
		const runId = report.evidence?.workerRunId;
		if (runId && record.reports.some((existing) => existing.evidence?.workerRunId === runId)) {
			return record;
		}
		record.reports.push(report);
		return this.touch(record);
	}

	recordValidatorReport(taskId: string, report: WorkerReport): TaskRecord {
		const record = this.require(taskId);
		const runId = report.evidence?.workerRunId;
		if (runId && record.validatorReports.some((existing) => existing.evidence?.workerRunId === runId)) {
			return record;
		}
		record.validatorReports.push(report);
		return this.touch(record);
	}

	recordReview(taskId: string, review: ReviewResult): TaskRecord {
		const record = this.require(taskId);
		record.reviews.push(review);
		return this.touch(record);
	}

	recordVerdictRefusal(taskId: string, refusal: Omit<RootVerdictRefusalRecord, "at">): TaskRecord {
		const record = this.require(taskId);
		(record.verdictRefusals ??= []).push({ ...refusal, at: this.now().toISOString() });
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

	setCompletionKind(taskId: string, completionKind: import("./types.ts").TaskCompletionKind): TaskRecord {
		const record = this.require(taskId);
		record.completionKind = completionKind;
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

	/**
	 * Release a stuck task through the operator escape hatch.
	 * Ticket 41 / Option 3: `blocked` stays final for automatic success paths
	 * and launch gates, but operators may abandon `blocked → failed`.
	 */
	abandon(taskId: string, reason = "abandoned by operator"): TaskRecord {
		const record = this.require(taskId);
		if (record.state !== "blocked" && isFinalTaskState(record.state)) {
			throw new Error(`cannot abandon terminal task: ${record.state}`);
		}
		this.transition(taskId, "failed");
		record.stateReason = reason;
		delete record.baseEvidence;
		delete record.baseReportCount;
		delete record.snapshot;
		delete record.sealedAt;
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
 * The lock follows actual write ability — decided in delegate.ts by
 * `role === "worker"` — not the presence of a TaskSpec or the worker role
 * name: a warn-mode unstructured worker and a shell-capable validator
 * contend just the same, and a second call on the
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
