// Acceptance observer: no credentials or full input prompts are logged.
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export default function observer(pi: any) {
 if (process.env.PI_SUBAGENT_CHILD === "1" || !process.env.STUDY_EVENTS) return;
 // Child sessions temporarily change process.env; retain the parent locations.
 const eventFile = process.env.STUDY_EVENTS;
 const agentDir = process.env.PI_CODING_AGENT_DIR!;
 const scenario = process.env.STUDY_TUI_SCENARIO ?? "plain";
 let scheduled = false;
 let timer: ReturnType<typeof setTimeout> | undefined;
 const state = () => {
  const dir = join(agentDir, "planner-only", "requests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map(key => {
   try { const s = JSON.parse(readFileSync(join(dir, key, "state.json"), "utf8")).current;
    return s ? { id: s.id, closedReason: s.closedReason, rootStop: s.rootStop, settled: s.settled } : null;
   } catch { return { unreadable: true }; }
  }).filter(Boolean);
 };
 const write = (data: any) => appendFileSync(eventFile, JSON.stringify({ t: Date.now(), requests: state(), ...data }) + "\n");
 for (const event of ["request", "started", "update", "response", "cancel"]) {
  pi.events.on(`prompt-template:subagent:${event}`, (p: any) => write({ kind: "launcher", event,
   requestId: p.requestId, ownerRunId: p.ownerRunId, nodeId: p.nodeId, runId: p.runId,
   model: p.model, thinking: p.thinking, status: p.status, usage: p.usage,
   toolBudget: p.toolBudget, error: p.error }));
 }
 pi.on("input", (e: any, ctx: any) => write({ kind: "host", hook: "input", hasUI: ctx.hasUI,
  source: e.source, streamingBehavior: e.streamingBehavior,
  marker: e.text?.startsWith("__study_tui_queued__") ? "queued"
   : e.text?.startsWith("__study_tui_scheduled__") ? "scheduled" : undefined }));
 for (const hook of ["agent_start", "agent_settled", "before_provider_request", "tool_call", "tool_result", "message_end"]) {
  pi.on(hook, (e: any, ctx: any) => {
   write({ kind: "host", hook, hasUI: ctx.hasUI, mode: ctx.mode,
    toolName: e.toolName, isError: e.isError,
    ...(hook === "message_end" && e.message?.role === "assistant" ? {
     model: e.message.model, provider: e.message.provider, usage: e.message.usage,
     answer: e.message.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n")
    } : {}) });
   if (hook === "agent_settled" && ctx.hasUI && ["scheduled", "combined"].includes(scenario)
       && !scheduled && state().some((s: any) => s.closedReason && s.settled)) {
    scheduled = true;
    write({ kind: "injection", event: "timer_armed", delayMs: 250 });
    timer = setTimeout(() => {
     write({ kind: "injection", event: "timer_fired" });
     // This is the real public ExtensionRuntime in the real TUI process.
     pi.sendUserMessage("__study_tui_scheduled__ Continue the previous bounded task.", { deliverAs: "followUp" });
    }, 250);
   }
  });
 }
 pi.on("session_shutdown", () => { if (timer) clearTimeout(timer); });
}
