import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeBus, tempDir } from "./test-helpers.mjs";

process.env.PI_CODING_AGENT_DIR = tempDir("native-handoff-");
process.env.PI_PLANNER_ONLY_MODE = "native";
process.env.PI_PLANNER_ONLY_HANDOFF = "auto";
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import("./index.ts");
const brief = "Preserve the source session work and next action. ".repeat(8);
const progress = "Completed: setup.\nRemaining: work.\nNext: continue work.";
const handoffStatus = "progress";
const status = { text: "", details: {}, fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, generatedAt: 1, caps: { maxRuns: 20, maxChildrenPerNode: 8, maxDepth: 3, maxStringLength: 160, maxSerializedBytes: 32768 }, runs: [], omitted: { runs: 0, children: 0, byteLimitExceeded: false } } };

function harness() {
	const handlers = new Map(), commands = new Map(), tools = new Map(), events = fakeBus();
	const notices = [], sent = [], queued = [], editor = [];
	let active = ["read", "bash", "subagent", "subagents_enable"], branch = [], calls = 0, sessionId = "source";
	let model = { provider: "source", id: "one" }, thinking = "high", failMode = false, onGit;
	let response = { version: 1, success: true, data: status };
	const ctx = {
		cwd: "/work", hasUI: true, isIdle: () => true,
		sessionManager: { getSessionId: () => sessionId, getSessionFile: () => "/sessions/source", getBranch: () => branch },
		get model() { return model; }, get thinkingLevel() { return thinking; },
		modelRegistry: { find: (provider, id) => ({ provider, id }) },
		ui: { notify: message => notices.push(message), setStatus() {}, setEditorText: message => editor.push(message), theme: { fg: (_c, s) => s } },
		sendUserMessage: async message => sent.push(message),
		newSession: async ({ withSession }) => {
			calls++;
			branch = [];
			model = { provider: "default", id: "two" }; thinking = "medium";
			const next = makePi();
			plannerOnly(next);
			await handlers.get("session_start")({ reason: "new" }, ctx);
			if (failMode) await commands.get("planner-only").handler("off", ctx);
			await withSession(ctx);
			return {};
		},
	};
	function makePi() {
		return { events, registerTool: tool => tools.set(tool.name, tool), registerCommand: (name, cmd) => commands.set(name, cmd), on: (name, fn) => handlers.set(name, fn), getActiveTools: () => active, setActiveTools: value => { active = value; }, appendEntry: (customType, data) => branch.push({ type: "custom", customType, data }), exec: async () => { await onGit?.(); return { code: 128, stdout: "", stderr: "not a repo" }; }, sendMessage: msg => notices.push(msg), sendUserMessage: msg => queued.push(msg), setModel: async next => { model = next; return true; }, setThinkingLevel: value => { thinking = value; } };
	}
	plannerOnly(makePi());
	events.on("subagents:rpc:v1:request", request => {
		if (request.method !== "status") return;
		if (typeof response === "function") return response(request);
		if (response === "throw") throw new Error("injected status error");
		if (response) events.emit(`subagents:rpc:v1:reply:${request.requestId}`, { ...response, requestId: response.requestId ?? request.requestId });
	});
	return { ctx, handlers, commands, tools, events, notices, sent, editor, queued, active: () => active, calls: () => calls, setResponse: value => { response = value; }, onGit: fn => { onGit = fn; }, failMode: value => { failMode = value; }, branch: () => branch, sessionId: value => { sessionId = value; } };
}

async function ready() {
	const h = harness();
	await h.handlers.get("session_start")({ reason: "new" }, h.ctx);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	return h;
}
const schedule = h => h.tools.get("handoff").execute("native", { brief, progress, status: handoffStatus }, undefined, undefined, h.ctx);
const data = patch => ({ version: 1, success: true, data: { ...status, ...patch } });

test("Native tools and context warning", async () => {
	const h = await ready();
	assert.ok(h.active().includes("handoff"));
	assert.ok(!["delegate", "git_audit", "git_commit"].some(name => h.active().includes(name)));
	const event = { systemPrompt: "base", systemPromptOptions: { selectedTools: ["read", "subagent", "delegate", "git_audit", "git_commit"] } };
	await h.handlers.get("before_agent_start")(event, h.ctx);
	assert.deepEqual(event.systemPromptOptions.selectedTools, ["read", "subagent", "handoff"]);
	await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 200000, output: 1 } } }, h.ctx);
	await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 200000, output: 1 } } }, h.ctx);
	assert.equal(h.notices.filter(x => x.customType === "planner-only-context").length, 1);
});

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const heldReply = h => {
	const request = deferred();
	h.setResponse(value => request.resolve(value));
	return async reply => {
		const value = await request.promise;
		h.events.emit(`subagents:rpc:v1:reply:${value.requestId}`, { ...reply, requestId: value.requestId });
	};
};

test("handoff cannot dispatch while schedule status is pending", async () => {
	const h = await ready();
	const reply = heldReply(h);
	const scheduled = schedule(h);
	assert.match((await schedule(h)).content[0].text, /already pending/);
	const queued = h.queued.length;
	await h.handlers.get("agent_settled")({}, h.ctx);
	assert.equal(h.queued.length, queued);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.calls(), 0);
	await reply(data({}));
	assert.equal((await scheduled).details.ok, true);
});

for (const action of ["drop", "reset", "off", "shutdown", "session-change"]) test(`late schedule reply cannot undo ${action}`, async () => {
	const h = await ready();
	const reply = heldReply(h);
	const pending = schedule(h);
	if (action === "shutdown") await h.handlers.get("session_shutdown")({}, h.ctx);
	else if (action === "session-change") h.sessionId("other");
	else if (action === "reset") await h.handlers.get("session_start")({ reason: "new" }, h.ctx);
	else await h.commands.get("planner-only").handler(action === "drop" ? "handoff drop" : "off", h.ctx);
	await reply(data({ fleet: { ...status.fleet, totalActive: 1 } }));
	assert.equal((await pending).details.ok, false);
	const count = h.queued.length;
	await h.handlers.get("agent_settled")({}, h.ctx);
	assert.equal(h.queued.length, count);
	h.setResponse(data({}));
	if (action !== "session-change") {
		await h.commands.get("planner-only").handler("handoff", h.ctx);
		assert.equal(h.calls(), 0);
	}
});

for (const action of ["drop", "reset", "off"]) for (const stage of ["git", "status"]) test(`late dispatch ${stage} cannot undo ${action}`, async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	let release;
	if (stage === "git") { const gate = deferred(); h.onGit(() => gate.promise); release = () => gate.resolve(); }
	else { const reply = heldReply(h); release = () => reply(data({})); }
	const dispatch = h.commands.get("planner-only").handler("handoff", h.ctx);
	await new Promise(resolve => setImmediate(resolve));
	if (action === "reset") await h.handlers.get("session_start")({ reason: "new" }, h.ctx);
	else await h.commands.get("planner-only").handler(action === "drop" ? "handoff drop" : "off", h.ctx);
	await release();
	await dispatch;
	assert.equal(h.calls(), 0);
});

test("concurrent manual handoffs create only one session", async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	const gate = deferred();
	h.onGit(() => gate.promise);
	const first = h.commands.get("planner-only").handler("handoff", h.ctx);
	const second = h.commands.get("planner-only").handler("handoff", h.ctx);
	gate.resolve();
	await Promise.all([first, second]);
	assert.equal(h.calls(), 1);
});

for (const kind of ["success", "failure", "throw", "timeout"]) test(`status ${kind} releases listener and timer`, async () => {
	const h = await ready();
	const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
	const timers = [];
	globalThis.setTimeout = fn => { const timer = { fn, cleared: false }; timers.push(timer); return timer; };
	globalThis.clearTimeout = timer => { timer.cleared = true; };
	try {
		h.setResponse(kind === "timeout" ? undefined : kind === "throw" ? "throw" : kind === "failure" ? { version: 1, success: false } : data({}));
		const call = schedule(h);
		const request = h.events.emitted.filter(([name, value]) => name === "subagents:rpc:v1:request" && value.method === "status").at(-1)[1];
		if (kind === "timeout") timers.at(-1).fn();
		await call;
		assert.equal(h.events.listeners(`subagents:rpc:v1:reply:${request.requestId}`), 0);
		assert.equal(timers.at(-1).cleared, true);
	} finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; }
});

test("drop discards a blocked brief without automatic dispatch", async () => {
	const h = await ready();
	h.setResponse(data({ fleet: { ...status.fleet, totalActive: 1 } }));
	assert.equal((await schedule(h)).details.ok, false);
	await h.commands.get("planner-only").handler("handoff drop", h.ctx);
	h.setResponse(data({}));
	const count = h.queued.length;
	await h.handlers.get("agent_settled")({}, h.ctx);
	assert.equal(h.queued.length, count);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.calls(), 0);
	assert.match(h.queued.at(-1), /Call the handoff tool/);
});

for (const [name, response] of [
	["active fleet", data({ fleet: { ...status.fleet, totalActive: 1 } })],
	["active snapshot", data({ asyncSnapshot: { ...status.asyncSnapshot, runs: [{ id: "one", kind: "subagent", label: "worker", state: "running" }] } })],
	["unknown state", data({ asyncSnapshot: { ...status.asyncSnapshot, runs: [{ id: "one", kind: "subagent", label: "worker", state: "unknown" }] } })],
	["missing snapshot", data({ asyncSnapshot: undefined })],
	["missing fleet", data({ fleet: undefined })],
	["bad version", { version: 2, success: true, data: status }],
	["foreign request", { version: 1, requestId: "foreign", success: true, data: status }],
	["failed response", { version: 1, success: false }],
	["transport throws", "throw"],
	["timeout", undefined],
]) test(`Native ${name} refuses without retaining brief`, async () => {
	const h = await ready();
	h.setResponse(response);
	const result = await schedule(h);
	assert.equal(result.details.ok, false);
	assert.match(result.content[0].text, /not kept/);
	assert.match(result.content[0].text, name.startsWith("active") ? /still running/ : /could not be confirmed/);
	await h.handlers.get("agent_settled")({}, h.ctx);
	assert.equal(h.calls(), 0);
	h.setResponse(data({}));
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.calls(), 0);
	assert.match(h.queued.at(-1), /Call the handoff tool/);
});

for (const state of ["complete", "failed", "partial", "paused", "stopped", "rejected"]) test(`Native terminal ${state} allows handoff`, async () => {
	const h = await ready();
	h.setResponse(data({ asyncSnapshot: { ...status.asyncSnapshot, runs: [{ id: "one", kind: "subagent", label: "worker", state }] } }));
	assert.equal((await schedule(h)).details.ok, true);
});

for (const response of [data({ fleet: { ...status.fleet, totalActive: 1 } }), { version: 1, success: false }]) test("Native dispatch rechecks activity", async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	h.onGit(() => h.setResponse(response));
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.calls(), 0);
	assert.ok(h.notices.some(value => typeof value === "string" && /next handoff call.*replace/i.test(value)));
	h.onGit(undefined);
	h.setResponse(data({}));
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.calls(), 1);
});

test("Native busy preserves explicit request for resubmission in off mode", async () => {
	process.env.PI_PLANNER_ONLY_HANDOFF = "off";
	try {
		const h = await ready();
		h.setResponse(data({ fleet: { ...status.fleet, totalActive: 1 } }));
		assert.equal((await schedule(h)).details.ok, false);
		h.setResponse(data({}));
		assert.equal((await schedule(h)).details.ok, true);
	} finally { process.env.PI_PLANNER_ONLY_HANDOFF = "auto"; }
});

test("Native failed dispatch brief is replaced by a new brief", async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	h.setResponse(data({ fleet: { ...status.fleet, totalActive: 1 } }));
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	h.setResponse(data({}));
	await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: 200000, output: 1 } } }, h.ctx);
	const fresh = "New work and next steps. ".repeat(12);
	const replacement = await h.tools.get("handoff").execute("new", { brief: fresh, progress, status: handoffStatus }, undefined, undefined, h.ctx);
	assert.equal(replacement.details.ok, true);
	assert.match(replacement.content[0].text, /replaces/);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.ok(h.sent.at(-1).includes(fresh));
	assert.ok(!h.sent.at(-1).includes(brief));
});

test("Native user initiated confirm sends automatically", async () => {
	process.env.PI_PLANNER_ONLY_HANDOFF = "confirm";
	try {
		const h = await ready();
		assert.equal((await schedule(h)).details.ok, true);
		await h.commands.get("planner-only").handler("handoff", h.ctx);
		assert.equal(h.sent.length, 1);
		assert.equal(h.editor.length, 0);
	} finally { process.env.PI_PLANNER_ONLY_HANDOFF = "auto"; }
});

test("Native handoff preserves source mode, model and thinking", async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	process.env.PI_PLANNER_ONLY_MODE = "off";
	try {
		await h.commands.get("planner-only").handler("handoff", h.ctx);
		assert.deepEqual(h.ctx.model, { provider: "source", id: "one" });
		assert.equal(h.ctx.thinkingLevel, "high");
		assert.equal(h.branch().at(-1).data.mode, "native");
		assert.ok(h.sent.some(message => message.includes(brief)));
		assert.ok(h.sent.at(-1).includes(`## Progress against the user's goal (previous Root's account)\nstatus: ${handoffStatus}\n${progress}`));
		assert.doesNotMatch(h.sent.at(-1), /Continue as Root under planner-only/);
		await h.handlers.get("session_start")({ reason: "new" }, h.ctx);
		assert.equal(h.branch().at(-1).data.mode, "off", "handoff mode is consumed only once");
	} finally { process.env.PI_PLANNER_ONLY_MODE = "native"; }
});

test("mode restore failure does not send brief", async () => {
	const h = await ready();
	assert.equal((await schedule(h)).details.ok, true);
	h.failMode(true);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.equal(h.sent.length, 0);
	assert.ok(h.notices.some(value => typeof value === "string" && /retry|drop/i.test(value)));
	h.failMode(false);
	await h.commands.get("planner-only").handler("handoff", h.ctx);
	assert.ok(h.sent.some(message => message.includes(brief)), "failed restore retains brief for retry");
});
