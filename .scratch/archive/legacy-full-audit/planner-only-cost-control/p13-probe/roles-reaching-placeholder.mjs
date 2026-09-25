import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";

const FIXED_NOW = () => new Date(2026, 8, 5);
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

const ROLES = ["worker", "oracle", "reviewer", "explorer", "scout"];

for (const mode of ["warn", "strict"]) {
  for (const role of ROLES) {
    const store = new TaskStore({ now: FIXED_NOW });
    const orch = new PlannerOrchestrator({ gitRunner, store, structuredDelegationMode: mode });
    const input = { agent: role, task: "Please go do the thing. No TaskSpec here at all.", cwd: "/repo" };
    let out;
    try {
      out = await orch.beginDelegation({ toolCallId: `tc-${mode}-${role}`, input }, "/repo");
    } catch (e) {
      console.log(`${mode.padEnd(6)} ${role.padEnd(9)} THREW ${e.message}`);
      continue;
    }
    const tasks = store.list ? store.list() : [];
    const placeholders = tasks.filter((t) => t.isPlaceholder).map((t) => t.taskId);
    console.log(
      `${mode.padEnd(6)} ${role.padEnd(9)} block=${out.block ? "YES" : "no"} task=${out.task?.taskId ?? "-"} isPlaceholder=${out.task?.isPlaceholder ?? "-"} storePlaceholders=[${placeholders}] warn=${JSON.stringify(out.warnings ?? [])}`,
    );
  }
}
