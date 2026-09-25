// Experiment-only model control for baseline 85bdd2a's runtime scout.
// Load before the installed launcher. Only model/thinking in the public v1
// registration request are changed; baseline source and tool definitions stay exact.
import { appendFileSync } from "node:fs";
export default function baselineModelPin(pi: any) {
 if(process.env.PI_SUBAGENT_CHILD === "1") return;
 const model=process.env.STUDY_CHILD_MODEL;
 const thinking=process.env.STUDY_THINKING;
 const evidence=process.env.STUDY_EVENTS;
 if(!model || !thinking || !evidence) throw new Error("baseline model control requires explicit study config");
 pi.events.on("pi-subagents:runtime-agent-register:v1", (request: any) => {
  if(request.version !== 1 || request.name !== "planner-scout") return;
  if(request.result !== undefined) throw new Error("baseline model pin must run before launcher registration");
  request.definition={...request.definition,model,thinking};
  appendFileSync(evidence, JSON.stringify({t:Date.now(),kind:"model-control",event:"runtime-registration",
   name:request.name,model,thinking,changedFields:["model","thinking"]})+"\n");
 });
}
