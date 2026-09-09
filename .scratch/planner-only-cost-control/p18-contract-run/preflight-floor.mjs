// Free plugin-side pre-flight for the 36-F3 contract run: does
// PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD reach the wire as usageBudget.tokens.hard,
// and does OUR gate stay open while it does?
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

async function run(floorTokens) {
	const dir = mkdtempSync(join(process.cwd(), ".contract-probe-"));
	process.env.PI_CODING_AGENT_DIR = dir;
	process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD = String(floorTokens);
	delete process.env.PI_SUBAGENT_CHILD;
	const { default: plannerOnly } = await import(`./index.ts?v=${floorTokens}`);
	const handlers = new Map(); const commands = new Map(); const notices = [];
	plannerOnly({
		on(n, h) { handlers.set(n, h); }, registerCommand(n, d) { commands.set(n, d); },
		registerTool() {}, getActiveTools() { return ["read", "subagent"]; },
		getAllTools() { return [{ name: "read" }, { name: "subagent" }]; }, setActiveTools() {},
		appendEntry() {}, async exec() { return { stdout: "", stderr: "", code: 0 }; },
	});
	const ctx = { hasUI: true, ui: { notify(m, t) { notices.push({ m, t }); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
		cwd: process.cwd(), sessionManager: { getEntries() { return []; }, getSessionFile() { return join(dir, "s.jsonl"); } } };
	await handlers.get("session_start")({}, ctx);
	const spec = { taskId: "T-20260909-900", objective: "probe", cwd: "/fixture/probe", role: "worker",
		scope: { allowedPaths: ["src/x.ts"] }, constraints: [], acceptanceCriteria: ["ok"],
		validation: { required: true, commands: ["npm test"] }, expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask"], budget: { costUsd: 0.05 } };
	const input = { agent: "worker", task: "Do this:\n\n```json\n" + JSON.stringify(spec) + "\n```" };
	const res = await handlers.get("tool_call")({ toolCallId: "call-probe", toolName: "subagent", input }, ctx);
	console.log(`floor=${floorTokens} -> decision=${JSON.stringify(res)?.slice(0, 120)}`);
	console.log(`floor=${floorTokens} -> usageBudget=${JSON.stringify(input.usageBudget)} toolBudget=${JSON.stringify(input.toolBudget)}`);
}
await run(1);
await run(200000);
