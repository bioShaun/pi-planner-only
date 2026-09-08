// Ticket 16 clause 1 baseline (planner claude-pD, before dispatching 16-b).
// Session A: create a Task with a cumulative budget, delegate once, settle it.
// Session B: a fresh extension instance over the SAME agent dir -- what does
// /planner-only status know about that Task, and does its budget come back?
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const agentDir = mkdtempSync(join(process.cwd(), ".p16-probe-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;

function makeHost() {
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
	const ctx = {
		hasUI: true,
		ui: { notify(message) { notices.push(message); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
		cwd: process.cwd(),
		sessionManager: { getEntries() { return []; }, getSessionFile() { return join(agentDir, "s.jsonl"); } },
	};
	return { pi, ctx, handlers, commands, notices };
}

const TASK = "T-20260908-950";
const spec = {
	taskId: TASK,
	objective: "probe reload recovery",
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

// ---------------- session A ----------------
const A = makeHost();
const { default: plannerOnlyA } = await import("../../../index.ts");
plannerOnlyA(A.pi);
await A.handlers.get("session_start")({}, A.ctx);

const inputA = { agent: "worker", task: JSON.stringify(spec) };
await A.handlers.get("tool_call")({ toolCallId: "call-a1", toolName: "subagent", input: inputA }, A.ctx);
await A.handlers.get("tool_result")({
	toolCallId: "call-a1",
	toolName: "subagent",
	content: [{ type: "text", text: "done" }],
	details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.04, turns: 1 }, model: "test/model" }] },
}, A.ctx);

A.notices.length = 0;
await A.commands.get("planner-only").handler("status", A.ctx);
console.log("=========== session A status ===========");
console.log(A.notices.at(-1));

console.log("\n=========== what is on disk ===========");
const ledgerDir = join(agentDir, "planner-only", "ledger");
console.log("ledger dir exists:", existsSync(ledgerDir));
if (existsSync(ledgerDir)) {
	for (const name of readdirSync(ledgerDir)) {
		const env = JSON.parse(readFileSync(join(ledgerDir, name), "utf8"));
		console.log(` ${name}: state=${env.task.state} usage.root.costUsd=${env.task.usage?.root?.costUsd} children=${env.task.usage?.children?.length} budget=${JSON.stringify(env.task.spec.cumulativeBudget)}`);
	}
}

// ---------------- session B: fresh instance, same agent dir ----------------
const B = makeHost();
const { default: plannerOnlyB } = await import("../../../index.ts?reload=2");
plannerOnlyB(B.pi);
await B.handlers.get("session_start")({}, B.ctx);

B.notices.length = 0;
await B.commands.get("planner-only").handler("status", B.ctx);
console.log("\n=========== session B status (after reload) ===========");
console.log(B.notices.at(-1));

// does the same Task get a whole new budget?
const inputB = { agent: "worker", task: JSON.stringify(spec) };
const out = await B.handlers.get("tool_call")({ toolCallId: "call-b1", toolName: "subagent", input: inputB }, B.ctx);
console.log("\nafter reload, delegating the SAME Task again:");
console.log("  blocked?", out?.block ? "YES: " + String(out.block.reason).split("\n")[0] : "no");
console.log("  usageBudget handed to the child:", JSON.stringify(inputB.usageBudget));

B.notices.length = 0;
await B.commands.get("planner-only").handler("status", B.ctx);
console.log("\n=========== session B status (after re-delegating) ===========");
console.log(B.notices.at(-1));

rmSync(agentDir, { recursive: true, force: true });
