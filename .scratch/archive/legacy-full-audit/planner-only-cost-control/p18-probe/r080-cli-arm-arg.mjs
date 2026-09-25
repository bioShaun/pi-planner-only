// Probe: `/planner-only usage record --arm <name>` with the taskId omitted.
// Documented signature (docs/pi-planner-only-cost-comparison-protocol.md):
//   /planner-only usage record [<taskId>] [--arm <name>]
// so omitting taskId must fall back to the active Task, not treat "--arm" as an id.
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
const dir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
process.env.PI_CODING_AGENT_DIR = dir;
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import("../../../index.ts");
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
await commands.get("planner-only").handler("usage record --arm role-split", ctx);
console.log("notice:", JSON.stringify(notices.at(-1)));
