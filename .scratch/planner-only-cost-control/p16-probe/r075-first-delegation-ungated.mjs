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
	cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
};

async function delegate(toolCallId) {
	const input = { agent: "worker", task: JSON.stringify(spec) };
	const out = await handlers.get("tool_call")({ toolCallId, toolName: "subagent", input }, ctx);
	console.log(`  usageBudget handed to ${toolCallId}:`, JSON.stringify(input.usageBudget));
	return out;
}
async function statusText() {
	notices.length = 0;
	await commands.get("planner-only").handler("status", ctx);
	return notices.at(-1);
}

// --- the question: does the FIRST delegation of a Task reserve anything? ---
const first = await delegate("call-first");
const s1 = await statusText();
console.log("---- after the first delegation (nothing settled yet) ----");
console.log(s1);
console.log("first delegation blocked?", first?.block ? "YES" : "no");
console.log("在途预留 present after 1st?", s1.includes("在途预留"));

// settle it, then delegate a second time
await handlers.get("tool_result")({
	toolCallId: "call-first",
	toolName: "subagent",
	content: [{ type: "text", text: "done" }],
	details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
}, ctx);

const second = await delegate("call-second");
console.log("second delegation blocked?", second?.block ? "YES: " + String(second.reason ?? second.block?.reason ?? "").split("\n")[0] : "no");
const s2 = await statusText();
console.log("---- after the second delegation ----");
console.log(s2);
console.log("在途预留 present after 2nd?", s2.includes("在途预留"));

rmSync(agentDir, { recursive: true, force: true });
