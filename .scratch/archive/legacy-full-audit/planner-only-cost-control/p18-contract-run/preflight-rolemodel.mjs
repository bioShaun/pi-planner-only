// Free pre-flight for groups C/D (ticket 09 clause 2) and for the worker-model
// wiring groups A/B depend on. Calls the exact functions the status handler uses
// (index.ts:1122 renders configuredRoleModelSummaries(loadRoleModelPolicy())).
import { configuredRoleModelSummaries, loadRoleModelPolicy, resolveRoleModel } from "../../../../pi-planner-only-contract-run/role-models.ts";

function show(label, env) {
	const policy = loadRoleModelPolicy(env);
	let summaries;
	try { summaries = configuredRoleModelSummaries(policy); } catch (e) { summaries = [`THREW: ${e.message}`]; }
	console.log(`${label}\n  enabled=${policy.enabled}  status-lines=${JSON.stringify(summaries)}`);
	const input = {};
	let worker;
	try { worker = JSON.stringify(resolveRoleModel(policy, "worker", input)); } catch (e) { worker = `THREW: ${e.message}`; }
	console.log(`  resolveRoleModel(worker) -> ${worker}   input=${JSON.stringify(input)}`);
}

// exactly what run.sh sets today
show("[as run.sh is written today]", {
	PI_PLANNER_ONLY_MODEL_WORKER: "qwen-local/qwen3.8-27b",
	PI_PLANNER_ONLY_MODEL_ROOT: "tcuni/gpt-5.6-luna",
});
// with the policy switch on, but no thinking values
show("[ROLE_MODELS=1, no THINKING_*]", {
	PI_PLANNER_ONLY_ROLE_MODELS: "1",
	PI_PLANNER_ONLY_MODEL_WORKER: "qwen-local/qwen3.8-27b",
	PI_PLANNER_ONLY_MODEL_ROOT: "tcuni/gpt-5.6-luna",
});
// fully configured: group D shape (policy root != the model the host actually runs)
show("[group D: ROLE_MODELS=1 + THINKING_*, host runs qwen-local]", {
	PI_PLANNER_ONLY_ROLE_MODELS: "1",
	PI_PLANNER_ONLY_MODEL_WORKER: "qwen-local/qwen3.8-27b",
	PI_PLANNER_ONLY_THINKING_WORKER: "low",
	PI_PLANNER_ONLY_MODEL_ROOT: "tcuni/gpt-5.6-luna",
	PI_PLANNER_ONLY_THINKING_ROOT: "low",
});
