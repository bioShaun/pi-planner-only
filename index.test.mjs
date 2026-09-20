import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { TaskStore, createTaskSpec, validateTaskSpec } from "./task.ts";
import { emptyTaskUsage } from "./usage.ts";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT,
	SUBAGENT_DELEGATION_REQUEST_EVENT,
	SUBAGENT_DELEGATION_RESPONSE_EVENT,
	SUBAGENT_DELEGATION_UPDATE_EVENT,
} from "./subagent-delegation-contract.ts";

const isolatedAgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
process.env.PI_PLANNER_ONLY_SEED_PRICING = "0";
// P0-A — keep the spec §3 quiescence wait instant in tests; the default is 10 s.
process.env.PI_PLANNER_ONLY_QUIESCENCE_MS = "0";
// Keep the cancel grace near-instant so the stop_unconfirmed/writerHold path is testable; default is 5 s.
process.env.PI_PLANNER_ONLY_CANCEL_GRACE_MS = "50";
// This legacy fixture exercises many independent lifecycle cases in one host.
// Isolate its Task/refusal-breaker assertions from Request quotas; P0 defaults
// and bounded recovery are exercised by request-stop.test.mjs.
for (const limit of ["TOOL_ATTEMPTS", "CHILD_LAUNCHES", "FAILURES", "REPAIRS"]) {
	process.env[`PI_PLANNER_ONLY_REQUEST_${limit}`] = "1000";
}
// ticket 05 → 08: this file drives the pre-cutover subagent chain through the hook; deleted with it.

delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly, filterPlannerTools, restorePlannerTools, PLANNER_PROMPT, createLoadedPluginFingerprint } = await import("./index.ts");

const handlers = new Map();
const commands = new Map();
const tools = new Map();
const gitResponses = new Map();
let activeTools = ["read", "bash", "write", "subagent", "custom_mutator", "git_audit", "planner_verdict"];
const allTools = [
	{ name: "read" },
	{ name: "grep" },
	{ name: "find" },
	{ name: "ls" },
	{ name: "bash" },
	{ name: "write" },
	{ name: "edit" },
	{ name: "subagent" },
	{ name: "bg_wait" },
	{ name: "subagent_wait" },
	{ name: "contact_supervisor" },
	{ name: "git_audit" },
	{ name: "custom_mutator" },
];
const setActiveCalls = [];
const notices = [];
const execCalls = [];
const sessionEntries = [];

// Minimal on/emit bus standing in for pi.events (same shape as the one in
// delegate.test.mjs — deliberately not shared across files).
function tinyEmitter() {
	const listeners = new Map();
	const emitted = [];
	return {
		emitted,
		on(event, fn) {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(fn);
			return () => set.delete(fn);
		},
		emit(event, payload) {
			emitted.push({ event, payload });
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload);
		},
	};
}
const piEvents = tinyEmitter();
let fixtureToolCallSequence = 0;

const pi = {
	on(name, handler) {
		handlers.set(name, name === "tool_call"
			? (event, context) => handler({ ...event, toolCallId: event.toolCallId ?? `fixture-hook-${++fixtureToolCallSequence}` }, context)
			: handler);
	},
	registerCommand(name, definition) {
		commands.set(name, definition);
	},
	registerTool(definition) {
		tools.set(definition.name, definition);
	},
	getActiveTools() {
		return [...activeTools];
	},
	getAllTools() {
		return allTools;
	},
	setActiveTools(names) {
		activeTools = [...names];
		setActiveCalls.push([...names]);
	},
	appendEntry(customType, data) {
		sessionEntries.push({ type: "custom", customType, data });
	},
	events: piEvents,
	async exec(command, args) {
		execCalls.push([command, [...args]]);
		if (command !== "git") return { stdout: "", stderr: "", code: 1 };
		return gitResponses.get(args.join(" ")) ?? { stdout: "", stderr: "", code: 0 };
	},
};

plannerOnly(pi);
assert.equal(handlers.has("session_start"), true);
assert.equal(handlers.has("session_shutdown"), true);
assert.equal(handlers.has("before_agent_start"), true);
assert.equal(handlers.has("tool_call"), true);
assert.equal(commands.has("planner-only"), true);
assert.equal(tools.has("git_audit"), true);
assert.equal(tools.has("planner_verdict"), true);

const ui = {
	notify(message, type) {
		notices.push({ message, type });
	},
	setStatus() {},
	theme: { fg(_color, text) { return text; } },
};
const ctx = {
	hasUI: true,
	isIdle() { return true; },
	ui,
	cwd: process.cwd(),
	sessionManager: {
		getEntries() { return sessionEntries; },
		getSessionFile() { return join(isolatedAgentDir, "sessions", "test.jsonl"); },
	},
};

await handlers.get("session_start")({}, ctx);
assert.deepEqual(activeTools, [
	"read",
	"bash",
	"write",
	"subagent",
	"custom_mutator",
	"git_audit",
	"planner_verdict",
]);
assert.equal(setActiveCalls.length, 0);



// Issue 13B: status exposes session totals and keeps pre-Task Root usage unattributed.
await handlers.get("message_end")({ message: {
	role: "assistant", id: "msg-budget-session", model: "test-model",
	usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.04 }, content: "before task",
} }, ctx);
notices.length = 0;
await commands.get("planner-only").handler("status", ctx);
const budgetStatus = notices.at(-1).message;
assert.equal(budgetStatus.includes("Session usage: tokens=15，已知费用 $0.0400，未知项 0 项"), true);
assert.equal(budgetStatus.includes("Unattributed (会话级，未归入任何 Task): 1 turns, tokens=15, 费用 $0.0400"), true);

await handlers.get("message_end")({ message: {
	role: "assistant", id: "msg-budget-task", model: "test-model",
	usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.05 }, content: "task usage",
} }, ctx);

// L73 — a Root turn spanning multiple Tasks is attributed shared across all
// of them; collapsing onto the most recent delegation target is forbidden.
// (No Task can be minted post-cutover, so this turn stays unattributed too.)
await handlers.get("message_end")({ message: {
	role: "assistant", id: "msg-shared-turn", model: "test-model",
	usage: { input: 7, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01 }, content: "two tasks in one turn",
} }, ctx);

notices.length = 0;
await commands.get("planner-only").handler(`usage summary ${join(isolatedAgentDir, "missing-runs")}`, ctx);
assert.equal(notices.at(-1).type, "warning");
assert.match(notices.at(-1).message, /no run records/);

const blocked = await handlers.get("tool_call")(
	{ toolName: "write", input: { path: "/tmp/x" } },
	ctx,
);
assert.equal(blocked.block, true);

const auditAllowed = await handlers.get("tool_call")(
	{ toolName: "git_audit", input: { operation: "status" } },
	ctx,
);
assert.equal(auditAllowed, undefined);
const verdictAllowed = await handlers.get("tool_call")(
	{ toolName: "planner_verdict", input: { verdict: "pass", summary: "policy check" } },
	ctx,
);
assert.equal(verdictAllowed, undefined, "the policy never blocks planner_verdict");

activeTools.push("edit");
await handlers.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
assert.equal(activeTools.includes("edit"), true, "setActiveTools is not used; policy blocks Root mutators");

const prompt = await handlers.get("before_agent_start")({ systemPrompt: "BASE" }, ctx);
assert.match(prompt.systemPrompt, /^BASE/);
assert.match(prompt.systemPrompt, /plan, delegate, inspect read-only, review, and arbitrate/);
assert.match(prompt.systemPrompt, /WorkerReport/);
assert.match(prompt.systemPrompt, /Top-level status must be exactly completed\/partial\/blocked\/failed/);
assert.match(prompt.systemPrompt, /validation status must be exactly passed\/failed\/not-run/);
assert.match(prompt.systemPrompt, /git_audit/);
assert.match(prompt.systemPrompt, /Never fix rejected work/);
// R02 — the workflowScript ban merged into the role line (authorized cut).
assert.match(prompt.systemPrompt, /never pre-compose worker→reviewer as a workflowScript or chain/);
assert.match(prompt.systemPrompt, /canonical taskId in details/);
assert.match(prompt.systemPrompt, /One bounded TaskSpec per planner_delegate call/);
assert.match(prompt.systemPrompt, /the reviewer runs via planner_redelegate only after the worker returns, in a separate call/);
assert.doesNotMatch(prompt.systemPrompt, /diffStat/);
assert.doesNotMatch(prompt.systemPrompt, /\/planner-only/);

const subagentBlocked = await handlers.get("tool_call")(
	{ toolName: "subagent", input: { agent: "worker", task: "anything" } },
	ctx,
);
assert.equal(subagentBlocked.block, true);
assert.match(subagentBlocked.reason, /may not call 'subagent'/);

await handlers.get("session_shutdown")({}, ctx);
assert.deepEqual(activeTools, [
	"read",
	"bash",
	"write",
	"subagent",
	"custom_mutator",
	"git_audit",
	"planner_verdict",
	"edit",
]);

assert.deepEqual(
	filterPlannerTools(["bash", "read", "write"]),
	["read"],
);
assert.equal(
	filterPlannerTools(["bash", "read", "write"]).includes("grep"),
	false,
);
const suppressed = ["bash", "write", "edit"];
assert.deepEqual(
	restorePlannerTools(["read", "subagent"], suppressed),
	["read", "subagent", "bash", "write", "edit"],
);

const childProbe = spawnSync(
	process.execPath,
	[
		"--input-type=module",
		"--eval",
		`import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};
		let calls = 0;
		plannerOnly({ on() { calls++; }, registerCommand() { calls++; } });
		if (calls !== 0) process.exit(1);`,
	],
	{
		env: { ...process.env, PI_SUBAGENT_CHILD: "1" },
		encoding: "utf8",
	},
);
assert.ifError(childProbe.error);
assert.equal(childProbe.signal, null);
assert.equal(childProbe.status, 0, childProbe.stderr || childProbe.stdout);

const userMarker = join(homedir(), ".pi", "agent", "planner-only.off");
const userMarkerWasPresent = existsSync(userMarker);
const fixtureAgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-"));
try {
	const toggleProbe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { existsSync } from "node:fs";
			import { join } from "node:path";
			import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};

			const handlers = new Map();
			const commands = new Map();
			const tools = new Map();
			let activeTools = ["read", "bash", "write", "subagent"];
			const allTools = [
				{ name: "read" }, { name: "grep" }, { name: "find" }, { name: "ls" },
				{ name: "bash" }, { name: "write" }, { name: "edit" }, { name: "subagent" },
				{ name: "other_extension_tool" },
			];
			const pi = {
				on(name, handler) { handlers.set(name, handler); },
				registerCommand(name, definition) { commands.set(name, definition); },
				registerTool(definition) { tools.set(definition.name, definition); },
				getActiveTools() { return [...activeTools]; },
				getAllTools() { return allTools; },
				setActiveTools(names) { activeTools = [...names]; },
				async exec() { return { stdout: "", stderr: "", code: 0 }; },
			};
			const ctx = {
				hasUI: false,
				ui: { notify() {}, setStatus() {}, theme: { fg(_color, text) { return text; } } },
			};

			plannerOnly(pi);
			await handlers.get("session_start")({}, ctx);
			assert.deepEqual(activeTools, ["read", "bash", "write", "subagent"]);

			activeTools.push("other_extension_tool");
			await commands.get("planner-only").handler("off", ctx);
			assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "planner-only.off")), true);
			assert.deepEqual(activeTools, [
				"read", "bash", "write", "subagent", "other_extension_tool",
			]);

			await commands.get("planner-only").handler("on", ctx);
			assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "planner-only.off")), false);
			assert.deepEqual(activeTools, [
				"read", "bash", "write", "subagent", "other_extension_tool",
			]);
			console.log("planner-only toggle: PASS");`,
		],
		{
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: fixtureAgentDir,
				PI_PLANNER_ONLY: "1",
				PI_SUBAGENT_CHILD: "0",
			},
			encoding: "utf8",
		},
	);
	assert.ifError(toggleProbe.error);
	assert.equal(toggleProbe.signal, null);
	assert.equal(toggleProbe.status, 0, toggleProbe.stderr || toggleProbe.stdout);
	assert.match(toggleProbe.stdout, /planner-only toggle: PASS/);
} finally {
	rmSync(fixtureAgentDir, { recursive: true, force: true });
}
assert.equal(existsSync(fixtureAgentDir), false);
assert.equal(existsSync(userMarker), userMarkerWasPresent);

// --------------------------------------------------------------------------
// RF-4: D1 & D2 per-session force-on and status source reporting
// --------------------------------------------------------------------------

const rf4AgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-rf4-"));
try {
	const rf4Probe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { rmSync, writeFileSync } from "node:fs";
			import { join } from "node:path";
			import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};

			function makePi(initialActive) {
				const handlers = new Map();
				const commands = new Map();
				let active = [...initialActive];
				return {
					handlers,
					commands,
					getActive() { return active; },
					pi: {
						on(name, h) { handlers.set(name, h); },
						registerCommand(name, def) { commands.set(name, def); },
						registerTool() {},
						getActiveTools() { return [...active]; },
						getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
						setActiveTools(names) { active = [...names]; },
						async exec() { return { stdout: "", stderr: "", code: 0 }; },
					},
				};
			}

			const markerPath = join(process.env.PI_CODING_AGENT_DIR, "planner-only.off");

			// D1: marker present + PI_PLANNER_ONLY=1 -> guard on (env), schema not stripped
			process.env.PI_PLANNER_ONLY = "1";
			writeFileSync(markerPath, "Disabled\\n");
			const d1 = makePi(["read", "bash", "subagent", "write"]);
			plannerOnly(d1.pi);
			const notices1 = [];
			const ctx1 = { hasUI: true, ui: { notify(msg) { notices1.push(msg); }, setStatus() {}, theme: { fg(_c, t) { return t; } } } };
			await d1.handlers.get("session_start")({}, ctx1);
			assert.deepEqual(d1.getActive(), ["read", "bash", "subagent", "write"]);
			await d1.commands.get("planner-only").handler("status", ctx1);
			assert.match(notices1.at(-1), /Planner-only mode is on \\(source: env\\)/);

			// D2: marker present + env unset -> tools unrestricted, status source: marker
			delete process.env.PI_PLANNER_ONLY;
			const d2 = makePi(["read", "bash", "subagent", "write"]);
			plannerOnly(d2.pi);
			const notices2 = [];
			const ctx2 = { hasUI: true, ui: { notify(msg) { notices2.push(msg); }, setStatus() {}, theme: { fg(_c, t) { return t; } } } };
			await d2.handlers.get("session_start")({}, ctx2);
			assert.deepEqual(d2.getActive(), ["read", "bash", "subagent", "write"]);
			await d2.commands.get("planner-only").handler("status", ctx2);
			assert.match(notices2.at(-1), /Planner-only mode is off \\(source: marker\\)/);

			// Default: no marker + env unset -> guard on (default), schema not stripped
			rmSync(markerPath);
			const d3 = makePi(["read", "bash", "subagent", "write"]);
			plannerOnly(d3.pi);
			const notices3 = [];
			const ctx3 = { hasUI: true, ui: { notify(msg) { notices3.push(msg); }, setStatus() {}, theme: { fg(_c, t) { return t; } } } };
			await d3.handlers.get("session_start")({}, ctx3);
			assert.deepEqual(d3.getActive(), ["read", "bash", "subagent", "write"]);
			await d3.commands.get("planner-only").handler("status", ctx3);
			assert.match(notices3.at(-1), /Planner-only mode is on \\(source: default\\)/);

			console.log("planner-only rf4: PASS");`,
		],
		{
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: rf4AgentDir,
				PI_SUBAGENT_CHILD: "0",
			},
			encoding: "utf8",
		},
	);
	assert.ifError(rf4Probe.error);
	assert.equal(rf4Probe.signal, null);
	assert.equal(rf4Probe.status, 0, rf4Probe.stderr || rf4Probe.stdout);
	assert.match(rf4Probe.stdout, /planner-only rf4: PASS/);
} finally {
	rmSync(rf4AgentDir, { recursive: true, force: true });
}

// --------------------------------------------------------------------------
// T02-T04: restore keeps operator/extension/environment intent; headless status
// --------------------------------------------------------------------------

const t05AgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-t05-"));
try {
	const t05Probe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { join } from "node:path";
			import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};

			const handlers = new Map();
			const commands = new Map();
			let registered = ["read", "bash", "write", "edit", "custom_mutator", "subagent"];
			let active = ["read", "bash", "write", "custom_mutator", "subagent"];
			const sent = [];
			const pi = {
				on(name, h) { handlers.set(name, h); },
				registerCommand(name, def) { commands.set(name, def); },
				registerTool() {},
				getActiveTools() { return [...active]; },
				getAllTools() { return registered.map((name) => ({ name })); },
				setActiveTools(names) { active = [...names]; },
				sendMessage(message) { sent.push(message); },
				async exec() { return { stdout: "", stderr: "", code: 0 }; },
			};
			const ctx = { hasUI: false, ui: { notify() {}, setStatus() {}, theme: { fg(_c, t) { return t; } } } };

			plannerOnly(pi);
			await handlers.get("session_start")({}, ctx);
			assert.deepEqual([...active].sort(), ["bash", "custom_mutator", "read", "subagent", "write"], "session start does not strip the parent schema");
			assert.equal(active.includes("edit"), false, "a tool the operator disabled before on stays disabled");

			// while on, another extension disables a currently-active safe tool
			active = active.filter((name) => name !== "read");

			// and custom_mutator is unregistered entirely
			registered = registered.filter((name) => name !== "custom_mutator");

			await commands.get("planner-only").handler("off", ctx);
			assert.deepEqual([...active].sort(), ["bash", "custom_mutator", "subagent", "write"],
				"off does not rewrite tools this extension never stripped");
			assert.equal(active.includes("read"), false, "another extension's disable is not reverted");
			assert.equal(active.includes("edit"), false);

			await commands.get("planner-only").handler("on", ctx);
			assert.deepEqual([...active].sort(), ["bash", "custom_mutator", "subagent", "write"], "on does not strip the parent schema");

			console.log("planner-only t05 restore: PASS");`,
		],
		{
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: t05AgentDir,
				PI_SUBAGENT_CHILD: "0",
			},
			encoding: "utf8",
		},
	);
	assert.ifError(t05Probe.error);
	assert.equal(t05Probe.signal, null);
	assert.equal(t05Probe.status, 0, t05Probe.stderr || t05Probe.stdout);
	assert.match(t05Probe.stdout, /planner-only t05 restore: PASS/);
} finally {
	rmSync(t05AgentDir, { recursive: true, force: true });
}

const t05bAgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-t05b-"));
try {
	const t05bProbe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { existsSync, writeFileSync } from "node:fs";
			import { join } from "node:path";
			import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};

			const handlers = new Map();
			const commands = new Map();
			let active = ["read", "bash", "subagent"];
			const sent = [];
			const pi = {
				on(name, h) { handlers.set(name, h); },
				registerCommand(name, def) { commands.set(name, def); },
				registerTool() {},
				getActiveTools() { return [...active]; },
				getAllTools() { return ["read", "bash", "subagent"].map((name) => ({ name })); },
				setActiveTools(names) { active = [...names]; },
				sendMessage(message) { sent.push(message); },
				async exec() { return { stdout: "", stderr: "", code: 0 }; },
			};
			const ctx = { hasUI: false, ui: { notify() {}, setStatus() {}, theme: { fg(_c, t) { return t; } } } };

			plannerOnly(pi);

			// T04: environment-forced off — on must say it stays off and name the source
			process.env.PI_PLANNER_ONLY = "0";
			await commands.get("planner-only").handler("on", ctx);
			const onNotice = sent.at(-1);
			assert.match(onNotice.content, /remains off/);
			assert.match(onNotice.content, /PI_PLANNER_ONLY=0 forces planner-only off/);
			assert.deepEqual(active, ["read", "bash", "subagent"], "forced-off on must not restrict tools");

			// headless status names the effective state and its source
			await commands.get("planner-only").handler("status", ctx);
			assert.match(sent.at(-1).content, /Planner-only mode is off \\(source: env\\)/);
			assert.match(sent.at(-1).content, /PI_PLANNER_ONLY=0 forces planner-only off/);
			assert.match(sent.at(-1).content, /Oracle suite: bounded/);

			// marker source is reported headless too
			delete process.env.PI_PLANNER_ONLY;
			const markerPath = join(process.env.PI_CODING_AGENT_DIR, "planner-only.off");
			writeFileSync(markerPath, "off\\n");
			await commands.get("planner-only").handler("status", ctx);
			assert.match(sent.at(-1).content, /Planner-only mode is off \\(source: marker\\)/);
			assert.ok(existsSync(markerPath));

			// oracle suite full env
			process.env.PI_PLANNER_ONLY_ORACLE = "full";
			await commands.get("planner-only").handler("status", ctx);
			assert.match(sent.at(-1).content, /Oracle suite: full/);
			delete process.env.PI_PLANNER_ONLY_ORACLE;

			console.log("planner-only t05 env: PASS");`,
		],
		{
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: t05bAgentDir,
				PI_PLANNER_ONLY: "0",
				PI_SUBAGENT_CHILD: "0",
			},
			encoding: "utf8",
		},
	);
	assert.ifError(t05bProbe.error);
	assert.equal(t05bProbe.signal, null);
	assert.equal(t05bProbe.status, 0, t05bProbe.stderr || t05bProbe.stdout);
	assert.match(t05bProbe.stdout, /planner-only t05 env: PASS/);
} finally {
	rmSync(t05bAgentDir, { recursive: true, force: true });
}


// p07-r033: Root remains host-controlled while status reports requested policy values.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		rootModel: process.env.PI_PLANNER_ONLY_MODEL_ROOT,
		rootThinking: process.env.PI_PLANNER_ONLY_THINKING_ROOT,
	};
	const originalModel = ctx.model;
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_ROOT = "policy-test/root";
		process.env.PI_PLANNER_ONLY_THINKING_ROOT = "off";
		await commands.get("planner-only").handler("status", ctx);
		assert.match(notices.at(-1).message, /root: model=policy-test\/root thinking=off/);
		assert.match(notices.at(-1).message, /（策略配置值；root 不经委派，此值不改变实际运行的模型）/);
		assert.match(notices.at(-1).message, /实际运行的 root: 未知（宿主未提供 ctx\.model）/);
		assert.doesNotMatch(notices.at(-1).message, /root 策略配置与实际运行的模型不一致/);
		assert.doesNotMatch(notices.at(-1).message, /Root .*已切换|Root.*switched/);
		assert.equal(ctx.model, originalModel, "status must not mutate the host Root model");
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_ROOT: saved.rootModel,
			PI_PLANNER_ONLY_THINKING_ROOT: saved.rootThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

// p18-r084: Status distinguishes configured Root policy from actual host identity.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		rootModel: process.env.PI_PLANNER_ONLY_MODEL_ROOT,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_ROOT = "policy-test/root";
		ctx.model = { provider: "actual", id: "root" };
		notices.length = 0;
		await commands.get("planner-only").handler("status", ctx);
		assert.match(notices.at(-1).message, /root 策略配置与实际运行的模型不一致/);

		ctx.model = { provider: "policy-test", id: "root" };
		notices.length = 0;
		await commands.get("planner-only").handler("status", ctx);
		assert.doesNotMatch(notices.at(-1).message, /root 策略配置与实际运行的模型不一致/);

		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "0";
		delete ctx.model;
		notices.length = 0;
		await commands.get("planner-only").handler("status", ctx);
		assert.match(notices.at(-1).message, /实际运行的 root: 未知（宿主未提供 ctx\.model）/);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_ROOT: saved.rootModel,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

// --------------------------------------------------------------------------
// v0.2 lifecycle: git_audit, delegation, worker reports, review commands
// --------------------------------------------------------------------------
// --------------------------------------------------------------------------

const { hashStatus } = await import("./evidence.ts");
const emptyStatus = "";
// A fixture worktree whose changes are exactly what the worker will report.
const cleanStatus = [
	"1 .M N... 100644 100644 100644 1111111 2222222 src/parser.ts",
	"1 .M N... 100644 100644 100644 3333333 4444444 src/parser.test.ts",
	"",
].join("\n");
gitResponses.set("rev-parse --git-dir", { stdout: ".git\n", stderr: "", code: 0 });
gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
const cleanHash = hashStatus(cleanStatus);

// git_audit is a registered tool with bounded, read-only execution
const audit = tools.get("git_audit");
assert.equal(audit.name, "git_audit");
assert.match(audit.description, /Read-only/);
assert.match(audit.description, /never mutates/);
const headResult = await audit.execute("call-1", { operation: "head" }, undefined, undefined, ctx);
assert.equal(headResult.details.ok, true);
assert.match(headResult.content[0].text, /abc1234/);
assert.ok(execCalls.some(([command, args]) => command === "git" && args.join(" ") === "rev-parse HEAD"));

const deniedAudit = await audit.execute("call-2", { operation: "reset --hard" }, undefined, undefined, ctx);
assert.equal(deniedAudit.details.ok, false);
assert.match(deniedAudit.content[0].text, /forbids the mutating git operation/);

const truncatedAudit = await audit.execute(
	"call-3",
	{ operation: "log", maxEntries: 99999 },
	undefined,
	undefined,
	ctx,
);
assert.equal(truncatedAudit.details.ok, true);

// --------------------------------------------------------------------------
// v0.3 V-1/V-2: planner_verdict tool, prompt bound, operator override
// --------------------------------------------------------------------------

const verdictTool = tools.get("planner_verdict");
assert.equal(verdictTool.name, "planner_verdict");
assert.equal(verdictTool.label, "Planner Verdict");

// I-1: PLANNER_PROMPT UTF-8 bound and §3.1 contracts (semantic fragments, not a snapshot)
assert.ok(
	Buffer.byteLength(PLANNER_PROMPT, "utf8") <= 1800,
	`PLANNER_PROMPT is ${Buffer.byteLength(PLANNER_PROMPT, "utf8")} UTF-8 bytes`,
);
assert.match(PLANNER_PROMPT, /plan, delegate, inspect read-only, review, and arbitrate/);
assert.match(PLANNER_PROMPT, /Do not edit or write files, run a general shell, or implement fixes/);
assert.match(PLANNER_PROMPT, /One bounded TaskSpec per planner_delegate call/);
assert.match(PLANNER_PROMPT, /canonical taskId in details/);
assert.match(PLANNER_PROMPT, /WorkerReport version 1/);
assert.match(PLANNER_PROMPT, /changedFiles, validation plus exit codes, evidence, risks, and unresolved items/);
assert.match(PLANNER_PROMPT, /record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict/);
assert.match(PLANNER_PROMPT, /context=fresh/);
assert.match(PLANNER_PROMPT, /validator → oracle/);
assert.match(PLANNER_PROMPT, /workflowScript/);
assert.match(PLANNER_PROMPT, /Never trust a worker PASS/);
assert.match(PLANNER_PROMPT, /Never accept stale evidence/);
assert.match(PLANNER_PROMPT, /Stop after 3 review rounds/);
assert.match(PLANNER_PROMPT, /one ticket per TaskSpec/);
assert.match(PLANNER_PROMPT, /Do not instruct workers to \/code-review/);
assert.match(PLANNER_PROMPT, /PI_PLANNER_ONLY_ORACLE=full/);
assert.match(PLANNER_PROMPT, /Lifecycle state arrives in delegation results; the operator may override a verdict, you record yours with planner_verdict\./);
assert.doesNotMatch(PLANNER_PROMPT, /\/planner-only/);
assert.doesNotMatch(PLANNER_PROMPT, /record a verdict or switch/);

// unknown taskId -> isError, nothing recorded
await assert.rejects(
	verdictTool.execute(
		"v-0",
		{ verdict: "pass", summary: "no such task", taskId: "T-20260905-nope" },
		undefined,
		undefined,
		ctx,
	),
	(error) => {
		assert.match(error.message, /unknown task T-20260905-nope/);
		assert.match(error.message, /planner_verdict/);
		return true;
	},
);
// --------------------------------------------------------------------------
// U-5 — Usage reporting, decision block usage line, and soft budget warning
// --------------------------------------------------------------------------


{
	const marker = join(isolatedAgentDir, "planner-only", "session-root-budget.on");
	notices.length = 0;
	await commands.get("planner-only").handler("budget", ctx);
	assert.match(notices.at(-1).message, /会话 root 预算未开启/);
	assert.equal(existsSync(marker), false);

	notices.length = 0;
	await commands.get("planner-only").handler("budget on", ctx);
	assert.match(notices.at(-1).message, /Session root budget enabled/);
	assert.doesNotMatch(notices.at(-1).message, /会话 root 预算未开启/);
	assert.equal(existsSync(marker), true, "budget on persists an on-marker");

	notices.length = 0;
	await commands.get("planner-only").handler("status", ctx);
	assert.doesNotMatch(notices.at(-1).message, /会话 root 预算未开启/);
	assert.match(notices.at(-1).message, /软顶 ×3/);

	notices.length = 0;
	await commands.get("planner-only").handler("budget nope", ctx);
	assert.match(notices.at(-1).message, /Usage: \/planner-only budget \[on\|off\]/);

	const savedBudgetEnv = process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET;
	try {
		process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET = "0";
		notices.length = 0;
		await commands.get("planner-only").handler("budget on", ctx);
		assert.match(notices.at(-1).message, /Session root budget remains off/);
		assert.match(notices.at(-1).message, /PI_PLANNER_ONLY_SESSION_ROOT_BUDGET/);
	} finally {
		if (savedBudgetEnv === undefined) delete process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET;
		else process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET = savedBudgetEnv;
	}

	notices.length = 0;
	await commands.get("planner-only").handler("budget off", ctx);
	assert.match(notices.at(-1).message, /Session root budget disabled/);
	assert.match(notices.at(-1).message, /会话 root 预算未开启/);
	assert.equal(existsSync(marker), false);

	try {
		process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET = "1";
		notices.length = 0;
		await commands.get("planner-only").handler("budget off", ctx);
		assert.match(notices.at(-1).message, /Session root budget remains on/);
	} finally {
		if (savedBudgetEnv === undefined) delete process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET;
		else process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET = savedBudgetEnv;
		await commands.get("planner-only").handler("budget off", ctx);
	}
}

// --------------------------------------------------------------------------
// Issue 05 & Ticket 40: startup env-var validation (floor + session-root budget)
// --------------------------------------------------------------------------

{
	// Issue 05: startup fails when the session-base env var (formerly the
	// worker-initial floor var) is set to empty or invalid.
	const savedEnv = process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD;
	try {
		process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD = "";
		assert.throws(() => {
			plannerOnly({
				on() {},
				registerCommand() {},
				registerTool() {},
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});
		}, /PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD is set but empty/);

		process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD = "not-a-number";
		assert.throws(() => {
			plannerOnly({
				on() {},
				registerCommand() {},
				registerTool() {},
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});
		}, /is invalid; must be a positive finite number/);
	} finally {
		if (savedEnv !== undefined) {
			process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD = savedEnv;
		} else {
			delete process.env.PI_PLANNER_ONLY_FLOOR_WORKER_TOKENS_HARD;
		}
	}
}

{
	// Ticket 40: invalid session root multipliers reject initialization, not live handlers.
	const SOFT = "PI_PLANNER_ONLY_SESSION_ROOT_SOFT_MULTIPLIER";
	const HARD = "PI_PLANNER_ONLY_SESSION_ROOT_HARD_MULTIPLIER";
	const ENABLED = "PI_PLANNER_ONLY_SESSION_ROOT_BUDGET";
	const saved = { [SOFT]: process.env[SOFT], [HARD]: process.env[HARD], [ENABLED]: process.env[ENABLED] };
	const bareHost = () => ({
		on() {},
		registerCommand() {},
		registerTool() {},
		exec: async () => ({ stdout: "", stderr: "", code: 0 }),
	});
	try {
		process.env[SOFT] = "not-a-number";
		delete process.env[HARD];
		assert.throws(() => plannerOnly(bareHost()), /PI_PLANNER_ONLY_SESSION_ROOT_SOFT_MULTIPLIER.*is invalid/, "40-i1: invalid soft multiplier fails startup");

		process.env[SOFT] = "5";
		process.env[HARD] = "3";
		assert.throws(() => plannerOnly(bareHost()), /hard multiplier .* must be >= soft/, "40-i2: hard < soft fails startup");

		process.env[SOFT] = "2";
		process.env[HARD] = "";
		assert.throws(() => plannerOnly(bareHost()), /PI_PLANNER_ONLY_SESSION_ROOT_HARD_MULTIPLIER is set but empty/, "40-i3: empty hard multiplier fails startup");

		delete process.env[SOFT];
		delete process.env[HARD];
		process.env.PI_PLANNER_ONLY_SESSION_ROOT_BUDGET = "yes";
		assert.throws(() => plannerOnly(bareHost()), /PI_PLANNER_ONLY_SESSION_ROOT_BUDGET.*must be 1 or 0/, "40-i4: invalid enable flag fails startup");
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value !== undefined) process.env[key] = value;
			else delete process.env[key];
		}
	}
}


// --------------------------------------------------------------------------
// Issue 07: Root model with no pricing rate — startup & status warning
// --------------------------------------------------------------------------

const i07AgentDir = mkdtempSync(join(tmpdir(), "planner-only-test-i07-"));
try {
	const i07Probe = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import assert from "node:assert/strict";
			import { mkdirSync, writeFileSync } from "node:fs";
			import { join } from "node:path";
			import plannerOnly from ${JSON.stringify(new URL("./index.ts", import.meta.url).href)};

			delete process.env.PI_PLANNER_ONLY_PRICING;

			const agentDir = process.env.PI_CODING_AGENT_DIR;
			const defaultPricingPath = join(agentDir, "planner-only", "pricing.json");
			mkdirSync(join(agentDir, "planner-only"), { recursive: true });
			writeFileSync(defaultPricingPath, JSON.stringify({
				version: 1,
				currency: "USD",
				rates: {
					"test-priced/has-rate": { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 1.5 },
					"test-priced/zero-rate": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				},
			}));

			const WARN_RE = /\\[PLANNER-ONLY\\] Root model/;
			const frozenLine = (model, path) =>
				\`[PLANNER-ONLY] Root model \${model} has no rate in \${path}. Root cost will be recorded as unknown and excluded from totals. Set PI_PLANNER_ONLY_PRICING to use another file.\`;

			function makePi() {
				const handlers = new Map();
				const commands = new Map();
				let active = ["read", "bash", "subagent", "write"];
				const sent = [];
				return {
					handlers,
					commands,
					sent,
					pi: {
						on(name, h) { handlers.set(name, h); },
						registerCommand(name, def) { commands.set(name, def); },
						registerTool() {},
						getActiveTools() { return [...active]; },
						getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
						setActiveTools(names) { active = [...names]; },
						sendMessage(message) { sent.push(message); },
						async exec() { return { stdout: "", stderr: "", code: 0 }; },
					},
				};
			}

			function makeCtx(model, notices = []) {
				return {
					hasUI: true,
					cwd: process.cwd(),
					...(model !== undefined ? { model } : {}),
					ui: {
						notify(message, type) { notices.push({ message, type }); },
						setStatus() {},
						theme: { fg(_c, t) { return t; } },
					},
					notices,
				};
			}

			// 1. No rate: session_start warns with the frozen line naming the model
			//    and the resolved default pricing path; status repeats the same line.
			{
				const d = makePi();
				plannerOnly(d.pi);
				const ctx = makeCtx({ provider: "test-unpriced", id: "no-rate" });
				await d.handlers.get("session_start")({}, ctx);
				const expected = frozenLine("test-unpriced/no-rate", defaultPricingPath);
				const startNotice = ctx.notices.find((n) => WARN_RE.test(n.message));
				assert.ok(startNotice, "session_start must warn about the unpriced Root model");
				assert.equal(startNotice.type, "warning");
				assert.equal(startNotice.message, expected);

				ctx.notices.length = 0;
				await d.commands.get("planner-only").handler("status", ctx);
				const statusNotice = ctx.notices.at(-1);
				assert.ok(
					statusNotice.message.split("\\n").includes(expected),
					\`status body must contain the frozen line: \${statusNotice.message}\`,
				);
			}

			// 2. Priced model (and a zero-rate model): no warning anywhere.
			{
				const d = makePi();
				plannerOnly(d.pi);
				for (const model of [
					{ provider: "test-priced", id: "has-rate" },
					{ provider: "test-priced", id: "zero-rate" },
				]) {
					const ctx = makeCtx(model);
					await d.handlers.get("session_start")({}, ctx);
					assert.equal(ctx.notices.some((n) => WARN_RE.test(n.message)), false,
						\`no startup warning for priced model \${model.id}\`);
					await d.commands.get("planner-only").handler("status", ctx);
					assert.equal(ctx.notices.some((n) => WARN_RE.test(n.message)), false,
						\`no status warning for priced model \${model.id}\`);
				}
			}

			// 3. Mid-session switch: start priced, model_select to unpriced, next
			//    status warns even when the command ctx carries no model.
			{
				const d = makePi();
				plannerOnly(d.pi);
				assert.equal(d.handlers.has("model_select"), true, "the public model_select event is registered");
				const ctx = makeCtx({ provider: "test-priced", id: "has-rate" });
				await d.handlers.get("session_start")({}, ctx);
				assert.equal(ctx.notices.some((n) => WARN_RE.test(n.message)), false);
				await d.handlers.get("model_select")({ model: { provider: "test-unpriced", id: "no-rate" } }, ctx);
				const bareCtx = makeCtx(undefined);
				await d.commands.get("planner-only").handler("status", bareCtx);
				const statusNotice = bareCtx.notices.at(-1);
				assert.ok(
					statusNotice.message.split("\\n").includes(frozenLine("test-unpriced/no-rate", defaultPricingPath)),
					\`status after model_select must warn: \${statusNotice.message}\`,
				);
			}

			// 4. No ctx.model at all: stay silent.
			{
				const d = makePi();
				plannerOnly(d.pi);
				const ctx = makeCtx(undefined);
				await d.handlers.get("session_start")({}, ctx);
				assert.equal(ctx.notices.some((n) => WARN_RE.test(n.message)), false,
					"no warning when the host reports no model");
				await d.commands.get("planner-only").handler("status", ctx);
				assert.equal(ctx.notices.some((n) => WARN_RE.test(n.message)), false);
			}

			// 5. PI_PLANNER_ONLY_PRICING override: the warning names the override
			//    path, and headless delivery goes through sendMessage.
			{
				const overridePath = join(agentDir, "override-pricing.json");
				writeFileSync(overridePath, JSON.stringify({ version: 1, currency: "USD", rates: {} }));
				process.env.PI_PLANNER_ONLY_PRICING = overridePath;
				try {
					const d = makePi();
					plannerOnly(d.pi);
					const headlessCtx = {
						hasUI: false,
						cwd: process.cwd(),
						model: { provider: "test-unpriced", id: "no-rate" },
						ui: { notify() {}, setStatus() {}, theme: { fg(_c, t) { return t; } } },
					};
					await d.handlers.get("session_start")({}, headlessCtx);
					const sentNotice = d.sent.at(-1);
					assert.ok(sentNotice, "headless warning must use sendMessage");
					assert.equal(
						sentNotice.content,
						frozenLine("test-unpriced/no-rate", overridePath),
						"the warning names the override pricing path",
					);
				} finally {
					delete process.env.PI_PLANNER_ONLY_PRICING;
				}
			}

			console.log("planner-only issue07 root rate warning: PASS");`,
		],
		{
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: i07AgentDir,
				PI_SUBAGENT_CHILD: "0",
			},
			encoding: "utf8",
		},
	);
	assert.ifError(i07Probe.error);
	assert.equal(i07Probe.signal, null);
	assert.equal(i07Probe.status, 0, i07Probe.stderr || i07Probe.stdout);
	assert.match(i07Probe.stdout, /planner-only issue07 root rate warning: PASS/);
} finally {
	rmSync(i07AgentDir, { recursive: true, force: true });
}

// p07-r029: model policy never changes Root write-tool capability.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		model: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		thinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "on";
		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium";
		const rootWrite = await handlers.get("tool_call")({ toolName: "write", input: { path: "x" } }, ctx);
		assert.equal(rootWrite.block, true);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.model,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.thinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
}

// ---------------------------------------------------------------------------
// ticket 07 test 9: index.ts wiring over the real host launcher, driven by
// the fake pi's event bus. (a) an identity-matched UPDATE reaches execute's
// onUpdate as a progress partial; (b) session_shutdown CANCELS an in-flight
// delegation. Both reachable in Idle — planner_delegate mints its own Task.
// ---------------------------------------------------------------------------
{
	assert.equal(tools.has("planner_delegate"), true);

	const seenReqIds = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const requestSeen = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seenReqIds.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seenReqIds.add(found.requestId);
		return found;
	};

	// Ticket 02 (root-stamped-run-identity) — launcher starts child without legacy capability rejection gate.
	const capFreeExec = tools.get("planner_delegate").execute(
		"call-capfree-init",
		{
			role: "worker",
			objective: "attempt without capability gate",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		() => {},
		ctx,
	);
	const capReq = await requestSeen();
	assert.ok(capReq, "REQUEST emitted without capability gate");
	assert.ok(capReq.nodeId, "taskId exists");
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: capReq.requestId,
		ownerRunId: capReq.ownerRunId,
		nodeId: capReq.nodeId,
		status: "completed",
		runId: "run-capfree-init",
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: capReq.nodeId,
				status: "completed",
				summary: "done",
				changedFiles: [],
				validation: [],
				evidence: { cwd: capReq.cwd, taskId: capReq.nodeId },
				risks: [],
				unresolved: [],
			},
		},
	});
	const capFreeRes = await capFreeExec;
	assert.ok(capFreeRes.details.taskId);
	assert.equal(capFreeRes.details.report?.evidence?.workerRunId, "run-capfree-init");

	// (a) UPDATE -> onUpdate once, marked as progress; completed RESPONSE
	//     settles the call with the structured WorkerReport in details.report.
	const updates = [];
	const execPromise = tools.get("planner_delegate").execute(
		"call-progress-1",
		{
			role: "worker",
			objective: "emit progress then complete",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		(partial) => updates.push(partial),
		ctx,
	);
	const request = await requestSeen();
	const triple = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
	piEvents.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...triple, currentTool: "bash", toolCount: 3, durationMs: 2100 });
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		...triple,
		status: "completed",
		runId: "run-ix1",
		agent: "worker",
		model: "test/model",
		usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 15 },
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: triple.nodeId,
				status: "completed",
				summary: "done",
				changedFiles: [],
				validation: [],
				evidence: { cwd: request.cwd, taskId: triple.nodeId, workerRunId: "run-ix1" },
				risks: [],
				unresolved: [],
			},
		},
	});
	const toolResult = await execPromise;
	assert.equal(updates.length, 1, "one UPDATE forwarded to the execute onUpdate");
	assert.equal(updates[0].details.progress, true, "partial marked as progress");
	assert.equal(updates[0].details.taskId, triple.nodeId);
	assert.equal(updates[0].details.currentTool, "bash");
	assert.equal(toolResult.details.report.taskId, triple.nodeId, "terminal carries the structured report");

	// (b) a second delegation left in flight: session_shutdown emits CANCEL,
	//     then the cancelled terminal settles the wait (no dangling promise).
	const pendingExec = tools.get("planner_delegate").execute(
		"call-shutdown-1",
		{
			role: "worker",
			objective: "stay in flight until shutdown",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		() => {},
		ctx,
	);
	const pendingRequest = await requestSeen();
	assert.notEqual(pendingRequest.requestId, request.requestId, "a second delegation is in flight");
	const cancelsBefore = piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_CANCEL_EVENT).length;
	await handlers.get("session_shutdown")({}, ctx);
	const cancels = piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_CANCEL_EVENT);
	assert.ok(cancels.length > cancelsBefore, "session_shutdown emits CANCEL for the in-flight delegation");
	assert.ok(
		cancels.some((entry) => entry.payload.requestId === pendingRequest.requestId),
		"the CANCEL names the in-flight requestId",
	);
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: pendingRequest.requestId,
		ownerRunId: pendingRequest.ownerRunId,
		nodeId: pendingRequest.nodeId,
		status: "cancelled",
		usage: { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 15 },
	});
	const cancelResult = await pendingExec;
	assert.equal(
		cancelResult.details.termination?.status,
		"cancelled",
		"P0-A: cancelled delegation returns structured termination details, not a thrown refusal",
	);
	assert.equal(cancelResult.details.termination?.reason, "operator_cancel");
	assert.equal(cancelResult.details.state, "blocked");
	const ledgerPath = join(isolatedAgentDir, "planner-only", "ledger", `${pendingRequest.nodeId}.json`);
	const snapshot = JSON.parse(readFileSync(ledgerPath, "utf8"));
	assert.equal(snapshot.task.usage.children.length, 1, "ledger file carries the cancelled child's usage row");
	assert.equal(snapshot.task.usage.children[0].outcome, "failed", "non-completed terminal lands as outcome=failed in the file");
	// The shutdown case closed its Request. Subsequent independent cases start
	// through the same trusted host boundary as a new operator prompt.
	await handlers.get("agent_settled")({}, ctx);
	await handlers.get("input")({ source: "interactive" }, ctx);
}

// --------------------------------------------------------------------------
// FP-1: createLoadedPluginFingerprint prefers sessionManager.getSessionId()
//       over the session-file stem, so provenance session= matches the
//       ownerRootSessionId that planner_delegate records in usage rows.
//       With only getSessionFile it falls back to the file-name stem.
// --------------------------------------------------------------------------
{
	const cwd = "/tmp/fp-probe";
	const fpWithManager = createLoadedPluginFingerprint({
		cwd,
		sessionManager: {
			getSessionId: () => "host10-x",
			getSessionFile: () => "/x/2026-09-15T00-00-00-000Z_host10-x.jsonl",
		},
	});
	assert.equal(fpWithManager.sessionId, "host10-x", "sessionId prefers sessionManager.getSessionId()");
	const fpFileOnly = createLoadedPluginFingerprint({
		cwd,
		sessionManager: {
			getSessionFile: () => "/x/2026-09-15T00-00-00-000Z_host10-x.jsonl",
		},
	});
	assert.equal(fpFileOnly.sessionId, "2026-09-15T00-00-00-000Z_host10-x", "sessionId falls back to the file-name stem");
}

// --------------------------------------------------------------------------
// P0-B e2e (tool wiring): envelope breach -> CANCEL -> worker_runaway ->
// recovery.required -> planner_verdict blocked + recovery{abort} consumes it;
// a retry path via planner_redelegate.recovery re-executes the same Task.
// --------------------------------------------------------------------------
{
	// (a) runaway + verdict-level abort.
	const runawayExec = tools.get("planner_delegate").execute(
		"call-wrc-1",
		{
			role: "worker",
			objective: "breach the token envelope",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			envelope: { maxTokens: 100 },
		},
		undefined,
		() => {},
		ctx,
	);
	const requestsBefore = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	const wrcRequest = await (async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			const all = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT);
			if (all.length > requestsBefore) found = all.at(-1).payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "a fresh REQUEST was emitted for the runaway delegation");
		return found;
	})();
	const wrcTriple = { requestId: wrcRequest.requestId, ownerRunId: wrcRequest.ownerRunId, nodeId: wrcRequest.nodeId };
	piEvents.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...wrcTriple, tokens: 5000 });
	const runawayResult = await (async () => {
		// The monitor aborts on the UPDATE; answer the CANCEL with a cancelled terminal.
		await new Promise((r) => setTimeout(r, 5));
		piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
			...wrcTriple,
			status: "cancelled",
			runId: "run-wrc",
			agent: "worker",
			usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 },
		});
		return runawayExec;
	})();
	assert.equal(runawayResult.details.termination?.reason, "worker_runaway", "tool wiring carries the runaway reason");
	assert.equal(runawayResult.details.termination?.anomaly?.signal, "tokens");
	assert.match(runawayResult.content[0].text, /recovery\.required/);
	const runawayLedger = JSON.parse(readFileSync(join(isolatedAgentDir, "planner-only", "ledger", `${wrcRequest.nodeId}.json`), "utf8"));
	assert.equal(runawayLedger.task.recovery.required, true);
	assert.equal(runawayLedger.task.recovery.executionId, "call-wrc-1");
	assert.equal(runawayLedger.task.executions[0].endedReason, "worker_runaway");

	// Recovery via planner_abort (ADR-0003 — verdict no longer carries one).
	const abortTool = tools.get("planner_abort");
	assert.ok(abortTool, "planner_abort is registered");
	assert.equal(verdictTool.parameters.properties.recovery, undefined, "planner_verdict exposes no recovery key");
	const verdictAbort = await abortTool.execute(
		"call-wrc-v1",
		{
			taskId: wrcRequest.nodeId,
			executionId: "call-wrc-1",
			reason: "needs manual triage",
			worktreeDecision: "manual",
			summary: "hand the runaway task to the operator",
		},
		undefined,
		() => {},
		ctx,
	);
	const afterAbort = JSON.parse(readFileSync(join(isolatedAgentDir, "planner-only", "ledger", `${wrcRequest.nodeId}.json`), "utf8"));
	assert.equal(afterAbort.task.recovery.required, false);
	assert.equal(afterAbort.task.recovery.nextAction, "abort");
	assert.equal(afterAbort.task.recoveryHistory[0].consumedBy, "planner_abort");
	assert.equal(afterAbort.task.state, "blocked", "planner_abort leaves the Task blocked for operator handling");

	// (b) runaway + delegate retry_same_plan retry completing the Task.
	const retryFirst = tools.get("planner_delegate").execute(
		"call-wrc-2",
		{
			role: "worker",
			objective: "breach, then retry",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			envelope: { maxTokens: 10 },
		},
		undefined,
		() => {},
		ctx,
	);
	const retryRequest = await (async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			const candidates = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT);
			found = candidates.at(-1)?.payload.requestId !== wrcRequest.requestId ? candidates.at(-1)?.payload : undefined;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		return found;
	})();
	const retryTriple = { requestId: retryRequest.requestId, ownerRunId: retryRequest.ownerRunId, nodeId: retryRequest.nodeId };
	piEvents.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...retryTriple, tokens: 500 });
	await new Promise((r) => setTimeout(r, 5));
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, { ...retryTriple, status: "cancelled", runId: "run-wrc2", agent: "worker" });
	const firstOutcome = await retryFirst;
	assert.equal(firstOutcome.details.termination?.reason, "worker_runaway");

	// Missing recovery on a required Task refuses.
	await assert.rejects(
		tools.get("planner_redelegate").execute("call-wrc-3", { taskId: retryRequest.nodeId, role: "worker", objective: "x", scope: {}, constraints: [], acceptanceCriteria: [], validation: { required: false } }, undefined, () => {}, ctx),
		/requires a RecoveryDecision/,
	);

	// Valid retry_same_plan → new execution on the same Task.
	const retryExec = tools.get("planner_redelegate").execute(
		"call-wrc-4",
		{
			taskId: retryRequest.nodeId,
			role: "worker",
			objective: "breach, then retry",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			recovery: { executionId: "call-wrc-2", action: "retry_same_plan", reason: "transient provider stall; retry with no envelope", worktreeDecision: "keep" },
		},
		undefined,
		() => {},
		ctx,
	);
	const retryRequest2 = await (async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			const candidates = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT);
			found = ![wrcRequest.requestId, retryRequest.requestId].includes(candidates.at(-1)?.payload.requestId) ? candidates.at(-1)?.payload : undefined;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		return found;
	})();
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: retryRequest2.requestId,
		ownerRunId: retryRequest2.ownerRunId,
		nodeId: retryRequest2.nodeId,
		status: "completed",
		runId: "run-wrc3",
		agent: "worker",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 5 },
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: retryRequest2.nodeId,
				status: "completed",
				summary: "recovered",
				changedFiles: [],
				validation: [],
				evidence: { cwd: retryRequest2.cwd, taskId: retryRequest2.nodeId, workerRunId: "run-wrc3" },
				risks: [],
				unresolved: [],
			},
		},
	});
	const retryOutcome = await retryExec;
	assert.equal(retryOutcome.details.report?.summary, "recovered");
	const retryLedger = JSON.parse(readFileSync(join(isolatedAgentDir, "planner-only", "ledger", `${retryRequest.nodeId}.json`), "utf8"));
	assert.equal(retryLedger.task.executions.length, 2, "the recovery produced a second execution on the same Task");
	assert.equal(retryLedger.task.recoveryHistory[0].consumedBy, "call-wrc-4");
	assert.equal(retryLedger.task.recovery.required, false);
}

// ---------------------------------------------------------------------------
// ticket 16: the repeated-refusal breaker. Three byte-identical
// planner_redelegate calls with an invented taskId refuse TASK_UNKNOWN each
// time; the 2nd carries a Repeat notice naming the previous toolCallId, the
// 3rd prepends STOP and notifies the UI, and the 4th is intercepted by the
// tool_call hook before execute. The launcher never runs and no Task mints.
// (Ticket 17: the binding surface is planner_redelegate — planner_delegate
//  has no taskId key and would mint instead of refusing.)
// ---------------------------------------------------------------------------
{
	const redelegateTool = tools.get("planner_redelegate");
	const ledgerDir = join(isolatedAgentDir, "planner-only", "ledger");
	const ledgerCount = () => (existsSync(ledgerDir) ? readdirSync(ledgerDir).filter((name) => name.endsWith(".json")).length : 0);
	const requestCount = () => piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	const breakerParams = {
		taskId: "T-20200101-001",
		role: "worker",
		objective: "breaker probe — invented taskId replayed verbatim",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
	};
	const ledgerBefore = ledgerCount();
	const requestsBefore = requestCount();
	notices.length = 0;

	// The host runs the tool_call hook, then execute: drive the same pair.
	const refused = async (toolCallId, params = breakerParams) => {
		const gate = await handlers.get("tool_call")(
			{ toolName: "planner_redelegate", input: params, toolCallId },
			ctx,
		);
		assert.equal(gate, undefined, `${toolCallId} still reaches execute`);
		try {
			await redelegateTool.execute(toolCallId, params, undefined, () => {}, ctx);
		} catch (error) {
			return error;
		}
		assert.fail("expected planner_redelegate to refuse");
	};

	const e1 = await refused("call-rb-1");
	assert.equal(e1.name, "DelegationRefused");
	assert.equal(e1.code, "TASK_UNKNOWN");
	assert.doesNotMatch(e1.message, /Repeat notice|STOP:/, "the first refusal is verbatim");

	const e2 = await refused("call-rb-2");
	assert.equal(e2.code, "TASK_UNKNOWN", "the breaker appends text without losing the refusal code");
	assert.match(e2.message, /Repeat notice: 本边界收到的规范化参数相同 \(observed boundary: root tool input; previous toolCallId: call-rb-1; refusal code: TASK_UNKNOWN; missing fields: none\)/);
	assert.match(e2.message, /Read back the arguments actually received at this boundary before calling again/);
	assert.match(e2.message, /planner_redelegate refused: unknown Task T-20200101-001/, "the original refusal text is kept, appended not replaced");

	const e3 = await refused("call-rb-3");
	assert.equal(e3.code, "TASK_UNKNOWN");
	assert.match(e3.message, /STOP: this exact call has now been refused 3 times with TASK_UNKNOWN\./);
	assert.match(e3.message, /Do not call planner_redelegate again with these arguments\./);
	assert.ok(
		notices.some((n) => n.type === "warning" && /planner_redelegate refused 3 times with identical arguments/.test(n.message)),
		"the third refusal also notifies the UI",
	);

	// Call 4 never reaches execute: the tool_call hook blocks it.
	const blocked = await handlers.get("tool_call")(
		{ toolName: "planner_redelegate", input: breakerParams, toolCallId: "call-rb-4" },
		ctx,
	);
	assert.equal(blocked.block, true);
	assert.equal(
		blocked.reason,
		"planner-only: identical call refused 3 times with TASK_UNKNOWN; blocked. Change the arguments or ask the user.",
	);
	assert.ok(
		notices.some((n) => n.type === "warning" && /Blocked parent tool: planner_redelegate/.test(n.message)),
		"the block is surfaced to the UI",
	);

	assert.equal(requestCount(), requestsBefore, "refused calls never reached the launcher");
	assert.equal(ledgerCount(), ledgerBefore, "no Task was minted");

	// A different argument set is a different key: still refused, count 1.
	const eOther = await refused("call-rb-5", { ...breakerParams, taskId: "T-20200101-002" });
	assert.equal(eOther.code, "TASK_UNKNOWN");
	assert.doesNotMatch(eOther.message, /Repeat notice/, "different params start a fresh streak");
}

// ---------------------------------------------------------------------------
// ticket 17: the delegation surface is split. planner_delegate always mints
// — a passthrough taskId/recovery is ignored with a disclosed warning, never
// refused; planner_redelegate requires the canonical taskId (TASK_REQUIRED)
// and an unknown one refuses TASK_UNKNOWN with the ticket-13/14 text.
// ---------------------------------------------------------------------------
let mintedTaskIdForListing; // ticket 18's planner_tasks block lists this Task
{
	const delegateTool = tools.get("planner_delegate");
	const redelegateTool = tools.get("planner_redelegate");
	assert.ok(redelegateTool, "planner_redelegate is registered");
	assert.equal(redelegateTool.label, "Planner Redelegate");

	const seenRequestIds = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const requestSeen17 = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seenRequestIds.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seenRequestIds.add(found.requestId);
		return found;
	};
	const requestCount17 = () => piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;

	// (a) a passthrough taskId + recovery on planner_delegate: ignored, a new
	//     Task mints, and the result discloses both.
	const mintExec = delegateTool.execute("call-split-1", {
		taskId: "T-20200101-009",
		recovery: { executionId: "call-x", action: "retry_same_plan", reason: "x", worktreeDecision: "keep" },
		role: "worker",
		objective: "split-surface probe — passthrough keys must be ignored",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
	}, undefined, () => {}, ctx);
	const mintRequest = await requestSeen17();
	const mintTriple = { requestId: mintRequest.requestId, ownerRunId: mintRequest.ownerRunId, nodeId: mintRequest.nodeId };
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		...mintTriple,
		status: "completed",
		runId: "run-split",
		agent: "worker",
		model: "test/model",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 1, durationMs: 5 },
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: mintTriple.nodeId,
				status: "completed",
				summary: "minted",
				changedFiles: [],
				validation: [],
				evidence: { cwd: mintRequest.cwd, taskId: mintTriple.nodeId, workerRunId: "run-split" },
				risks: [],
				unresolved: [],
			},
		},
	});
	const mintResult = await mintExec;
	assert.notEqual(mintResult.details.taskId, "T-20200101-009", "a new Task minted — the supplied id never reached binding");
	assert.match(mintResult.details.taskId, /^T-\d{8}-\d{3}$/, "details.taskId is the canonical minted id");
	assert.ok(
		mintResult.details.warnings.some((w) => w === "supplied taskId T-20200101-009 was ignored: planner_delegate always mints a new Task; use planner_redelegate to bind an existing one"),
		"the ignored taskId is disclosed in details.warnings",
	);
	assert.ok(
		mintResult.details.warnings.some((w) => /supplied recovery was ignored/.test(w)),
		"the ignored recovery is disclosed too",
	);
	assert.match(mintResult.content[0].text, /warning: supplied taskId T-20200101-009 was ignored/, "the warning is in the text the model reads");
	assert.match(mintResult.content[0].text, new RegExp(`^planner_delegate: ${mintResult.details.taskId} `), "the outcome line names the minting surface");
	mintedTaskIdForListing = mintResult.details.taskId;

	// (b) planner_redelegate without taskId never mints — TASK_REQUIRED, no launch.
	const requestsBefore17 = requestCount17();
	await assert.rejects(
		redelegateTool.execute("call-split-2", {
			role: "worker",
			objective: "rebind without id",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		}, undefined, () => {}, ctx),
		(error) => {
			assert.equal(error.name, "DelegationRefused");
			assert.equal(error.code, "TASK_REQUIRED");
			assert.match(error.message, /planner_redelegate refused: taskId is required/);
			assert.match(error.message, /never construct one/);
			return true;
		},
	);
	assert.equal(requestCount17(), requestsBefore17, "no launch, no Task minted");

	// (c) an unknown taskId on planner_redelegate refuses TASK_UNKNOWN — the
	//     ticket-13/14 guidance, surface-corrected (no "omit taskId" advice on
	//     a bind-only tool).
	await assert.rejects(
		redelegateTool.execute("call-split-3", {
			taskId: "T-20200101-777",
			role: "worker",
			objective: "x",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		}, undefined, () => {}, ctx),
		(error) => {
			assert.equal(error.code, "TASK_UNKNOWN");
			assert.equal(
				error.message,
				"planner_redelegate refused: unknown Task T-20200101-777; call planner_tasks to list live Tasks, or use planner_delegate to create a new one",
			);
			return true;
		},
	);
	// reviewer-role unknown binding keeps its own ticket-14 guidance.
	await assert.rejects(
		redelegateTool.execute("call-split-4", {
			taskId: "T-20200101-778",
			role: "reviewer",
			objective: "x",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		}, undefined, () => {}, ctx),
		(error) => {
			assert.equal(error.code, "TASK_UNKNOWN");
			assert.match(error.message, /planner_redelegate refused: unknown Task T-20200101-778; role=reviewer can only bind an existing Task — call planner_tasks to find its canonical taskId/);
			return true;
		},
	);
	assert.equal(requestCount17(), requestsBefore17, "no launch, no Task minted");
}

// ---------------------------------------------------------------------------
// ticket 18: planner_tasks — read-only live-Task lookup over memory ∪ ledger.
// The minted Task above is live (reviewing); a blocked+recovery ledger record
// the restore cap never adopted still lists with source "ledger". Listing
// never launches, mints, or restores.
// ---------------------------------------------------------------------------
{
	const tasksTool = tools.get("planner_tasks");
	assert.ok(tasksTool, "planner_tasks is registered");
	assert.equal(tasksTool.label, "Planner Tasks");

	const ledger18 = join(isolatedAgentDir, "planner-only", "ledger");
	const ledgerCount18 = () => (existsSync(ledger18) ? readdirSync(ledger18).filter((name) => name.endsWith(".json")).length : 0);
	const requestCount18 = () => piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;

	// Aged blocked Task that exists only on disk (restore cap / missed restore).
	new LedgerSnapshotStore(isolatedAgentDir).write({
		taskId: "T-20200101-500",
		state: "blocked",
		role: "worker",
		cwd: ctx.cwd,
		spec: { objective: "aged blocked Task the restore cap left out" },
		recovery: { required: true, executionId: "exec-18", reason: "worker_runaway" },
		updatedAt: "2020-01-01T00:00:00.000Z",
	});
	// A live Task bound to another workspace's ledger — never listed here.
	new LedgerSnapshotStore(isolatedAgentDir).write({
		taskId: "T-20200101-501",
		state: "executing",
		role: "worker",
		cwd: "/some/other/workspace",
		spec: { objective: "foreign workspace task" },
		updatedAt: "2020-01-01T00:00:01.000Z",
	});

	const ledgerBefore18 = ledgerCount18();
	const requestsBefore18 = requestCount18();
	const listed = await tasksTool.execute("call-tasks-1", {}, undefined, () => {}, ctx);

	const byId18 = new Map(listed.details.tasks.map((task) => [task.taskId, task]));
	assert.ok(
		byId18.has(mintedTaskIdForListing),
		"the live in-memory Task is listed",
	);
	assert.equal(byId18.get(mintedTaskIdForListing).source, "memory");
	const ledgerOnly = byId18.get("T-20200101-500");
	assert.ok(ledgerOnly, "the ledger-only live Task is listed");
	assert.equal(ledgerOnly.source, "ledger");
	assert.equal(ledgerOnly.state, "blocked");
	assert.equal(ledgerOnly.recoveryRequired, true, "blocked + recovery.required surfaces for the caller");
	assert.equal(ledgerOnly.objective, "aged blocked Task the restore cap left out");
	assert.equal(byId18.has("T-20200101-501"), false, "another workspace's live Task is not listed");
	for (const task of listed.details.tasks) {
		assert.ok(!("cwd" in task), "the summary shape carries no cwd");
		assert.ok(!["completed", "closed-superseded", "failed"].includes(task.state), "final Tasks are not listed");
		assert.ok(["memory", "ledger"].includes(task.source));
	}
	assert.match(listed.content[0].text, /planner_tasks: \d+ live Task\(s\) in /);
	assert.match(listed.content[0].text, /T-20200101-500 \| blocked \| worker \| recovery required \|/);
	assert.equal(requestCount18(), requestsBefore18, "listing never reaches the launcher");
	assert.equal(ledgerCount18(), ledgerBefore18, "listing writes nothing to the ledger");

	// A workspace with no live Tasks gets the mint-hint text. Another workspace
	// is another Request namespace: the host crosses the trusted boundary into
	// it (settled + idle interactive input) and back, exactly like a new prompt.
	const noLiveCtx = { ...ctx, cwd: join(tmpdir(), "planner-only-no-live-cwd") };
	await handlers.get("agent_settled")({}, noLiveCtx);
	await handlers.get("input")({ source: "interactive" }, noLiveCtx);
	const emptyListed = await tasksTool.execute("call-tasks-2", {}, undefined, () => {}, noLiveCtx);
	assert.deepEqual(emptyListed.details.tasks, []);
	assert.match(emptyListed.content[0].text, /No live Tasks in .+\. planner_delegate mints a new one\./);
	await handlers.get("agent_settled")({}, ctx);
	await handlers.get("input")({ source: "interactive" }, ctx);
}

// ---------------------------------------------------------------------------
// wrc-incident-followups ticket 04: the 2026-09-17 verdict/recovery boundary
// incident as a permanent fixture (ported from the R2 harness
// /tmp/opencode/planner-verdict-recovery-repro.mjs). A runaway Task is
// recovered via planner_redelegate retry_same_plan, its retry report judged
// into changes_requested — the S:116 state: a report exists, the requirement
// is already consumed, the Task is not blocked. Assertions a–f lock the
// ADR-0003 boundary (tickets 02/03 landed: verdict strips+warns,
// planner_abort owns the abort RecoveryDecision, a stray redelegate recovery
// refuses RECOVERY_NOT_APPLICABLE).
// ---------------------------------------------------------------------------
{
	const delegateTool04 = tools.get("planner_delegate");
	const redelegateTool04 = tools.get("planner_redelegate");
	const ledgerPath04 = (taskId) => join(isolatedAgentDir, "planner-only", "ledger", `${taskId}.json`);
	const readLedger04 = (taskId) => JSON.parse(readFileSync(ledgerPath04(taskId), "utf8"));
	const seen04 = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const nextRequest04 = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seen04.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seen04.add(found.requestId);
		return found;
	};
	const requestCount04 = () => piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	const reportFor04 = (request, runId, summary) => ({
		kind: "structured",
		value: {
			version: 1,
			taskId: request.nodeId,
			status: "completed",
			summary,
			changedFiles: [],
			validation: [],
			evidence: { cwd: request.cwd, taskId: request.nodeId, workerRunId: runId },
			risks: [],
			unresolved: [],
		},
	});
	// Mint a worker Task and drive it into worker_runaway via a token breach:
	// blocked + recovery.required, keyed on the delegate call's executionId.
	const runawayTask04 = async (toolCallId) => {
		const exec = delegateTool04.execute(
			toolCallId,
			{
				role: "worker",
				objective: "ticket-04 runaway probe",
				scope: {},
				constraints: [],
				acceptanceCriteria: [],
				validation: { required: false },
				envelope: { maxTokens: 100 },
			},
			undefined,
			() => {},
			ctx,
		);
		const request = await nextRequest04();
		const triple = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
		piEvents.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, { ...triple, tokens: 5000 });
		await new Promise((r) => setTimeout(r, 5));
		piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
			...triple,
			status: "cancelled",
			runId: `${toolCallId}-run`,
			agent: "worker",
			usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1, toolCalls: 1, durationMs: 10 },
		});
		const result = await exec;
		assert.equal(result.details.termination?.reason, "worker_runaway");
		assert.equal(readLedger04(request.nodeId).task.recovery.required, true);
		return { request, result };
	};

	// Incident sequence (S:95–116): runaway -> retry_same_plan consumes the
	// requirement -> the retry report lands -> request_changes.
	const incident = await runawayTask04("call-wrc04-1");
	const incidentTask = incident.request.nodeId;
	const retryExec = redelegateTool04.execute(
		"call-wrc04-2",
		{
			taskId: incidentTask,
			role: "worker",
			objective: "ticket-04 runaway probe",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			recovery: { executionId: "call-wrc04-1", action: "retry_same_plan", reason: "transient stall; retry with a fresh execution", worktreeDecision: "keep" },
		},
		undefined,
		() => {},
		ctx,
	);
	const retryRequest = await nextRequest04();
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: retryRequest.requestId,
		ownerRunId: retryRequest.ownerRunId,
		nodeId: retryRequest.nodeId,
		status: "completed",
		runId: "run-wrc04-retry",
		agent: "worker",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 1, durationMs: 5 },
		result: reportFor04(retryRequest, "run-wrc04-retry", "recovered"),
	});
	await retryExec;
	assert.equal(readLedger04(incidentTask).task.recovery.required, false, "the retry consumed the requirement");
	await verdictTool.execute(
		"call-wrc04-3",
		{
			taskId: incidentTask,
			verdict: "request_changes",
			summary: "the report needs one correction",
			findings: [{ severity: "major", category: "correctness", description: "correction needed", requestedChange: "fix it" }],
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(readLedger04(incidentTask).task.state, "changes_requested", "fixture reached the S:116 state");

	// (a) request_changes + a stray recovery object: ADR-0003 strips the key,
	//     discloses it in warnings, and lets the verdict land — the replay loop
	//     the incident showed is refused no more, the combination is simply
	//     inexpressible on the schema.
	const strayRecovery = { executionId: "run-wrc04-retry", action: "abort", reason: "not applicable", worktreeDecision: "keep" };
	const strayParams = { taskId: incidentTask, verdict: "request_changes", summary: "recover", recovery: strayRecovery };
	const strippedA = await verdictTool.execute("call-wrc04-a", strayParams, undefined, () => {}, ctx);
	assert.equal(strippedA.details.verdict, "request_changes", "the stripped verdict landed");
	assert.ok(
		strippedA.details.warnings?.some((warning) => /not a planner_verdict key/.test(warning)),
		"the stripped recovery is disclosed in details.warnings",
	);
	assert.match(strippedA.content[0].text, /warning: recovery is not a planner_verdict key/);
	const afterA = readLedger04(incidentTask).task;
	assert.equal(afterA.state, "changes_requested", "the verdict applied normally");
	assert.equal(afterA.recovery?.consumedBy, "call-wrc04-2", "the strip consumed nothing — the retry still owns the consumption");
	assert.equal(afterA.verdictRefusals?.length ?? 0, 0, "a stripped key is a warning, not a refusal");

	// (c, moved) planner_abort on a Task whose requirement is not live refuses
	//     with the admissibility refusal — and the refusal is recorded, closing
	//     the incident's verdictRefusals blind spot.
	// (b, moved) a byte-identical resend earns the ticket-16 Repeat notice —
	//     the breaker check moved onto planner_abort with the refusal itself.
	const abortTool04 = tools.get("planner_abort");
	const badAbort = { taskId: incidentTask, executionId: "run-wrc04-retry", reason: "not applicable", worktreeDecision: "keep" };
	await assert.rejects(
		abortTool04.execute("call-wrc04-c1", badAbort, undefined, () => {}, ctx),
		(error) => {
			assert.match(error.message, /planner_abort refused \(recovery, task=T-\d{8}-\d{3}\): recovery is only admissible while the Task flags recovery\.required/);
			assert.match(error.message, /not a child runId/, "the refusal re-teaches executionId vs runId");
			return true;
		},
	);
	await assert.rejects(
		abortTool04.execute("call-wrc04-c2", badAbort, undefined, () => {}, ctx),
		(error) => {
			assert.match(error.message, /Repeat notice: 本边界收到的规范化参数相同 \(observed boundary: root tool input; previous toolCallId: call-wrc04-c1;/);
			return true;
		},
	);
	const refusals04 = readLedger04(incidentTask).task.verdictRefusals ?? [];
	assert.equal(refusals04.length, 2, "both planner_abort refusals are recorded (was: ledger blind spot)");
	assert.ok(refusals04.every((r) => r.kind === "recovery-invalid" && r.executionId === "run-wrc04-retry"), "records echo the received executionId");

	// (f) the same stray recovery on planner_redelegate now refuses
	//     RECOVERY_NOT_APPLICABLE (ticket 03): no launch, no execution, no
	//     state change — and a byte-identical resend earns the Repeat notice.
	//     Ordered before (d) because (d) leaves the Task blocked.
	const requestsBeforeF = requestCount04();
	const strayRedelegate = {
		taskId: incidentTask,
		role: "worker",
		objective: "ticket-04 correction round",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		recovery: { executionId: "run-wrc04-retry", action: "retry_same_plan", reason: "stray" },
	};
	await assert.rejects(
		redelegateTool04.execute("call-wrc04-f", strayRedelegate, undefined, () => {}, ctx),
		(error) => {
			assert.equal(error.code, "RECOVERY_NOT_APPLICABLE");
			assert.match(error.message, /planner_redelegate refused: recovery is only admissible on a blocked Task flagged recovery\.required — Task T-\d{8}-\d{3} is changes_requested with no pending requirement/);
			assert.match(error.message, /not a child runId/);
			return true;
		},
	);
	await assert.rejects(
		redelegateTool04.execute("call-wrc04-f2", strayRedelegate, undefined, () => {}, ctx),
		(error) => {
			assert.match(error.message, /Repeat notice: 本边界收到的规范化参数相同 \(observed boundary: root tool input; previous toolCallId: call-wrc04-f;/);
			return true;
		},
	);
	assert.equal(requestCount04(), requestsBeforeF, "the stray recovery launched nothing");
	assert.equal(readLedger04(incidentTask).task.state, "changes_requested", "the refused call changed no state");

	// (d) a plain blocked verdict — the correct shape once a Task truly cannot
	//     proceed — lands.
	const blockedResult = await verdictTool.execute(
		"call-wrc04-d",
		{ taskId: incidentTask, verdict: "blocked", summary: "host evidence still missing" },
		undefined,
		() => {},
		ctx,
	);
	assert.equal(blockedResult.details.state, "blocked");

	// (e, moved) while a requirement is still live, planner_abort consumes it —
	//     the only legal abort shape. A separate Task: the incident Task's
	//     requirement was spent by the retry.
	const abortTask = await runawayTask04("call-wrc04-e1");
	const abortResult = await abortTool04.execute(
		"call-wrc04-e2",
		{
			taskId: abortTask.request.nodeId,
			executionId: "call-wrc04-e1",
			reason: "needs manual triage",
			worktreeDecision: "keep",
			summary: "hand the runaway task to the operator",
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(abortResult.details.state, "blocked");
	assert.equal(abortResult.details.recovery?.consumedBy, "planner_abort");
	const afterAbort04 = readLedger04(abortTask.request.nodeId).task;
	assert.equal(afterAbort04.recovery.required, false);
	assert.equal(afterAbort04.recovery.nextAction, "abort");
	assert.equal(afterAbort04.recoveryHistory[0].consumedBy, "planner_abort");
}

// ---------------------------------------------------------------------------
// wrc-incident-followups ticket 02 review follow-up — planner_abort's refusal
// surface on a LIVE requirement (wrong executionId incl. the child-runId
// mistake, empty reason, duplicate-after-consume), pass/blocked with a stray
// recovery key stripped, and worktreeDecision:"manual" actually releasing a
// persisted writer hold via the stop_unconfirmed path.
// ---------------------------------------------------------------------------
{
	const delegateTool04b = tools.get("planner_delegate");
	const abortTool04b = tools.get("planner_abort");
	const ledgerPath04b = (taskId) => join(isolatedAgentDir, "planner-only", "ledger", `${taskId}.json`);
	const readLedger04b = (taskId) => JSON.parse(readFileSync(ledgerPath04b(taskId), "utf8"));
	const taskWithoutRefusalAudit04b = (task) => {
		const copy = structuredClone(task);
		delete copy.verdictRefusals;
		delete copy.updatedAt;
		return copy;
	};
	const assertSingleRefusalAppend04b = (before, after, { executionId, reason }) => {
		assert.deepEqual(
			taskWithoutRefusalAudit04b(after),
			taskWithoutRefusalAudit04b(before),
			"a refused planner_abort changes only verdictRefusals and updatedAt",
		);
		const beforeRows = before.verdictRefusals ?? [];
		const afterRows = after.verdictRefusals ?? [];
		assert.equal(afterRows.length, beforeRows.length + 1, "one refusal appends exactly one audit row");
		assert.deepEqual(afterRows.slice(0, beforeRows.length), beforeRows, "existing refusal audit order and contents are preserved");
		const appended = afterRows.at(-1);
		assert.equal(appended.taskId, before.taskId);
		assert.equal(appended.requestedVerdict, "blocked");
		assert.equal(appended.kind, "recovery-invalid");
		assert.equal(appended.executionId, executionId);
		assert.match(appended.reason, reason);
		assert.equal(typeof appended.at, "string", "the store supplies the refusal timestamp");
	};
	const seen04b = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const nextRequest04b = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seen04b.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seen04b.add(found.requestId);
		return found;
	};
	// A runaway whose CANCEL goes unanswered: cancel grace expires ->
	// stop_unconfirmed + persisted writerHold + recovery.required.
	const unconfirmedRunaway = async (toolCallId) => {
		const exec = delegateTool04b.execute(
			toolCallId,
			{
				role: "worker",
				objective: "stop-unconfirmed probe",
				scope: {},
				constraints: [],
				acceptanceCriteria: [],
				validation: { required: false },
				envelope: { maxTokens: 100 },
			},
			undefined,
			() => {},
			ctx,
		);
		const request = await nextRequest04b();
		piEvents.emit(SUBAGENT_DELEGATION_UPDATE_EVENT, {
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
			tokens: 5000,
		});
		// No terminal: the cancel grace expires and the launcher rejects.
		const result = await exec;
		const record = readLedger04b(request.nodeId).task;
		assert.equal(record.state, "blocked");
		assert.equal(record.recovery.required, true);
		assert.equal(record.recovery.executionId, toolCallId);
		assert.equal(record.executions.at(-1).status, "stop_unconfirmed");
		assert.ok(record.writerHold, "persisted writer hold");
		return { request, result };
	};

	const held = await unconfirmedRunaway("call-wrc04b-1");
	const heldTask = held.request.nodeId;

	// Refusals on a live requirement — recorded as verdictRefusals, but no
	// verdict, no consumption, no state change beyond the refusal audit row.
	const beforeBadId = readLedger04b(heldTask).task;
	await assert.rejects(
		// The incident's mistake: a child runId where the executionId belongs.
		abortTool04b.execute(
			"call-wrc04b-badid",
			{ taskId: heldTask, executionId: "run-child-not-exec", reason: "wrong id", worktreeDecision: "keep" },
			undefined, () => {}, ctx,
		),
		(error) => {
			assert.match(error.message, /does not match the abnormal execution call-wrc04b-1/);
			assert.match(error.message, /received executionId=run-child-not-exec/);
			assert.match(error.message, /not a child runId/);
			return true;
		},
	);
	const afterBadId = readLedger04b(heldTask).task;
	assertSingleRefusalAppend04b(beforeBadId, afterBadId, {
		executionId: "run-child-not-exec",
		reason: /does not match the abnormal execution call-wrc04b-1/,
	});
	const beforeEmpty = readLedger04b(heldTask).task;
	await assert.rejects(
		abortTool04b.execute(
			"call-wrc04b-empty",
			{ taskId: heldTask, executionId: "call-wrc04b-1", reason: "", worktreeDecision: "keep" },
			undefined, () => {}, ctx,
		),
		/recovery\.reason must name a concrete basis/,
	);
	const afterEmpty = readLedger04b(heldTask).task;
	assertSingleRefusalAppend04b(beforeEmpty, afterEmpty, {
		executionId: "call-wrc04b-1",
		reason: /recovery\.reason must name a concrete basis/,
	});
	const afterRefusals = readLedger04b(heldTask).task;
	assert.equal(afterRefusals.state, "blocked");
	assert.equal(afterRefusals.recovery.required, true, "refusals never consume the requirement");
	assert.equal(afterRefusals.executions.length, 1);
	assert.ok(afterRefusals.writerHold);
	assert.equal(afterRefusals.verdictRefusals.length, 2, "the refusals are the only ledger change");

	// worktreeDecision:"manual" aborts AND releases the persisted writer hold.
	const manualAbort = await abortTool04b.execute(
		"call-wrc04b-manual",
		{ taskId: heldTask, executionId: "call-wrc04b-1", reason: "operator confirmed the writer is dead", worktreeDecision: "manual" },
		undefined, () => {}, ctx,
	);
	assert.equal(manualAbort.details.state, "blocked");
	const afterManual = readLedger04b(heldTask).task;
	assert.equal(afterManual.writerHold, undefined, "manual abort releases the persisted writer hold");
	assert.equal(afterManual.recovery.required, false);
	assert.equal(afterManual.recovery.nextAction, "abort");

	// Duplicate after consume: the same call now hits the consumed gate, and a
	// byte-identical resend earns the breaker Repeat notice.
	const spent = { taskId: heldTask, executionId: "call-wrc04b-1", reason: "operator confirmed the writer is dead", worktreeDecision: "manual" };
	const beforeConsumed = readLedger04b(heldTask).task;
	await assert.rejects(
		abortTool04b.execute("call-wrc04b-dup", spent, undefined, () => {}, ctx),
		(error) => {
			assert.match(error.message, /only admissible while the Task flags recovery\.required/);
			assert.match(error.message, /consumedBy=planner_abort/, "the refusal names the consumer");
			return true;
		},
	);
	const afterConsumed = readLedger04b(heldTask).task;
	assertSingleRefusalAppend04b(beforeConsumed, afterConsumed, {
		executionId: "call-wrc04b-1",
		reason: /only admissible while the Task flags recovery\.required/,
	});
	const beforeRepeatedConsumed = readLedger04b(heldTask).task;
	await assert.rejects(
		abortTool04b.execute("call-wrc04b-dup2", spent, undefined, () => {}, ctx),
		/Repeat notice: 本边界收到的规范化参数相同 \(observed boundary: root tool input; previous toolCallId: call-wrc04b-dup/,
	);
	const afterRepeatedConsumed = readLedger04b(heldTask).task;
	assertSingleRefusalAppend04b(beforeRepeatedConsumed, afterRepeatedConsumed, {
		executionId: "call-wrc04b-1",
		reason: /only admissible while the Task flags recovery\.required/,
	});
	const refusals04b = readLedger04b(heldTask).task.verdictRefusals ?? [];
	assert.equal(refusals04b.length, 4, "wrong id, empty reason, consumed, and repeated consumed are all recorded once");
	assert.deepEqual(
		refusals04b.map((row) => row.executionId),
		["run-child-not-exec", "call-wrc04b-1", "call-wrc04b-1", "call-wrc04b-1"],
		"refusal audit rows preserve call order and received identity",
	);

	// blocked with a stray recovery on a live-requirement Task: the key is
	// stripped, the verdict lands, the requirement stays live for planner_abort.
	const liveAbort = await unconfirmedRunaway("call-wrc04b-2");
	const liveTask = liveAbort.request.nodeId;
	const beforeBlockedStray = readLedger04b(liveTask).task;
	const blockedStray = await verdictTool.execute(
		"call-wrc04b-bs",
		{
			taskId: liveTask,
			verdict: "blocked",
			summary: "cannot proceed",
			recovery: { executionId: "call-wrc04b-2", action: "abort", reason: "stray", worktreeDecision: "keep" },
		},
		undefined, () => {}, ctx,
	);
	assert.equal(blockedStray.details.verdict, "blocked");
	assert.ok(blockedStray.details.warnings?.some((w) => /not a planner_verdict key/.test(w)));
	const afterBlockedStray = readLedger04b(liveTask).task;
	assert.equal(afterBlockedStray.reviews.length, beforeBlockedStray.reviews.length + 1, "the blocked verdict is persisted");
	assert.equal(afterBlockedStray.reviews.at(-1).requestedVerdict, "blocked");
	assert.equal(afterBlockedStray.reviews.at(-1).source, "root");
	assert.deepEqual(afterBlockedStray.recovery, beforeBlockedStray.recovery, "a stripped recovery never consumes the requirement");
	assert.deepEqual(afterBlockedStray.recoveryHistory ?? [], beforeBlockedStray.recoveryHistory ?? [], "strip adds no recovery history");
	// The surviving requirement is still abortable via the dedicated surface
	// (manual so the workspace reservation frees for the delegate below).
	const liveAbortResult = await abortTool04b.execute(
		"call-wrc04b-live",
		{ taskId: liveTask, executionId: "call-wrc04b-2", reason: "operator triage", worktreeDecision: "manual" },
		undefined, () => {}, ctx,
	);
	assert.equal(liveAbortResult.details.recovery?.consumedBy, "planner_abort");

	// pass with a stray recovery: the key is stripped and disclosed the same
	// way — whatever the acceptance gate decides, the call is never a refusal
	// *because of* recovery.
	const passExec = delegateTool04b.execute(
		"call-wrc04b-p0",
		{
			role: "worker",
			objective: "passable task",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined, () => {}, ctx,
	);
	const passRequest = await nextRequest04b();
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: passRequest.requestId,
		ownerRunId: passRequest.ownerRunId,
		nodeId: passRequest.nodeId,
		status: "completed",
		runId: "run-wrc04b-pass",
		agent: "worker",
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 1, durationMs: 5 },
		result: {
			kind: "structured",
			value: {
				version: 1, taskId: passRequest.nodeId, status: "completed", summary: "done",
				changedFiles: [], validation: [],
				evidence: { cwd: passRequest.cwd, taskId: passRequest.nodeId, workerRunId: "run-wrc04b-pass" },
				risks: [], unresolved: [],
			},
		},
	});
	await passExec;
	const beforePassStray = readLedger04b(passRequest.nodeId).task;
	const passStray = await verdictTool.execute(
		"call-wrc04b-ps",
		{
			taskId: passRequest.nodeId,
			verdict: "pass",
			summary: "accept",
			recovery: { executionId: "call-wrc04b-p0", action: "abort", reason: "stray", worktreeDecision: "keep" },
		},
		undefined, () => {}, ctx,
	);
	assert.equal(passStray.details.verdict, "pass", "the verdict itself lands");
	assert.ok(passStray.details.warnings?.some((w) => /not a planner_verdict key/.test(w)), "strip disclosed in warnings");
	const afterPassStray = readLedger04b(passRequest.nodeId).task;
	assert.equal(afterPassStray.state, "completed", "the pass verdict is persisted");
	assert.equal(afterPassStray.reviews.length, beforePassStray.reviews.length + 1);
	assert.equal(afterPassStray.reviews.at(-1).requestedVerdict, "pass");
	assert.equal(afterPassStray.reviews.at(-1).source, "root");
	assert.deepEqual(afterPassStray.recovery, beforePassStray.recovery, "stripped pass recovery is not consumed");
	assert.deepEqual(afterPassStray.recoveryHistory ?? [], beforePassStray.recoveryHistory ?? [], "stripped pass adds no recovery history");
}

// ============================================================================
// Ticket 02 + 06 — restricted-reader binding through the runtime-agent
// registry, and the read-only planner_tasks diagnostics view.
// ============================================================================
{
	const delegateTool = tools.get("planner_delegate");
	const tasksTool = tools.get("planner_tasks");
	const requestCount = () => piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;

	// (a) No registry listener — explorer refuses before launch.
	const beforeA = requestCount();
	await assert.rejects(
		delegateTool.execute(
			"call-t02-nobind",
			{
				role: "explorer",
				objective: "survey",
				scope: {},
				constraints: [],
				acceptanceCriteria: [],
				validation: { required: false },
			},
			undefined, () => {}, ctx,
		),
		(error) => error?.code === "READER_CAPABILITY_UNPROVEN",
	);
	assert.equal(requestCount(), beforeA, "a refused explorer never reaches the launcher");

	// (b) pi-subagents' runtime-agent registry answers: the explorer binds the
	//    trusted restricted reader, completes, and carries its capability
	//    record on the execution.
	const registrations = [];
	piEvents.on("pi-subagents:runtime-agent-register:v1", (request) => {
		if (request.name === "planner-scout") {
			registrations.push(request);
			request.result = { ok: true, registration: { dispose() {} } };
		}
	});
	const execPromise = delegateTool.execute(
		"call-t02-reader",
		{
			role: "explorer",
			objective: "where are the logs",
			acceptanceMode: "observation",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined, () => {}, ctx,
	);
	const deadline = Date.now() + 2000;
	let readerRequest;
	const emittedBefore = piEvents.emitted.length;
	while (!readerRequest && Date.now() < deadline) {
		readerRequest = piEvents.emitted
			.slice(emittedBefore)
			.find((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)?.payload;
		if (!readerRequest) await new Promise((r) => setTimeout(r, 2));
	}
	assert.ok(readerRequest, "explorer request emitted");
	assert.equal(readerRequest.agent, "planner-scout", "explorer binds the trusted restricted reader");
	assert.ok(registrations.length >= 1, "the runtime-agent definition was registered");
	assert.deepEqual(registrations[0].definition.tools, ["read", "grep", "find", "ls"], "the registered tool list is read-only");
	// 2026-09-18 T-20260918-001..003 launch rejections from the pi-subagents task-intent heuristic.
	assert.equal(registrations[0].definition.completionGuard, false, "the restricted reader opts out of the completion-guard text heuristic");
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: readerRequest.requestId,
		ownerRunId: readerRequest.ownerRunId,
		nodeId: readerRequest.nodeId,
		status: "completed",
		runId: "run-t02-reader",
		agent: "planner-scout",
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: readerRequest.nodeId,
				status: "completed",
				summary: "logs live under /var/log/x",
				changedFiles: [],
				validation: [],
				evidence: { cwd: readerRequest.cwd, taskId: readerRequest.nodeId, workerRunId: "run-t02-reader" },
				risks: [],
				unresolved: [],
			},
		},
	});
	const readerOutcome = await execPromise;
	const readerTask = readerOutcome.details.taskId;
	assert.equal(readerOutcome.details.state, "reviewing", "the report is admitted");

	// (c) planner_tasks diagnostics: canonical ids, lifecycle truth, no launcher.
	const beforeC = requestCount();
	const diag = await tasksTool.execute("call-t06-diag", { taskId: readerTask }, undefined, () => {}, ctx);
	const d = diag.details.diagnostics;
	assert.equal(d.taskId, readerTask);
	assert.equal(d.acceptanceMode, "observation");
	assert.equal(d.executions[0].executionId, "call-t02-reader");
	assert.equal(d.executions[0].capability, "restricted-reader");
	assert.equal(d.executions[0].terminationConfirmed, true);
	assert.equal(d.executions[0].confirmationBasis, "terminal+restricted-reader");
	assert.equal(d.executions[0].reportReceived, true);
	assert.equal(d.executions[0].reportAccepted, true);
	assert.match(diag.content[0].text, /restricted-reader/);
	// The session-log line reports a location status, never a guessed file.
	assert.ok(d.sessionLog, "diagnostics carry the session log status");
	assert.match(diag.content[0].text, /session log: (verified-file|known-unavailable|default-directory|unknown)/);
	const miss = await tasksTool.execute("call-t06-miss", { taskId: "T-19990101-000" }, undefined, () => {}, ctx);
	assert.equal(miss.details.error, "TASK_UNKNOWN");
	assert.equal(requestCount(), beforeC, "diagnostics never launches a child");

	// (d) diagnostics on the ledger-only Task from ticket 18's block: source is
	//    "ledger" and the record is NOT adopted into the session store.
	const ledgerOnly = await tasksTool.execute("call-t06-ledger", { taskId: "T-20200101-500" }, undefined, () => {}, ctx);
	assert.equal(ledgerOnly.details.diagnostics.source, "ledger");
	assert.equal(ledgerOnly.details.diagnostics.state, "blocked");
	assert.equal(ledgerOnly.details.diagnostics.recovery.required, true);
}

// ---------------------------------------------------------------------------
// Diagnostics output cap: a ledger record with unbounded per-execution detail
// renders within the fixed text cap, disclosing the truncation.
// ---------------------------------------------------------------------------
{
	const tasksTool = tools.get("planner_tasks");
	const fatTask = {
		taskId: "T-20200101-900",
		state: "blocked",
		role: "worker",
		cwd: ctx.cwd,
		spec: { objective: "fat diagnostics" },
		executions: Array.from({ length: 25 }, (_, i) => ({
			executionId: `call-fat-${i}`,
			kind: "worker",
			status: "stop_unconfirmed",
			capability: "writer",
			aRun: {
				cwd: ctx.cwd,
				taskId: "T-20200101-900",
				workerRunId: `call-fat-${i}`,
				probeFailures: Array.from({ length: 12 }, (__, n) => ({
					operation: `probe-${n}`,
					kind: "probe-error",
					cwd: ctx.cwd,
					exitCode: 1,
					error: "x".repeat(400),
				})),
			},
		})),
		reports: [],
		reviews: [],
		updatedAt: "2020-01-01T00:00:00.000Z",
	};
	new LedgerSnapshotStore(isolatedAgentDir).write(fatTask);
	const fat = await tasksTool.execute("call-t06-fat", { taskId: "T-20200101-900" }, undefined, () => {}, ctx);
	const fd = fat.details.diagnostics;
	assert.equal(fd.totalExecutions, 25);
	assert.ok(
		fd.executions.length >= 1 && fd.executions.length <= 20,
		`structured output is capped (got ${fd.executions.length})`,
	);
	assert.ok(
		JSON.stringify(fd).length <= 65536,
		`structured details stay within the total budget (got ${JSON.stringify(fd).length})`,
	);
	assert.equal(fd.truncated, true, "truncation is disclosed");
	assert.ok(
		fat.content[0].text.length <= 20500,
		`rendered text stays bounded (got ${fat.content[0].text.length})`,
	);
	assert.match(fat.content[0].text, /truncated/, "the text discloses the cap");
}

// ---------------------------------------------------------------------------
// F7 (ticket 06): an unaccepted report with unbounded identity fields must not
// blow through the structured payload — details carry a fixed total budget and
// disclose the truncation in sync with the text.
// ---------------------------------------------------------------------------
{
	const tasksTool = tools.get("planner_tasks");
	const longRunId = "r".repeat(1_000_000);
	const longReason = "identity mismatch " + "x".repeat(1_000_000);
	const longSummary = "s".repeat(1_000_000);
	const identityTask = {
		taskId: "T-20200101-901",
		state: "blocked",
		role: "worker",
		cwd: ctx.cwd,
		spec: { objective: "unaccepted report with huge identity fields" },
		executions: [{
			executionId: "call-identity-1",
			kind: "worker",
			status: "stop_unconfirmed",
			capability: "writer",
			aRun: { cwd: ctx.cwd, taskId: "T-20200101-901", workerRunId: "call-identity-1" },
			unacceptedReport: {
				version: 1,
				taskId: "T-20200101-901",
				status: "completed",
				summary: longSummary,
				changedFiles: [],
				validation: [],
				evidence: { cwd: ctx.cwd, taskId: "T-20200101-901", workerRunId: longRunId },
				risks: [],
				unresolved: [],
			},
			unacceptedReportReason: longReason,
		}],
		reports: [],
		reviews: [],
		updatedAt: "2020-01-01T00:00:00.000Z",
	};
	new LedgerSnapshotStore(isolatedAgentDir).write(identityTask);
	const identity = await tasksTool.execute("call-t06-identity", { taskId: "T-20200101-901" }, undefined, () => {}, ctx);
	const id = identity.details.diagnostics;
	const serialized = JSON.stringify(id).length;
	assert.ok(serialized <= 65536, `structured details stay within the total budget (got ${serialized})`);
	assert.equal(id.truncated, true, "the structured details disclose the truncation");
	assert.ok(
		id.executions[0].unacceptedReport.workerRunId.length < longRunId.length,
		"the untrusted identity field is deep-capped",
	);
	assert.match(identity.content[0].text, /diagnostics truncated/, "the text discloses the same truncation");
}

// The registered surface budgets UTF-8 bytes (including the details wrapper),
// deep-caps strings inside arrays, and remains observational over its ledger.
{
	const tasksTool = tools.get("planner_tasks");
	const taskId = "T-20200101-902";
	const ledger = new LedgerSnapshotStore(isolatedAgentDir);
	ledger.write({
		taskId,
		state: "blocked",
		role: "worker",
		cwd: ctx.cwd,
		spec: { objective: "multibyte diagnostics budget" },
		executions: Array.from({ length: 20 }, (_, i) => ({
			executionId: `call-byte-${i}`,
			kind: "worker",
			status: "stop_unconfirmed",
			capability: "writer",
			cwd: ctx.cwd,
			worktreeRoots: Array.from({ length: 50 }, () => `/${"界".repeat(500)}`),
			aRun: {
				cwd: ctx.cwd,
				taskId,
				workerRunId: `call-byte-${i}`,
				probeFailures: Array.from({ length: 10 }, (_, n) => ({
					operation: `probe-${n}`,
					kind: "probe-error",
					cwd: ctx.cwd,
					exitCode: 1,
					error: "界".repeat(4000),
				})),
			},
		})),
		reports: [],
		reviews: [],
		updatedAt: "2020-01-01T00:00:00.000Z",
	});
	const ledgerPath = join(isolatedAgentDir, "planner-only", "ledger", `${taskId}.json`);
	const beforeLedger = readFileSync(ledgerPath, "utf8");
	const beforeRequests = piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	const first = await tasksTool.execute("call-t06-byte-budget-1", { taskId }, undefined, () => {}, ctx);
	const second = await tasksTool.execute("call-t06-byte-budget-2", { taskId }, undefined, () => {}, ctx);
	assert.ok(Buffer.byteLength(JSON.stringify(first.details), "utf8") < 64 * 1024, "all structured details fit below 64 KiB in UTF-8 bytes");
	assert.equal(first.details.diagnostics.truncated, true, "byte-budget truncation is disclosed");
	assert.deepEqual(second.details, first.details, "repeated diagnostics are stable and do not mutate their source record");
	assert.equal(readFileSync(ledgerPath, "utf8"), beforeLedger, "registered diagnostics do not rewrite or mutate the ledger record");
	assert.equal(
		piEvents.emitted.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length,
		beforeRequests,
		"registered diagnostics do not launch or alter execution concurrency",
	);
}

// ---------------------------------------------------------------------------
// F5 (ticket 06): with no host sessionFile the plugin's own storage directory
// must not be mislabeled as the session-log default — the location is unknown.
// ---------------------------------------------------------------------------
{
	const tasksTool = tools.get("planner_tasks");
	const noSessionCtx = {
		...ctx,
		sessionManager: { getEntries() { return sessionEntries; } },
	};
	// No session file means a different Request identity: cross the trusted
	// boundary into it, and back to the primary identity afterwards.
	await handlers.get("agent_settled")({}, noSessionCtx);
	await handlers.get("input")({ source: "interactive" }, noSessionCtx);
	const noSession = await tasksTool.execute("call-t06-nosession", { taskId: "T-20200101-900" }, undefined, () => {}, noSessionCtx);
	await handlers.get("agent_settled")({}, ctx);
	await handlers.get("input")({ source: "interactive" }, ctx);
	const ns = noSession.details.diagnostics;
	assert.equal(ns.sessionLog.status, "unknown", "without a host sessionFile the log location is unknown, not a directory hint");
	assert.equal(ns.sessionLog.path, undefined, "no path is claimed");
	assert.ok(
		!noSession.content[0].text.includes(join(isolatedAgentDir, "planner-only")),
		"the plugin storage directory is never rendered as the session log location",
	);
	assert.match(noSession.content[0].text, /session log: unknown/);
}

// ---------------------------------------------------------------------------
// Ticket 04: Legacy unstarted planning task recovery and blocked verdict
// ---------------------------------------------------------------------------
{
	const tasksTool = tools.get("planner_tasks");
	const redelegateTool = tools.get("planner_redelegate");
	const verdictTool = tools.get("planner_verdict");
	const abortTool = tools.get("planner_abort");
	const ledger = new LedgerSnapshotStore(isolatedAgentDir);

	// 1. Construct a legacy unstarted planning task in the ledger
	const legacyId = "T-20260918-099";
	const legacyTask = {
		taskId: legacyId,
		state: "planning",
		role: "worker",
		cwd: ctx.cwd,
		spec: {
			taskId: legacyId,
			objective: "legacy unstarted task",
			cwd: ctx.cwd,
			role: "worker",
			validation: { required: false },
		},
		executions: [],
		reports: [],
		reviews: [],
		updatedAt: "2026-09-18T10:00:00.000Z",
	};
	ledger.write(legacyTask);

	// 2. planner_tasks lists and diagnoses the unstarted task
	const listResult = await tasksTool.execute("call-t04-list", {}, undefined, () => {}, ctx);
	assert.match(listResult.content[0].text, new RegExp(legacyId));
	assert.match(listResult.content[0].text, /planning/);

	const diagResult = await tasksTool.execute("call-t04-diag", { taskId: legacyId }, undefined, () => {}, ctx);
	assert.match(diagResult.content[0].text, /state: planning/);
	assert.match(diagResult.content[0].text, /executions: none recorded/);
	assert.doesNotMatch(diagResult.content[0].text, /recovery\.required/);

	// 3. planner_abort is refused (recovery.required is false) with guidance to planner_verdict or planner_redelegate
	await assert.rejects(
		abortTool.execute("call-t04-abort", { taskId: legacyId, executionId: "fake-exec", reason: "abort unstarted", worktreeDecision: "keep" }, undefined, () => {}, ctx),
		(error) => {
			assert.match(error.message, /planner_abort refused \(recovery/);
			assert.match(error.message, /record the verdict with planner_verdict or re-enter with planner_redelegate/);
			return true;
		},
	);

	// 4. On a separate unstarted fixture, planner_verdict blocked transitions planning -> blocked cleanly
	const abandonId = "T-20260918-098";
	const abandonTask = {
		taskId: abandonId,
		state: "planning",
		role: "worker",
		cwd: ctx.cwd,
		spec: {
			taskId: abandonId,
			objective: "legacy task to abandon",
			cwd: ctx.cwd,
			role: "worker",
			validation: { required: false },
		},
		executions: [],
		reports: [],
		reviews: [],
		updatedAt: "2026-09-18T10:00:00.000Z",
	};
	ledger.write(abandonTask);

	const verdictOutcome = await verdictTool.execute(
		"call-t04-verdict-blocked",
		{ taskId: abandonId, verdict: "blocked", summary: "operator chose to abandon unstarted legacy task" },
		undefined,
		() => {},
		ctx,
	);
	assert.equal(verdictOutcome.details.state, "blocked");
	const abandonedAfter = ledger.read(abandonId).record;
	assert.equal(abandonedAfter.state, "blocked");
	assert.equal(abandonedAfter.executions.length, 0, "no fake execution minted");
	assert.equal(abandonedAfter.reports.length, 0, "no fake WorkerReport minted");
	assert.equal(abandonedAfter.stateReason, "operator chose to abandon unstarted legacy task");

	// 4b. Refusal breaker triggered by malformed redelegate does not block query or verdict.
	// P1-A: legacy definition fields are ignored on rebind, so the malformed input is an
	// invalid envelope — refused before any reservation or launch.
	const abandonId2 = "T-20260918-097";
	ledger.write({
		taskId: abandonId2,
		state: "planning",
		role: "worker",
		cwd: ctx.cwd,
		spec: {
			taskId: abandonId2,
			objective: "legacy task with malformed redelegations",
			cwd: ctx.cwd,
			role: "worker",
			validation: { required: false },
		},
		executions: [],
		reports: [],
		reviews: [],
		updatedAt: "2026-09-18T10:00:00.000Z",
	});

	// Attempt 1: malformed redelegate (envelope.maxTokens is not a positive integer)
	await assert.rejects(
		redelegateTool.execute(
			"call-t04-malformed-1",
			{
				taskId: abandonId2,
				role: "worker",
				envelope: { maxTokens: 0 },
			},
			undefined,
			() => {},
			ctx,
		),
		(err) => err.message.includes("envelope.maxTokens must normalize to a positive finite integer"),
	);
	assert.equal(ledger.read(abandonId2).record.executions.length, 0, "malformed redelegate launched nothing");

	// Attempt 2: identical malformed redelegate -> refusal breaker notice
	await assert.rejects(
		redelegateTool.execute(
			"call-t04-malformed-2",
			{
				taskId: abandonId2,
				role: "worker",
				envelope: { maxTokens: 0 },
			},
			undefined,
			() => {},
			ctx,
		),
		(err) => err.message.includes("Repeat notice"),
	);

	// Query still works
	const diagAfterRefusal = await tasksTool.execute("call-t04-diag-2", { taskId: abandonId2 }, undefined, () => {}, ctx);
	assert.match(diagAfterRefusal.content[0].text, /state: planning/);

	// Verdict blocked still works and transitions the task
	const verdictAfterRefusal = await verdictTool.execute(
		"call-t04-verdict-blocked-2",
		{ taskId: abandonId2, verdict: "blocked", summary: "abandoned after repeated refusal" },
		undefined,
		() => {},
		ctx,
	);
	assert.equal(verdictAfterRefusal.details.state, "blocked");
	assert.equal(ledger.read(abandonId2).record.state, "blocked");

	// 5. On the first fixture, planner_redelegate launches the existing task without requiring RecoveryDecision
	const seenT04 = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const nextReqT04 = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seenT04.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seenT04.add(found.requestId);
		return found;
	};

	const initialRequests = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	const redelegatePromise = redelegateTool.execute(
		"call-t04-redelegate",
		{
			taskId: legacyId,
			role: "worker",
			objective: "execute unstarted legacy task",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		() => {},
		ctx,
	);
	const req = await nextReqT04();
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: req.requestId,
		ownerRunId: req.ownerRunId,
		nodeId: req.nodeId,
		status: "completed",
		runId: "run-t04",
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: req.nodeId,
				status: "completed",
				summary: "worker completed",
				changedFiles: [],
				validation: [],
				evidence: { cwd: req.cwd, taskId: req.nodeId, workerRunId: "run-t04" },
				risks: [],
				unresolved: [],
			},
		},
	});
	const redelegateResult = await redelegatePromise;
	assert.equal(redelegateResult.details.taskId, legacyId, "executed original taskId");
	const currentRequests = piEvents.emitted.filter((e) => e.event === SUBAGENT_DELEGATION_REQUEST_EVENT).length;
	assert.equal(currentRequests, initialRequests + 1, "exactly one launch occurred");
	const finalRecord = ledger.read(legacyId).record;
	assert.equal(finalRecord.spec?.objective, "legacy unstarted task", "original TaskSpec not overwritten");
}

// ============================================================================
// Ticket 01 (delegation-contract-incident-20260918) — Host Entrypoint Regression:
// Explorer (2 tasks, 1 correction round) and Worker Report Admission & Verdict
// ============================================================================
{
	const delegateTool = tools.get("planner_delegate");
	const redelegateTool = tools.get("planner_redelegate");
	const verdictTool = tools.get("planner_verdict");
	assert.ok(delegateTool && redelegateTool && verdictTool);
	const ledger = new LedgerSnapshotStore(isolatedAgentDir);

	const seenRequests = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const nextReq = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seenRequests.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seenRequests.add(found.requestId);
		return found;
	};

	// 1. Explorer Task 1: single round, runId allocated by launcher, admitted, enters Verdict.
	const exp1Promise = delegateTool.execute(
		"call-exp1-mint",
		{
			role: "explorer",
			objective: "investigate repo layout",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			acceptanceMode: "observation",
		},
		undefined,
		() => {},
		ctx,
	);
	const reqExp1 = await nextReq();
	const runIdExp1 = "run-exp1-host-alloc";
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: reqExp1.requestId,
		ownerRunId: reqExp1.ownerRunId,
		nodeId: reqExp1.nodeId,
		status: "completed",
		runId: runIdExp1,
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: reqExp1.nodeId,
				status: "completed",
				summary: "Explorer recon done",
				changedFiles: [],
				validation: [],
				evidence: { cwd: reqExp1.cwd, taskId: reqExp1.nodeId, workerRunId: runIdExp1 },
				risks: [],
				unresolved: [],
			},
		},
	});
	const exp1Res = await exp1Promise;
	assert.equal(exp1Res.details.report.evidence.workerRunId, runIdExp1);
	assert.equal(exp1Res.details.state, "reviewing");

	// Verdict for Explorer Task 1
	const v1 = await verdictTool.execute(
		"call-v-exp1",
		{
			taskId: exp1Res.details.taskId,
			verdict: "pass",
			summary: "Recon matches requirements",
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(v1.details.state, "completed");
	assert.equal(ledger.read(exp1Res.details.taskId).record.state, "completed");

	// 2. Explorer Task 2: Round 1 needs correction -> Round 2 redelegate -> Verdict.
	// Execution 1: Round 1
	const exp2Promise = delegateTool.execute(
		"call-exp2-mint",
		{
			role: "explorer",
			objective: "investigate dependencies",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			acceptanceMode: "observation",
		},
		undefined,
		() => {},
		ctx,
	);
	const reqExp2R1 = await nextReq();
	const runIdExp2R1 = "run-exp2-round1-alloc";
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: reqExp2R1.requestId,
		ownerRunId: reqExp2R1.ownerRunId,
		nodeId: reqExp2R1.nodeId,
		status: "completed",
		runId: runIdExp2R1,
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: reqExp2R1.nodeId,
				status: "partial",
				summary: "Partial dependencies found; more needed",
				changedFiles: [],
				validation: [],
				evidence: { cwd: reqExp2R1.cwd, taskId: reqExp2R1.nodeId, workerRunId: runIdExp2R1 },
				risks: [],
				unresolved: [],
			},
		},
	});
	const exp2R1Res = await exp2Promise;
	assert.equal(exp2R1Res.details.report.evidence.workerRunId, runIdExp2R1);
	const exp2TaskId = exp2R1Res.details.taskId;

	// Execution 2: Round 2 (correction round via redelegate)
	const exp2R2Promise = redelegateTool.execute(
		"call-exp2-r2",
		{
			taskId: exp2TaskId,
			role: "explorer",
			objective: "finish dependencies survey",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		() => {},
		ctx,
	);
	const reqExp2R2 = await nextReq();
	assert.notEqual(reqExp2R2.requestId, reqExp2R1.requestId);
	const runIdExp2R2 = "run-exp2-round2-fresh-alloc";
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: reqExp2R2.requestId,
		ownerRunId: reqExp2R2.ownerRunId,
		nodeId: reqExp2R2.nodeId,
		status: "completed",
		runId: runIdExp2R2,
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: reqExp2R2.nodeId,
				status: "completed",
				summary: "All dependencies documented",
				changedFiles: [],
				validation: [],
				evidence: { cwd: reqExp2R2.cwd, taskId: reqExp2R2.nodeId, workerRunId: runIdExp2R2 },
				risks: [],
				unresolved: [],
			},
		},
	});
	const exp2R2Res = await exp2R2Promise;
	assert.equal(exp2R2Res.details.report.evidence.workerRunId, runIdExp2R2);
	assert.notEqual(runIdExp2R2, runIdExp2R1, "correction round obtains new runId");

	// Verdict for Explorer Task 2
	const v2 = await verdictTool.execute(
		"call-v-exp2",
		{
			taskId: exp2TaskId,
			verdict: "pass",
			summary: "Complete survey accepted",
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(v2.details.state, "completed");
	const task2Record = ledger.read(exp2TaskId).record;
	assert.equal(task2Record.state, "completed");
	assert.equal(task2Record.executions.length, 2, "Task 2 accurately records two executions");
	assert.equal(task2Record.executions[0].runId, runIdExp2R1);
	assert.equal(task2Record.executions[1].runId, runIdExp2R2);

	// 3. Worker Task: executes, binds runId, report admitted, enters Verdict.
	const workerPromise = delegateTool.execute(
		"call-w-mint",
		{
			role: "worker",
			objective: "implement component",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
		},
		undefined,
		() => {},
		ctx,
	);
	const reqW = await nextReq();
	const runIdW = "run-worker-alloc";
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: reqW.requestId,
		ownerRunId: reqW.ownerRunId,
		nodeId: reqW.nodeId,
		status: "completed",
		runId: runIdW,
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: reqW.nodeId,
				status: "completed",
				summary: "component implemented",
				changedFiles: [],
				validation: [],
				evidence: { cwd: reqW.cwd, taskId: reqW.nodeId, workerRunId: runIdW },
				risks: [],
				unresolved: [],
			},
		},
	});
	const wRes = await workerPromise;
	assert.equal(wRes.details.report.evidence.workerRunId, runIdW);

	// Verdict for Worker Task
	const vW = await verdictTool.execute(
		"call-v-w",
		{
			taskId: wRes.details.taskId,
			verdict: "pass",
			summary: "Worker implementation accepted",
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(vW.details.state, "completed");
	assert.equal(ledger.read(wRes.details.taskId).record.state, "completed");
}

// ============================================================================
// root-stamped-run-identity Ticket 01 — Host Entrypoint: Stamped report and incident replay
// ============================================================================
{
	const delegateTool = tools.get("planner_delegate");
	const verdictTool = tools.get("planner_verdict");
	const ledger = new LedgerSnapshotStore(isolatedAgentDir);

	const seenRequests = new Set(
		piEvents.emitted
			.filter((entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT)
			.map((entry) => entry.payload.requestId),
	);
	const nextReq = async () => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find(
				(entry) => entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && !seenRequests.has(entry.payload.requestId),
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		seenRequests.add(found.requestId);
		return found;
	};

	// 9. Report without workerRunId is admitted and completes via planner_verdict pass
	const execPromise = delegateTool.execute(
		"call-no-runid-tool",
		{
			role: "explorer",
			objective: "child without workerRunId",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: false },
			acceptanceMode: "observation",
		},
		undefined,
		() => {},
		ctx,
	);
	const req = await nextReq();
	const hostAllocatedRunId = "run-host-alloc-clean";
	piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
		requestId: req.requestId,
		ownerRunId: req.ownerRunId,
		nodeId: req.nodeId,
		status: "completed",
		runId: hostAllocatedRunId,
		result: {
			kind: "structured",
			value: {
				version: 1,
				taskId: req.nodeId,
				status: "completed",
				summary: "clean report",
				changedFiles: [],
				validation: [],
				evidence: { cwd: req.cwd, taskId: req.nodeId }, // NO workerRunId
				risks: [],
				unresolved: [],
			},
		},
	});
	const res = await execPromise;
	assert.equal(res.details.report.evidence.workerRunId, hostAllocatedRunId, "Root stamped runId");
	assert.equal(res.details.state, "reviewing");

	const vRes = await verdictTool.execute(
		"call-v-no-runid",
		{
			taskId: res.details.taskId,
			verdict: "pass",
			summary: "clean report accepted",
		},
		undefined,
		() => {},
		ctx,
	);
	assert.equal(vRes.details.state, "completed");
	assert.equal(ledger.read(res.details.taskId).record.state, "completed");

	// 10. Incident replay: three incident values ("planner-scout", "T-20260918-004", "not-provided-in-launch-packet")
	const incidentValues = ["planner-scout", "T-20260918-004", "not-provided-in-launch-packet"];
	for (const incidentVal of incidentValues) {
		const incPromise = delegateTool.execute(
			`call-inc-${incidentVal.slice(0, 8)}`,
			{
				role: "explorer",
				objective: `replay incident ${incidentVal}`,
				scope: {},
				constraints: [],
				acceptanceCriteria: [],
				validation: { required: false },
				acceptanceMode: "observation",
			},
			undefined,
			() => {},
			ctx,
		);
		const incReq = await nextReq();
		const incRunId = `run-replay-${incidentVal.slice(0, 8)}`;
		piEvents.emit(SUBAGENT_DELEGATION_RESPONSE_EVENT, {
			requestId: incReq.requestId,
			ownerRunId: incReq.ownerRunId,
			nodeId: incReq.nodeId,
			status: "completed",
			runId: incRunId,
			result: {
				kind: "structured",
				value: {
					version: 1,
					taskId: incReq.nodeId,
					status: "completed",
					summary: `replaying ${incidentVal}`,
					changedFiles: [],
					validation: [],
					evidence: { cwd: incReq.cwd, taskId: incReq.nodeId, workerRunId: incidentVal },
					risks: [],
					unresolved: [],
				},
			},
		});
		const incRes = await incPromise;
		assert.equal(incRes.details.report.evidence.workerRunId, incRunId, "stamped by Root to launcher runId");
		assert.equal(incRes.details.state, "reviewing", "admitted, not unaccepted");
		assert.ok(
			incRes.details.warnings?.some((w) => w.includes(incidentVal)),
			`warnings disclose child value ${incidentVal}`,
		);
	}
}
