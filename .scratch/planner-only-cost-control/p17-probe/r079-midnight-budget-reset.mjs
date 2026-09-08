// Does a Task's cumulative budget survive midnight?
// shouldReplaceTaskId() replaces any caller-supplied taskId whose date stamp is not
// today's, so a Task opened yesterday is addressed today under a NEW id.
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
	const ctx = { hasUI: true, ui: { notify(m) { notices.push(m); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
		cwd: process.cwd(), sessionManager: { getEntries() { return []; }, getSessionFile() { return join(agentDir, "s.jsonl"); } } };
	return { pi, ctx, handlers, commands, tools, notices };
}
const pad = (n) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
const y = new Date(now.getTime() - 86400000);
const yesterday = `${y.getFullYear()}${pad(y.getMonth() + 1)}${pad(y.getDate())}`;
const YTASK = `T-${yesterday}-701`;
const spec = (taskId) => ({
	taskId, objective: "midnight budget probe", cwd: `/fixture/midnight`, role: "worker",
	scope: { allowedPaths: ["src/a.ts"] }, constraints: [], acceptanceCriteria: ["tests pass"],
	validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: [],
	cumulativeBudget: { tokens: 200000, costUsd: 0.05 },
});
const showBlock = (r) => r?.block ? "BLOCKED: " + String(r.reason ?? r.block?.reason ?? "").split("\n")[0] : "allowed";

const H = makeHost();
const { default: plannerOnly } = await import("../../../index.ts");
plannerOnly(H.pi);
await H.handlers.get("session_start")({}, H.ctx);
const status = async (a) => { H.notices.length = 0; await H.commands.get("planner-only").handler(a, H.ctx); return H.notices.at(-1); };

console.log(`today=${today} yesterday=${yesterday}`);
console.log(`\n--- delegate against a Task id stamped YESTERDAY (${YTASK}) ---`);
const c1 = { toolCallId: "m-1", toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec(YTASK)) } };
console.log("result:", showBlock(await H.handlers.get("tool_call")(c1, H.ctx)));

const s = String(await status("status"));
const ids = [...s.matchAll(/T-\d{8}-\d{3}/g)].map((m) => m[0]);
console.log("Task ids the planner now knows:", [...new Set(ids)].join(", ") || "(none in status)");
console.log("yesterday's id survived as a Task?", ids.includes(YTASK));
console.log("a NEW id stamped today was minted?", ids.some((i) => i.startsWith(`T-${today}-`)));
console.log("\n--- full status ---");
console.log(s.split("\n").filter((l) => /State:|Task|费用:|Budget|tokens:/.test(l)).slice(0, 14).join("\n"));
rmSync(agentDir, { recursive: true, force: true });
