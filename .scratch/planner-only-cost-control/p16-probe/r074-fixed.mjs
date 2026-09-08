// Ticket 15-b clause 2: same scene as r074-clause2-failed-launch-debt.mjs,
// asserting the fixed behavior. Do not edit the original probe.
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

await delegate("call-never-launched");
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

const retryOutcome = await delegate("call-retry");
const afterRetry = await statusText();
console.log("---- the retry the plugin itself told Root to make ----");
console.log(retryOutcome?.reason ?? "(not blocked)");
console.log("---- status after it ----");
console.log(afterRetry.split("\n").filter((l) => /tokens:|费用:|在途|Task:|State:|已知消耗|未知项/.test(l)).join("\n") || "(no Task section: the Task is final)");
console.log("--------------------------------------");

rmSync(agentDir, { recursive: true, force: true });

assert.equal(retryOutcome?.block, undefined, retryOutcome?.reason);
assert.match(afterRetry, /tokens: 已用 1500 \/ 上限 200000，剩余 198500，未知项 0 项/);
assert.match(afterRetry, /费用: 已用 \$0\.0500 \/ 上限 \$0\.5000，剩余 \$0\.4500，未知项 0 项/);
console.log("fixed: retry is not refused; known spend stays tokens=1500 / $0.0500; 未知项 0");
console.log("r074-fixed: PASS");
