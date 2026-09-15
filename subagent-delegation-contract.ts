/**
 * Local copy of the pi-subagents structured-delegation contract.
 *
 * Copied from pi-subagents@0.67.0 `src/api/delegation.ts`. The five event
 * names are the established extension-to-extension transport described in
 * that package's docs; the request/response shapes mirror the launcher
 * contract exactly. `IntercomBridgeConfig` is deliberately not copied — the
 * `intercomBridge` field below is typed `unknown` instead.
 *
 * We do not `import "pi-subagents/delegation"`: that package's exports map to
 * raw `.ts` sources, which cannot be type-checked under our flags and cannot
 * be loaded at all by `node --experimental-strip-types` (our test runner).
 * Acceptance diffs the copied event names against the installed package.
 */

// This is the established extension-to-extension transport. The structured
// delegation API intentionally reuses it instead of adding a second event
// protocol. Unstructured legacy direct payloads are rejected.
export const SUBAGENT_DELEGATION_REQUEST_EVENT = "prompt-template:subagent:request";
export const SUBAGENT_DELEGATION_STARTED_EVENT = "prompt-template:subagent:started";
export const SUBAGENT_DELEGATION_UPDATE_EVENT = "prompt-template:subagent:update";
export const SUBAGENT_DELEGATION_RESPONSE_EVENT = "prompt-template:subagent:response";
export const SUBAGENT_DELEGATION_CANCEL_EVENT = "prompt-template:subagent:cancel";

export interface SubagentDelegationToolBudget {
	soft?: number;
	hard: number;
	block?: string[] | "*";
}

export type SubagentDelegationJsonSchemaObject = Record<string, unknown>;

export type SubagentDelegationThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export type SubagentDelegationResultRequest =
	| { kind: "text" }
	| { kind: "structured"; schema: SubagentDelegationJsonSchemaObject };

export interface SubagentDelegationRequest {
	requestId: string;
	ownerRunId: string;
	nodeId: string;
	agent: string;
	task: string;
	context: "fresh" | "fork";
	cwd: string;
	model?: string;
	thinking?: SubagentDelegationThinking;
	timeoutMs?: number;
	toolBudget?: SubagentDelegationToolBudget;
	skill?: string | string[] | boolean;
	artifacts?: boolean;
	/** Per-launch bridge config; replaces the global `intercomBridge` config. Pass the same value to preflight to compare digests. */
	intercomBridge?: unknown;
	result: SubagentDelegationResultRequest;
}

export interface SubagentDelegationStarted {
	requestId: string;
	ownerRunId: string;
	nodeId: string;
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

export type SubagentDelegationValue =
	| { kind: "text"; text: string }
	| { kind: "structured"; value: unknown };

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

export interface SubagentDelegationTerminalResponse extends SubagentDelegationStarted {
	status: Exclude<SubagentDelegationStatus, "invalid_request">;
	error?: string;
	runId?: string;
	agent?: string;
	model?: string;
	thinking?: string;
	exitCode?: number;
	launchContractDigest?: string;
	result?: SubagentDelegationValue;
	usage?: SubagentDelegationUsage;
}

/** A malformed structured request can only be correlated by the valid identity fields it supplied. */
export interface SubagentDelegationInvalidResponse {
	requestId: string;
	ownerRunId?: string;
	nodeId?: string;
	status: "invalid_request";
	error?: string;
}

export type SubagentDelegationResponse = SubagentDelegationTerminalResponse | SubagentDelegationInvalidResponse;

export interface SubagentDelegationCancel extends SubagentDelegationStarted {}
