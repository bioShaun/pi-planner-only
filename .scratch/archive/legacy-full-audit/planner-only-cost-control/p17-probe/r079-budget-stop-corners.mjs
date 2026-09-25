// Ticket 16-c prototype, part 2: the corners of "settled and recorded after the stop"
// that are most likely to be broken -- missing usage, and a child that lands after
// Root already recorded a verdict.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const agentDir = mkdtempSync(join(process.cwd(), ".p17-probe-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;

function makeHost() {
	const handlers = new Map(), commands = new Map(), tools = new Map(), notices = [];
	let activeTools = ["read", "bash", "write", "subagent"];
	const pi = {
		on(n, h) { handlers.set(n, h); }, registerCommand(n, d) { commands.set(n, d); },
		registerTool(d) { tools.set(d.name, d); },
		getActiveTools() { return [...activeTools]; },
		getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
		setActiveTools(n) { activeTools = [...n]; }, appendEntry() {},
		async exec() { return { stdout: "", stderr: "", code: 1 }; },
	};
	const ctx = {
		hasUI: true, ui: { notify(m) { notices.push(m); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
		cwd: process.cwd(),
		sessionManager: { getEntries() { return []; }, getSessionFile() { return join(agentDir, "s.jsonl"); } },
	};
	return { pi, ctx, handlers, commands, tools, notices };
}
const cleanHash = "0".repeat(64);
const specFor = (taskId, role = "worker") => ({
	taskId, objective: "probe stop corners", cwd: `/fixture/${taskId}`, role,
	scope: { allowedPaths: ["src/parser.ts"] }, constraints: ["no new deps"],
	acceptanceCriteria: ["tests pass"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: ["ask if ambiguous"],
	cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
});
const reportFor = (taskId, toolCallId) => ({
	version: 1, taskId, status: "completed", summary: "Implemented the change.",
	changedFiles: ["src/parser.ts"],
	validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "1 passed" }],
	evidence: { cwd: `/fixture/${taskId}`, taskId, workerRunId: toolCallId, baseGitRef: "abc1234",
		finalGitRef: "abc1234", gitStatusHash: cleanHash, changedPaths: ["src/parser.ts"],
		gitAvailable: true, generatedAt: "2026-09-01T10:00:00.000Z" },
	risks: [], unresolved: [],
});
const showBlock = (r) => r?.block ? "YES: " + String(r.reason ?? r.block?.reason ?? "").split("\n")[0] : "no";
const budgetLines = (s) => String(s).split("\n").filter((l) => /State:|费用:|在途预留|预算已停止|未知|超额|超支/.test(l)).join("\n");

async function scenario(name, { usageDetails, verdictFirst, budget, taskId }) {
	const TASK = taskId;
	const H = makeHost();
	const { default: plannerOnly } = await import(`../../../index.ts?s=${encodeURIComponent(name)}`);
	plannerOnly(H.pi);
	await H.handlers.get("session_start")({}, H.ctx);
	const status = async (a) => { H.notices.length = 0; await H.commands.get("planner-only").handler(a, H.ctx); return H.notices.at(-1); };
	const call = (id, role = "worker") => ({ toolCallId: id, toolName: "subagent",
		input: { agent: role, task: JSON.stringify({ ...specFor(TASK, role), ...(budget ? { cumulativeBudget: budget } : {}) }) } });

	console.log(`\n########## ${name} ##########`);
	await H.handlers.get("tool_call")(call("c1"), H.ctx);            // reserves the whole balance
	const stop = await H.handlers.get("tool_call")(call("c2"), H.ctx); // THE STOP (or not, in the control)
	console.log("second delegation:", showBlock(stop));

	if (verdictFirst) {
		const vt = H.tools.get("planner_verdict");
		const out = await vt.execute("v1", { verdict: "blocked", summary: "stopped, blocking", taskId: TASK },
			undefined, undefined, H.ctx);
		console.log("verdict BEFORE the child lands:", `isError=${Boolean(out?.isError)}`, JSON.stringify(out?.details));
	}

	await H.handlers.get("tool_result")({
		toolCallId: "c1", toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(reportFor(TASK, "c1")) }],
		...(usageDetails ? { details: usageDetails } : {}),
	}, H.ctx);
	console.log("--- after the in-flight child landed ---");
	console.log(budgetLines(await status(`task ${TASK}`)));
	const full = String(await status(`task ${TASK}`));
	console.log("reports recorded:", (full.match(/Worker round: (\d+)/) ?? [])[1],
		"| reviews line:", (full.match(/^Reviews: .*$/m) ?? ["(none)"])[0]);
}

// corner 3: the in-flight child never returns. Budget stays reserved -> permanent stop.
// Can the operator still close the Task out?
async function hungChild() {
	const TASK = "T-20260908-994";
	const H = makeHost();
	const { default: plannerOnly } = await import("../../../index.ts?s=hung");
	plannerOnly(H.pi);
	await H.handlers.get("session_start")({}, H.ctx);
	const status = async (a) => { H.notices.length = 0; await H.commands.get("planner-only").handler(a, H.ctx); return H.notices.at(-1); };
	const call = (id, role = "worker") => ({ toolCallId: id, toolName: "subagent",
		input: { agent: role, task: JSON.stringify(specFor(TASK, role)) } });
	console.log("\n########## corner 3: hung child + budget stop, operator closeout ##########");
	await H.handlers.get("tool_call")(call("c1"), H.ctx);
	console.log("stop refusal:", showBlock(await H.handlers.get("tool_call")(call("c2"), H.ctx)));
	const vt = H.tools.get("planner_verdict");
	for (const v of ["request_changes", "pass", "blocked"]) {
		const out = await vt.execute(`v-${v}`, { verdict: v, summary: `hung ${v}`, taskId: TASK }, undefined, undefined, H.ctx);
		console.log(`  ${v}: isError=${Boolean(out?.isError)} ${String(out?.content?.[0]?.text ?? "").split("\n")[0].slice(0, 120)}`);
	}
	console.log("--- operator abandon ---");
	console.log(await status(`task abandon ${TASK}`));
	console.log("RAW STATUS >>>"); console.log(await status(`task ${TASK}`)); console.log("<<< RAW");
	const after = await H.handlers.get("tool_call")(call("c3"), H.ctx);
	console.log("new delegation on the abandoned Task blocked?", showBlock(after));
}

// corner 1: the child that was already running comes back with NO usage at all.
await scenario("corner 1: in-flight child returns with missing usage", { taskId: "T-20260908-991", usageDetails: undefined });
// corner 2: Root records a blocked verdict while the child is still running.
const U = { results: [{ usage: { input: 30000, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0.02, turns: 1 }, model: "test/model" }] };
await scenario("corner 2: verdict recorded before the in-flight child lands", { taskId: "T-20260908-992", usageDetails: U, verdictFirst: true });
// CONTROL for clause 4: identical sequence with a budget that never stops.
await scenario("control: same sequence, budget never exhausted", { taskId: "T-20260908-993", usageDetails: U, verdictFirst: true, budget: { tokens: 2000000, costUsd: 5 } });

await hungChild();

rmSync(agentDir, { recursive: true, force: true });
