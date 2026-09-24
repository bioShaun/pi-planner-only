// What does prepareRoleDelegation actually stamp on `input`? L18c/L23 assert
// that no `"hard": 0.5` survives on a blocked untrusted launch; this shows
// which key that regex can ever match.
import { PlannerOrchestrator } from "../../../orchestrate.ts";
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const orch = new PlannerOrchestrator({ gitRunner });
const input = { agent: "worker", task: "do something" };
await orch.prepareRoleDelegation(input);
console.log("keys after prepareRoleDelegation:", Object.keys(input).join(", "));
console.log("usageBudget   :", JSON.stringify(input.usageBudget));
console.log("__floorLimits :", JSON.stringify(input.__floorLimits));
console.log('__floorLimits matches /"hard":\\s*0\\.5/ ?',
  /"hard":\s*0\.5/.test(JSON.stringify(input.__floorLimits ?? null)));
