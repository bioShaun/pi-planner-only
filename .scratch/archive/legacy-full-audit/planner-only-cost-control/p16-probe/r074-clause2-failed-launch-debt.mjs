// Ticket 15 clause 2 gap probe (planner, pre-dispatch verification).
//
// Claim under test: when the host confirms a delegation NEVER LAUNCHED
// (isError, no runId, no results), 14A releases the reservation -- but 15-a's
// debt row is still recorded at the full granted budget and stays charged to
// the Task. The plugin's own error text tells Root to "re-delegate with the
// same TaskSpec", and ticket 14 clause 5 says a retry does not reset the
// cumulative ledger -- so the phantom debt is spent budget forever.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const agentDir = mkdtempSync(join(process.cwd(), ".p16-probe-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;

const { default: plannerOnly } = await import("../../../index.ts");

const handlers = new Map();
const commands = new Map();
const notices = [];
let activeTools = ["read", "bash", "write", "subagent"];
const pi = {
	on(name, handler) { handlers.set(name, handler); },
	registerCommand(name, definition) { commands.set(name, definition); },
	registerTool() {},
	getActiveTools() { return [...activeTools]; },
	getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
	setActiveTools(names) { activeTools = [...names]; },
	appendEntry() {},
	async exec() { return { stdout: "", stderr: "", code: 1 }; },
};
plannerOnly(pi);

const ctx = {
	hasUI: true,
	ui: { notify(message) { notices.push(message); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
	cwd: process.cwd(),
	sessionManager: { getEntries() { return []; }, getSessionFile() { return join(agentDir, "s.jsonl"); } },
};
await handlers.get("session_start")({}, ctx);

const TASK = "T-20260908-902";
const spec = {
	taskId: TASK,
	objective: "probe the confirmed-not-launched path",
	cwd: `/fixture/${TASK}`,
	role: "worker",
	scope: { allowedPaths: ["src/parser.ts"] },
	constraints: ["no new deps"],
	acceptanceCriteria: ["tests pass"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true },
	stopConditions: ["ask if ambiguous"],
	cumulativeBudget: { tokens: 200000, costUsd: 0.5 },
};

async function delegate(toolCallId) {
	return await handlers.get("tool_call")(
		{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
		ctx,
	);
}
async function statusText() {
	notices.length = 0;
	await commands.get("planner-only").handler("status", ctx);
	return notices.at(-1);
}
function budgetLines(text) {
	return text.split("\n").filter((line) => /tokens:|费用:|在途/.test(line));
}

// 0. First delegation of the Task, settled with real usage so the ledger is live.
await delegate("call-1");
await handlers.get("tool_result")(
	{
		toolCallId: "call-1", toolName: "subagent", input: {},
		details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
		content: [{ type: "text", text: "worker done" }], isError: false,
	},
	ctx,
);
console.log("---- after call-1 settled ----");
console.log(budgetLines(await statusText()).join("\n"));

// 1. Second delegation: 14A reserves and stamps the granted budget on the record.
await delegate("call-never-launched");

// 2. The host confirms the launch never happened: error, no runId, no results.
await handlers.get("tool_result")(
	{
		toolCallId: "call-never-launched",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: "spawn failed: no such agent 'worker'" }],
		details: {},
		isError: true,
	},
	ctx,
);

// 3. Root does exactly what the plugin told it to: re-delegate the same TaskSpec.
const retryOutcome = await delegate("call-retry");
const afterRetry = await statusText();
console.log("---- the retry the plugin itself told Root to make ----");
console.log(retryOutcome?.reason ?? "(not blocked)");
console.log("---- status after it ----");
console.log(afterRetry.split("\n").filter((l) => /tokens:|费用:|在途|Task:|State:/.test(l)).join("\n") || "(no Task section: the Task is final)");
console.log("--------------------------------------");

rmSync(agentDir, { recursive: true, force: true });

// GAP A: the child the host confirmed never started is charged its full granted
// budget, and that charge alone exhausts the Task's cost limit.
assert.equal(retryOutcome?.block, true, "GAP A: the retry is refused");
assert.match(retryOutcome.reason, /cumulative budget exhausted \(costUsd\)/);
assert.match(retryOutcome.reason, /已知消耗: tokens=101500, 费用 \$0\.5000/);
assert.match(retryOutcome.reason, /在途预留: tokens=0, 费用 \$0\.0000/);
console.log("A: measured spend was tokens=1500/$0.0500; the never-launched child added 100000/$0.4500 of debt");
console.log("A: the reservation WAS released (在途预留 0) -- but the debt was not, so the Task can never delegate again");

// GAP B: status never shows the in-flight reservation anywhere.
assert.equal(afterRetry.includes("在途"), false, "GAP B: status has no 在途 line");
console.log("B: status shows no 在途 reservation line");

console.log("r074-clause2-failed-launch-debt: BOTH GAPS REPRODUCED");
