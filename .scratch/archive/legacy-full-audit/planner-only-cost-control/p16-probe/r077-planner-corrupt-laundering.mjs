// Planner-side probe for p16-r077 (16-b), written by the planner, not the executor.
//
// Question: the untrusted placeholder TaskRecord that restoreFromLedger installs for a
// corrupt snapshot is a *live* store record. Any later mutation of it calls touch() ->
// persist() -> LedgerSnapshotStore.write(), which OVERWRITES the corrupt file with a
// well-formed placeholder envelope carrying usage=0 and no spec.cumulativeBudget.
// On the NEXT reload that file parses cleanly, so untrustedBalances is empty and the
// Task is trusted again -- with a blank balance and no budget.
//
// If that path is reachable, "corrupt once, then touch, then reload" launders a Task
// back into a full (indeed unbounded) budget -- the very hole 16-b exists to close.
// Reviewer delegation is the obvious candidate because it is exempt from the gate.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const agentDir = mkdtempSync(join(process.cwd(), ".p16-planner-probe-"));
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

const TASK = "T-20260908-971";
function specFor(taskId) {
	return {
		taskId,
		objective: "planner probe: corrupt laundering",
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
const ledgerFile = join(agentDir, "planner-only", "ledger", `${TASK}.json`);

// ---- session A: spend $0.04 of a $0.05 budget -------------------------------
const A = makeHost();
const { default: plannerOnlyA } = await import("../../../index.ts");
plannerOnlyA(A.pi);
await A.handlers.get("session_start")({}, A.ctx);
const inputA = { agent: "worker", task: JSON.stringify(specFor(TASK)) };
await A.handlers.get("tool_call")({ toolCallId: "call-a", toolName: "subagent", input: inputA }, A.ctx);
await A.handlers.get("tool_result")({
	toolCallId: "call-a", toolName: "subagent",
	content: [{ type: "text", text: "done" }],
	details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.04, turns: 1 }, model: "test/model" }] },
}, A.ctx);
console.log("session A snapshot on disk:", existsSync(ledgerFile));

// ---- corrupt the snapshot ---------------------------------------------------
writeFileSync(ledgerFile, "this is not json", "utf8");
console.log("corrupted the snapshot bytes.");

// ---- session B: the Task is untrusted; try to mutate it ---------------------
const B = makeHost();
const { default: plannerOnlyB } = await import("../../../index.ts?planner=1");
plannerOnlyB(B.pi);
await B.handlers.get("session_start")({}, B.ctx);

const paid = await B.handlers.get("tool_call")({
	toolCallId: "call-b-worker", toolName: "subagent",
	input: { agent: "worker", task: JSON.stringify(specFor(TASK)) },
}, B.ctx);
console.log("\nB: worker delegation blocked?", paid?.block ? "YES" : "no");

// reviewer is exempt from the untrusted gate -- does it mutate and rewrite the file?
const reviewerInput = { agent: "reviewer", task: JSON.stringify({ taskId: TASK, objective: "review", cwd: `/fixture/${TASK}`, role: "reviewer" }) };
const rev = await B.handlers.get("tool_call")({ toolCallId: "call-b-rev", toolName: "subagent", input: reviewerInput }, B.ctx);
console.log("B: reviewer delegation blocked?", rev?.block ? "YES: " + String(rev.reason ?? "").split("\n")[0] : "no");
await B.handlers.get("tool_result")({
	toolCallId: "call-b-rev", toolName: "subagent",
	content: [{ type: "text", text: "reviewed" }],
	details: { results: [{ usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1 }, model: "test/model" }] },
}, B.ctx);

const afterBytes = readFileSync(ledgerFile, "utf8");
console.log("\nledger file after session B, first 200 chars:");
console.log("  " + afterBytes.slice(0, 200).replace(/\n/g, " "));
console.log("  still corrupt (non-JSON)?", (() => { try { JSON.parse(afterBytes); return false; } catch { return true; } })());

// ---- session C: reload again and see whether the Task is trusted now --------
const C = makeHost();
const { default: plannerOnlyC } = await import("../../../index.ts?planner=2");
plannerOnlyC(C.pi);
await C.handlers.get("session_start")({}, C.ctx);
C.notices.length = 0;
await C.commands.get("planner-only").handler(`task ${TASK}`, C.ctx);
console.log("\n=========== session C status ===========");
console.log(C.notices.at(-1));

const inputC = { agent: "worker", task: JSON.stringify(specFor(TASK)) };
const c = await C.handlers.get("tool_call")({ toolCallId: "call-c", toolName: "subagent", input: inputC }, C.ctx);
console.log("\nC: worker delegation blocked?", c?.block ? "YES: " + String(c.reason ?? "").split("\n")[0] : "no");
console.log("C: usageBudget handed to the child:", JSON.stringify(inputC.usageBudget));

rmSync(agentDir, { recursive: true, force: true });
