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
import type { EvidenceComparison } from "./evidence.ts";
import type { WorkspaceSnapshotBinding } from "./workspace-snapshot.ts";
import { jsonCandidates } from "./report.ts";
import { emptyTaskUsage } from "./usage.ts";

const TASK_ROLES: readonly TaskRole[] = ["worker", "explorer", "validator", "reviewer"];
const explicitlyNoValidation = new WeakSet<TaskSpec>();

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
}

export function createTaskId(now: Date = new Date(), sequence = 1): string {
	const year = String(now.getFullYear());
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	const index = String(Math.max(1, Math.trunc(sequence))).padStart(3, "0");
	return `T-${year}${month}${day}-${index}`;
}

export function createTaskSpec(input: CreateTaskSpecInput, taskId = createTaskId()): TaskSpec {
	const spec: TaskSpec = {
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
	if (input.validation?.required === false) explicitlyNoValidation.add(spec);
	return spec;
}

export function isExplicitlyNoValidation(spec: TaskSpec | undefined): boolean {
	return spec !== undefined && explicitlyNoValidation.has(spec);
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
	if (value.additionalWorktreeRoots !== undefined) {
		if (!isStringArray(value.additionalWorktreeRoots)) {
			errors.push("additionalWorktreeRoots must be an array of strings");
		} else if (value.additionalWorktreeRoots.some((root) => !root.trim())) {
			errors.push("additionalWorktreeRoots entries must be non-empty strings");
		}
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
] as const;

/**
 * R01 — the documented example-JSON `taskId` sentinel. Orchestration always
 * replaces it with a generated canonical id and never stores it as an alias,
 * so pasting the same example JSON a second time starts a new Task.
 */
export const TASKSPEC_EXAMPLE_SENTINEL = "T-pending";

const EXAMPLE_INSPECT_TOOLS = new Set(["read", "grep", "find", "ls"]);

const EXAMPLE_WORKER_REPORT_CONTRACT =
	"Return only a valid WorkerReport JSON object (version, taskId, status, summary, changedFiles, validation, evidence, risks, unresolved) using the canonical Task id from your launch packet; you must not ask Root or supervisor for the taskId. The validation status must be exactly passed, failed, or not-run. Your final message must contain only the WorkerReport JSON.";

export interface TaskSpecExampleInput {
	toolName: string;
	/** The refused tool call's input (inspect path, bash command, edit target…). */
	input?: unknown;
	/** Adapter workspace the refusal happened in. */
	cwd?: string;
	/** An invalid TaskSpec candidate whose valid fields should be preserved. */
	submitted?: Record<string, unknown>;
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

function validValidation(value: unknown): boolean {
	if (!isPlainObject(value)) return false;
	const validation = value as Record<string, unknown>;
	if (typeof validation.required !== "boolean") return false;
	if (validation.commands !== undefined && !isStringArray(validation.commands)) return false;
	return true;
}

/**
 * R01 — the one example-TaskSpec renderer shared by the Policy parent-tool
 * refusal and the Orchestration invalid-TaskSpec refusal. The returned object
 * always passes `validateTaskSpec`. Fields are filled from the refused tool
 * input (inspect path → constraints + Explorer; shell command → objective +
 * Explorer; write/edit → Worker; anything else → placeholder objective +
 * Explorer unless the submitted candidate carries a valid role); submitted
 * fields that already pass per-field validation are preserved, except the
 * example sentinel `taskId`. Budget, evidence, extra worktree roots, and test
 * commands are never invented.
 */
export function buildTaskSpecExample(options: TaskSpecExampleInput): Record<string, unknown> {
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
	const role: TaskRole = isMutate
		? "worker"
		: isInspect || isShell
			? "explorer"
			: submittedRole ?? "explorer";

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

	const constraints: string[] = submitted && isStringArray(submitted.constraints)
		? submitted.constraints.filter((item) => item.trim())
		: [];
	if (isInspect && path) constraints.push(`Inspect ${path} and report the findings; do not modify it.`);
	if (role === "explorer") constraints.push(EXAMPLE_WORKER_REPORT_CONTRACT);
	if (isMutate) constraints.push("Stay inside the objective and list every changed file in the WorkerReport.");

	// Invalid validation shapes (array, non-boolean required, non-string-array
	// commands) collapse to the minimal legal object; commands are omitted, not
	// guessed.
	const validation: { required: boolean; commands?: string[] } = submitted && validValidation(submitted.validation)
		? (() => {
			const raw = submitted.validation as Record<string, unknown>;
			return {
				required: raw.required as boolean,
				...(isStringArray(raw.commands) && raw.commands.length > 0 ? { commands: raw.commands } : {}),
			};
		})()
		: { required: false };

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
		validation,
		...(submitted && isPlainObject(submitted.expectedEvidence) ? { expectedEvidence: submitted.expectedEvidence } : {}),
		...(submitted && isStringArray(submitted.stopConditions)
			? { stopConditions: submitted.stopConditions.filter((item) => item.trim()) }
			: {}),
		...(submitted && isStringArray(submitted.additionalWorktreeRoots)
			? { additionalWorktreeRoots: submitted.additionalWorktreeRoots.filter((item) => item.trim()) }
			: {}),
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
		return minimal;
	}
	return example;
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
		"Embed this in the subagent task prompt as the TaskSpec JSON:",
		"```json",
		JSON.stringify(example, null, 2),
		"```",
	].join("\n");
}

export interface ExtractedTaskSpecResult {
	spec?: TaskSpec;
	hasCharacteristics: boolean;
	titleAliasUsed: boolean;
	errors: string[];
	candidate?: Record<string, unknown>;
}

function topLevelJsonCandidates(text: string): string[] {
	const candidates: string[] = [];
	const trimmed = text.trim();
	if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
		candidates.push(trimmed);
	}
	for (const match of text.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)```/g)) {
		if (match[1]?.trim()) candidates.push(match[1].trim());
	}
	for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		let matchedEnd = -1;
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
					matchedEnd = index;
					break;
				}
			}
		}
		if (matchedEnd !== -1) {
			candidates.push(text.slice(start, matchedEnd + 1));
			start = matchedEnd;
		}
	}
	return [...new Set(candidates)];
}

export function extractTaskSpecDetails(
	text: string,
	defaultCwd?: string,
	defaultRole: TaskRole = "worker",
): ExtractedTaskSpecResult {
	if (typeof text !== "string" || !text.trim()) {
		return { hasCharacteristics: false, titleAliasUsed: false, errors: [] };
	}

	let firstErrorResult: ExtractedTaskSpecResult | undefined;

	for (const candidate of topLevelJsonCandidates(text)) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(candidate);
		} catch {
			continue;
		}

		if (!isPlainObject(parsed)) continue;

		// Ignore ReviewRequest and WorkerReport payloads
		if ("reviewMode" in parsed && "reportTaskId" in parsed) continue;
		if ("status" in parsed && "changedFiles" in parsed && "evidence" in parsed) continue;

		const matchingFields = TASKSPEC_CHARACTERISTIC_FIELDS.filter((field) => field in parsed);
		const hasCharacteristics = matchingFields.length >= 2 || (matchingFields.length === 1 && matchingFields[0] !== "taskId");
		if (!hasCharacteristics) continue;

		let objective: unknown = parsed.objective;
		let titleAliasUsed = false;
		if (isNonEmptyString(parsed.objective)) {
			objective = parsed.objective;
		} else if (isNonEmptyString(parsed.title)) {
			objective = parsed.title;
			titleAliasUsed = true;
		}

		const effectiveCwd = isNonEmptyString(parsed.cwd)
			? parsed.cwd
			: defaultCwd ?? (typeof process !== "undefined" ? process.cwd() : "");
		const effectiveRole = isNonEmptyString(parsed.role)
			? (parsed.role as TaskRole)
			: defaultRole;

		const candidateToValidate: Record<string, unknown> = {
			...parsed,
			objective,
			cwd: effectiveCwd,
			role: effectiveRole,
		};

		const errors = validateTaskSpec(candidateToValidate);
		if (errors.length === 0) {
			const spec = createTaskSpec(
				{
					taskId: isNonEmptyString(parsed.taskId) ? parsed.taskId : undefined,
					objective: objective as string,
					cwd: effectiveCwd,
					role: effectiveRole,
					scope: isPlainObject(parsed.scope) ? (parsed.scope as TaskScope) : undefined,
					constraints: isStringArray(parsed.constraints) ? parsed.constraints : undefined,
					acceptanceCriteria: isStringArray(parsed.acceptanceCriteria) ? parsed.acceptanceCriteria : undefined,
					validation: isPlainObject(parsed.validation) ? (parsed.validation as Partial<TaskValidation>) : undefined,
					expectedEvidence: isPlainObject(parsed.expectedEvidence) ? (parsed.expectedEvidence as ExpectedEvidence) : undefined,
					stopConditions: isStringArray(parsed.stopConditions) ? parsed.stopConditions : undefined,
					additionalWorktreeRoots: isStringArray(parsed.additionalWorktreeRoots)
						? parsed.additionalWorktreeRoots
						: undefined,
				},
				isNonEmptyString(parsed.taskId) ? parsed.taskId : undefined,
			);
			if (isPlainObject(parsed.budget)) {
				(spec as { budget?: unknown }).budget = parsed.budget;
			}
			if (isPlainObject(parsed.cumulativeBudget)) {
				(spec as { cumulativeBudget?: unknown }).cumulativeBudget = parsed.cumulativeBudget;
			}
			if (parsed.reportOnly === true) {
				spec.reportOnly = true;
			}
			return {
				spec,
				hasCharacteristics: true,
				titleAliasUsed,
				errors: [],
				candidate: parsed,
			};
		}

		if (!firstErrorResult) {
			firstErrorResult = {
				hasCharacteristics: true,
				titleAliasUsed: false,
				errors,
				candidate: parsed,
			};
		}
	}

	if (firstErrorResult) {
		return firstErrorResult;
	}

	return { hasCharacteristics: false, titleAliasUsed: false, errors: [] };
}

/** Pull a TaskSpec the parent embedded in a delegation prompt. */
export function extractTaskSpec(
	text: string,
	defaultCwd?: string,
	defaultRole: TaskRole = "worker",
): TaskSpec | undefined {
	return extractTaskSpecDetails(text, defaultCwd, defaultRole).spec;
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
	blocked: ["executing", "reviewing", "failed"],
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
}

export class TaskStore {
	private readonly tasks = new Map<string, TaskRecord>();
	private readonly clock: () => Date;
	private readonly onPersist?: (record: TaskRecord) => void;
	private sequence = 0;

	constructor(options: TaskStoreOptions = {}) {
		this.clock = options.now ?? (() => new Date());
		this.onPersist = options.onPersist;
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
			reviewMode: process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1" ? "fresh" : "root",
			reports: [],
			validatorReports: [],
			reviews: [],
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
		this.persist(record);
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
		if (!Array.isArray(record.recoveryStates)) record.recoveryStates = [];
		if (!Number.isFinite(record.recoveryAttempts) || record.recoveryAttempts < 0) {
			record.recoveryAttempts = 0;
		}
		this.tasks.set(record.taskId, record);
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
		record.isPlaceholder = false;
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
	 * E02 — record one granted automatic recovery attempt. Counters live on
	 * the Task record: a restart or a rewritten reason text cannot reset them.
	 */
	recordRecoveryAttempt(taskId: string, evidenceKey: string): TaskRecord {
		const record = this.require(taskId);
		record.recoveryAttempts += 1;
		if (!record.recoveryStates.includes(evidenceKey)) record.recoveryStates.push(evidenceKey);
		record.lastRecovery = {
			reportRevision: record.reports.length,
			evidenceKey,
			at: this.now().toISOString(),
		};
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
