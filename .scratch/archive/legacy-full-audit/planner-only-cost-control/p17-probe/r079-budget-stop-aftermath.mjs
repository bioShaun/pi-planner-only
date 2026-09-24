// Ticket 16-c prototype (planner, pre-dispatch): what actually happens AFTER the
// cumulative budget gate stops new paid delegations?
//   clause 3: status still queryable; Root can still record a non-pass verdict;
//             a child launched BEFORE the stop is still settled and recorded.
//   clause 4: the budget stop changes neither the write lock nor the Task state machine.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const agentDir = mkdtempSync(join(process.cwd(), ".p17-probe-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;

function makeHost() {
	const handlers = new Map();
	const commands = new Map();
	const tools = new Map();
	const notices = [];
	let activeTools = ["read", "bash", "write", "subagent"];
	const pi = {
		on(name, handler) { handlers.set(name, handler); },
		registerCommand(name, definition) { commands.set(name, definition); },
		registerTool(def) { tools.set(def.name, def); },
		getActiveTools() { return [...activeTools]; },
		getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
		setActiveTools(names) { activeTools = [...names]; },
		appendEntry() {},
		async exec() { return { stdout: "", stderr: "", code: 1 }; },
	};
	const ctx = {
		hasUI: true,
		ui: { notify(m) { notices.push(m); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
		cwd: process.cwd(),
		sessionManager: { getEntries() { return []; }, getSessionFile() { return join(agentDir, "s.jsonl"); } },
	};
	return { pi, ctx, handlers, commands, tools, notices };
}

const TASK = "T-20260908-981";
function specFor(taskId, role = "worker") {
	return {
		taskId, objective: "probe budget stop aftermath", cwd: `/fixture/${taskId}`, role,
		scope: { allowedPaths: ["src/parser.ts"] },
		constraints: ["no new deps"], acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
		cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
	};
}
const cleanHash = "0000000000000000000000000000000000000000000000000000000000000000";
function reportFor(taskId, toolCallId) {
	return {
		version: 1, taskId, status: "completed", summary: "Implemented the change.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
		evidence: {
			cwd: `/fixture/${taskId}`, taskId, workerRunId: toolCallId,
			baseGitRef: "abc1234", finalGitRef: "abc1234", gitStatusHash: cleanHash,
			changedPaths: ["src/parser.ts"], gitAvailable: true, generatedAt: "2026-09-01T10:00:00.000Z",
		},
		risks: [], unresolved: [],
	};
}
const usageDetails = (cost, tokens) => ({
	results: [{ usage: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, cost, turns: 1 }, model: "test/model" }],
});
const showBlock = (r) => r?.block ? "YES: " + String(r.reason ?? r.block?.reason ?? "").split("\n")[0] : "no";

const H = makeHost();
const { default: plannerOnly } = await import("../../../index.ts");
plannerOnly(H.pi);
await H.handlers.get("session_start")({}, H.ctx);
const status = async (arg) => { H.notices.length = 0; await H.commands.get("planner-only").handler(arg, H.ctx); return H.notices.at(-1); };
const call = (id, role = "worker") => ({ toolCallId: id, toolName: "subagent", input: { agent: role, task: JSON.stringify(specFor(TASK, role)) } });
const budgetLines = (s) => String(s).split("\n").filter((l) => /State:|费用:|在途预留|预算已停止|Delegations|worker:|reviewer:|Review round|Worker round/.test(l)).join("\n");

// --- 1. first delegation creates the Task and reserves the whole balance.
const c1 = call("call-1");
const r1 = await H.handlers.get("tool_call")(c1, H.ctx);
console.log("call-1 blocked?", showBlock(r1), "| grant:", JSON.stringify(c1.input.usageBudget));

// --- 2. THE STOP, with call-1 still in flight.
const c2 = call("call-2");
const r2 = await H.handlers.get("tool_call")(c2, H.ctx);
console.log("call-2 blocked?", showBlock(r2), "| grant:", JSON.stringify(c2.input.usageBudget));

console.log("\n=== clause 3a: status queryable while stopped, with a child in flight ===");
console.log(budgetLines(await status(`task ${TASK}`)));

// === clause 4b (sharp): the stop must NOT release the lock call-1 holds.
//     Another Task's writer must still be refused by the write-lock rule.
const OTHER = "T-20260908-982";
// same cwd on purpose: the write lock is per-cwd, so a different cwd proves nothing.
const otherSpec = () => ({ ...specFor(OTHER), taskId: OTHER, cwd: `/fixture/${TASK}`, cumulativeBudget: { tokens: 200000, costUsd: 5 } });
const rLock = await H.handlers.get("tool_call")(
	{ toolCallId: "call-lock", toolName: "subagent", input: { agent: "worker", task: JSON.stringify(otherSpec()) } }, H.ctx);
console.log("\n=== clause 4b: lock still held by the in-flight writer while stopped ===");
console.log("other Task writer blocked?", showBlock(rLock));

// === clause 4c: the budget refusal itself must not transition the stopped Task.
const stateBeforeRefusal = String(await status(`task ${TASK}`)).match(/^State: (.*)$/m)?.[1];
await H.handlers.get("tool_call")(call("call-2b"), H.ctx);
const stateAfterRefusal = String(await status(`task ${TASK}`)).match(/^State: (.*)$/m)?.[1];
console.log("=== clause 4c: state machine untouched by a refusal ===");
console.log(`state before refusal=${stateBeforeRefusal}  after=${stateAfterRefusal}  same=${stateBeforeRefusal === stateAfterRefusal}`);

// === clause 3b: the child launched BEFORE the stop comes back -> must still settle.
await H.handlers.get("tool_result")({
	toolCallId: "call-1", toolName: "subagent",
	content: [{ type: "text", text: JSON.stringify(reportFor(TASK, "call-1")) }],
	details: usageDetails(0.055, 120000),
}, H.ctx);
console.log("\n=== clause 3b: in-flight child settled after the stop (overspend 0.055 > 0.05) ===");
console.log(budgetLines(await status(`task ${TASK}`)));

// --- 3. durable stop: a fresh delegation is now refused.
const c3 = call("call-3");
const r3 = await H.handlers.get("tool_call")(c3, H.ctx);
console.log("\ncall-3 (fresh, budget now overspent) blocked?", showBlock(r3));
// === clause 3c: Root can still record a NON-PASS verdict after the stop.
const verdictTool = H.tools.get("planner_verdict");
console.log("\n=== clause 3c: planner_verdict after the stop ===");
for (const v of ["request_changes", "blocked"]) {
	const out = await verdictTool.execute(`verdict-${v}`,
		{ verdict: v, summary: `probe ${v} after budget stop`, taskId: TASK },
		undefined, undefined, H.ctx);
	console.log(`  ${v}: isError=${Boolean(out?.isError)} details=${JSON.stringify(out?.details)}`);
	console.log("    " + String(out?.content?.[0]?.text ?? "").split("\n").slice(0, 2).join(" / "));
}

console.log("\ncall-4 (reviewer, exempt by design) blocked?",
	showBlock(await H.handlers.get("tool_call")(call("call-4", "reviewer"), H.ctx)));

// === clause 4a: a budget-refused delegation must not touch the write lock.
//     Another Task's writer must see exactly the lock state it would see anyway.
const c5 = { toolCallId: "call-5", toolName: "subagent", input: { agent: "worker", task: JSON.stringify(otherSpec()) } };
const r5 = await H.handlers.get("tool_call")(c5, H.ctx);
console.log("\n=== clause 4a: same-cwd writer AFTER the in-flight child returned (lock free) ===");
console.log("other Task's writer while", TASK, "is budget-stopped -> blocked?", showBlock(r5));

console.log("\n=== clause 4: state after the stop ===");
console.log(budgetLines(await status(`task ${TASK}`)));
console.log("\n--- full status ---");
console.log(await status(`task ${TASK}`));

rmSync(agentDir, { recursive: true, force: true });
