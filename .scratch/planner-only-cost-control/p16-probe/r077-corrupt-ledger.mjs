// Ticket 16-b 实测 B: a corrupt snapshot must not be claimed as a trusted
// remaining balance, must refuse a new controlled paid launch with a reason
// that is not "cumulative budget exhausted", and must not freeze a neighbouring
// intact Task in the same session.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function specFor(taskId) {
	return {
		taskId,
		objective: "probe corrupt ledger",
		cwd: `/fixture/${taskId}`,
		role: "worker",
		scope: { allowedPaths: ["src/parser.ts"] },
		constraints: ["no new deps"],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
		cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
	};
}

const BAD = "T-20260908-961";
const GOOD = "T-20260908-962";

const A = makeHost();
const { default: plannerOnlyA } = await import("../../../index.ts");
plannerOnlyA(A.pi);
await A.handlers.get("session_start")({}, A.ctx);

for (const taskId of [BAD, GOOD]) {
	const input = { agent: "worker", task: JSON.stringify(specFor(taskId)) };
	await A.handlers.get("tool_call")({ toolCallId: `call-a-${taskId}`, toolName: "subagent", input }, A.ctx);
	await A.handlers.get("tool_result")({
		toolCallId: `call-a-${taskId}`,
		toolName: "subagent",
		content: [{ type: "text", text: "done" }],
		details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 }, model: "test/model" }] },
	}, A.ctx);
}

writeFileSync(join(agentDir, "planner-only", "ledger", `${BAD}.json`), "this is not json", "utf8");

const B = makeHost();
const { default: plannerOnlyB } = await import("../../../index.ts?corrupt=1");
plannerOnlyB(B.pi);
await B.handlers.get("session_start")({}, B.ctx);

B.notices.length = 0;
await B.commands.get("planner-only").handler(`task ${BAD}`, B.ctx);
console.log("=========== corrupt Task status ===========");
console.log(B.notices.at(-1));

B.notices.length = 0;
await B.commands.get("planner-only").handler(`task ${GOOD}`, B.ctx);
console.log("\n=========== intact Task status ===========");
console.log(B.notices.at(-1));

const inputBad = { agent: "worker", task: JSON.stringify(specFor(BAD)) };
const refused = await B.handlers.get("tool_call")({ toolCallId: "call-b-bad", toolName: "subagent", input: inputBad }, B.ctx);
console.log("\nafter reload, delegating the CORRUPT Task:");
console.log("  blocked?", refused?.block ? "YES" : "no");
console.log("  reason:", refused?.reason ?? "(none)");

const inputGood = { agent: "worker", task: JSON.stringify(specFor(GOOD)) };
const ok = await B.handlers.get("tool_call")({ toolCallId: "call-b-good", toolName: "subagent", input: inputGood }, B.ctx);
console.log("\nafter reload, delegating the INTACT Task:");
console.log("  blocked?", ok?.block ? "YES: " + String(ok.reason ?? ok.block).split("\n")[0] : "no");
console.log("  usageBudget handed to the child:", JSON.stringify(inputGood.usageBudget));

rmSync(agentDir, { recursive: true, force: true });
