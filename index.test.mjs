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

function fakePi(initialActive = ["read", "bash", "edit", "write"], exec = async () => ({ stdout: "", stderr: "not a repo", code: 128 })) {
	const tools = new Map();
	const handlers = new Map();
	const commands = new Map();
	const events = fakeBus();
	let active = initialActive;
	const pi = {
		registerTool: (t) => tools.set(t.name, t),
		registerCommand: (name, c) => commands.set(name, c),
		on: (event, h) => handlers.set(event, h),
		getActiveTools: () => active,
		setActiveTools: (next) => (active = next),
		exec,
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
	const { loadLimits } = await import("./delegate.ts");
	assert.match(plannerPrompt(false), /A child has 10 minutes\. Do not delegate work that needs longer/);
	assert.match(plannerPrompt(false, loadLimits({ PI_PLANNER_ONLY_TIMEOUT_MS: "300000" })), /A child has 5 minutes\./);
	assert.match(plannerPrompt(false), /pass `cwd` to delegate, git_audit, and git_commit/);
	process.env.PI_PLANNER_ONLY_TIMEOUT_MS = "300000";
	assert.match((await h.handlers.get("before_agent_start")({ systemPrompt: "BASE" }, h.ctx)).systemPrompt, /A child has 5 minutes\./);
	delete process.env.PI_PLANNER_ONLY_TIMEOUT_MS;

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

	// git_audit/git_commit: cwd resolves against ctx.cwd; non-repos get a clear hint.
	const notRepo = await h.tools.get("git_audit").execute("call-3", { operation: "status", cwd: "elsewhere" }, undefined, undefined, h.ctx);
	assert.equal(notRepo.content[0].text, "/w/elsewhere is not inside a git work tree; pass cwd=<repo>");
	assert.equal(notRepo.details.ok, false);
	const notRepoCommit = await h.tools.get("git_commit").execute("call-4", { message: "m" }, undefined, undefined, h.ctx);
	assert.equal(notRepoCommit.content[0].text, "/w is not inside a git work tree; pass cwd=<repo>");
	assert.equal(notRepoCommit.details.ok, false);
	{
		const seen = [];
		const hg = fakePi(undefined, async (cmd, args, opts) => {
			assert.equal(cmd, "git");
			seen.push([args.filter((a) => !a.startsWith("-") && a !== "core.fsmonitor=false")[0], opts.cwd]);
			return { stdout: args[0] === "--version" ? "git version 2.43.0" : "ok", stderr: "", code: 0 };
		});
		const cwdOf = (op) => seen.filter(([o]) => o === op).map(([, c]) => c);
		assert.equal((await hg.tools.get("git_audit").execute("a", { operation: "log", cwd: "../repo" }, undefined, undefined, hg.ctx)).details.ok, true);
		assert.deepEqual(cwdOf("log"), ["/repo"]);
		await hg.tools.get("git_audit").execute("b", { operation: "diff" }, undefined, undefined, hg.ctx);
		assert.deepEqual(cwdOf("diff"), ["/w"]);
		assert.equal((await hg.tools.get("git_commit").execute("c", { message: "m", paths: ["a.ts"], cwd: "/abs/repo" }, undefined, undefined, hg.ctx)).details.ok, true);
		assert.deepEqual(cwdOf("commit"), ["/abs/repo"]);
		await hg.tools.get("git_commit").execute("d", { message: "m" }, undefined, undefined, hg.ctx);
		assert.deepEqual(cwdOf("commit"), ["/abs/repo", "/w"]);
	}

	assert.equal(rootUsageOf({ role: "assistant", usage: { input: 5, output: "x" } }).tokens, 5);
	assert.equal(rootUsageOf(undefined), undefined);

	// HIDDEN_HOST_TOOLS: while enabled, subagents_enable/subagent are stripped.
	const h2 = fakePi(["read", "bash", "subagents_enable", "subagent"]);
	await h2.handlers.get("session_start")({}, h2.ctx);
	assert.deepEqual(h2.active(), ["read", "bash", "delegate", "git_audit", "git_commit"]);

	// pi-subagents re-adds the loader on its own hooks; before_agent_start strips again.
	h2.pi.setActiveTools([...h2.active(), "subagents_enable", "subagent"]);
	await h2.handlers.get("before_agent_start")({ systemPrompt: "B" }, h2.ctx);
	assert.deepEqual(h2.active(), ["read", "bash", "delegate", "git_audit", "git_commit"]);

	// off: subagents_enable comes back, subagent does not; on: stripped again.
	await h2.commands.get("planner-only").handler("off", h2.ctx);
	assert.ok(h2.active().includes("subagents_enable"));
	assert.ok(!h2.active().includes("subagent"));
	assert.ok(!h2.active().includes("delegate"));
	await h2.commands.get("planner-only").handler("on", h2.ctx);
	assert.ok(!h2.active().includes("subagents_enable"));
	assert.ok(!h2.active().includes("subagent"));
	assert.ok(h2.active().includes("delegate"));

	// before_agent_start scrubs systemPromptOptions.selectedTools when enabled.
	const evSel = { systemPrompt: "B", systemPromptOptions: { selectedTools: ["read", "subagents_enable", "subagent", "bash"] } };
	await h2.handlers.get("before_agent_start")(evSel, h2.ctx);
	assert.deepEqual(evSel.systemPromptOptions.selectedTools, ["read", "bash", "delegate", "git_audit", "git_commit"]);

	// tool_call: hidden tools are blocked even without strict; ordinary tools are not.
	const callTool = (toolName) => h2.handlers.get("tool_call")({ toolName }, h2.ctx);
	assert.equal((await callTool("subagents_enable")).block, true);
	assert.match((await callTool("subagent")).reason, /use the delegate tool instead of subagent\./);
	assert.equal(await callTool("read"), undefined);
	assert.equal(await callTool("bash"), undefined);

	// Disabled: selectedTools left untouched, hidden tools not blocked.
	await h2.commands.get("planner-only").handler("off", h2.ctx);
	const evSelOff = { systemPrompt: "B", systemPromptOptions: { selectedTools: ["read", "subagents_enable", "subagent"] } };
	await h2.handlers.get("before_agent_start")(evSelOff, h2.ctx);
	assert.deepEqual(evSelOff.systemPromptOptions.selectedTools, ["read", "subagents_enable", "subagent"]);
	assert.equal(await callTool("subagents_enable"), undefined);
	assert.equal(await callTool("subagent"), undefined);
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}

console.log("index.test: ok");
