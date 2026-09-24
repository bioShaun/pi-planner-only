import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "./subagent-delegation-contract.ts";
import { fakeBus, tempDir, usage } from "./test-helpers.mjs";

const agentDir = tempDir("ppo-agent-");
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_PLANNER_ONLY;
delete process.env.PI_PLANNER_ONLY_STRICT;
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly, OFF_MARKER, plannerPrompt, rootUsageOf } = await import("./index.ts");

function fakePi() {
	const tools = new Map();
	const handlers = new Map();
	const commands = new Map();
	const events = fakeBus();
	let active = ["read", "bash", "edit", "write"];
	const pi = {
		registerTool: (t) => tools.set(t.name, t),
		registerCommand: (name, c) => commands.set(name, c),
		on: (event, h) => handlers.set(event, h),
		getActiveTools: () => active,
		setActiveTools: (next) => (active = next),
		exec: async () => ({ stdout: "", stderr: "not a repo", code: 128 }),
		events,
	};
	plannerOnly(pi);
	const notes = [];
	const statuses = [];
	const ctx = {
		cwd: "/w",
		hasUI: true,
		sessionManager: { getSessionId: () => "session-1" },
		ui: { setStatus: (k, v) => statuses.push(v), notify: (m) => notes.push(m), theme: { fg: (_c, s) => s } },
	};
	return { pi, tools, handlers, commands, events, ctx, notes, statuses, active: () => active };
}

try {
	// Child processes load nothing.
	process.env.PI_SUBAGENT_CHILD = "1";
	assert.equal(fakePi().tools.size, 0);
	delete process.env.PI_SUBAGENT_CHILD;

	const h = fakePi();
	assert.deepEqual([...h.tools.keys()], ["delegate", "git_audit", "git_commit"]);
	assert.ok(h.commands.has("planner-only"));

	// Prompt: appended when enabled, short, strict variant differs.
	await h.handlers.get("session_start")({}, h.ctx);
	assert.deepEqual(h.active(), ["read", "bash", "edit", "write", "delegate", "git_audit", "git_commit"]);
	const injected = await h.handlers.get("before_agent_start")({ systemPrompt: "BASE" }, h.ctx);
	assert.ok(injected.systemPrompt.startsWith("BASE\n\n[PLANNER-ONLY]"));
	for (const strict of [false, true]) assert.ok(plannerPrompt(strict).length < 1_300, "prompt should stay ~300 tokens");
	assert.match(plannerPrompt(true), /Strict mode/);

	// Strict mode blocks only edit/write/bash, and only when enabled.
	const toolCall = h.handlers.get("tool_call");
	assert.equal(await toolCall({ toolName: "bash" }, h.ctx), undefined);
	process.env.PI_PLANNER_ONLY_STRICT = "1";
	for (const toolName of ["edit", "write", "bash"]) assert.equal((await toolCall({ toolName }, h.ctx)).block, true);
	assert.equal(await toolCall({ toolName: "read" }, h.ctx), undefined);
	assert.equal(await toolCall({ toolName: "delegate" }, h.ctx), undefined);

	// Env off wins over strict; tools are hidden and no prompt is added.
	process.env.PI_PLANNER_ONLY = "0";
	assert.equal(await toolCall({ toolName: "bash" }, h.ctx), undefined);
	assert.equal(await h.handlers.get("before_agent_start")({ systemPrompt: "BASE" }, h.ctx), undefined);
	assert.deepEqual(h.active(), ["read", "bash", "edit", "write"]);
	delete process.env.PI_PLANNER_ONLY;
	delete process.env.PI_PLANNER_ONLY_STRICT;

	// /planner-only off|on toggles the marker file.
	await h.commands.get("planner-only").handler("off", h.ctx);
	assert.ok(existsSync(OFF_MARKER));
	assert.match(h.notes.at(-1), /^planner-only off/);
	assert.ok(!h.active().includes("delegate"));
	await h.commands.get("planner-only").handler("on", h.ctx);
	assert.ok(!existsSync(OFF_MARKER));
	assert.ok(h.active().includes("delegate"));

	// delegate end to end over pi.events; child and Root usage are both counted.
	h.events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (req) => {
		assert.equal(req.ownerRunId, "session-1");
		assert.equal(req.cwd, "/w/sub");
		h.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", agent: req.agent, result: { kind: "text", text: "done" }, usage: usage({ cost: 0.01 }) });
	});
	const result = await h.tools.get("delegate").execute("call-1", { role: "worker", task: "t", cwd: "sub" }, undefined, undefined, h.ctx);
	assert.match(result.content[0].text, /Child report:\ndone/);
	assert.equal(result.details.status, "completed");
	await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0, cost: { total: 0.03 } } } }, h.ctx);
	await h.handlers.get("message_end")({ message: { role: "user", content: "hi" } }, h.ctx);
	await h.commands.get("planner-only").handler("status", h.ctx);
	assert.match(h.notes.at(-1), /root 12k \$0\.030 · children\(1\) 4k \$0\.010 · root 75%/);

	// git_audit refusals come back as text, not exceptions.
	const audit = await h.tools.get("git_audit").execute("call-2", { operation: "diff", base: "--output=x" }, undefined, undefined, h.ctx);
	assert.match(audit.content[0].text, /refused/);

	assert.equal(rootUsageOf({ role: "assistant", usage: { input: 5, output: "x" } }).tokens, 5);
	assert.equal(rootUsageOf(undefined), undefined);
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}

console.log("index.test: ok");
