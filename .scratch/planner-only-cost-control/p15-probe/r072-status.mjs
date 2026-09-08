// 14B/17 pre-dispatch probe: print the ACTUAL status budget block today.
import { PlannerOrchestrator } from "../../../orchestrate.ts";
import { TaskStore } from "../../../task.ts";
import { emptyTaskUsage } from "../../../usage.ts";

const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });
const BASE = "/repo";

function spec(taskId, cumulativeBudget) {
	return {
		taskId, objective: "x", cwd: BASE, role: "worker",
		scope: { allowedPaths: ["a.ts"] }, constraints: [], acceptanceCriteria: ["ok"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
		cumulativeBudget,
	};
}

function render(label, cumulativeBudget, mutate) {
	const store = new TaskStore({ now: () => new Date(2026, 8, 8) });
	const task = store.create(spec("T-20260908-status", cumulativeBudget));
	const usage = emptyTaskUsage();
	mutate(usage);
	task.usage = usage;
	const out = new PlannerOrchestrator({ gitRunner, store }).renderTaskStatus(task);
	const lines = out.split("\n").filter((l) => /Budget/.test(l) || /^ {2}(tokens|费用|- )/.test(l));
	console.log(`--- ${label}`);
	for (const l of lines) console.log(l);
}

render("A both dims configured, root spent, child known", { tokens: 100000, costUsd: 0.5 }, (u) => {
	u.root = { ...u.root, turns: 3, input: 20000, output: 5000, costUsd: 0.12 };
	u.children.push({ kind: "worker", calls: 1, turns: 1, input: 8000, output: 2000, cacheRead: 0, cacheWrite: 0, costUsd: 0.04 });
});

render("B child with UNKNOWN cost (no rate)", { tokens: 100000, costUsd: 0.5 }, (u) => {
	u.root = { ...u.root, turns: 1, input: 1000, output: 500, costUsd: 0.01 };
	u.children.push({ kind: "worker", calls: 1, turns: 1, input: 30000, output: 9000, cacheRead: 0, cacheWrite: 0 });
});

render("C root cost sticky-unknown", { tokens: 100000, costUsd: 0.5 }, (u) => {
	u.root = { ...u.root, turns: 2, input: 4000, output: 1000, tokensUnknownTurns: 0 };
});

render("D no cumulative limits at all", undefined, (u) => {
	u.root = { ...u.root, turns: 1, input: 100, output: 20, costUsd: 0.001 };
});
