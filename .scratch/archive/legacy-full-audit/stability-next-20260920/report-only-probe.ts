// Actual launcher acceptance through public versioned contracts.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { REPORT_ONLY_AGENT, REPORT_ONLY_DEFINITION, REPORT_ONLY_TOOL_BUDGET } from "../../delegate.ts";
import { SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST,
 SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE, SUBAGENT_DELEGATION_CANCEL_EVENT as CANCEL
} from "../../subagent-delegation-contract.ts";
export default function probe(pi: any) {
 if (process.env.PI_SUBAGENT_CHILD === "1") return;
 const evidence = process.env.STUDY_PROBE_EVIDENCE!;
 const model = process.env.STUDY_CHILD_MODEL!;
 const thinking = process.env.STUDY_THINKING ?? "low";
 pi.registerCommand("study-zero-tools", {
  description: "Prove the actual child exposes only structured report submission",
  handler: async (_args: string, ctx: any) => {
   const identity = { requestId: randomUUID(), ownerRunId: ctx.sessionManager.getSessionId(), nodeId: "report-only-acceptance" };
   const unsubs: Array<() => void> = [];
   const same = (p: any) => Object.entries(identity).every(([k, v]) => p[k] === v);
   const log = (event: string, payload: any) => appendFileSync(join(evidence, "events.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), event, payload })+"\n");
   const registration: any = {version:1, name:REPORT_ONLY_AGENT,
    definition:{...REPORT_ONLY_DEFINITION,
     subagentOnlyExtensions:[join(dirname(fileURLToPath(import.meta.url)),"report-only-tool-observer.ts")]}};
   pi.events.emit("pi-subagents:runtime-agent-register:v1",registration);
   log("registration",registration);
   if(registration.result?.ok!==true || !registration.result.registration) throw new Error("Report-only capability registration failed");
   for (const event of ["request", "started", "update", "response", "cancel"]) {
    const unsub = pi.events.on(`prompt-template:subagent:${event}`, (p: any) => { if (same(p)) log(event,p); });
    if (unsub) unsubs.push(unsub);
   }
   const request = { ...identity, agent: REPORT_ONLY_AGENT, cwd: ctx.cwd, context: "fresh", model, thinking,
    toolBudget: {...REPORT_ONLY_TOOL_BUDGET},
    task: "Submit a report from this supplied context only: no workspace operation has been attempted. Use the structured_output tool once with {\"attempted\":false}. Do not read or change any files. Do not invent an unavailable tool.",
    result: { kind: "structured", schema: { type: "object", properties: { attempted: { type: "boolean" } }, required: ["attempted"], additionalProperties: false } } };
   let timer: ReturnType<typeof setTimeout> | undefined;
   try {
    const terminal = await new Promise<any>((resolve, reject) => {
     const unsub = pi.events.on(RESPONSE, (p: any) => { if (same(p)) resolve(p); });
     if (unsub) unsubs.push(unsub);
     timer = setTimeout(() => { pi.events.emit(CANCEL,identity); reject(new Error("report-only probe deadline")); }, 120000);
     pi.events.emit(REQUEST, request);
    });
    const childFile=join(evidence,"child-tools.jsonl");
    const childEvents=existsSync(childFile)?readFileSync(childFile,"utf8").trim().split("\n").filter(Boolean).map(line=>JSON.parse(line)):[];
    const starts=childEvents.filter((e: any)=>e.hook==="agent_start");
    const onlyReportTools=starts.length>0&&starts.every((e: any)=>JSON.stringify([...e.tools].sort())==='["structured_output"]');
    const calls=childEvents.filter((e: any)=>e.hook==="tool_call");
    const onlyOneReportCall=calls.length===1&&calls[0].toolName==="structured_output";
    const sentinelExists=existsSync(join(ctx.cwd,"forbidden.txt"));
    const completed=terminal.status==="completed"&&terminal.result?.kind==="structured"&&terminal.result.value?.attempted===false;
    const identityVerified=terminal.model?.replace(/:low$/,"")===model&&terminal.thinking===thinking&&terminal.agent===REPORT_ONLY_AGENT;
    const verdict=completed&&identityVerified&&onlyReportTools&&onlyOneReportCall&&!sentinelExists?"PASS":"NOT_PROVEN";
    writeFileSync(join(evidence,"result.json"),JSON.stringify({verdict,request,terminal,sentinelExists,onlyReportTools,onlyOneReportCall,identityVerified,childEvents,
     scope:"Actual installed launcher/provider and public child tool-set observations. Production runtime definition plus observation-only test extension; plugin grant/ledger/attribution covered by entry tests."},null,2)+"\n");
   } catch(error) {
    writeFileSync(join(evidence,"result.json"),JSON.stringify({verdict:"NOT_PROVEN",error:String(error),request},null,2)+"\n");
    throw error;
   } finally {
    if(timer)clearTimeout(timer);
    for(const unsubscribe of unsubs)unsubscribe();
   }
  }
 });
}
