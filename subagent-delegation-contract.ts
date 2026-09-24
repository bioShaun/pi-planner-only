/**
 * Local copy of the pi-subagents structured-delegation contract, limited to
 * the fields this plugin sends and reads.
 *
 * Based on pi-subagents@0.70.1 `src/api/delegation.js` and
 * `src/slash/delegation-request.js`. contract.test.mjs checks the event names
 * against the installed package.
 */
export const SUBAGENT_DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const SUBAGENT_DELEGATION_STARTED_EVENT = "prompt-template:subagent:started";
export const SUBAGENT_DELEGATION_UPDATE_EVENT = "prompt-template:subagent:update";
export const SUBAGENT_DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
export const SUBAGENT_DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

export interface SubagentDelegationIdentity {
	requestId: string;
	ownerRunId: string;
	nodeId: string;
}

export interface SubagentDelegationRequest extends SubagentDelegationIdentity {
	agent: string;
	task: string;
	context: "fresh" | "fork";
	cwd: string;
	timeoutMs?: number;
	result: { kind: "text" };
}

export interface SubagentDelegationUpdate extends SubagentDelegationIdentity {
	runId?: string;
	currentTool?: string;
	currentToolArgs?: string;
	recentOutput?: string;
	recentOutputLines?: string[];
	model?: string;
	toolCount?: number;
	durationMs?: number;
	tokens?: number;
}

export type SubagentDelegationStatus =
	| "completed"
	| "failed"
	| "timed_out"
	| "cancelled"
	| "interrupted"
	| "tool_budget_exhausted"
	| "structured_output_failed"
	| "acceptance_failed"
	| "invalid_request"
	| "unavailable_context"
	| "duplicate_node";

export interface SubagentDelegationUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	toolCalls: number;
	durationMs: number;
}

export interface SubagentDelegationResponse {
	requestId: string;
	ownerRunId?: string;
	nodeId?: string;
	status: SubagentDelegationStatus;
	error?: string;
	/** Host run id; pi-subagents sends it although older contract copies omit it. */
	runId?: string;
	agent?: string;
	model?: string;
	result?: { kind: "text"; text: string } | { kind: "structured"; value: unknown };
	usage?: SubagentDelegationUsage;
}
