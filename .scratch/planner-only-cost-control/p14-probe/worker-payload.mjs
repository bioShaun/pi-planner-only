import { applyRoleDelegation, stripDelegationKeys } from "../../../roles.ts";
const worker = { agent: "worker", context: "fork", task: "probe worker" };
applyRoleDelegation(worker, { role: "worker", taskId: "T-20260908-001", reportsCount: 1 });
stripDelegationKeys(worker);
console.log("worker toolBudget:", JSON.stringify(worker.toolBudget), "usageBudget:", JSON.stringify(worker.usageBudget), "__floorLimits:", JSON.stringify(worker.__floorLimits));
