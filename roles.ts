import type { ReviewEvidencePacket, TaskPacket, TaskRole, TaskSpec, WorkerReport } from "./types.ts";
import { canRebindNamedTask } from "./types.ts";
import { extractTaskSpec, extractTaskSpecDetails, inferTaskRoleFromAgent } from "./task.ts";
import type { TaskRecord } from "./task.ts";
import { buildFreshReviewerTask, extractReviewRequest } from "./review.ts";
import type { ReviewRequest } from "./types.ts";
import { workerReportShapeReminder } from "./report.ts";
import { formatFloorLimitsSummary, resolveEffectiveLimits } from "./floors.ts";
import type { EffectiveLimits, FloorConfig } from "./floors.ts";

// The capability table is owned by task.ts so the write lock and the agent
// remapping share one source of truth; re-exported here for consumers.
export { ROLE_TOOL_PROFILES, MUTATING_TOOLS, roleAllowsMutatingTools } from "./task.ts";

/**
 * §13 — capability profiles live in task.ts (the write-lock owner) so agent
 * remapping and write coordination share one source of truth; re-exported
 * above. Worker is unbounded (the selected agent keeps its own tools).
 * Restricted roles are enforced by remapping to a builtin agent whose
 * allowlist matches the profile. Foreground children do not load ambient
 * extensions, so this is the per-child tool ceiling the parent can actually
 * apply. Background children may load ambient extensions; this extension
 * no-ops when PI_SUBAGENT_CHILD=1.
 *
 * Reviewer children therefore have no `git_audit`: that tool is registered
 * by this extension and is not on the reviewer allowlist. Root passes
 * a bounded Git evidence packet instead (§P1-2).
 */

/** Builtin pi-subagents agents whose declared tools match the role profile. */
export const ROLE_AGENTS: Record<TaskRole, string | undefined> = {
	explorer: "reviewer",
	reviewer: "reviewer",
	validator: "oracle",
	worker: undefined,
};

// IS-02 — the agent→role table is owned by task.ts (identity and the repair
// contract live there) and re-exported under the historical name so agent
// remapping and the TaskSpec repair renderer cannot drift apart.
export { inferTaskRoleFromAgent as inferRoleFromAgent } from "./task.ts";

const inferRoleFromAgent = inferTaskRoleFromAgent;

export const WORKER_CONTRACT_MARKER = "[PLANNER-ONLY WORKER CONTRACT]";
export const ORACLE_CONTRACT_MARKER = "[PLANNER-ONLY ORACLE]";

export function oracleSuiteMode(env: NodeJS.ProcessEnv = process.env): "bounded" | "full" {
	return (env.PI_PLANNER_ONLY_ORACLE ?? "").trim().toLowerCase() === "full" ? "full" : "bounded";
}

export function wrapWorkerContract(task: string, taskId: string): string {
	if (task.includes(WORKER_CONTRACT_MARKER)) return task;
	return [
		task,
		"",
		WORKER_CONTRACT_MARKER,
		"Do not run /code-review or spawn a reviewer. Return only a WorkerReport JSON object:",
		"Use the canonical Task id from your launch packet; you must not ask Root or supervisor for the taskId.",
		"The top-level status must be exactly completed, partial, blocked, or failed.",
		"The validation status must be exactly passed, failed, or not-run.",
		"Your final message must contain only the WorkerReport JSON.",
		workerReportShapeReminder(taskId),
		"Do not run npm install, pnpm install, or any other command that modifies a lockfile, unless the TaskSpec explicitly requires it.",
		"If dependencies must be installed, use a lockfile-readonly install (npm ci, pnpm install --frozen-lockfile).",
		"If a lockfile is modified anyway, list it in changedFiles.",
	].join("\n");
}

export const MISSING_VALIDATION_DEFINITION_REASON = "Planner-only guard: 需补充验证定义。";

export function hasMissingRequiredValidationCommands(spec: TaskSpec | undefined): boolean {
	return spec?.validation.required === true && (!spec.validation.commands || spec.validation.commands.length === 0);
}

export function taskSpecRequestsFullSuite(spec: TaskSpec | undefined): boolean {
	return (spec?.validation.commands ?? []).some((command) =>
		command === "npm run test:e2e" || command === "full suite" || command === "全量套件",
	);
}

export function missingTaskSpecValidationCommands(
	spec: TaskSpec | undefined,
	report: WorkerReport | undefined,
): string[] {
	const required = spec?.validation?.commands ?? [];
	if (!required.length) return [];
	const covered = new Set(
		(report?.validation ?? [])
			.filter((item) => Boolean(item.command) && item.inferred !== true && item.status === "passed" && item.exitCode === 0)
			.map((item) => item.command as string),
	);
	return required.filter((cmd) => !covered.has(cmd));
}

export function wrapOracleContract(
	task: string,
	mode: "bounded" | "full" | "missing",
	workerValidationPassed: boolean,
	missingCommands?: string[],
): string {
	if (task.includes(ORACLE_CONTRACT_MARKER)) return task;
	let suite: string;
	if (mode === "missing") {
		const cmds = (missingCommands ?? []).join(", ");
		suite = `ORACLE_SUITE=missing. Run only the missing TaskSpec validation commands: ${cmds}. Do not re-run commands that already passed. This command restriction applies only to validation commands; still complete every required source inspection and acceptance criterion, and report manual checks separately.`;
	} else if (mode === "full" || !workerValidationPassed) {
		suite = "ORACLE_SUITE=full. Re-run the listed validation commands.";
	} else {
		suite = "ORACLE_SUITE=bounded. You MAY run only the test files named in the WorkerReport. Do not run npm test, npm run test:e2e, or the full suite. Check git rev-parse HEAD and git status --porcelain.";
	}
	return `${ORACLE_CONTRACT_MARKER}\n${suite}\nValidation-command reuse does not waive source inspection or acceptance criteria. Check each required inspection/criterion independently; mark it checked, reused, not-run, or failed, and report any mandatory item that remains incomplete. The embedded TaskSpec is authoritative, and its acceptanceCriteria/constraints must remain in scope.\nThe top-level status must be exactly completed, partial, blocked, or failed.\nThe validation status must be exactly passed, failed, or not-run.\n\n${task}`;
}

export function lastWorkerValidationPassed(report: WorkerReport | undefined): boolean {
	if (!report) return false;
	if (!report.validation.length) return false;
	return report.validation.every((item) => item.inferred !== true && item.status === "passed" && item.exitCode === 0);
}

export const ORACLE_SUITE_CONFLICT_WARNING =
	"[PLANNER-ONLY] Oracle suite conflict: Root prompt requests a full suite while mode is bounded.";

export const FULL_SUITE_MARKERS = [
	"npm test",
	"npm run test",
	"npm run test:e2e",
	"full suite",
	"全量套件",
] as const;

export function stripContractWrappers(prompt: string): string {
	if (prompt.startsWith(ORACLE_CONTRACT_MARKER)) {
		const doubleNewline = prompt.indexOf("\n\n");
		return doubleNewline !== -1 ? prompt.slice(doubleNewline + 2) : "";
	}
	if (prompt.includes(WORKER_CONTRACT_MARKER)) {
		const markerIndex = prompt.indexOf(WORKER_CONTRACT_MARKER);
		return prompt.slice(0, markerIndex).trim();
	}
	return prompt;
}

export function hasFullSuiteRequest(prompt: string): boolean {
	const unwrapped = stripContractWrappers(prompt).toLowerCase();
	return FULL_SUITE_MARKERS.some((marker) => unwrapped.includes(marker));
}

export interface ApplyRoleDelegationOptions {
	role: TaskRole;
	packet?: string;
	budget?: TaskSpec["budget"];
	taskId?: string;
	oracleMode?: "bounded" | "full";
	workerValidationPassed?: boolean;
	reportsCount?: number;
	floorConfig?: FloorConfig;
	/** Use the read-only builtin agent for report-only worker repairs. */
	readOnlyRepair?: boolean;
}

export interface ApplyRoleDelegationResult {
	mutated: boolean;
	role: TaskRole;
	contextOverridden?: boolean;
	contextReason?: string;
	floorLimits?: EffectiveLimits;
	oracleSuiteConflict?: boolean;
}

function sameToolBudget(existing: unknown, target: { hard?: number; soft?: number } | undefined): boolean {
	if (!target) return existing === undefined;
	if (!existing || typeof existing !== "object") return false;
	const record = existing as { hard?: unknown; soft?: unknown };
	return record.hard === target.hard
		&& (target.soft === undefined || record.soft === target.soft);
}

function sameUsageBudget(
	existing: unknown,
	target: { tokens?: { hard: number }; costUsd?: { hard: number } } | undefined,
): boolean {
	if (!target || (!target.tokens && !target.costUsd)) return existing === undefined;
	if (!existing || typeof existing !== "object") return false;
	const rec = existing as { tokens?: { hard?: unknown }; costUsd?: { hard?: unknown } };
	if (target.tokens) {
		if (!rec.tokens || typeof rec.tokens !== "object" || (rec.tokens as { hard?: unknown }).hard !== target.tokens.hard) {
			return false;
		}
	} else if (rec.tokens !== undefined) {
		return false;
	}
	if (target.costUsd) {
		if (!rec.costUsd || typeof rec.costUsd !== "object" || (rec.costUsd as { hard?: unknown }).hard !== target.costUsd.hard) {
			return false;
		}
	} else if (rec.costUsd !== undefined) {
		return false;
	}
	return true;
}

/**
 * Mutate a `subagent` tool payload in place so the child launches with the
 * role's builtin agent, context: "fresh" by default (Worker, Validator, Reviewer),
 * and a bounded task packet.
 */
export function applyRoleDelegation(
	input: Record<string, unknown>,
	options: ApplyRoleDelegationOptions,
): ApplyRoleDelegationResult {
	let mutated = false;
	// R02 — stamp the resolved role before the agent remap: an unstructured
	// explorer remaps to the builtin reviewer agent, and begin must still know
	// the invocation's own role to register unbound Explorer ownership.
	input.__delegationRole = options.role;
	let contextOverridden = false;
	let contextReason: string | undefined;

	const target = options.readOnlyRepair && options.role === "worker"
		? ROLE_AGENTS.explorer
		: ROLE_AGENTS[options.role];
	const callerKeepsScout = options.role === "explorer"
		&& typeof input.agent === "string"
		&& input.agent.trim().toLowerCase() === "scout";
	if (target && input.agent !== target && !callerKeepsScout) {
		input.agent = target;
		mutated = true;
	}

	// Worker, Validator, Reviewer all default to fresh context
	if (options.role === "worker" || options.role === "validator" || options.role === "reviewer") {
		if (input.context !== "fresh") {
			if (input.context === "fork") {
				contextOverridden = true;
				contextReason = 'context "fork" overridden to "fresh"';
			}
			input.context = "fresh";
			mutated = true;
		}
	}

	if (options.role === "reviewer") {
		if (options.packet !== undefined && input.task !== options.packet) {
			input.task = options.packet;
			mutated = true;
		}
	}
	if (options.role === "worker" || options.role === "explorer") {
		if (options.packet !== undefined) {
			if (input.task !== options.packet) {
				input.task = options.packet;
				mutated = true;
			}
		} else if (options.role === "worker" && typeof input.task === "string") {
			const wrapped = wrapWorkerContract(input.task, options.taskId ?? "<id>");
			if (wrapped !== input.task) {
				input.task = wrapped;
				mutated = true;
			}
		}
	}
	let oracleSuiteConflict: boolean | undefined;
	if (options.role === "validator") {
		const mode = options.oracleMode ?? "bounded";
		const workerValidationPassed = options.workerValidationPassed ?? false;
		const isBounded = mode === "bounded" && Boolean(workerValidationPassed);
		// Scan the caller's Root/task prose before wrapping. A plugin-built
		// packet (TaskSpec JSON) often contains validation.commands like
		// "npm test" and must not be treated as Root requesting a full suite.
		const scanText = options.packet === undefined && typeof input.task === "string"
			? input.task
			: undefined;
		if (Boolean(input.__oracleSuiteConflict) || (isBounded && scanText !== undefined && hasFullSuiteRequest(scanText))) {
			input.__oracleSuiteConflict = true;
			oracleSuiteConflict = true;
		}
		if (options.packet !== undefined) {
			if (input.task !== options.packet) {
				input.task = options.packet;
				mutated = true;
			}
		} else if (typeof input.task === "string") {
			const wrapped = wrapOracleContract(
				input.task,
				options.oracleMode ?? "bounded",
				options.workerValidationPassed ?? false,
			);
			if (wrapped !== input.task) {
				input.task = wrapped;
				mutated = true;
			}
		}
	}
	const effectiveLimits = resolveEffectiveLimits({
		role: options.role,
		reportsCount: options.reportsCount,
		callerToolBudget: input.toolBudget,
		callerUsageBudget: input.usageBudget,
		taskSpecBudget: options.budget,
		config: options.floorConfig,
	});

	if (effectiveLimits.tokens || effectiveLimits.costUsd) {
		const existingUsage = input.usageBudget && typeof input.usageBudget === "object"
			? { ...(input.usageBudget as Record<string, unknown>) }
			: {};
		const newUsage: Record<string, unknown> = existingUsage;
		if (effectiveLimits.tokens) {
			const existingTokens = existingUsage.tokens && typeof existingUsage.tokens === "object"
				? existingUsage.tokens as Record<string, unknown>
				: {};
			newUsage.tokens = { ...existingTokens, hard: effectiveLimits.tokens.value };
		}
		if (effectiveLimits.costUsd) {
			const existingCost = existingUsage.costUsd && typeof existingUsage.costUsd === "object"
				? existingUsage.costUsd as Record<string, unknown>
				: {};
			newUsage.costUsd = { ...existingCost, hard: effectiveLimits.costUsd.value };
		}
		if (!sameUsageBudget(input.usageBudget, newUsage)) {
			input.usageBudget = newUsage;
			mutated = true;
		}
	}

	if (effectiveLimits.toolBudget) {
		const existingTool = input.toolBudget && typeof input.toolBudget === "object"
			? input.toolBudget as Record<string, unknown>
			: {};
		const newTool = { ...existingTool, hard: effectiveLimits.toolBudget.value } as Record<string, unknown>;
		if (effectiveLimits.toolBudget.soft !== undefined) {
			Object.defineProperty(newTool, "soft", {
				value: effectiveLimits.toolBudget.soft,
				enumerable: Object.prototype.propertyIsEnumerable.call(existingTool, "soft"),
				writable: true,
				configurable: true,
			});
		}
		if (!sameToolBudget(input.toolBudget, newTool)) {
			input.toolBudget = newTool;
			mutated = true;
		}
	}

	input.__floorLimits = effectiveLimits;

	return {
		mutated,
		role: options.role,
		...(contextOverridden ? { contextOverridden: true, contextReason } : {}),
		floorLimits: effectiveLimits,
		...(oracleSuiteConflict ? { oracleSuiteConflict: true } : {}),
	};
}

/**
 * Build the worker/explorer packet without asking a model to summarize the
 * Root's prose. When a valid embedded spec is found, only that exact JSON
 * slice is removed; if it cannot be isolated, the original prompt is kept.
 */
export function buildTaskPacket(
	spec: TaskSpec,
	prompt: string,	details: { candidateText?: string; candidate?: Record<string, unknown> } = {},
): string {
	let instructions = prompt.trim();
	const existingValue = (() => {
		try {
			return JSON.parse(instructions) as Partial<TaskPacket>;
		} catch {
			return undefined;
		}
	})();
	const existing = existingValue && existingValue.version === 1 && existingValue.spec && Array.isArray(existingValue.knownFacts) && Array.isArray(existingValue.artifactRefs)
		? existingValue
		: details.candidate && details.candidate.version === 1 && details.candidate.spec
			&& Array.isArray(details.candidate.knownFacts) && Array.isArray(details.candidate.artifactRefs)
			? details.candidate as Partial<TaskPacket>
			: undefined;
	if (existing) {
		const knownFacts = Array.isArray(existing.knownFacts)
			? existing.knownFacts.filter((item): item is string => typeof item === "string")
			: [];
		const artifactRefs = Array.isArray(existing.artifactRefs)
			? existing.artifactRefs.filter((item): item is string => typeof item === "string")
			: [];
		return JSON.stringify({
			version: 1,
			spec,
			instructions: typeof existing.instructions === "string" ? existing.instructions : "",
			knownFacts,
			artifactRefs,
		} satisfies TaskPacket, null, 2);
	}
	if (details.candidateText) {
		const start = prompt.indexOf(details.candidateText);
		if (start >= 0) {
			instructions = `${prompt.slice(0, start)}${prompt.slice(start + details.candidateText.length)}`
				.replace(/```(?:json|jsonc)?\s*\n?\s*```/g, "")
				.replace(/UNRELATED_ROOT_CONVERSATION_HISTORY_MARKER_[A-Za-z0-9_-]+/g, "")
				.trim();
		}
	}
	const submitted = details.candidate;
	const submittedFacts = submitted && Array.isArray(submitted.knownFacts)
		? submitted.knownFacts.filter((item): item is string => typeof item === "string")
		: [];
	const submittedRefs = submitted && Array.isArray(submitted.artifactRefs)
		? submitted.artifactRefs.filter((item): item is string => typeof item === "string")
		: [];
	const knownFacts = submittedFacts.length > 0
		? submittedFacts
		: [...(spec.constraints ?? []), ...(spec.acceptanceCriteria ?? [])];
	const artifactRefs = submittedRefs.length > 0
		? submittedRefs
		: [...(spec.scope?.allowedPaths ?? [])];
	return JSON.stringify({
		version: 1,
		spec,
		instructions,
		knownFacts,
		artifactRefs,
	} satisfies TaskPacket, null, 2);
}

export function extractTaskPacket(text: string): TaskPacket | undefined {
	if (typeof text !== "string") return undefined;
	try {
		const value = JSON.parse(text.trim()) as Partial<TaskPacket>;
		if (value?.version !== 1 || !value.spec || typeof value.instructions !== "string"
			|| !Array.isArray(value.knownFacts) || !Array.isArray(value.artifactRefs)) return undefined;
		return value as TaskPacket;
	} catch {
		return undefined;
	}
}

export function delegationPrompt(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const params = input as { task?: unknown; tasks?: unknown; chain?: unknown };
	const parts: string[] = [typeof params.task === "string" ? params.task : ""];
	if (Array.isArray(params.tasks)) {
		parts.push(...params.tasks.map((item) => (item && typeof item === "object" ? String((item as { task?: unknown }).task ?? "") : "")));
	}
	if (Array.isArray(params.chain)) {
		parts.push(...params.chain.map((item) => (item && typeof item === "object" ? String((item as { task?: unknown }).task ?? "") : "")));
	}
	return parts.filter(Boolean).join("\n");
}

/** Replace pre-launch Task ids in the child packet after Orchestration mints the canonical id. */
export function stampCanonicalTaskId(input: unknown, canonicalTaskId: string, previousTaskIds: readonly (string | undefined)[]): void {
	if (!input || typeof input !== "object" || Array.isArray(input)) return;
	const record = input as Record<string, unknown>;
	if (typeof record.task !== "string") return;
	let packet = record.task;
	for (const previousTaskId of previousTaskIds) {
		if (previousTaskId && previousTaskId !== canonicalTaskId) packet = packet.split(previousTaskId).join(canonicalTaskId);
	}
	record.task = packet;
}

export interface DelegationTarget {
	role: TaskRole;
	taskId?: string;
	task?: TaskRecord;
	/** TaskSpec embedded in the prompt, when the parent supplied one. */
	spec?: TaskSpec;
	/** ReviewRequest embedded in a reviewer packet. */
	request?: ReviewRequest;
	/** Task ids named in the prompt when no TaskSpec/ReviewRequest was embedded. */
	namedTaskIds?: string[];
}

export const TASK_ID_RE = /\bT-\d{8}-\d{3}\b/g;

export function promptTaskIds(prompt: string): string[] {
	return [...new Set(prompt.match(TASK_ID_RE) ?? [])];
}

/**
 * Resolve the role and Task identity of a delegation payload.
 *
 * A ReviewRequest wins over an embedded TaskSpec: reviewing is an invocation
 * over an existing Task, so the reviewer packet is not a TaskSpec of its own.
 */
export function resolveDelegationTarget(
	rawInput: unknown,
	lookup: (taskId: string) => TaskRecord | undefined,
): DelegationTarget | undefined {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return undefined;
	const input = rawInput as Record<string, unknown>;
	const prompt = delegationPrompt(input);
	const agentRole = inferRoleFromAgent(typeof input.agent === "string" ? input.agent : undefined);
	const spec = extractTaskSpec(prompt, undefined, agentRole ?? "worker");
	const request = extractReviewRequest(prompt);
	const role = request
		? "reviewer"
		: agentRole === "validator"
			? agentRole
			: spec?.role ?? agentRole;
	if (!role) return undefined;

	const namedTaskIds = !spec && !request ? promptTaskIds(prompt) : [];
	let taskId = request?.taskId ?? spec?.taskId ?? (typeof input.taskId === "string" ? input.taskId.trim() : undefined);
	let task = taskId ? lookup(taskId) : undefined;
	if (!taskId && namedTaskIds.length === 1) {
		const found = lookup(namedTaskIds[0] as string);
		if (found && canRebindNamedTask(found.state)) {
			taskId = namedTaskIds[0];
			task = found;
		}
	}
	return {
		role,
		...(taskId ? { taskId } : {}),
		...(task ? { task } : {}),
		...(spec ? { spec } : {}),
		...(request ? { request } : {}),
		...(namedTaskIds.length ? { namedTaskIds } : {}),
	};
}

export interface ReuseRequestInfo {
	requested: boolean;
	requestedTaskId?: string;
	rootHistoryRequested?: boolean;
}

export interface ContextReuseOutcome {
	reused: boolean;
	reason: string;
}

export function detectReuseRequest(rawInput: unknown): ReuseRequestInfo {
	if (!rawInput || typeof rawInput !== "object") return { requested: false };
	const rec = rawInput as Record<string, unknown>;
	const rootHistoryRequested = rec.context === "fork" || rec.reuseRootHistory === true;
	const explicitTaskId = typeof rec.reuseTaskId === "string" && rec.reuseTaskId.trim()
		? rec.reuseTaskId.trim()
		: typeof rec.reuseContext === "string" && rec.reuseContext.trim()
			? rec.reuseContext.trim()
			: undefined;
	const boolRequested = rec.reuseContext === true || rec.reuse === true;
	if (rootHistoryRequested || explicitTaskId || boolRequested) {
		return {
			requested: true,
			...(explicitTaskId ? { requestedTaskId: explicitTaskId } : {}),
			...(rootHistoryRequested ? { rootHistoryRequested: true } : {}),
		};
	}
	return { requested: false };
}

export const STRIPPED_DELEGATION_KEYS = [
	"__delegationRole",
	"__reuseOutcome",
	"__contextOverridden",
	"__floorLimits",
	"__oracleSuiteConflict",
	"reuseTaskId",
	"reuseContext",
	"reuseRootHistory",
	"reuse",
] as const;

export function stripDelegationKeys(input: unknown): void {
	if (!input || typeof input !== "object" || Array.isArray(input)) return;
	const rec = input as Record<string, unknown>;
	for (const key of STRIPPED_DELEGATION_KEYS) {
		delete rec[key];
	}
}

export function buildPreviousExecutionContext(task: TaskRecord, spec?: TaskSpec): string {
	const report = task.reports.at(-1);
	const scopedPaths = spec?.scope?.allowedPaths?.length ? spec.scope.allowedPaths : report?.changedFiles ?? [];
	const lines = [
		"[PLANNER-ONLY REUSED TASK CONTEXT]",
		`Task: ${task.taskId} (round ${task.reviewRound})`,
		...(scopedPaths.length ? [`Scoped files: ${scopedPaths.join(", ")}`] : []),
		...(report?.evidence ? [`Evidence: taskId=${report.evidence.taskId}, workerRunId=${report.evidence.workerRunId}, gitAvailable=${report.evidence.gitAvailable}`] : []),
		"Previous WorkerReport:",
		report ? JSON.stringify(report, null, 2) : "none",
	];
	return lines.join("\n");
}

/**
 * Ticket 42 — labeled shim for detecting Root-authored report-only correction
 * prose. Prefer the explicit `reportOnly` field; this sniff only triggers
 * machine-generation of that field + TaskSpec embedding.
 */
export function isReportOnlyPrompt(prompt: string): boolean {
	return /\bDo not modify files\b/i.test(prompt) || /\breport-only correction\b/i.test(prompt);
}

/** True when the delegation input carries or implies report-only correction. */
export function isReportOnlyDelegationInput(rawInput: unknown): boolean {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return false;
	const input = rawInput as Record<string, unknown>;
	if (input.reportOnly === true) return true;
	return isReportOnlyPrompt(delegationPrompt(input));
}

/**
 * Ticket 42 — stamp explicit `reportOnly` and ensure a worker agent so
 * `resolveDelegationTarget` can bind, enabling TaskSpec auto-embedding.
 */
export function stampReportOnlyCorrectionInput(rawInput: unknown): void {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return;
	if (!isReportOnlyDelegationInput(rawInput)) return;
	const input = rawInput as Record<string, unknown>;
	input.reportOnly = true;
	if (typeof input.agent !== "string" || !input.agent.trim()) {
		input.agent = "worker";
	}
}

/**
 * True when the delegation carries no Task identity at all: no `taskId`, no
 * embedded TaskSpec / ReviewRequest, and no Task id named in the prose. Only
 * such requests may bind to an active fallback Task; an explicit but
 * unresolved identity (unknown, completed) must not be redirected.
 */
export function isUnnamedDelegationTarget(target: DelegationTarget | undefined): boolean {
	if (!target) return true;
	return !target.taskId && !target.spec && !target.request && (target.namedTaskIds?.length ?? 0) === 0;
}

/** Bind a report-only correction that names no Task to the active fallback Task. */
export function bindReportOnlyFallback(
	target: DelegationTarget | undefined,
	fallbackTask: TaskRecord | undefined,
): DelegationTarget | undefined {
	if (!fallbackTask || !isUnnamedDelegationTarget(target)) return target;
	return { role: target?.role ?? "worker", taskId: fallbackTask.taskId, task: fallbackTask };
}

export interface PrepareRoleDelegationOptions {
	/** Bounded Git-read sample for a reviewer packet. Root supplies it. */
	git?: ReviewEvidencePacket;
	/** Freshness summary of the last Root-side evidence comparison. */
	evidence?: string;
	/** Override oracle suite mode; defaults to PI_PLANNER_ONLY_ORACLE. */
	oracleMode?: "bounded" | "full";
	reportsCount?: number;
	/**
	 * Ticket 42 — when a report-only correction names no Task at all, bind to
	 * this active Task (typically changes_requested / reviewing) so its TaskSpec
	 * can be machine-embedded. Never overrides an explicit but unresolved id.
	 */
	fallbackTask?: TaskRecord;
}

/**
 * Remap the child agent, and for reviewers replace the payload with a fresh
 * ReviewRequest packet. Looks up an existing Task when the prompt embeds a
 * taskId; the packet shows the Task's *original* spec read-only, so a reviewer
 * invocation never rewrites the unit of work (§P1-1).
 */
export function prepareRoleDelegation(
	rawInput: unknown,
	lookup: (taskId: string) => TaskRecord | undefined,
	options: PrepareRoleDelegationOptions = {},
): void {
	if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) return;
	// Ticket 42 — stamp explicit reportOnly before target resolution so a
	// Root-authored correction prose still binds and embeds the TaskSpec.
	stampReportOnlyCorrectionInput(rawInput);
	const prompt = delegationPrompt(rawInput);
	const specDetails = extractTaskSpecDetails(prompt);
	if (specDetails.hasCharacteristics && !specDetails.spec) return;

	let target = resolveDelegationTarget(rawInput, lookup);
	const input = rawInput as Record<string, unknown>;
	const reportOnly = input.reportOnly === true;
	// Machine-generate binding: an unnamed report-only correction uses the
	// active fallback Task so the original TaskSpec can be embedded.
	if (reportOnly) target = bindReportOnlyFallback(target, options.fallbackTask);
	if (!target) return;
	// An existing Task's spec is authoritative; without one the embedded spec is
	// the only description available.
	let packetSpec = target.role === "reviewer"
		? (target.task?.spec ?? target.spec)
		: (target.spec ?? target.task?.spec);
	// Ticket 42 — machine-generated correction carries explicit reportOnly on
	// the embedded TaskSpec so evidence compare does not sniff prompt text.
	if (reportOnly && packetSpec && !packetSpec.reportOnly) {
		packetSpec = { ...packetSpec, reportOnly: true };
	}
	const report = target.task?.reports.at(-1);
	let packet: string | undefined;
	let effectiveWorkerValidationPassed = false;

	const missingValidationDefinition = target.role === "validator"
		&& hasMissingRequiredValidationCommands(packetSpec);
	if (missingValidationDefinition) return;

	if (target.role === "reviewer") {
		packet = (packetSpec || report || options.git)
			? buildFreshReviewerTask({
				// The reviewer must echo the store's canonical id: a model-chosen id
				// kept only as an alias would fail ReviewResult identity checks.
				taskId: target.task?.taskId ?? target.taskId ?? "unknown",
				...(packetSpec ? { spec: packetSpec } : {}),
				...(report ? { report } : {}),
				// D09 / ticket 02 — the reviewer is told which report revision and
				// workspace snapshot digest it is reviewing, so its verdict can be
				// bound to them. A missing bound snapshot is omitted (unknown), never
				// replaced by a HEAD/status hash.
				reportRevision: target.task?.reports.length ?? 0,
				...(report && target.task?.snapshot?.digest
					? { workspaceDigest: target.task.snapshot.digest }
					: {}),
				...(options.evidence ? { evidence: options.evidence } : {}),
				...(options.git ? { git: options.git } : {}),
			})
			: undefined;
	} else if (target.role === "worker" || target.role === "validator" || target.role === "explorer") {
		const reuseReq = detectReuseRequest(rawInput);
		let reuseOutcome: ContextReuseOutcome | undefined;
		if (reuseReq.rootHistoryRequested) {
			reuseOutcome = {
				reused: false,
				reason: 'Root history replication requested (context: "fork"); Root history cannot be reused. Fell back to pure fresh packet.',
			};
		} else if (reuseReq.requested) {
			const canonicalId = target.task?.taskId ?? target.taskId;
			const requestedId = reuseReq.requestedTaskId;
			if (requestedId && target.task && target.task.taskId !== requestedId && !target.task.aliases.includes(requestedId)) {
				reuseOutcome = {
					reused: false,
					reason: `Context reuse rejected: requested task ${requestedId} does not match canonical task ${target.task.taskId}; fell back to pure fresh packet.`,
				};
			} else if (!target.task || target.task.reports.length === 0) {
				reuseOutcome = {
					reused: false,
					reason: `Context reuse rejected: cannot verify previous execution context for task ${canonicalId ?? "unknown"}; fell back to pure fresh packet.`,
				};
			} else {
				reuseOutcome = {
					reused: true,
					reason: `Context reused from previous round of task ${target.task.taskId}.`,
				};
			}
		}

		if (reuseOutcome) {
			input.__reuseOutcome = reuseOutcome;
		}
		if (reuseReq.rootHistoryRequested) {
			input.__contextOverridden = true;
		}

		let validatorWrapMode: "bounded" | "full" | "missing" = "full";
		let validatorMissingCommands: string[] = [];
		effectiveWorkerValidationPassed = false;
		if (target.role === "validator") {
			const requestedOracleMode = options.oracleMode ?? oracleSuiteMode();
			const missingCommands = missingTaskSpecValidationCommands(packetSpec, report);
			validatorMissingCommands = missingCommands;
			const requiredCommands = packetSpec?.validation?.commands ?? [];
			const properSubsetMissing = requiredCommands.length > 0
				&& missingCommands.length > 0
				&& missingCommands.length < requiredCommands.length;
			const completeTaskSpecValidation = requiredCommands.length > 0 && missingCommands.length === 0;
			const fresh = target.task?.lastComparison?.fresh === true;
			const workerPassed = lastWorkerValidationPassed(report);

			if (requestedOracleMode === "full") {
				validatorWrapMode = "full";
			} else if (taskSpecRequestsFullSuite(packetSpec)) {
				validatorWrapMode = "full";
			} else if (properSubsetMissing && fresh) {
				validatorWrapMode = "missing";
			} else if (workerPassed && fresh && completeTaskSpecValidation) {
				validatorWrapMode = "bounded";
			} else {
				validatorWrapMode = "full";
			}
			effectiveWorkerValidationPassed = workerPassed && fresh && completeTaskSpecValidation && !properSubsetMissing;
		}

		if (packetSpec) {
			let packetBody = reuseOutcome?.reused && target.task
				? `${buildPreviousExecutionContext(target.task, packetSpec)}\n\n${JSON.stringify(packetSpec, null, 2)}`
				: buildTaskPacket(packetSpec, prompt, {
					candidateText: specDetails.candidateText,
					candidate: specDetails.candidate,
				});
			// Ticket 42 — machine-generated corrections keep the report-only instruction
			// ahead of the embedded TaskSpec so the child still knows not to edit files.
			if (reportOnly && target.role === "worker") {
				const correctionLead = [
					`Do not modify files. Return only a valid WorkerReport for task ${target.task?.taskId ?? target.taskId ?? packetSpec.taskId}.`,
					"The top-level status must be exactly completed, partial, blocked, or failed.",
					"The validation status must be exactly passed, failed, or not-run.",
					"This repair uses a fresh read-only agent because native resume cannot tighten the prior worker's tools.",
				].join("\n");
				packetBody = `${correctionLead}\n\n${packetBody}`;
			}

			if (target.role === "explorer") {
				packetBody = [
					"This is a read-only execution. Do not edit, create, delete, stage, or commit files.",
					"Do not list concurrent workspace changes as changedFiles; report them as observed external changes in risks or unresolved instead.",
					packetBody,
				].join("\n\n");
			}
			if (target.role === "worker" || target.role === "explorer") {
				packet = wrapWorkerContract(packetBody, target.task?.taskId ?? target.taskId ?? packetSpec.taskId);
			} else {
				packet = wrapOracleContract(
					packetBody,
					validatorWrapMode,
					effectiveWorkerValidationPassed,
					validatorMissingCommands,
				);
			}
		}

		if (target.role === "validator") {
			const isBounded = validatorWrapMode === "bounded";
			if (isBounded && hasFullSuiteRequest(prompt)) {
				input.__oracleSuiteConflict = true;
			}
		}
	}

	applyRoleDelegation(input, {
		role: target.role,
		...(packet ? { packet } : {}),
		...(packetSpec?.budget ? { budget: packetSpec.budget } : {}),
		...(target.task?.taskId ?? target.taskId ? { taskId: target.task?.taskId ?? target.taskId } : {}),
		reportsCount: options.reportsCount ?? target.task?.reports.length ?? 0,
		...(target.role === "validator"
			? {
				oracleMode: options.oracleMode ?? oracleSuiteMode(),
				workerValidationPassed: effectiveWorkerValidationPassed,
			}
			: {}),
		readOnlyRepair: reportOnly && target.role === "worker",
	});
}
