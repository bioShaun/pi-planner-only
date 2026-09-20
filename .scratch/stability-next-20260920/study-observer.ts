// Acceptance-only observer: no prompts, raw payloads, or credentials are logged.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export default function observer(pi: any) {
 if (process.env.PI_SUBAGENT_CHILD === "1" || !process.env.STUDY_EVENTS) return;
 const state = () => {
  const dir = join(process.env.PI_CODING_AGENT_DIR!, "planner-only", "requests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(key => {
   try { const s = JSON.parse(readFileSync(join(dir, key, "state.json"), "utf8")).current;
    return s ? { id: s.id, closedReason: s.closedReason, rootStop: s.rootStop } : null;
   } catch { return { unreadable: true }; }
  }).filter(Boolean);
 };
 const write = (data: any) => appendFileSync(process.env.STUDY_EVENTS!, JSON.stringify({ t: Date.now(), requests: state(), ...data }) + "\n");
 for (const event of ["request", "started", "update", "response", "cancel"]) {
  pi.events.on(`prompt-template:subagent:${event}`, (p: any) => write({ kind: "launcher", event,
   requestId: p.requestId, ownerRunId: p.ownerRunId, nodeId: p.nodeId, runId: p.runId,
   model: p.model, thinking: p.thinking, status: p.status, usage: p.usage }));
 }
 for (const hook of ["agent_start", "agent_settled", "before_provider_request", "tool_call", "tool_result", "message_end"]) {
  pi.on(hook, (e: any, ctx: any) => write({ kind: "host", hook, hasUI: ctx.hasUI,
   toolName: e.toolName, isError: e.isError,
   ...(hook === "message_end" && e.message?.role === "assistant" ? {
    model: e.message.model, provider: e.message.provider, usage: e.message.usage,
    answer: e.message.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
   } : {}) }));
 }
}
