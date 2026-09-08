// planner probe (p13-r060, ticket 35). Independent of index.test.mjs: builds its
// own pi stub, then drives one scenario per process so extension state is fresh.
// Usage: PROBE=<name> node --experimental-strip-types shutdown-matrix.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const probe = process.env.PROBE ?? "quit-open";
const agentDir = mkdtempSync(join(dirname(fileURLToPath(import.meta.url)), "agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import("../../../index.ts");

const handlers = new Map();
const commands = new Map();
const notices = [];
const sessionEntries = [];
let activeTools = ["read", "bash", "write", "subagent", "git_audit", "planner_verdict"];
const pi = {
	on: (n, h) => handlers.set(n, h),
	registerCommand: (n, d) => commands.set(n, d),
	registerTool: () => {},
	getActiveTools: () => [...activeTools],
	getAllTools: () => [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }],
	setActiveTools: (names) => { activeTools = [...names]; },
	appendEntry: (customType, data) => sessionEntries.push({ type: "custom", customType, data }),
	exec: async () => ({ stdout: "", stderr: "", code: 0 }),
};
plannerOnly(pi);
const ctx = {
	hasUI: true,
	ui: { notify: (message, type) => notices.push({ message, type }), setStatus() {}, theme: { fg: (_c, t) => t } },
	cwd: process.cwd(),
	sessionManager: {
		getEntries: () => sessionEntries,
		getSessionFile: () => join(agentDir, "sessions", "probe.jsonl"),
	},
};
await handlers.get("session_start")({}, ctx);

const artifactDir = join(agentDir, "sessions", "subagent-artifacts");
mkdirSync(artifactDir, { recursive: true });
const rows = () => {
	const p = join(agentDir, "planner-only", "usage.jsonl");
	if (!existsSync(p)) return [];
	return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const spec = (taskId) => ({
	taskId, objective: `do ${taskId}`, cwd: `/fixture/${taskId}`, role: "worker",
	scope: { allowedPaths: ["src/parser.ts"] }, constraints: ["no new deps"],
	acceptanceCriteria: ["tests pass"], validation: { required: true, commands: ["npm test"] },
	expectedEvidence: { changedFiles: true, tests: true }, stopConditions: ["ask if ambiguous"],
});
const openWorker = async (taskId, callId) =>
	handlers.get("tool_call")({ toolCallId: callId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec(taskId)) } }, ctx);
const writeMeta = (runId, agent, cost) => writeFileSync(join(artifactDir, `${runId}_${agent}_meta.json`), JSON.stringify({
	runId, agent, model: "volcengine/glm-5-3-flash:medium",
	usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, cost, turns: 1 },
}));
const out = (label, value) => console.log(`${label}: ${JSON.stringify(value)}`);

if (probe === "quit-open") {
	// clause 1-3: open Task + an orphan meta the ledger never saw -> one incomplete row carrying the money.
	await openWorker("T-20260908-P01", "call-p01");
	writeMeta("p01-orphan", "oracle", 0.0432);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const last = rows().at(-1);
	out("rows", rows().length);
	out("incomplete", last?.incomplete);
	out("state", last?.state);
	out("childRunIds", (last?.children ?? []).map((c) => c.runId));
	out("fullRow", last);
} else if (probe === "reasons") {
	// clause 5: which reasons flush. One fresh child process per reason via REASON.
	const reason = process.env.REASON;
	await openWorker("T-20260908-P02", "call-p02");
	writeMeta("p02-orphan", "oracle", 0.011);
	const before = rows().length;
	await handlers.get("session_shutdown")({ reason }, ctx);
	out("reason", reason);
	out("appended", rows().length - before);
} else if (probe === "no-reason") {
	await openWorker("T-20260908-P03", "call-p03");
	writeMeta("p03-orphan", "oracle", 0.011);
	const before = rows().length;
	await handlers.get("session_shutdown")({}, ctx);
	out("appended-missing-reason", rows().length - before);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	out("appended-then-quit", rows().length - before);
} else if (probe === "double-quit") {
	// clause 4/6: a second shutdown must not duplicate the snapshot.
	await openWorker("T-20260908-P04", "call-p04");
	writeMeta("p04-orphan", "oracle", 0.02);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const afterFirst = rows().length;
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	out("afterFirst", afterFirst);
	out("afterSecond", rows().length);
	const ids = rows().flatMap((r) => (r.children ?? []).map((c) => c.runId));
	out("allChildRunIds", ids);
	out("duplicateRunIds", ids.filter((id, i) => ids.indexOf(id) !== i));
} else if (probe === "ghost") {
	// clause 7: unbound validator with no active Task in that cwd.
	const ghostCall = await handlers.get("tool_call")({
		toolCallId: "call-p05-ghost", toolName: "subagent",
		input: { agent: "oracle", cwd: "/repo/p05-empty", task: "validate the claim" },
	}, ctx);
	out("ghostBlocked", ghostCall?.block ?? false);
	await handlers.get("tool_result")({
		toolCallId: "call-p05-ghost", toolName: "subagent",
		details: { runId: "p05-ghost-run", results: [{ agent: "oracle", model: "volcengine/glm-5-3-flash:medium", usage: { input: 80, output: 16, cacheRead: 0, cacheWrite: 0, cost: 0.058, turns: 2 } }] },
		content: [{ type: "text", text: "HEAD matches." }], isError: false,
	}, ctx);
	out("rowsBeforeShutdown", rows().length);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const ghostRows = rows().filter((r) => (r.children ?? []).some((c) => c.runId === "p05-ghost-run"));
	out("ghostRowCount", ghostRows.length);
	out("ghostRowFull", ghostRows[0]);
} else if (probe === "terminal") {
	// clause 6: a Task already flushed by flushIfTerminal gets no second row.
	await openWorker("T-20260908-P06", "call-p06");
	notices.length = 0;
	await commands.get("planner-only").handler("task T-20260908-P06", ctx);
	const taskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	await handlers.get("tool_result")({
		toolCallId: "call-p06", toolName: "subagent",
		details: { results: [{ agent: "worker", usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1 } }] },
		content: [{ type: "text", text: "not a WorkerReport" }], isError: false,
	}, ctx);
	await commands.get("planner-only").handler(`task abandon ${taskId}`, ctx);
	const before = rows().filter((r) => r.taskId === taskId);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const after = rows().filter((r) => r.taskId === taskId);
	out("taskId", taskId);
	out("rowsBeforeShutdown", before.length);
	out("rowsAfterShutdown", after.length);
	out("incompleteFlags", after.map((r) => r.incomplete ?? false));
}
rmSync(agentDir, { recursive: true, force: true });
