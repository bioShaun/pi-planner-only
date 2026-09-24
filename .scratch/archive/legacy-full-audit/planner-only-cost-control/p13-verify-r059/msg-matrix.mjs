import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
const FIXED_NOW = () => new Date(2026, 8, 5);
const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

const cases = [
  ["neither",        undefined, undefined],
  ["REQUIRE only",   "1",       undefined],
  ["STRUCT only",    undefined, "strict"],
  ["BOTH",           "1",       "strict"],
];
for (const [label, req, str] of cases) {
  if (req) process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = req; else delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
  if (str) process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION = str; else delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
  const store = new TaskStore({ now: FIXED_NOW });
  const orch = new PlannerOrchestrator({ gitRunner, store });
  const out = await orch.beginDelegation(
    { toolCallId: `tc-${label}`, input: { agent: "worker", task: "do the thing, no TaskSpec", cwd: "/repo" } },
    "/repo",
  );
  const last = out.block ? out.block.reason.split("\n").pop() : `(no block; tasks=${store.list().length}, placeholder=${out.task?.isPlaceholder})`;
  console.log(`${label.padEnd(13)} block=${out.block ? "YES" : "no "} lastLine=${last}`);
}
