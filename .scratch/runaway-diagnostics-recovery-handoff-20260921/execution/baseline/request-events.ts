/** Translate program-owned Task/host facts into request observations. */
import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { isExecutableCommandShape, isValidationDefinitionIncomplete } from "./task.ts";
import type { TaskRecord } from "./task.ts";
import type { DelegationOutcome, PlannerDelegationParams } from "./delegate.ts";
import type { ReviewDecision } from "./review.ts";
import { isRefusal } from "./refusal-breaker.ts";

export function structuralIssues(schema: TSchema, params: unknown): string[] {
	const issues = Value.Errors(schema, params).flatMap(e => {
		const missing = (e.params as { requiredProperties?: string[] }).requiredProperties;
		return missing?.length ? missing.map(p => `${e.instancePath}/${p}:required`) : [`${e.instancePath}:${e.keyword}`];
	});
	const validation = (params as PlannerDelegationParams | null)?.validation;
	if (isValidationDefinitionIncomplete(validation)) issues.push("/validation/commands:required");
	if (Array.isArray(validation?.commands)) {
		validation.commands.forEach((c, i) => {
			if (typeof c === "string" && c.trim() && !isExecutableCommandShape(c)) issues.push(`/validation/commands/${i}:executable`);
		});
	}
	return [...new Set(issues)].sort();
}

export function requestErrorFamily(tool: string, error: unknown): string {
	const e = error as { code?: unknown; name?: string } | null;
	const code = typeof e?.code === "string" ? e.code : "UNKNOWN";
	if (code.startsWith("TASK_LEDGER_")) return "environment";
	if (["EACCES", "EPERM", "ENOENT", "ENOSPC", "EIO", "ENVIRONMENT_UNVERIFIABLE", "STORE_ERROR"].includes(code)) return "environment";
	if (["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "RATE_LIMITED", "PROVIDER_UNAVAILABLE"].includes(code)) return "transient";
	if (code === "WRITER_HOLD") return "stop-unconfirmed";
	if (code === "REQUEST_REMAINING_INSUFFICIENT") return "budget";
	if (e?.name === "DelegationAborted" || e?.name === "AbortError") return "cancel";
	const operation = tool === "planner_delegate" || tool === "planner_redelegate" ? "delegation" : tool;
	if (code.startsWith("TASKSPEC_") || code === "ARGUMENTS_INVALID") return `contract:${operation}:arguments`;
	// Only stable program codes, never arbitrary error prose or supplied IDs.
	if (/^[A-Z][A-Z0-9_:-]*$/.test(code) && code !== "UNKNOWN") return `contract:${operation}:${code}`;
	if (isRefusal(error)) return `contract:${operation}:refused`;
	return "unknown-failure";
}

export function reviewFailureFamily(decision?: ReviewDecision): string | undefined {
	if (!decision || decision.action === "accept" || decision.action === "review_pending") return undefined;
	if (decision.failureClass === "environment") return "environment";
	if (decision.failureClass === "implementation") return "task-quality";
	if (decision.failureClass === "contract") return "contract:report";
	if (decision.failureClass === "evidence") return "evidence";
	return decision.nextState === "changes_requested" || decision.nextState === "failed" || decision.nextState === "blocked" ? "task-quality" : undefined;
}

export function delegationFailureFamily(outcome: DelegationOutcome): string | undefined {
	const t = outcome.termination;
	if (t) {
		const execution = outcome.task.executions.find((item) => item.executionId === outcome.executionId);
		if (!t.terminationConfirmed) return "stop-unconfirmed";
		if (t.evidenceIncomplete || t.probeFailures?.length) return "environment";
		if (t.status === "tool_budget_exhausted" && execution?.reportOnly) return "report-only-tool-budget";
		if (t.anomaly || t.reason === "worker_runaway" || t.status === "tool_budget_exhausted" || t.status === "timed_out") return "budget";
		if (t.reason === "operator_cancel" || t.status === "cancelled" || t.status === "interrupted") return "cancel";
		if (t.errorCode) return requestErrorFamily("transport", { code: t.errorCode });
		if (t.reason === "provider_failure") return "transient";
		if (t.status === "structured_output_failed" || t.status === "acceptance_failed") return "contract:report";
		if (t.reason === "launch_failure" || t.status === "invalid_request" || t.status === "duplicate_node") return "contract:delegation:launch";
		return "unknown-failure";
	}
	const review = reviewFailureFamily(outcome.decision);
	if (review) return review;
	if (outcome.report?.status === "failed" || outcome.report?.status === "blocked") return "unknown-failure";
	if (outcome.review?.verdict === "request_changes") return "task-quality";
	return undefined;
}

/** Only existing Task state and execution identity authorize a causal edge. */
export function correctionPredecessor(task: TaskRecord | undefined, params: PlannerDelegationParams): string | undefined {
	if (!task || params.role === "reviewer" || params.role === "validator") return undefined;
	if (task.recovery?.required) {
		if (params.recovery?.executionId !== task.recovery.executionId) return undefined;
		return task.executions.find(e => e.executionId === task.recovery!.executionId && !e.auxiliary)?.executionId;
	}
	if (!["changes_requested", "report-invalid", "blocked", "failed"].includes(task.state)) return undefined;
	return [...task.executions].reverse().find(e => !e.auxiliary && e.status !== "running" && e.status !== "cancel_requested")?.executionId;
}

/** Bind acceptance to the report actually accepted, not the most recent child
 * (which could be a validator or reviewer). */
export function acceptedExecution(task: TaskRecord): string | undefined {
	if (task.state !== "completed" || task.reports.length === 0) return undefined;
	return task.executions.find(e => !e.auxiliary && e.reportIndex === task.reports.length - 1)?.executionId;
}
