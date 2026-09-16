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
assert.match(prompt.systemPrompt, /delegate the reviewer only after the worker returns, in a separate call/);
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
	// Issue 05: startup fails when floor env var is set to empty or invalid
	const savedEnv = process.env.PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD;
	try {
		process.env.PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD = "";
		assert.throws(() => {
			plannerOnly({
				on() {},
				registerCommand() {},
				registerTool() {},
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});
		}, /PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD is set but empty/);

		process.env.PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD = "not-a-number";
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
			process.env.PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD = savedEnv;
		} else {
			delete process.env.PI_PLANNER_ONLY_FLOOR_BOUNDED_TOOL_HARD;
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
