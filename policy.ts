import { isSafeAuditCommand } from "./git-audit.ts";
import { appendTaskSpecRepair, buildTaskSpecRepair } from "./task.ts";

export { isSafeAuditCommand };

export const READ_ONLY_TOOLS = new Set([
	"read",
	"grep",
	"find",
	"ls",
]);

export const ORCHESTRATION_TOOLS = new Set([
	"bg_wait",
	"subagent_wait",
	"subagent_supervisor",
	"contact_supervisor",
	"question",
	"questionnaire",
]);

/**
 * First-class tools this extension registers for Root itself.
 * Unlike the leftover `bash` allowlist, these are present in the parent's
 * schema, not just tolerated on a stale call.
 */
export const ROOT_TOOLS = new Set(["git_audit", "planner_verdict", "planner_recover"]);

/** @deprecated Alias for ROOT_TOOLS, kept for one release. */
export const AUDIT_TOOLS = ROOT_TOOLS;

export interface PolicyInput {
	toolName: string;
	input?: unknown;
	isChild: boolean;
	disabled: boolean;
	/** R01 — adapter workspace (`ctx.cwd || process.cwd()`), used by the example JSON. */
	cwd?: string;
	/**
	 * R02 — whether `activeForCwd(adapter cwd)` has a live (non-final) Task:
	 * the gather phase. The adapter always sets this; when it is absent the
	 * legacy allowlist applies (only the adapter's own store-read failure
	 * yields Idle, which fails closed).
	 */
	liveTask?: boolean;
	/**
	 * R02 — the exact host run id the orchestrator authorized for this bg_wait
	 * call (registered pending Delegation, same cwd, not consumed). Absent
	 * means the call is not recoverable while Idle.
	 */
	authorizedWaitId?: string;
}

export interface PolicyDecision {
	block: boolean;
	reason?: string;
}

function getCommand(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const command = (input as { command?: unknown }).command;
	return typeof command === "string" ? command.trim() : "";
}

function subagentDelegatesToChildren(input: unknown): boolean {
	if (!input || typeof input !== "object") return true;
	const params = input as { gate?: unknown; workflow?: unknown };
	if (typeof params.gate === "string" && params.gate.trim()) return false;
	if (typeof params.workflow === "string" && params.workflow.trim()) return false;
	return true;
}

function blockedReason(toolName: string): string {
	return [
		`Planner-only guard: the parent process may not call '${toolName}' directly.`,
		"The parent owns planning, delegation, arbitration, and review only.",
		"Delegate execution to a worker with the subagent tool. Include the objective, cwd, edit boundary, constraints, acceptance criteria, validation, and required evidence in the task.",
		"When the worker returns, review its evidence with read/grep/find/ls. Delegate any fixes instead of editing or running commands in the parent.",
		"Use '/planner-only off' for an explicit temporary override.",
	].join("\n");
}

/**
 * R02 — why this bg_wait call is not a legal Idle recovery. Undefined means
 * the call is authorized: it names the exact registered run id, carries an
 * optional bounded blocking timeout (≤ 60 s), and no unknown extra fields.
 */
function idleWaitRefusal(input: unknown, authorizedWaitId: string | undefined): string | undefined {
	const record = input && typeof input === "object" ? input as Record<string, unknown> : {};
	const id = typeof record.id === "string" ? record.id.trim() : "";
	if (!id) return "an exact run id is required";
	if (!authorizedWaitId || id !== authorizedWaitId) {
		return "no registered pending run for this exact id and cwd; recovery is unauthorized";
	}
	for (const key of Object.keys(record)) {
		if (key !== "id" && key !== "timeout" && key !== "timeoutMs") {
			return `unknown bg_wait field: ${key}`;
		}
	}
	const rawTimeout = record.timeout ?? record.timeoutMs;
	if (rawTimeout !== undefined) {
		if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0 || rawTimeout > 60_000) {
			return "the blocking timeout must be a positive number of at most 60000 ms";
		}
	}
	return undefined;
}

/**
 * R02 — Idle-for-gather refusal: no inspect tools, no Git-read, no general
 * shell, no mutation, no generic wait/supervisor calls. Root may start a
 * Delegation, ask a question, record a Verdict, recover one exact bound run,
 * or recover one registered pending run through an exact-id bg_wait.
 */
function idleBlockReason(toolName: string): string {
	return [
		`Planner-only guard (idle for gather): the parent process may not call '${toolName}' while no Task is live for this cwd.`,
		"New gather starts with one Delegation: inspect tools, Git-read, and a general shell are refused so they cannot substitute for it.",
		"Name the skill or lookup in the TaskSpec constraints and let the Worker follow them. Record a Verdict with planner_verdict, ask a question, or recover one known pending run with an exact-id bg_wait.",
	].join("\n");
}

export function decidePolicy(policy: PolicyInput): PolicyDecision {
	if (policy.isChild || policy.disabled) return { block: false };

	const toolName = policy.toolName;
	if (toolName === "subagent" && subagentDelegatesToChildren(policy.input)) {
		return { block: false };
	}
	// R01 — a composite subagent call keeps its plain refusal here: the
	// composite-workflow block reason is Orchestration's and does not gain the
	// example JSON.
	if (toolName === "subagent") {
		return { block: true, reason: blockedReason(toolName) };
	}

	// R02 — Idle for gather is the absence of a live Task for this cwd. The
	// field is adapter-set; an absent field keeps the legacy live allowlist.
	const liveTask = policy.liveTask ?? true;

	if (liveTask) {
		if (
			READ_ONLY_TOOLS.has(toolName) ||
			ORCHESTRATION_TOOLS.has(toolName) ||
			ROOT_TOOLS.has(toolName)
		) {
			return { block: false };
		}
		if (toolName === "bash" && isSafeAuditCommand(getCommand(policy.input))) {
			return { block: false };
		}
		return {
			block: true,
			reason: appendTaskSpecRepair(blockedReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })),
		};
	}

	// Idle allowlist: child-delegating subagent, questions, planner_verdict,
	// planner_recover, and the bounded exact-id bg_wait recovery. Everything else is refused
	// with the pasteable TaskSpec example (R01).
	if (toolName === "planner_verdict" || toolName === "planner_recover" || toolName === "question" || toolName === "questionnaire") {
		return { block: false };
	}
	if (toolName === "bg_wait") {
		const refusal = idleWaitRefusal(policy.input, policy.authorizedWaitId);
		if (!refusal) return { block: false };
		return {
			block: true,
			reason: appendTaskSpecRepair(`Planner-only guard: bg_wait refused (${refusal}).`, buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })),
		};
	}
	return {
		block: true,
		reason: appendTaskSpecRepair(idleBlockReason(toolName), buildTaskSpecRepair({ toolName, input: policy.input, cwd: policy.cwd })),
	};
}
