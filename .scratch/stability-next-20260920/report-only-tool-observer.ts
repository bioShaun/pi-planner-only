// Test-only observer: registers no tool and changes no tool/event result.
import { appendFileSync } from "node:fs";
import { join } from "node:path";
export default function observe(pi: any) {
 const evidence=process.env.STUDY_PROBE_EVIDENCE;
 if(!evidence)return;
 const write=(data: any)=>appendFileSync(join(evidence,"child-tools.jsonl"),JSON.stringify({at:new Date().toISOString(),...data})+"\n");
 pi.on("agent_start",(_e: any,ctx: any)=>write({hook:"agent_start",sessionId:ctx.sessionManager.getSessionId(),tools:pi.getActiveTools()}));
 pi.on("tool_call",(e: any)=>write({hook:"tool_call",toolName:e.toolName}));
 pi.on("tool_result",(e: any)=>write({hook:"tool_result",toolName:e.toolName,isError:e.isError}));
}
