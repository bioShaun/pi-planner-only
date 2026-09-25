// Passive observer only. Loaded next to pi-subagents and the plugin under
// test; it subscribes to the launcher delegation contract events and a few
// public host hooks and appends one JSON line per observation. It returns
// nothing from any hook and never touches the plugin, the launcher, or the
// model. Written by ticket 05 CLI acceptance; not part of the product.
import { appendFileSync } from "node:fs";

const CONTRACT_EVENTS = [
	"prompt-template:subagent:request",
	"prompt-template:subagent:started",
	"prompt-template:subagent:update",
	"prompt-template:subagent:response",
	"prompt-template:subagent:cancel",
];
const HOST_HOOKS = ["agent_start", "agent_settled", "before_provider_request", "tool_call", "tool_result", "input", "session_start", "session_shutdown"];

export default function probeEvents(pi: any) {
	const out = process.env.P0_CLI_EVENT_LOG;
	if (!out || process.env.PI_SUBAGENT_CHILD === "1") return;
	const write = (record: Record<string, unknown>) => {
		try { appendFileSync(out, JSON.stringify({ t: Date.now(), ...record }) + "\n"); } catch { /* observer must never break the run */ }
	};
	for (const name of CONTRACT_EVENTS) {
		pi.events?.on?.(name, (payload: any) => write({
			kind: "launcher", event: name,
			requestId: payload?.requestId, ownerRunId: payload?.ownerRunId, nodeId: payload?.nodeId, agent: payload?.agent,
			status: payload?.status, runId: payload?.runId, model: payload?.model, usage: payload?.usage,
			reason: payload?.reason, errorCode: payload?.errorCode, resultKind: payload?.result?.kind,
		}));
	}
	for (const hook of HOST_HOOKS) {
		pi.on(hook, async (event: any) => {
			const record: Record<string, unknown> = { kind: "host", hook };
			if (hook === "tool_call") Object.assign(record, { toolCallId: event?.toolCallId, toolName: event?.toolName });
			if (hook === "tool_result") Object.assign(record, { toolCallId: event?.toolCallId, toolName: event?.toolName, isError: event?.isError === true });
			if (hook === "input") Object.assign(record, { source: event?.source, streamingBehavior: event?.streamingBehavior });
			if (hook === "session_shutdown") Object.assign(record, { reason: event?.reason });
			write(record);
		});
	}
}
