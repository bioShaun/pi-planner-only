import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { TaskStore, validateTaskSpec } from "./task.ts";
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

const pi = {
	on(name, handler) {
		handlers.set(name, handler);
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
await handlers.get("before_agent_start")({ systemPrompt: "BASE" });
assert.equal(activeTools.includes("edit"), true, "setActiveTools is not used; policy blocks Root mutators");

const prompt = await handlers.get("before_agent_start")({ systemPrompt: "BASE" });
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

	// The launcher emits REQUEST only after runDelegation's async setup —
	// poll the bus until it lands (bounded so an early throw cannot hang).
	// `excludeRequestId` skips an earlier delegation's REQUEST.
	const requestSeen = async (excludeRequestId) => {
		const deadline = Date.now() + 2000;
		let found;
		while (!found && Date.now() < deadline) {
			found = piEvents.emitted.find((entry) =>
				entry.event === SUBAGENT_DELEGATION_REQUEST_EVENT && entry.payload.requestId !== excludeRequestId,
			)?.payload;
			if (!found) await new Promise((r) => setTimeout(r, 2));
		}
		assert.ok(found, "REQUEST emitted on the delegation bus");
		return found;
	};

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
	const pendingRequest = await requestSeen(request.requestId);
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

	// Recovery via verdict blocked + abort.
	const verdictAbort = await verdictTool.execute(
		"call-wrc-v1",
		{
			verdict: "blocked",
			summary: "hand the runaway task to the operator",
			taskId: wrcRequest.nodeId,
			recovery: { executionId: "call-wrc-1", action: "abort", reason: "needs manual triage", worktreeDecision: "manual" },
		},
		undefined,
		() => {},
		ctx,
	);
	const afterAbort = JSON.parse(readFileSync(join(isolatedAgentDir, "planner-only", "ledger", `${wrcRequest.nodeId}.json`), "utf8"));
	assert.equal(afterAbort.task.recovery.required, false);
	assert.equal(afterAbort.task.recovery.nextAction, "abort");
	assert.equal(afterAbort.task.recoveryHistory[0].consumedBy, "planner_verdict");

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
	assert.match(e2.message, /Repeat notice: these arguments are byte-identical to refused call call-rb-1 \(same refusal TASK_UNKNOWN\)/);
	assert.match(e2.message, /read back the arguments you actually sent/);
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

	// A workspace with no live Tasks gets the mint-hint text.
	const emptyListed = await tasksTool.execute("call-tasks-2", {}, undefined, () => {}, { ...ctx, cwd: join(tmpdir(), "planner-only-no-live-cwd") });
	assert.deepEqual(emptyListed.details.tasks, []);
	assert.match(emptyListed.content[0].text, /No live Tasks in .+\. planner_delegate mints a new one\./);
}
