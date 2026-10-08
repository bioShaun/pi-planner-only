// usage: node --experimental-strip-types driver_r2.mjs <repo_dir> <steps_json_file>
// Loads <repo_dir>/index.ts against a frozen fake pi host (copied from baseline 1275050 index.test.mjs fakePi),
// runs steps in order, prints one JSON trace line. Env is set by the caller.
// Steps: "session_start" | "before_agent_start" | "agent_settled" | {cmd:"<args>"} | {usage:<input tokens>} | {tool:"handoff", brief:"..."}
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const repoDir = resolve(process.argv[2]);
const steps = JSON.parse(readFileSync(process.argv[3], "utf8"));

function fakeBus() {
	const handlers = new Map();
	const emitted = [];
	return {
		emitted,
		on(event, handler) {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event).add(handler);
			return () => handlers.get(event)?.delete(handler);
		},
		emit(event, data) {
			emitted.push([event, data]);
			for (const handler of [...(handlers.get(event) ?? [])]) handler(data);
		},
		listeners(event) { return handlers.get(event)?.size ?? 0; },
		totalListeners() { return [...handlers.values()].reduce((n, set) => n + set.size, 0); },
	};
}

function fakePi(plannerOnly, initialActive = ["read", "bash", "edit", "write"], exec = async () => ({ stdout: "", stderr: "not a repo", code: 128 })) {
	const tools = new Map();
	const handlers = new Map();
	const commands = new Map();
	const events = fakeBus();
	let active = initialActive;
	let branch = [];
	let sessionId = "session-1";
	const appended = [];
	const pi = {
		registerTool: (t) => tools.set(t.name, t),
		registerCommand: (name, c) => commands.set(name, c),
		on: (event, h) => handlers.set(event, h),
		getActiveTools: () => active,
		setActiveTools: (next) => (active = next),
		appendEntry: (customType, data) => { const entry = { type: "custom", customType, data }; appended.push(entry); branch.push(entry); },
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
		sessionManager: { getSessionId: () => sessionId, getSessionFile: () => "/sessions/previous.jsonl", getBranch: () => branch },
		newSession: async (opts) => { sessionCalls.push(opts); await opts.withSession(replaced); return {}; },
		ui: { setStatus: (k, v) => statuses.push(v), notify: (m) => notes.push(m), theme: { fg: (c, s) => { statusColors.push(c); return s; } } },
	};
	pi.sendMessage = (...args) => sentMessages.push(args);
	pi.sendUserMessage = (...args) => sentUserMessages.push(args);
	return { pi, tools, handlers, commands, events, ctx, notes, statuses, statusColors, sentMessages, sentUserMessages, sessionCalls, replaced };
}

const trace = { steps: [], sentMessages: [], sentUserMessages: [], sessionCalls: [], replaced_sent: [], replaced_editor: [], replaced_notes: [], load_error: null };
let h;
try {
	const mod = await import(pathToFileURL(resolve(repoDir, "index.ts")).href);
	h = fakePi(mod.default);
} catch (e) {
	trace.load_error = String(e?.stack ?? e);
}

if (h) {
	for (const step of steps) {
		const rec = { step, error: null, notes_added: [], tool_result: null };
		const before = h.notes.length;
		try {
			if (step === "session_start" || step === "before_agent_start" || step === "agent_settled") {
				await h.handlers.get(step)?.({}, h.ctx);
			} else if (step && typeof step === "object" && "cmd" in step) {
				await h.commands.get("planner-only").handler(step.cmd, h.ctx);
			} else if (step && typeof step === "object" && "usage" in step) {
				await h.handlers.get("message_end")({ message: { role: "assistant", usage: { input: step.usage, output: 0, cacheRead: 0, cacheWrite: 0 } } }, h.ctx);
			} else if (step && typeof step === "object" && "tool" in step) {
				rec.tool_result = await h.tools.get(step.tool).execute("call-" + trace.steps.length, { brief: step.brief }, undefined, undefined, h.ctx);
			} else {
				throw new Error("unknown step");
			}
		} catch (e) {
			rec.error = String(e?.stack ?? e).split("\n").slice(0, 3).join(" | ");
		}
		rec.notes_added = h.notes.slice(before);
		trace.steps.push(rec);
	}
	Object.assign(trace, { sentMessages: h.sentMessages, sentUserMessages: h.sentUserMessages, sessionCalls: h.sessionCalls, replaced_sent: h.replaced.sent, replaced_editor: h.replaced.editor, replaced_notes: h.replaced.notes });
}

let out = JSON.stringify(trace);
const subs = [[process.env.PI_CODING_AGENT_DIR, "<AGENT>"], [repoDir, "<REPO>"], [process.env.TMPDIR, "<TMP>"]];
for (const [p, tag] of subs) if (p) out = out.split(JSON.stringify(p).slice(1, -1)).join(tag);
process.stdout.write(out + "\n");
