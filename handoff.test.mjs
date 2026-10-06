import assert from "node:assert/strict";
import { RootHandoff } from "./handoff.ts";
import { noGit } from "./test-helpers.mjs";

const savedMode = process.env.PI_PLANNER_ONLY_HANDOFF;
process.env.PI_PLANNER_ONLY_HANDOFF = "off";
const brief = "Continue the unfinished Root work with its decisions, constraints, evidence, and next step. ".repeat(3);

function harness(options = {}) {
	const sent = [], commands = [], notes = [], editor = [];
	const activity = { locks: { size: 0 }, delegationsInFlight: 0, rootContext: undefined };
	let current, model = { provider: "source", id: "model" }, thinking = "high", calls = 0;
	let failRestore = options.failRestore, failSend = options.failSend;
	const ctx = {
		cwd: "/work", hasUI: true, isIdle: () => true,
		get model() { return model; }, get thinkingLevel() { return thinking; },
		modelRegistry: { find: (provider, id) => ({ provider, id }) },
		ui: { notify: (message) => notes.push(message), setEditorText: (message) => editor.push(message) },
		sendUserMessage: async (message) => { if (failSend) { failSend = false; throw new Error("send failed"); } sent.push(message); },
		newSession: async ({ withSession }) => {
			calls++;
			if (options.cancel) return { cancelled: true };
			model = { provider: "default", id: "model" }; thinking = "medium";
			attach();
			await withSession(ctx);
			return {};
		},
	};
	function attach() {
		current = new RootHandoff({
			pi: {
				setModel: async (next) => { if (failRestore) { failRestore = false; throw new Error("restore failed"); } model = next; return true; },
				setThinkingLevel: (next) => { thinking = next; },
				sendUserMessage: (message) => commands.push(message),
			},
			git: noGit, host: { sessionFile: () => "/sessions/source.jsonl", sendMessage: (message) => notes.push(message) },
			activity, mode: () => "lite",
		});
	}
	attach();
	return { get current() { return current; }, ctx, activity, sent, commands, notes, editor, calls: () => calls, setSource: (next) => { model = next; } };
}

try {
	// Preserve the former PlannerSession handoff invariants at the module interface.
	const h = harness({ failRestore: true });
	assert.match(h.current.schedule({ brief }, h.ctx).content[0].text, /self-initiated handoff is off/);
	await h.current.command("handoff", h.ctx);
	assert.match(h.current.schedule({ brief: "short" }, h.ctx).content[0].text, /at least 200 characters/);
	assert.equal(h.current.schedule({ brief }, h.ctx).details.ok, true);
	h.current.deactivate();
	assert.equal(h.current.schedule({ brief }, h.ctx).details.ok, false, "scheduling consumes the explicit request even when the pending brief is cleared");
	await h.current.command("handoff", h.ctx);
	assert.equal(h.current.schedule({ brief }, h.ctx).details.ok, true);
	assert.match(h.current.schedule({ brief }, h.ctx).content[0].text, /already pending/);
	await h.current.command("handoff", h.ctx);
	assert.equal(h.sent.length, 0, "failed restoration must not send the brief");
	const before = h.commands.length;
	h.current.settled();
	assert.equal(h.commands.length, before, "deferred handoff is manual-only in the replacement instance");
	h.current.reset();
	assert.match(h.current.schedule({ brief }, h.ctx).content[0].text, /self-initiated handoff is off/, "reset clears both pending and requested state");
	await h.current.command("handoff", h.ctx);
	h.current.reset();
	assert.match(h.current.schedule({ brief }, h.ctx).content[0].text, /self-initiated handoff is off/, "reset also clears a request with no pending brief");

	// After replacement, a failed delivery must retain the original selection
	// for manual retry, even if Root changes its model before retrying.
	for (const options of [{ failRestore: true }, { failSend: true }, { cancel: true }]) {
		const h = harness(options);
		await h.current.command("handoff", h.ctx);
		assert.equal(h.current.schedule({ brief }, h.ctx).details.ok, true);
		await h.current.command("handoff", h.ctx);
		assert.equal(h.sent.length, 0);
		const commands = h.commands.length;
		h.current.settled();
		assert.equal(h.commands.length, commands);
		options.cancel = false;
		h.setSource({ provider: "other", id: "selection" });
		await h.current.command("handoff", h.ctx);
		assert.equal(h.sent.length, 1);
		assert.deepEqual(h.ctx.model, { provider: "source", id: "model" });
		assert.equal(h.ctx.thinkingLevel, "high");
		assert.ok(h.sent[0].includes(brief));
		assert.equal(h.calls(), 2);
	}

	const blocked = harness();
	await blocked.current.command("handoff", blocked.ctx);
	blocked.activity.locks.size = 1;
	assert.match(blocked.current.schedule({ brief }, blocked.ctx).content[0].text, /a child is still running/);
	blocked.activity.locks.size = 0;
	blocked.activity.delegationsInFlight = 1;
	assert.match(blocked.current.schedule({ brief }, blocked.ctx).content[0].text, /a delegated child is still running/);
	assert.equal(await blocked.current.command("status", blocked.ctx), false);
	console.log("handoff.test: ok");
} finally {
	if (savedMode === undefined) delete process.env.PI_PLANNER_ONLY_HANDOFF;
	else process.env.PI_PLANNER_ONLY_HANDOFF = savedMode;
}
