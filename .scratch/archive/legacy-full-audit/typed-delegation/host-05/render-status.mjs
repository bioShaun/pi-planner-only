// Renders `/planner-only status` out-of-host: loads the local index.ts with a
// minimal ExtensionAPI (same shape index.test.mjs uses), points ctx at the
// real probe-repo session jsonl, and prints what the handler notifies.
// Usage: node --experimental-strip-types render-status.mjs <probe-cwd> <session.jsonl> [--session-start]
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
delete process.env.PI_SUBAGENT_CHILD;
const [cwd, jsonl, flag] = process.argv.slice(2);
const { default: plannerOnly } = await import("/public/pi/pi-planner-only/index.ts");
const handlers = new Map(); const commands = new Map(); const tools = new Map();
let activeTools = ["read", "bash", "write", "planner_delegate", "planner_verdict", "git_audit"];
const pi = {
	on(n, h) { handlers.set(n, h); },
	registerCommand(n, d) { commands.set(n, d); },
	registerTool(d) { tools.set(d.name, d); },
	getActiveTools() { return [...activeTools]; },
	getAllTools() { return activeTools.map((name) => ({ name })); },
	setActiveTools(n) { activeTools = [...n]; },
	appendEntry() {},
	exec(command, args, opts = {}) {
		return new Promise((resolve) => execFile(command, args, { cwd: opts.cwd ?? cwd, maxBuffer: 1 << 24 }, (err, stdout, stderr) => resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code: err ? (err.code ?? 1) : 0 })));
	},
};
plannerOnly(pi);
const entries = readFileSync(jsonl, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const notices = [];
const ctx = {
	hasUI: true,
	ui: { notify(m, t) { notices.push(`[${t ?? "info"}] ${m}`); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
	cwd,
	sessionManager: { getEntries() { return entries; }, getSessionFile() { return jsonl; } },
};
if (flag === "--session-start") await handlers.get("session_start")({}, ctx);
await commands.get("planner-only").handler("status", ctx);
console.log(notices.join("\n"));
