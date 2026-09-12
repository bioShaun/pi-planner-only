import assert from "node:assert/strict";
import {
	DEFAULT_EXPLORATION_BUDGET,
	emptyExplorationBudget,
	isExplorationToolCall,
	recordExplorationToolCall,
} from "./floors.ts";
import { createTaskSpec, extractTaskSpecDetails } from "./task.ts";

assert.equal(DEFAULT_EXPLORATION_BUDGET, 20);
for (const tool of ["read", "grep", "find", "ls"]) {
	assert.equal(isExplorationToolCall(tool), true, `${tool} counts`);
}
for (const command of ["cat report.md", "head -20 report.md", "tail -5 report.md", "rg contextPack task.ts", "grep -n budget floors.ts", "sed -n '1,20p' report.ts"]) {
	assert.equal(isExplorationToolCall("bash", { command }), true, `${command} counts`);
}
assert.equal(isExplorationToolCall("bash", { command: "npm test" }), false);
assert.equal(isExplorationToolCall("edit"), false);

let budget = emptyExplorationBudget();
let softCount = 0;
let softNotice = "";
for (let index = 0; index < 16; index += 1) {
	const result = recordExplorationToolCall(budget, "read");
	budget = result.budget;
	if (result.notice) {
		softCount += 1;
		softNotice = result.notice;
	}
}
assert.equal(softCount, 1);
assert.match(softNotice, /wrap up|partial/i);
for (let index = 0; index < 3; index += 1) budget = recordExplorationToolCall(budget, "read").budget;
const hard = recordExplorationToolCall(budget, "read");
assert.match(hard.notice ?? "", /reached|final|partial/i);
assert.equal(recordExplorationToolCall(hard.budget, "read").notice, undefined);

const spec = createTaskSpec({
	taskId: "T-20260912-026",
	objective: "consume context pack",
	cwd: "/repo",
	contextPack: [{ path: "src/report.ts", startLine: 1, endLine: 8, summary: "report parser" }],
});
const extracted = extractTaskSpecDetails(JSON.stringify(spec));
assert.deepEqual(extracted.spec?.contextPack, spec.contextPack);

console.log("rt04: PASS");
