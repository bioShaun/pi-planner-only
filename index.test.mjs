import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "./subagent-delegation-contract.ts";
import { fakeBus, tempDir, usage } from "./test-helpers.mjs";

const agentDir = tempDir("ppo-agent-");
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_PLANNER_ONLY;
delete process.env.PI_PLANNER_ONLY_STRICT;
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly, MAX_COMMIT_MESSAGE_CHARS, OFF_MARKER, formatTotals, plannerPrompt, rootUsageOf } = await import("./index.ts");

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
	const statusColors = [];
	const sentMessages = [];
	const sentUserMessages = [];
	const sessionCalls = [];
	const replaced = { sent: [], editor: [], notes: [], ui: { notify: (m) => replaced.notes.push(m), setEditorText: (m) => replaced.editor.push(m) }, sendUserMessage: async (m) => replaced.sent.push(m) };
	const ctx = {
		cwd: "/w",
		hasUI: true,
		isIdle: () => true,
		sessionManager: { getSessionId: () => "session-1", getSessionFile: () => "/sessions/previous.jsonl" },
		newSession: async (opts) => { sessionCalls.push(opts); await opts.withSession(replaced); return {}; },
		ui: { setStatus: (k, v) => statuses.push(v), notify: (m) => notes.push(m), theme: { fg: (c, s) => { statusColors.push(c); return s; } } },
	};
	pi.sendMessage = (...args) => sentMessages.push(args);
	pi.sendUserMessage = (...args) => sentUserMessages.push(args);
	return { pi, tools, handlers, commands, events, ctx, notes, statuses, statusColors, sentMessages, sentUserMessages, sessionCalls, replaced, active: () => active };
}

try {
	// Child processes load nothing.
	process.env.PI_SUBAGENT_CHILD = "1";
	assert.equal(fakePi().tools.size, 0);
	delete process.env.PI_SUBAGENT_CHILD;

	const h = fakePi();
	assert.deepEqual([...h.tools.keys()], ["delegate", "git_audit", "git_commit", "handoff"]);
	// om09 run4: a 540-char message was rejected at the old 500 cap.
	assert.equal(MAX_COMMIT_MESSAGE_CHARS, 2_000);
	assert.equal(h.tools.get("git_commit").parameters.properties.message.maxLength, MAX_COMMIT_MESSAGE_CHARS);
	assert.ok(h.commands.has("planner-only"));

	// Prompt: appended when enabled, short, strict variant differs.
	await h.handlers.get("session_start")({}, h.ctx);
	assert.deepEqual(h.active(), ["read", "bash", "edit", "write", "delegate", "git_audit", "git_commit", "handoff"]);
	const injected = await h.handlers.get("before_agent_start")({ systemPrompt: "BASE" }, h.ctx);
	assert.ok(injected.systemPrompt.startsWith("BASE\n\n[PLANNER-ONLY]"));
	for (const strict of [false, true]) assert.ok(plannerPrompt(strict).length < 1_300, "prompt should stay ~300 tokens");
	assert.match(plannerPrompt(true), /Strict mode/);
	const { loadLimits } = await import("./delegate.ts");
	assert.match(plannerPrompt(false), /A child has 10 minutes\. Do not delegate work that needs longer/);
	assert.match(plannerPrompt(false, loadLimits({ PI_PLANNER_ONLY_TIMEOUT_MS: "300000" })), /A child has 5 minutes\./);
	assert.match(plannerPrompt(false), /pass `cwd` to delegate, git_audit, and git_commit/);
	assert.match(plannerPrompt(false), /timed-out child's result includes its last tool results; reuse them/);
	assert.match(plannerPrompt(false), /Before reverting or reporting a child's change, check it against your task/);
	assert.match(plannerPrompt(false), /explorer.*reading-heavy.*logs\/transcripts.*only its findings enter your context/);
	assert.match(plannerPrompt(false), /reviewer.*no shell.*uncommitted changes only.*before git_commit/);
	assert.match(plannerPrompt(false), /fails or times out.*narrower task.*report\/last tool results before doing the work yourself/);
	assert.match(h.tools.get("delegate").parameters.properties.role.description, /logs, or transcripts and return findings/);
	assert.match(h.tools.get("delegate").parameters.properties.role.description, /no shell, sees files and uncommitted changes \(review before committing\)/);
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

	const brief = "Continue the parser migration in this repository. Goal: finish the streaming parser. Decisions: preserve the public API and avoid dependencies. Constraints: TypeScript, existing tests, no commits. Relevant files: index.ts and index.test.mjs. Done: analysis and initial implementation. Open: validate edge cases and update tests. Exact next step: inspect parser tests, implement missing cases, then run npm run test:release.";
	const gate = fakePi();
	const gateTool = gate.tools.get("handoff");
	const unrequestedRefusal = await gateTool.execute("small-unrequested", { brief }, undefined, undefined, gate.ctx);
	assert.equal(unrequestedRefusal.details.ok, false);
	assert.match(unrequestedRefusal.content[0].text, /below the 150k threshold, and the user did not request a handoff/);
	await gate.commands.get("planner-only").handler("handoff", gate.ctx);
	assert.equal((await gateTool.execute("manual-request", { brief }, undefined, undefined, gate.ctx)).details.ok, true);
	await gate.commands.get("planner-only").handler("handoff", gate.ctx);
	await gate.handlers.get("session_start")({}, gate.ctx);
	const secondSmallCall = await gateTool.execute("after-handoff", { brief }, undefined, undefined, gate.ctx);
	assert.equal(secondSmallCall.details.ok, false);
	const high = fakePi();
	await high.handlers.get("session_start")({}, high.ctx);
	await high.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 200_000, output: 0, cacheRead: 0, cacheWrite: 0 } } }, high.ctx);
	assert.equal((await high.tools.get("handoff").execute("high-context", { brief }, undefined, undefined, high.ctx)).details.ok, true);
	const handoffTool = h.tools.get("handoff");
	assert.equal((await handoffTool.execute("short", { brief: "too short" }, undefined, undefined, h.ctx)).details.ok, false);
	assert.deepStrictEqual(await handoffTool.execute("no-ui", { brief }, undefined, undefined, { ...h.ctx, hasUI: false }), {
		content: [{ type: "text", text: "Handoff refused: a UI session is required." }],
		details: { ok: false },
	});
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal((await handoffTool.execute("handoff-1", { brief, cwd: "repo" }, undefined, undefined, h.ctx)).details.ok, true);
	assert.equal((await handoffTool.execute("handoff-2", { brief }, undefined, undefined, h.ctx)).details.ok, false);
	await h.handlers.get("agent_settled")({}, h.ctx);
	assert.deepEqual(h.sentUserMessages.at(-1), ["/planner-only handoff", { expandPromptTemplates: true }]);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.sessionCalls.at(-1).parentSession, "/sessions/previous.jsonl");
	assert.ok(h.replaced.sent.at(-1).startsWith("[planner-only handoff] You are the new Root session."));
	assert.match(h.replaced.sent.at(-1), /## Brief/);
	assert.match(h.replaced.sent.at(-1), /Facts from the previous session/);
	assert.match(h.replaced.sent.at(-1), /Not inside a git work tree/);
	assert.match(h.replaced.sent.at(-1), /Continue the parser migration/);
	const gitFacts = fakePi(undefined, async (_cmd, args) => {
		if (args[0] === "--version") return { stdout: "git version 2.43.0", stderr: "", code: 0 };
		if (args.includes("--is-inside-work-tree")) return { stdout: "true", stderr: "", code: 0 };
		if (args.includes("status")) return { stdout: " M index.ts\n?? new.ts\n", stderr: "", code: 0 };
		if (args.includes("log")) return { stdout: "abc123 latest change\n", stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 0 };
	});
	await gitFacts.commands.get("planner-only").handler("handoff", gitFacts.ctx);
	await gitFacts.tools.get("handoff").execute("facts", { brief, cwd: "repo" }, undefined, undefined, gitFacts.ctx);
	await gitFacts.commands.get("planner-only").handler("handoff", gitFacts.ctx);
	assert.match(gitFacts.replaced.sent[0], /M index.ts/);
	assert.match(gitFacts.replaced.sent[0], /abc123 latest change/);
	assert.match(gitFacts.replaced.sent[0], /Repository \(git facts below\): \/w\/repo/);
	const cancelled = fakePi();
	let cancelSession = true;
	cancelled.ctx.newSession = async (opts) => { cancelled.sessionCalls.push(opts); if (cancelSession) return { cancelled: true }; await opts.withSession(cancelled.replaced); return {}; };
	await cancelled.commands.get("planner-only").handler("handoff", cancelled.ctx);
	await cancelled.tools.get("handoff").execute("cancel", { brief }, undefined, undefined, cancelled.ctx);
	await cancelled.commands.get("planner-only").handler("handoff", cancelled.ctx);
	assert.match(cancelled.notes.at(-1), /handoff cancelled/);
	await cancelled.handlers.get("agent_settled")({}, cancelled.ctx);
	assert.equal(cancelled.sentUserMessages.length, 1);
	cancelSession = false;
	await cancelled.commands.get("planner-only").handler("handoff", cancelled.ctx);
	assert.equal(cancelled.sessionCalls.length, 2);
	assert.match(cancelled.replaced.sent.at(-1), /Continue the parser migration/);
	await cancelled.tools.get("handoff").execute("drop", { brief }, undefined, undefined, cancelled.ctx);
	await cancelled.commands.get("planner-only").handler("handoff drop", cancelled.ctx);
	assert.match(cancelled.notes.at(-1), /handoff dropped/);
	const thrown = fakePi();
	thrown.ctx.newSession = async () => { throw new Error("new session boom"); };
	await thrown.commands.get("planner-only").handler("handoff", thrown.ctx);
	await thrown.tools.get("handoff").execute("throw", { brief }, undefined, undefined, thrown.ctx);
	await assert.doesNotReject(thrown.commands.get("planner-only").handler("handoff", thrown.ctx));
	assert.match(thrown.notes.at(-1), /handoff failed/);
	await thrown.handlers.get("agent_settled")({}, thrown.ctx);
	assert.equal(thrown.sentUserMessages.length, 1);
	const gitFailure = fakePi(undefined, async () => { throw new Error("git unavailable"); });
	await gitFailure.commands.get("planner-only").handler("handoff", gitFailure.ctx);
	await gitFailure.tools.get("handoff").execute("git-failure", { brief }, undefined, undefined, gitFailure.ctx);
	await gitFailure.commands.get("planner-only").handler("handoff", gitFailure.ctx);
	assert.match(gitFailure.replaced.sent[0], /git facts unavailable: git unavailable/);
	const disabledHandoff = fakePi();
	await disabledHandoff.commands.get("planner-only").handler("handoff", disabledHandoff.ctx);
	await disabledHandoff.tools.get("handoff").execute("off-handoff", { brief }, undefined, undefined, disabledHandoff.ctx);
	await disabledHandoff.commands.get("planner-only").handler("off", disabledHandoff.ctx);
	await disabledHandoff.handlers.get("agent_settled")({}, disabledHandoff.ctx);
	await disabledHandoff.commands.get("planner-only").handler("on", disabledHandoff.ctx);
	await disabledHandoff.handlers.get("agent_settled")({}, disabledHandoff.ctx);
	assert.equal(disabledHandoff.sentUserMessages.length, 1);
	const confirm = fakePi();
	await confirm.commands.get("planner-only").handler("handoff", confirm.ctx);
	await confirm.tools.get("handoff").execute("confirm", { brief }, undefined, undefined, confirm.ctx);
	process.env.PI_PLANNER_ONLY_HANDOFF = "confirm";
	await confirm.commands.get("planner-only").handler("handoff", confirm.ctx);
	delete process.env.PI_PLANNER_ONLY_HANDOFF;
	assert.equal(confirm.replaced.editor.length, 1);
	assert.equal(confirm.replaced.sent.length, 0);
	const manual = fakePi();
	await manual.commands.get("planner-only").handler("handoff next goal", manual.ctx);
	assert.match(manual.sentUserMessages[0][0], /Call the handoff tool/);
	assert.match(manual.sentUserMessages[0][0], /next goal/);

	const inflight = fakePi();
	let finishReviewer;
	inflight.events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (req) => { finishReviewer = () => inflight.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: req.requestId, nodeId: req.nodeId, agent: req.agent, status: "completed", result: { kind: "text", text: "reviewed" }, usage: usage() }); });
	const reviewerPromise = inflight.tools.get("delegate").execute("review-inflight", { role: "reviewer", task: "review" }, undefined, undefined, inflight.ctx);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await inflight.commands.get("planner-only").handler("handoff", inflight.ctx);
	const inflightRefusal = await inflight.tools.get("handoff").execute("inflight-refusal", { brief }, undefined, undefined, inflight.ctx);
	assert.match(inflightRefusal.content[0].text, /a delegated child is still running/);
	finishReviewer();
	await reviewerPromise;

	// delegate end to end over pi.events; child and Root usage are both counted.
	let reply = { status: "completed", result: { kind: "text", text: "done" }, usage: usage({ cost: 0.01 }) };
	h.events.on(SUBAGENT_DELEGATION_REQUEST_EVENT, (req) => {
		assert.equal(req.ownerRunId, "session-1");
		assert.equal(req.cwd, "/w/sub");
		h.events.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: req.requestId, nodeId: req.nodeId, agent: req.agent, ...reply });
	});
	const result = await h.tools.get("delegate").execute("call-1", { role: "worker", task: "t", cwd: "sub" }, undefined, undefined, h.ctx);
	assert.match(result.content[0].text, /Child report:\ndone/);
	assert.equal(result.details.status, "completed");
	const hc = fakePi();
	await hc.handlers.get("session_start")({}, hc.ctx);
	assert.equal(rootUsageOf({ role: "assistant", usage: { input: 5, output: "x", cacheRead: 7, cacheWrite: 3 } }).context, 15);
	const largeContext = { message: { role: "assistant", usage: { input: 0, output: 0, cacheRead: 200_000, cacheWrite: 0, cost: { total: 0 } } } };
	await hc.handlers.get("message_end")(largeContext, hc.ctx);
	assert.equal(hc.sentMessages.length, 1);
	assert.equal(hc.sentMessages[0][0].customType, "planner-only-context");
	assert.equal(hc.sentMessages[0][1].deliverAs, "nextTurn");
	assert.match(hc.sentMessages[0][0].content, /about 200k tokens/);
	assert.match(hc.sentMessages[0][0].content, /\/compact/);
	assert.match(hc.sentMessages[0][0].content, /fresh session/);
	await hc.handlers.get("message_end")(largeContext, hc.ctx);
	assert.equal(hc.sentMessages.length, 1);
	await hc.commands.get("planner-only").handler("status", hc.ctx);
	assert.match(hc.notes.at(-1), /ctx 200k/);
	assert.equal(hc.statusColors.at(-1), "error");
	assert.doesNotMatch((await hc.handlers.get("before_agent_start")({ systemPrompt: "BASE" }, hc.ctx)).systemPrompt, /Root context is about/);
	await hc.handlers.get("session_compact")({}, hc.ctx);
	await hc.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 10_000, output: 0, cacheRead: 0, cacheWrite: 0 } } }, hc.ctx);
	await hc.handlers.get("message_end")(largeContext, hc.ctx);
	assert.equal(hc.sentMessages.length, 2);
	const preferred = fakePi();
	await preferred.handlers.get("session_start")({}, preferred.ctx);
	preferred.ctx.getContextUsage = () => ({ tokens: 180_000 });
	await preferred.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 10_000, output: 0, cacheRead: 0, cacheWrite: 0 } } }, preferred.ctx);
	await preferred.commands.get("planner-only").handler("status", preferred.ctx);
	assert.match(preferred.notes.at(-1), /ctx 180k/);
	assert.equal(preferred.sentMessages.length, 1);
	const threshold = fakePi();
	await threshold.handlers.get("session_start")({}, threshold.ctx);
	process.env.PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS = "300000";
	await threshold.handlers.get("message_end")(largeContext, threshold.ctx);
	assert.equal(threshold.sentMessages.length, 0);
	delete process.env.PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS;
	process.env.PI_PLANNER_ONLY = "0";
	const disabled = fakePi();
	await disabled.handlers.get("session_start")({}, disabled.ctx);
	await disabled.handlers.get("message_end")(largeContext, disabled.ctx);
	assert.equal(disabled.sentMessages.length, 0);
	delete process.env.PI_PLANNER_ONLY;
	await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0, cost: { total: 0.03 } } } }, h.ctx);
	await h.handlers.get("message_end")({ message: { role: "user", content: "hi" } }, h.ctx);
	await h.commands.get("planner-only").handler("status", h.ctx);
	assert.match(h.notes.at(-1), /root 12k \$0\.030 · children\(1\) 3\.5k \$0\.010 · root share 77% tok · 75% \$/);

	// A child that did not complete counts as failed even without usage; a refusal launched nothing and is not counted.
	reply = { status: "timed_out", error: "Subagent timed out after 600000ms." };
	const timedOut = await h.tools.get("delegate").execute("call-1b", { role: "worker", task: "t", cwd: "sub" }, undefined, undefined, h.ctx);
	assert.equal(timedOut.details.status, "timed_out");
	const refused = await h.tools.get("delegate").execute("call-1c", { role: "worker", task: "   ", cwd: "sub" }, undefined, undefined, h.ctx);
	assert.equal(refused.details.status, "refused");
	await h.commands.get("planner-only").handler("status", h.ctx);
	assert.match(h.notes.at(-1), /children\(2, 1 failed\) 3\.5k \$0\.010/);

	// git_audit refusals come back as text, not exceptions.
	const audit = await h.tools.get("git_audit").execute("call-2", { operation: "diff", base: "--output=x" }, undefined, undefined, h.ctx);
	assert.match(audit.content[0].text, /refused/);
	// An empty optional path (common from models) means "no filter", not a refusal.
	const emptyPath = await h.tools.get("git_audit").execute("call-2b", { operation: "status", path: "" }, undefined, undefined, h.ctx);
	assert.doesNotMatch(emptyPath.content[0].text, /path must be non-empty/);

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
	assert.equal(rootUsageOf({ role: "assistant", usage: { input: 5, output: "x" } }).context, 5);
	assert.equal(rootUsageOf(undefined), undefined);

	// HIDDEN_HOST_TOOLS: while enabled, subagents_enable/subagent are stripped.
	const h2 = fakePi(["read", "bash", "subagents_enable", "subagent"]);
	await h2.handlers.get("session_start")({}, h2.ctx);
	assert.deepEqual(h2.active(), ["read", "bash", "delegate", "git_audit", "git_commit", "handoff"]);
	// pi-subagents re-adds the loader on its own hooks; before_agent_start strips again.
	h2.pi.setActiveTools([...h2.active(), "subagents_enable", "subagent"]);
	await h2.handlers.get("before_agent_start")({ systemPrompt: "B" }, h2.ctx);
	assert.deepEqual(h2.active(), ["read", "bash", "delegate", "git_audit", "git_commit", "handoff"]);

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
	assert.deepEqual(evSel.systemPromptOptions.selectedTools, ["read", "bash", "delegate", "git_audit", "git_commit", "handoff"]);

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

// Status line: k/M/B units, root share by tokens and by cost, non-completed children counted.
{
	const line = formatTotals({ rootTokens: 4_166_000, rootCost: 3.854, childTokens: 2_822_000, childCost: 0.103, children: 3, failed: 1 });
	assert.equal(line, "root 4.17M $3.854 · children(3, 1 failed) 2.82M $0.103 · root share 60% tok · 97% $");
	assert.equal(formatTotals({ rootTokens: 12_000, rootCost: 0.05, childTokens: 0, childCost: 0, children: 0, failed: 0 }), "root 12k $0.050 · children(0) 0 $0.000");
	assert.equal(formatTotals({ rootTokens: 0, rootCost: 0, childTokens: 500, childCost: 0, children: 1, failed: 0 }), "root 0 $0.000 · children(1) 500 $0.000 · root share 0% tok");
}
