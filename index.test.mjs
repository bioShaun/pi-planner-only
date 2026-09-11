import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { LedgerSnapshotStore } from "./ledger-store.ts";
import { TaskStore, validateTaskSpec } from "./task.ts";
import { emptyTaskUsage } from "./usage.ts";

const isolatedAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
process.env.PI_PLANNER_ONLY_SEED_PRICING = "0";

delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly, filterPlannerTools, restorePlannerTools, PLANNER_PROMPT } = await import("./index.ts");

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
// The product mints Task ids from the current date (shouldReplaceTaskId), so a
// hardcoded stamp makes this fixture -- and every later assertion that depends on
// the placeholder sharing this Task's cwd -- go red the next time midnight passes.
const sessionTaskId = `T-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-801`;
await handlers.get("tool_call")({
	toolCallId: "call-budget-session",
	toolName: "subagent",
	input: { task: JSON.stringify(delegationSpec(sessionTaskId)) },
}, ctx);
notices.length = 0;
await commands.get("planner-only").handler("status", ctx);
const budgetStatus = notices.at(-1).message;
assert.equal(budgetStatus.includes("Session usage: tokens=15，已知费用 $0.0400，未知项 0 项"), true);
assert.equal(budgetStatus.includes("Unattributed (会话级，未归入任何 Task): 1 turns, tokens=15, 费用 $0.0400"), true);
assert.equal(budgetStatus.includes("Budget: 未设累计上限（已知消耗 tokens=0，费用 $0.0000"), true);

await handlers.get("message_end")({ message: {
	role: "assistant", id: "msg-budget-task", model: "test-model",
	usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: 0.05 }, content: "task usage",
} }, ctx);
notices.length = 0;
await commands.get("planner-only").handler("usage record", ctx);
const runsDir = join(isolatedAgentDir, "planner-only", "runs");
const firstRunFiles = readdirSync(runsDir).filter((name) => name.endsWith(".json"));
assert.equal(firstRunFiles.length, 1);
const firstRun = JSON.parse(readFileSync(join(runsDir, firstRunFiles[0]), "utf8"));
assert.equal(firstRun.version, 1);
assert.equal(firstRun.task.taskId, sessionTaskId);

await commands.get("planner-only").handler("usage record --arm role-split", ctx);
const recordsAfterArm = readdirSync(runsDir)
	.filter((name) => name.endsWith(".json"))
	.map((name) => JSON.parse(readFileSync(join(runsDir, name), "utf8")));
assert.equal(recordsAfterArm.some((record) => record.arm === "role-split"), true);

notices.length = 0;
await commands.get("planner-only").handler("usage summary", ctx);
assert.match(notices.at(-1).message, /费用对照汇总:/);

notices.length = 0;
await commands.get("planner-only").handler(`usage summary ${join(isolatedAgentDir, "missing-runs")}`, ctx);
assert.equal(notices.at(-1).type, "warning");
assert.match(notices.at(-1).message, /no run records/);

// R02 — the harness keeps one live Task anchored at ctx.cwd so the live
// gather allowlist (safe bash, git_audit, contact_supervisor, read) stays
// exercisable; Idle-gather fixtures run in their own context further below.
// The Task belongs to a (standalone) explorer: read-only roles hold no write
// lock, so later worker/validator fixtures at other cwds stay uncontended.
const harnessTaskId = `T-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-900`;
{
	const prev = gitResponses.get("status --porcelain=v2 --branch");
	gitResponses.set("status --porcelain=v2 --branch", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{
			toolCallId: "call-harness-live",
			toolName: "subagent",
			input: { task: JSON.stringify({ ...delegationSpec(harnessTaskId, "explorer", ctx.cwd), validation: { required: false } }) },
		},
		ctx,
	);
	if (prev === undefined) gitResponses.delete("status --porcelain=v2 --branch");
	else gitResponses.set("status --porcelain=v2 --branch", prev);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${harnessTaskId}`, ctx);
	assert.match(notices.at(-1).message, /State: executing/, "the harness Task anchors ctx.cwd as gather-live");
}

const blocked = await handlers.get("tool_call")(
	{ toolName: "write", input: { path: "/tmp/x" } },
	ctx,
);
assert.equal(blocked.block, true);
assert.match(blocked.reason, /Delegate execution to a worker/);

const allowed = await handlers.get("tool_call")(
	{ toolName: "bash", input: { command: "git status --short" } },
	ctx,
);
assert.equal(allowed, undefined);
const supervisorAllowed = await handlers.get("tool_call")(
	{ toolName: "contact_supervisor", input: {} },
	ctx,
);
assert.equal(supervisorAllowed, undefined);
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
assert.match(prompt.systemPrompt, /never pre-compose worker→reviewer as a workflowScript, tasks array, or chain/);
assert.match(prompt.systemPrompt, /canonical id returned by the extension/);
assert.match(prompt.systemPrompt, /direct \{agent, task\}/);
assert.match(prompt.systemPrompt, /call the reviewer only after the worker returns, in a separate direct call/);
assert.doesNotMatch(prompt.systemPrompt, /diffStat/);
assert.doesNotMatch(prompt.systemPrompt, /\/planner-only/);

const compositeBlocked = await handlers.get("tool_call")(
	{
		toolName: "subagent",
		input: {
			agent: "worker",
			task: "pre-composed worker then reviewer",
			workflowScript: "await worker(); await reviewer();",
		},
	},
	ctx,
);
assert.equal(compositeBlocked.block, true);
assert.match(compositeBlocked.reason, /composite/i);
assert.match(compositeBlocked.reason, /independent direct call \{agent, task\}/);
assert.match(compositeBlocked.reason, /does not parse workflowScript/);

const validateStillAllowed = await handlers.get("tool_call")(
	{
		toolName: "subagent",
		input: { action: "validate", workflowScript: "await worker(); await reviewer();" },
	},
	ctx,
);
assert.equal(validateStillAllowed, undefined, "management/validate with action stays unblocked");

const standaloneTasksBlocked = await handlers.get("tool_call")(
	{
		toolName: "subagent",
		input: {
			tasks: [
				{ agent: "worker", task: "SECRET_TASK_BODY implement parser then review" },
				{ agent: "reviewer", task: "SECRET_TASK_BODY rubber-stamp the worker" },
			],
		},
	},
	ctx,
);
assert.equal(standaloneTasksBlocked.block, true);
assert.match(standaloneTasksBlocked.reason, /composite/i);
assert.match(standaloneTasksBlocked.reason, /Detected: tasks/);
assert.doesNotMatch(standaloneTasksBlocked.reason, /SECRET_TASK_BODY/);
assert.doesNotMatch(standaloneTasksBlocked.reason, /rubber-stamp/);

const standaloneChainBlocked = await handlers.get("tool_call")(
	{
		toolName: "subagent",
		input: {
			chain: [
				{ agent: "worker", task: "SECRET_CHAIN_BODY wait for reviewer inside the script" },
				{ agent: "reviewer", task: "SECRET_CHAIN_BODY scan the whole repo" },
			],
		},
	},
	ctx,
);
assert.equal(standaloneChainBlocked.block, true);
assert.match(standaloneChainBlocked.reason, /composite/i);
assert.match(standaloneChainBlocked.reason, /Detected: chain/);
assert.doesNotMatch(standaloneChainBlocked.reason, /SECRET_CHAIN_BODY/);
assert.doesNotMatch(standaloneChainBlocked.reason, /scan the whole repo/);

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
const fixtureAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
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
// C01: the release gate fails closed when contract coverage would skip
// --------------------------------------------------------------------------

const e2ePath = new URL("./e2e.pi-subagents.test.mjs", import.meta.url).pathname;

// Local run without the peer: the missing public contract is explicit, exit 0
{
	const emptyAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-e2e-"));
	try {
		const local = spawnSync(process.execPath, [e2ePath], {
			env: { ...process.env, PI_CODING_AGENT_DIR: emptyAgentDir, PI_SUBAGENT_CHILD: "0" },
			encoding: "utf8",
		});
		assert.equal(local.status, 0, local.stderr || local.stdout);
		assert.match(local.stdout, /§G 角色模型启动契约未验证 .*pi-subagents is not installed/);
	} finally {
		rmSync(emptyAgentDir, { recursive: true, force: true });
	}
}

// Release-gate run: the same skip condition fails the job
{
	const emptyAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-e2e-"));
	try {
		const gated = spawnSync(process.execPath, [e2ePath], {
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: emptyAgentDir,
				PI_SUBAGENT_CHILD: "0",
				PI_PLANNER_ONLY_REQUIRE_CONTRACT: "1",
			},
			encoding: "utf8",
		});
		assert.notEqual(gated.status, 0, "a skipped contract suite must fail the release gate");
		assert.match(gated.stderr, /FAIL — release gate requires §G contract coverage/);
	} finally {
		rmSync(emptyAgentDir, { recursive: true, force: true });
	}
}

// Out-of-range peer: the public contract is unverified locally, fail under the gate
{
	const fakeAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-e2e-"));
	try {
		const fakePkgDir = join(fakeAgentDir, "npm", "node_modules", "pi-subagents");
		mkdirSync(fakePkgDir, { recursive: true });
		writeFileSync(join(fakePkgDir, "package.json"), JSON.stringify({ name: "pi-subagents", version: "0.99.0" }));
		const local = spawnSync(process.execPath, [e2ePath], {
			env: { ...process.env, PI_CODING_AGENT_DIR: fakeAgentDir, PI_SUBAGENT_CHILD: "0" },
			encoding: "utf8",
		});
		assert.equal(local.status, 0, local.stderr || local.stdout);
		assert.match(local.stdout, /§G 角色模型启动契约未验证 .*outside >=0\.65 <0\.70/);

		const gated = spawnSync(process.execPath, [e2ePath], {
			env: {
				...process.env,
				PI_CODING_AGENT_DIR: fakeAgentDir,
				PI_SUBAGENT_CHILD: "0",
				PI_PLANNER_ONLY_REQUIRE_CONTRACT: "1",
			},
			encoding: "utf8",
		});
		assert.notEqual(gated.status, 0, "an out-of-range peer must fail the release gate");
		assert.match(gated.stderr, /outside >=0\.65 <0\.70/);
	} finally {
		rmSync(fakeAgentDir, { recursive: true, force: true });
	}
}

// --------------------------------------------------------------------------
// RF-4: D1 & D2 per-session force-on and status source reporting
// --------------------------------------------------------------------------

const rf4AgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-rf4-"));
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

const t05AgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-t05-"));
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

const t05bAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-t05b-"));
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

// p07-r032: public tool_call/tool_result/status expose role-model policy state.
{
	const saved = {
		flag: process.env.PI_PLANNER_ONLY_ROLE_MODELS,
		workerModel: process.env.PI_PLANNER_ONLY_MODEL_WORKER,
		workerThinking: process.env.PI_PLANNER_ONLY_THINKING_WORKER,
	};
	try {
		process.env.PI_PLANNER_ONLY_ROLE_MODELS = "1";
		process.env.PI_PLANNER_ONLY_MODEL_WORKER = "policy-test/worker";
		process.env.PI_PLANNER_ONLY_THINKING_WORKER = "medium";
		const firstInput = {
			agent: "worker",
			cwd: "/fixture/index-policy-unknown",
			task: JSON.stringify({
				taskId: "T-20260905-932",
				objective: "policy status",
				cwd: "/fixture/index-policy-unknown",
				role: "worker",
				scope: { allowedPaths: ["src/parser.ts"] },
				constraints: ["no new deps"],
				acceptanceCriteria: ["tests pass"],
				validation: { required: true, commands: ["npm test"] },
				expectedEvidence: { changedFiles: true, tests: true },
				stopConditions: ["ask if ambiguous"],
			}),
		};
		assert.equal(await handlers.get("tool_call")({ toolName: "subagent", input: firstInput, toolCallId: "call-policy-index-1" }, ctx), undefined);
		await commands.get("planner-only").handler("status", ctx);
		assert.match(notices.at(-1).message, /requested=未指定 \(thinking: 未指定\)/);
		assert.match(notices.at(-1).message, /resolved=policy-test\/worker \(thinking: medium\)/);
		assert.match(notices.at(-1).message, /actual=未知 \(thinking: 未知\)/);

		const secondInput = { ...firstInput, cwd: "/fixture/index-policy-unknown-2", task: firstInput.task.replace("T-20260905-932", "T-20260905-933").replace("index-policy-unknown", "index-policy-unknown-2") };
		assert.equal(await handlers.get("tool_call")({ toolName: "subagent", input: secondInput, toolCallId: "call-policy-index-2" }, ctx), undefined, "unknown actual must not block the next worker");

		const actual = await handlers.get("tool_result")({
			toolCallId: "call-policy-index-1",
			toolName: "subagent",
			input: firstInput,
			details: { results: [{ model: "other/model", thinking: "medium", usage: {} }] },
			content: [{ type: "text", text: "child result" }],
			isError: false,
		}, ctx);
		assert.ok(actual);
		const blocked = await handlers.get("tool_call")({
			toolName: "subagent",
			toolCallId: "call-policy-index-3",
			input: { agent: "worker", cwd: "/fixture/index-policy-blocked", task: firstInput.task.replace("T-20260905-932", "T-20260905-934").replace("index-policy-unknown", "index-policy-blocked") },
		}, ctx);
		assert.equal(blocked.block, true);
		assert.match(blocked.reason, /Planner-only guard: role model policy mismatch recorded; further controlled launches are stopped\./);
	} finally {
		for (const [key, value] of Object.entries({
			PI_PLANNER_ONLY_ROLE_MODELS: saved.flag,
			PI_PLANNER_ONLY_MODEL_WORKER: saved.workerModel,
			PI_PLANNER_ONLY_THINKING_WORKER: saved.workerThinking,
		})) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
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

// Root stamps stored reports with its own sample; fixture paths never exist on
// disk, so each changed path hashes to null in that sample.
function digestOfFixture(report, paths = report.evidence.changedPaths ?? []) {
	return workspaceSummaryDigest({
		...report,
		evidence: {
			...report.evidence,
			dirtyPathHashes: Object.fromEntries(paths.map((p) => [p, null])),
		},
	});
}

function delegationSpec(taskId, role = "worker", cwd = `/fixture/${taskId}`) {
	return {
		taskId,
		objective: `do ${taskId}`,
		cwd,
		role,
		// Both fixture paths are declared so the shared report is in scope;
		// scope violations have their own E01 lifecycle coverage.
		scope: { allowedPaths: ["src/parser.ts", "src/parser.test.ts"] },
		constraints: ["no new deps"],
		acceptanceCriteria: ["tests pass"],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: { changedFiles: true, tests: true },
		stopConditions: ["ask if ambiguous"],
	};
}

// a delegation with an embedded TaskSpec registers the task and captures evidence
await handlers.get("tool_call")(
	{
		toolCallId: "call-100",
		toolName: "subagent",
		input: { agent: "worker", task: `Do this:\n\n\`\`\`json\n${JSON.stringify(delegationSpec("T-20260905-100"))}\n\`\`\`` },
	},
	ctx,
);
notices.length = 0;
await commands.get("planner-only").handler("task", ctx);
// Fixture ids are stamped 2026-09-05; the store canonicalises past-dated ids,
// so read the canonical id from the status render instead of assuming it.
const CANON100 = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
assert.ok(CANON100, `status must print a canonical task id: ${notices.at(-1).message}`);
assert.match(notices.at(-1).message, /aliases: T-20260905-100/);
assert.match(notices.at(-1).message, /State: executing/);
assert.match(notices.at(-1).message, /Review mode: root/);

gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

// Public hook: a validator Task with no WorkerReport must receive the full oracle contract.
{
	const input = { agent: "oracle", task: JSON.stringify(delegationSpec("T-20260905-no-report", "validator")) };
	await handlers.get("tool_call")(
		{ toolCallId: "call-no-report-validator", toolName: "subagent", input },
		ctx,
	);
	assert.match(input.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(input.task, /ORACLE_SUITE=bounded/);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-no-report-validator",
			toolName: "subagent",
			content: [{ type: "text", text: "Validator completed without a WorkerReport." }],
			isError: false,
		},
		ctx,
	);
}

// A WorkerReport with no validation results is unknown, so the public hook must
// give the Validator the full oracle contract rather than the bounded shortcut.
{
	const emptyValidationTask = delegationSpec("T-20260905-empty-validation");
	const emptyValidationInput = { agent: "worker", task: JSON.stringify(emptyValidationTask) };
	await handlers.get("tool_call")(
		{ toolCallId: "call-empty-validation-worker", toolName: "subagent", input: emptyValidationInput },
		ctx,
	);
	const emptyValidationReport = {
		version: 1,
		taskId: "T-20260905-empty-validation",
		status: "completed",
		summary: "No validation was run.",
		changedFiles: [],
		validation: [],
		evidence: {
			cwd: process.cwd(),
			taskId: "T-20260905-empty-validation",
			workerRunId: "call-empty-validation-worker",
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: cleanHash,
			changedPaths: [],
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
	};
	await handlers.get("tool_result")(
		{
			toolCallId: "call-empty-validation-worker",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: JSON.stringify(emptyValidationReport) }],
			isError: false,
		},
		ctx,
	);
	const emptyValidationValidator = {
		agent: "oracle",
		task: JSON.stringify({ ...emptyValidationTask, role: "validator" }),
	};
	await handlers.get("tool_call")(
		{ toolCallId: "call-empty-validation-validator", toolName: "subagent", input: emptyValidationValidator },
		ctx,
	);
	assert.match(emptyValidationValidator.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(emptyValidationValidator.task, /ORACLE_SUITE=bounded/);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-empty-validation-validator",
			toolName: "subagent",
			content: [{ type: "text", text: "Validator completed the full-suite review." }],
			isError: false,
		},
		ctx,
	);
}

// A not-run result and a passed result with a non-zero exit both require the full oracle contract.
{
	const contradictoryTask = delegationSpec("T-20260905-contradictory-validation");
	const contradictoryInput = { agent: "worker", task: JSON.stringify(contradictoryTask) };
	await handlers.get("tool_call")(
		{ toolCallId: "call-contradictory-validation-worker", toolName: "subagent", input: contradictoryInput },
		ctx,
	);
	const contradictoryReport = {
		version: 1,
		taskId: "T-20260905-contradictory-validation",
		status: "completed",
		summary: "Validation results are contradictory.",
		changedFiles: [],
		validation: [
			{ command: "npm test", type: "test", status: "not-run", exitCode: 0, summary: "not run" },
			{ command: "npm run test:e2e", type: "test", status: "passed", exitCode: 1, summary: "failed" },
		],
		evidence: {
			cwd: process.cwd(),
			taskId: "T-20260905-contradictory-validation",
			workerRunId: "call-contradictory-validation-worker",
			baseGitRef: "abc1234",
			finalGitRef: "abc1234",
			gitStatusHash: cleanHash,
			changedPaths: [],
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
		},
	};
	await handlers.get("tool_result")(
		{
			toolCallId: "call-contradictory-validation-worker",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: JSON.stringify(contradictoryReport) }],
			isError: false,
		},
		ctx,
	);
	const contradictoryValidator = {
		agent: "oracle",
		task: JSON.stringify({ ...contradictoryTask, role: "validator" }),
	};
	await handlers.get("tool_call")(
		{ toolCallId: "call-contradictory-validation-validator", toolName: "subagent", input: contradictoryValidator },
		ctx,
	);
	assert.match(contradictoryValidator.task, /ORACLE_SUITE=full/);
	assert.doesNotMatch(contradictoryValidator.task, /ORACLE_SUITE=bounded/);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-contradictory-validation-validator",
			toolName: "subagent",
			content: [{ type: "text", text: "Validator completed the full-suite review." }],
			isError: false,
		},
		ctx,
	);
}

// the worker returns a valid report wrapped in noise; the parent sees a bounded report
const workerReport = {
	version: 1,
	taskId: "T-20260905-100",
	status: "completed",
	summary: "Implemented the parser and its tests.",
	changedFiles: ["src/parser.ts", "src/parser.test.ts"],
	validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" }],
	evidence: {
		cwd: "/fixture/T-20260905-100",
		taskId: "T-20260905-100",
		workerRunId: "call-100",
		baseGitRef: "abc1234",
		finalGitRef: "abc1234",
		gitStatusHash: cleanHash,
		changedPaths: ["src/parser.ts", "src/parser.test.ts"],
		gitAvailable: true,
		generatedAt: "2026-08-31T10:00:00.000Z",
	},
	risks: ["strict about trailing commas"],
	unresolved: [],
};

const workerResult = await handlers.get("tool_result")(
	{
		toolCallId: "call-100",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: `Working... lots of raw noise that must not reach the parent.\n\`\`\`json\n${JSON.stringify(workerReport, null, 2)}\n\`\`\`\nDone!` }],
		isError: false,
	},
	ctx,
);
const workerText = workerResult.content[0].text;
const SNAPSHOT_DIGEST_RE = /workspaceDigest: ([0-9a-f]{16})/;
assert.match(workerText, /\[PLANNER-ONLY REVIEW STATE\]/);
assert.ok(workerText.includes(`taskId: ${CANON100}`));
assert.match(workerText, /decision: review_pending/);
assert.match(workerText, /evidence: fresh/);
assert.match(workerText, /\[PLANNER-ONLY WORKER REPORT\]/);
assert.match(workerText, /- \[passed\] test: npm test exit 0/);
assert.doesNotMatch(workerText, /Reviewer prompt template for an isolated fresh review:/);
assert.doesNotMatch(workerText, /You are an isolated reviewer/);
assert.doesNotMatch(workerText, /\[PLANNER-ONLY FRESH REVIEW\]/);
// the raw worker transcript is replaced, not forwarded
assert.doesNotMatch(workerText, /lots of raw noise/);

// The public hook bounds only after Root records a fresh comparison; a changed
// comparison forces the full listed validation commands again.
const publicBoundedValidator = { agent: "oracle", task: `Validate ${CANON100}` };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-fresh", toolName: "subagent", input: publicBoundedValidator },
	ctx,
);
assert.match(publicBoundedValidator.task, /ORACLE_SUITE=bounded/);
assert.doesNotMatch(publicBoundedValidator.task, /ORACLE_SUITE=full/);
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-fresh",
		toolName: "subagent",
		content: [{ type: "text", text: "Validator completed the bounded review." }],
		isError: false,
	},
	ctx,
);

// Ticket 12 round p10-r044: an explicit full-suite TaskSpec request remains full
// even with a complete, fresh WorkerReport.
const fullSuiteTaskId = "T-20260907-044";
const fullSuiteWorkerInput = {
	agent: "worker",
	task: JSON.stringify({
		...delegationSpec(fullSuiteTaskId),
		validation: { required: true, commands: ["npm test", "npm run test:e2e"] },
	}),
};
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-full-suite-worker", toolName: "subagent", input: fullSuiteWorkerInput },
	ctx,
);
const fullSuiteReport = {
	...workerReport,
	taskId: fullSuiteTaskId,
	validation: [
		{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "npm test passed" },
		{ command: "npm run test:e2e", type: "test", status: "passed", exitCode: 0, summary: "e2e passed" },
	],
	evidence: {
		...workerReport.evidence,
		taskId: fullSuiteTaskId,
		workerRunId: "call-100-oracle-full-suite-worker",
	},
};
const fullSuiteWorkerResult = await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-full-suite-worker",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(fullSuiteReport) }],
		isError: false,
	},
	ctx,
);
assert.ok(fullSuiteWorkerResult?.content?.length, "worker tool_result must be returned");
const fullSuiteValidator = { agent: "oracle", task: `Validate ${fullSuiteTaskId}` };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-full-suite-validator", toolName: "subagent", input: fullSuiteValidator },
	ctx,
);
assert.match(fullSuiteValidator.task, /ORACLE_SUITE=full/);
assert.match(fullSuiteValidator.task, /Re-run the listed validation commands/);
assert.doesNotMatch(fullSuiteValidator.task, /ORACLE_SUITE=(?:bounded|missing)/);
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-full-suite-validator",
		toolName: "subagent",
		content: [{ type: "text", text: "Validator completed the full-suite review." }],
		isError: false,
	},
	ctx,
);

// Ticket 12 round p10-r045: a public file-existence-only report cannot produce
// bounded validation or a passed status, and every public tool_call has a result.
const existenceTaskId = "T-20260907-045";
const existenceWorkerInput = {
	agent: "worker",
	task: JSON.stringify(delegationSpec(existenceTaskId)),
};
await handlers.get("tool_call")(
	{ toolCallId: "call-100-existence-worker", toolName: "subagent", input: existenceWorkerInput },
	ctx,
);
const existenceReport = {
	...workerReport,
	taskId: existenceTaskId,
	validation: [{ command: "test -f src/parser.test.ts", type: "test", status: "passed", exitCode: 0, summary: "test file exists" }],
	evidence: {
		...workerReport.evidence,
		taskId: existenceTaskId,
		workerRunId: "call-100-existence-worker",
	},
};
const existenceWorkerResult = await handlers.get("tool_result")(
	{
		toolCallId: "call-100-existence-worker",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify(existenceReport) }],
		isError: false,
	},
	ctx,
);
assert.ok(existenceWorkerResult?.content?.length, "existence worker tool_result must be returned");
const existenceValidator = { agent: "oracle", task: `Validate ${existenceTaskId}` };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-existence-validator", toolName: "subagent", input: existenceValidator },
	ctx,
);
assert.match(existenceValidator.task, /ORACLE_SUITE=full/);
assert.doesNotMatch(existenceValidator.task, /ORACLE_SUITE=(?:bounded|missing)/);
await commands.get("planner-only").handler("task", ctx);
assert.doesNotMatch(notices.at(-1).message, /Validation: passed/);
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-existence-validator",
		toolName: "subagent",
		content: [{ type: "text", text: "Validator completed the full-suite review." }],
		isError: false,
	},
	ctx,
);

const staleTaskId = "T-20260907-042";
const staleWorkerInput = { agent: "worker", task: JSON.stringify(delegationSpec(staleTaskId)) };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-stale-worker", toolName: "subagent", input: staleWorkerInput },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus.replace("2222222", "9999999"), stderr: "", code: 0 });
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-stale-worker",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify({
			...workerReport,
			taskId: staleTaskId,
			evidence: { ...workerReport.evidence, taskId: staleTaskId, workerRunId: "call-100-oracle-stale-worker" },
		}) }],
		isError: false,
	},
	ctx,
);
const publicStaleValidator = { agent: "oracle", task: `Validate ${staleTaskId}` };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-stale", toolName: "subagent", input: publicStaleValidator },
	ctx,
);
assert.match(publicStaleValidator.task, /ORACLE_SUITE=full/);
assert.doesNotMatch(publicStaleValidator.task, /ORACLE_SUITE=bounded/);
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-stale",
		toolName: "subagent",
		content: [{ type: "text", text: "Validator completed the full listed validation." }],
		isError: false,
	},
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });

gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
const missingTaskId = "T-20260907-043";
const missingWorkerInput = {
	agent: "worker",
	task: JSON.stringify({
		...delegationSpec(missingTaskId),
		scope: { allowedPaths: ["src/parser.ts", "src/parser.test.ts"] },
		validation: { required: true, commands: ["npm test", "npm run typecheck"] },
	}),
};
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-missing-worker", toolName: "subagent", input: missingWorkerInput },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-missing-worker",
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify({
			...workerReport,
			taskId: missingTaskId,
			changedFiles: ["src/parser.ts", "src/parser.test.ts"],
			validation: [
				{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "npm test passed" },
			],
			evidence: {
				...workerReport.evidence,
				cwd: `/fixture/${missingTaskId}`,
				taskId: missingTaskId,
				workerRunId: "call-100-oracle-missing-worker",
				changedPaths: ["src/parser.ts", "src/parser.test.ts"],
			},
		}) }],
		isError: false,
	},
	ctx,
);
const publicMissingValidator = { agent: "oracle", task: `Validate ${missingTaskId}` };
await handlers.get("tool_call")(
	{ toolCallId: "call-100-oracle-missing", toolName: "subagent", input: publicMissingValidator },
	ctx,
);
assert.match(publicMissingValidator.task, /ORACLE_SUITE=missing/);
assert.match(publicMissingValidator.task, /npm run typecheck/);
assert.doesNotMatch(publicMissingValidator.task, /ORACLE_SUITE=bounded/);
assert.doesNotMatch(publicMissingValidator.task, /ORACLE_SUITE=full/);
assert.doesNotMatch(publicMissingValidator.task, /Re-run the listed validation commands/);
await handlers.get("tool_result")(
	{
		toolCallId: "call-100-oracle-missing",
		toolName: "subagent",
		content: [{ type: "text", text: "Validator completed the missing validation commands." }],
		isError: false,
	},
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });

// a fresh reviewer on the same task records a verdict and advances the state
const reviewerSpec = delegationSpec("T-20260905-100", "reviewer");
const reviewInput = {
	agent: "worker",
	context: "fork",
	task: `Parent reasoning: I already decided this should pass. Please rubber-stamp it.\n${JSON.stringify(reviewerSpec)}`,
};
await handlers.get("tool_call")(
	{ toolCallId: "call-102", toolName: "subagent", input: reviewInput },
	ctx,
);
assert.equal(reviewInput.agent, "reviewer");
assert.equal(reviewInput.context, "fresh");
assert.match(reviewInput.task, /\[PLANNER-ONLY FRESH REVIEW\]/);
assert.ok(reviewInput.task.includes(`You are an isolated reviewer for task ${CANON100}`));
assert.ok(reviewInput.task.includes(CANON100));
assert.match(reviewInput.task, /Implemented the parser/);
assert.match(reviewInput.task, /You receive only the ReviewRequest below/);
assert.match(reviewInput.task, /ReviewRequest:/);
assert.doesNotMatch(reviewInput.task, /rubber-stamp/);
assert.doesNotMatch(reviewInput.task, /I already decided/);
const reviewResult = {
	taskId: CANON100,
	verdict: "request_changes",
	summary: "the parser has no test coverage",
	evidenceFresh: true,
	reportRevision: 1,
	// D09 — echo the workspace snapshot digest the rendered report carries.
	workspaceDigest: SNAPSHOT_DIGEST_RE.exec(workerText)?.[1],
	findings: [
		{ severity: "major", category: "test", description: "no test for empty input", requestedChange: "add a case" },
		{ severity: "minor", category: "maintainability", description: "naming" },
	],
};
const reviewOutcome = await handlers.get("tool_result")(
	{ toolCallId: "call-102", toolName: "subagent", input: {}, content: [{ type: "text", text: JSON.stringify(reviewResult) }], isError: false },
	ctx,
);
const reviewText = reviewOutcome.content[0].text;
assert.match(reviewText, /\[FRESH REVIEWER\] verdict: request_changes/);
assert.match(reviewText, /decision: request_changes/);
assert.match(reviewText, /\[major\] test: no test for empty input/);
assert.doesNotMatch(reviewText, /decision: accept/);

notices.length = 0;
await commands.get("planner-only").handler(`review T-20260905-100`, ctx);
assert.match(notices.at(-1).message, /State: changes_requested/);
assert.match(notices.at(-1).message, /Round: 1\/3/);

// root accepts despite the reviewer; the override is recorded, not silent
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-100 pass finding was out of scope", ctx);
assert.match(notices.at(-1).message, /decision: accept/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-100", ctx);
assert.match(notices.at(-1).message, /State: completed/);
assert.match(notices.at(-1).message, /Overrides: 1/);
assert.match(notices.at(-1).message, /Changed files: 2/);

// review mode switching
notices.length = 0;
await handlers.get("tool_call")(
	{ toolCallId: "call-110", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-110")) } },
	ctx,
);
await commands.get("planner-only").handler("review T-20260905-110 fresh", ctx);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-110", ctx);
assert.match(notices.at(-1).message, /Review mode: fresh/);
await commands.get("planner-only").handler("review T-20260905-110 root", ctx);

// Strict mode refuses only the persistent root-mode escape hatch. The task
// remains fresh, while the fresh command stays available for recovery.
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const strictTaskId = "T-20260905-501";
		await handlers.get("tool_call")(
			{ toolCallId: "call-501", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(strictTaskId)) } },
			ctx,
		);
		notices.length = 0;
		await commands.get("planner-only").handler(`review ${strictTaskId} root`, ctx);
		assert.match(notices.at(-1).message, /Strict mode \(PI_PLANNER_ONLY_REQUIRE_REVIEW=1\)/);
		assert.match(notices.at(-1).message, /reviewer ReviewResult/);
		assert.match(notices.at(-1).message, /evidence attribution must have > 0 paths/);
		assert.match(notices.at(-1).message, /unset PI_PLANNER_ONLY_REQUIRE_REVIEW and restart the session/);
		notices.length = 0;
		await commands.get("planner-only").handler(`task ${strictTaskId}`, ctx);
		assert.match(notices.at(-1).message, /Review mode: fresh/);
		notices.length = 0;
		await commands.get("planner-only").handler(`review ${strictTaskId} fresh`, ctx);
		assert.match(notices.at(-1).message, /^Review mode for T-\d{8}-\d{3} set to fresh\.$/);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}

// Without strict mode, root mode retains the original receipt verbatim.
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		const defaultTaskId = "T-20260905-502";
		await handlers.get("tool_call")(
			{ toolCallId: "call-502", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(defaultTaskId)) } },
			ctx,
		);
		notices.length = 0;
		await commands.get("planner-only").handler(`review ${defaultTaskId} root`, ctx);
		assert.match(notices.at(-1).message, /^Review mode for T-\d{8}-\d{3} set to root\.$/);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}

// malformed worker output triggers exactly one report-only correction
await handlers.get("tool_call")(
	{ toolCallId: "call-120", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-120")) } },
	ctx,
);
const malformed = await handlers.get("tool_result")(
	{ toolCallId: "call-120", toolName: "subagent", input: {}, content: [{ type: "text", text: "I tried but gave up." }], isError: false },
	ctx,
);
assert.match(malformed.content[0].text, /not a valid WorkerReport/);
assert.match(malformed.content[0].text, /report-only correction/);
assert.match(malformed.content[0].text, /I tried but gave up/);

// one writer per cwd: a second declared writer is blocked while the first runs
await handlers.get("tool_call")(
	{
		toolCallId: "call-200",
		toolName: "subagent",
		input: { task: JSON.stringify(delegationSpec("T-20260905-200", "worker", "/fixture/shared")) },
	},
	ctx,
);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-200", ctx);
const CANON200 = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
assert.ok(CANON200, "task status must print the canonical holder id");
const blockedWriter = await handlers.get("tool_call")(
	{
		toolCallId: "call-201",
		toolName: "subagent",
		input: { task: JSON.stringify(delegationSpec("T-20260905-201", "worker", "/fixture/shared")) },
	},
	ctx,
);
assert.equal(blockedWriter.block, true);
assert.match(blockedWriter.reason, /write lock/);
assert.ok(blockedWriter.reason.includes(CANON200), blockedWriter.reason);
// readers never take the write lock
const readerCall = await handlers.get("tool_call")(
	{ toolCallId: "call-202", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-202", "explorer")) } },
	ctx,
);
assert.equal(readerCall, undefined);
const explorerInput = { agent: "worker", task: JSON.stringify(delegationSpec("T-20260905-203", "explorer")) };
await handlers.get("tool_call")(
	{ toolCallId: "call-203", toolName: "subagent", input: explorerInput },
	ctx,
);
assert.equal(explorerInput.agent, "reviewer");

const workerInput = { agent: "worker", context: "fork", task: JSON.stringify(delegationSpec("T-20260905-204")) };
await handlers.get("tool_call")(
	{ toolCallId: "call-204", toolName: "subagent", input: workerInput },
	ctx,
);
assert.equal(workerInput.agent, "worker");
assert.equal(workerInput.context, "fresh");

// evidence drift: an external edit after the report marks the evidence stale
await handlers.get("tool_call")(
	{ toolCallId: "call-300", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-300")) } },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", {
	stdout: "1 .M N... 100644 100644 100644 1111111 2222222 unrelated.md\n",
	stderr: "",
	code: 0,
});
gitResponses.set("diff HEAD --stat", { stdout: " unrelated.md | 1 +\n", stderr: "", code: 0 });
const staleResult = await handlers.get("tool_result")(
	{
		toolCallId: "call-300",
		toolName: "subagent",
		input: {},
		content: [{
			type: "text",
			text: JSON.stringify({
				...workerReport,
				taskId: "T-20260905-300",
				evidence: { ...workerReport.evidence, taskId: "T-20260905-300", workerRunId: "call-300", cwd: "/fixture/T-20260905-300", gitStatusHash: cleanHash, changedPaths: ["src/parser.ts"] },
			}),
		}],
		isError: false,
	},
	ctx,
);
assert.match(staleResult.content[0].text, /decision: revalidate/);
assert.match(staleResult.content[0].text, /evidence: stale/);
assert.match(staleResult.content[0].text, /out-of-scope paths changed/);
assert.match(staleResult.content[0].text, /re-delegate validation/);
gitResponses.delete("status --porcelain=v2 --branch");
gitResponses.delete("diff HEAD --stat");

// §P0-3 race: an external edit between the report and a Root PASS rejects the pass
gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
await handlers.get("tool_call")(
	{ toolCallId: "call-400", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-400")) } },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
const freshReport = {
	...workerReport,
	taskId: "T-20260905-400",
	// The declaration must match the fixture worktree exactly: an in-scope
	// path missing from changedPaths is an E01 under-report finding.
	evidence: { ...workerReport.evidence, taskId: "T-20260905-400", workerRunId: "call-400", cwd: "/fixture/T-20260905-400" },
};
const raceWorker = await handlers.get("tool_result")(
	{ toolCallId: "call-400", toolName: "subagent", input: {}, content: [{ type: "text", text: JSON.stringify(freshReport) }], isError: false },
	ctx,
);
assert.match(raceWorker.content[0].text, /decision: review_pending/);
gitResponses.set("rev-parse HEAD", { stdout: "def5678\n", stderr: "", code: 0 });
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-400 pass accepting late", ctx);
assert.match(notices.at(-1).message, /decision: revalidate/);
assert.match(notices.at(-1).message, /evidence: stale/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-400", ctx);
assert.match(notices.at(-1).message, /State: changes_requested/);
gitResponses.delete("rev-parse HEAD");

// B6. message_end with a subagent-notify custom message returns a replaced
// message whose text starts with [PLANNER-ONLY REVIEW STATE]; a non-matching
// custom message is returned untouched.
assert.equal(handlers.has("message_end"), true);
{
	const foreign = { role: "custom", customType: "other-notify", content: "not a subagent-notify", display: "keep-display" };
	const foreignOut = await handlers.get("message_end")({ message: foreign });
	assert.equal(foreignOut, undefined);
}

{
	const taskId = "T-20260905-206";
	const runId = "b6b6b6b6-0000-0000-0000-0000000000b6";
	await handlers.get("tool_call")(
		{
			toolCallId: "call-b6",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const CANON206 = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	assert.ok(CANON206, "task status must print the canonical async task id");
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	const receipt = await handlers.get("tool_result")(
		{
			toolCallId: "call-b6",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
			content: [{
				type: "text",
				text: `Async: worker [${runId}]\nThe async run is detached and running in the background.`,
			}],
		},
		ctx,
	);
	assert.ok(receipt.content[0].text.includes(`Async delegation for task ${CANON206} has started`), receipt.content[0].text);

	const asyncReport = {
		...workerReport,
		taskId,
		evidence: {
			...workerReport.evidence,
			taskId,
			workerRunId: "call-b6",
			cwd: `/fixture/${taskId}`,
			changedPaths: ["src/parser.ts"],
		},
	};
	const notifyText = `Background task completed: **worker**\n\n${JSON.stringify(asyncReport)}\n\nChild runs: ${runId}`;
	const display = "Background task completed: worker";
	const replaced = await handlers.get("message_end")({
		message: { role: "custom", customType: "subagent-notify", content: notifyText, display },
	});
	assert.match(replaced.message.content, /^\[PLANNER-ONLY REVIEW STATE\]/);
	assert.equal(replaced.message.display, display);
	assert.equal(replaced.message.customType, "subagent-notify");
	assert.equal(replaced.message.role, "custom");
}

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
assert.match(PLANNER_PROMPT, /One bounded TaskSpec embedded in one direct \{agent, task\}/);
assert.match(PLANNER_PROMPT, /canonical id returned by the extension/);
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
const unknownVerdict = await verdictTool.execute(
	"v-0",
	{ verdict: "pass", summary: "no such task", taskId: "T-20260905-nope" },
	undefined,
	undefined,
	ctx,
);
assert.equal(unknownVerdict.isError, true);
assert.match(unknownVerdict.content[0].text, /unknown task T-20260905-nope/);
assert.match(unknownVerdict.content[0].text, /planner_verdict/);

// Ticket 22 round p10-r046: public planner_verdict refuses strict pass without reviewer.
{
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const taskId = "T-20260905-221";
		const toolCallId = "call-221-worker";
		const toolResult = await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
			ctx,
		);
		assert.equal(toolResult?.block, undefined);
		const worker = await handlers.get("tool_result")(
			{
				toolCallId,
				toolName: "subagent",
				input: {},
				content: [{ type: "text", text: JSON.stringify({
					...workerReport,
					taskId,
					evidence: { ...workerReport.evidence, taskId, workerRunId: toolCallId, cwd: `/fixture/${taskId}` },
				}) }],
				isError: false,
			},
			ctx,
		);
		assert.equal(worker.isError, undefined);
		const refused = await verdictTool.execute(
			"v-221",
			{ verdict: "pass", summary: "strict gate", taskId },
			undefined,
			undefined,
			ctx,
		);
		assert.equal(refused.isError, true);
		assert.match(refused.content[0].text, /planner_verdict refused:/);
		assert.match(refused.content[0].text, /reviewer ReviewResult/);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}

// pass with no recorded WorkerReport -> refused, state unchanged
const noReportVerdict = await verdictTool.execute(
	"v-1",
	{ verdict: "pass", summary: "nothing to judge", taskId: "T-20260905-110" },
	undefined,
	undefined,
	ctx,
);
assert.equal(noReportVerdict.isError, true);
assert.match(noReportVerdict.content[0].text, /no recorded WorkerReport/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-110", ctx);
assert.match(notices.at(-1).message, /State: executing/, "a refused verdict changes nothing");

// a worker task with a fresh report, then a pending reviewer run
gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
await handlers.get("tool_call")(
	{ toolCallId: "call-v10", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-510")) } },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
const v10Report = {
	...workerReport,
	taskId: "T-20260905-510",
	evidence: { ...workerReport.evidence, taskId: "T-20260905-510", workerRunId: "call-v10", cwd: "/fixture/T-20260905-510" },
};
const v10Worker = await handlers.get("tool_result")(
	{ toolCallId: "call-v10", toolName: "subagent", input: {}, content: [{ type: "text", text: JSON.stringify(v10Report) }], isError: false },
	ctx,
);
assert.match(v10Worker.content[0].text, /decision: review_pending/);
const CANON510 = /taskId: (T-\d{8}-\d{3})/.exec(v10Worker.content[0].text)?.[1];
const digest510 = SNAPSHOT_DIGEST_RE.exec(v10Worker.content[0].text)?.[1];
assert.ok(digest510, "the rendered report must carry the workspace snapshot digest");
assert.ok(CANON510, "decision block must print the canonical task id");

// pass while a reviewer delegation is pending -> refused
await handlers.get("tool_call")(
	{ toolCallId: "call-v11", toolName: "subagent", input: { agent: "reviewer", task: JSON.stringify(delegationSpec("T-20260905-510", "reviewer")) } },
	ctx,
);
const pendingVerdict = await verdictTool.execute(
	"v-2",
	{ verdict: "pass", summary: "jumping the gun", taskId: "T-20260905-510" },
	undefined,
	undefined,
	ctx,
);
assert.equal(pendingVerdict.isError, true);
assert.match(pendingVerdict.content[0].text, /still pending/);

// the reviewer requests changes; Root's pass is then accepted as an override
const v11Outcome = await handlers.get("tool_result")(
	{
		toolCallId: "call-v11",
		toolName: "subagent",
		input: {},
		content: [{ type: "text", text: JSON.stringify({
			taskId: CANON510,
			verdict: "request_changes",
			summary: "missing empty-input coverage",
			evidenceFresh: true,
			reportRevision: 1,
			workspaceDigest: digest510,
			findings: [{ severity: "major", category: "test", description: "no empty-input case", requestedChange: "add a case" }],
		}) }],
		isError: false,
	},
	ctx,
);
assert.match(v11Outcome.content[0].text, /decision: request_changes/);
const rootPass = await verdictTool.execute(
	"v-3",
	{ verdict: "pass", summary: "finding is out of scope for this task", taskId: "T-20260905-510" },
	undefined,
	undefined,
	ctx,
);
assert.equal(rootPass.isError, undefined);
assert.equal(rootPass.details.taskId, CANON510);
assert.equal(rootPass.details.verdict, "pass");
assert.equal(rootPass.details.action, "accept");
assert.equal(rootPass.details.state, "completed");
assert.match(rootPass.content[0].text, /^\[PLANNER-ONLY REVIEW STATE\]/);
assert.match(rootPass.content[0].text, /decision: accept/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-510", ctx);
assert.match(notices.at(-1).message, /State: completed/);
assert.match(notices.at(-1).message, /Reviews: request_changes \(reviewer\), pass \(root\)/);
assert.match(notices.at(-1).message, /Overrides: 1/);

// blocked with no report is allowed (no delegation pending)
await handlers.get("tool_call")(
	{ toolCallId: "call-v12", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-512")) } },
	ctx,
);
await handlers.get("tool_result")(
	{ toolCallId: "call-v12", toolName: "subagent", input: {}, content: [{ type: "text", text: "I could not produce a report." }], isError: false },
	ctx,
);
const blockedVerdict = await verdictTool.execute(
	"v-4",
	{ verdict: "blocked", summary: "worker cannot proceed without credentials", taskId: "T-20260905-512" },
	undefined,
	undefined,
	ctx,
);
assert.equal(blockedVerdict.isError, undefined);
assert.equal(blockedVerdict.details.action, "blocked");
assert.equal(blockedVerdict.details.state, "blocked");

// §4: the operator override bypasses refusals (here: pending run, no report)
// with a printed warning; the terminal-state refusal still holds
await handlers.get("tool_call")(
	{ toolCallId: "call-v13", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-513")) } },
	ctx,
);
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-513 pass forcing the issue", ctx);
assert.ok(
	notices.some((notice) => notice.type === "warning" && /bypassed refusal/i.test(notice.message)),
	"the override prints which refusal it bypassed",
);
assert.match(notices.at(-1).message, /\[PLANNER-ONLY REVIEW STATE\]/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-513", ctx);
assert.match(notices.at(-1).message, /Reviews: pass \(operator\)/);
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-513 pass again", ctx);
assert.match(notices.at(-1).message, /already completed/);
const terminalVerdict = await verdictTool.execute(
	"v-5",
	{ verdict: "pass", summary: "again", taskId: "T-20260905-513" },
	undefined,
	undefined,
	ctx,
);
assert.equal(terminalVerdict.isError, true);
assert.match(terminalVerdict.content[0].text, /already completed/);
assert.doesNotMatch(terminalVerdict.content[0].text, /\/planner-only/);
assert.match(
	terminalVerdict.content[0].text,
	/verdicts are final\. Start a new Task with a new TaskSpec for further work\./,
);

// L-4: Task blocked with one report and fresh evidence: planner_verdict(pass) → completed, one usage line with completed
{
	const taskId = "T-20260905-540";
	gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-l4u", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n src/parser.test.ts | 2 +-\n", stderr: "", code: 0 });
	await handlers.get("tool_result")(
		{
			toolCallId: "call-l4u",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: {
					...workerReport.evidence,
					taskId,
					workerRunId: "call-l4u",
					cwd: `/fixture/${taskId}`,
				},
			}) }],
			isError: false,
		},
		ctx,
	);
	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-l4u",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 200, output: 50, cacheRead: 10, cacheWrite: 0, cost: 0.15 },
			content: "reconsidering",
		},
	}, ctx);
	await verdictTool.execute(
		"v-l4-block",
		{ verdict: "blocked", summary: "pause", taskId },
		undefined,
		undefined,
		ctx,
	);
	const passBlocked = await verdictTool.execute(
		"v-l4-pass",
		{ verdict: "pass", summary: "ok to close", taskId },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(passBlocked.isError, undefined);
	assert.equal(passBlocked.details.state, "completed");
	assert.match(passBlocked.content[0].text, /\nusage: /);
	assert.match(passBlocked.content[0].text, /state: completed/);
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	// The usage log uses the store's canonical id; the fixture alias only resolves to it.
	const canon540 = passBlocked.details.taskId;
	const completedLines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((row) => row.taskId === canon540 && row.state === "completed");
	assert.equal(completedLines.length, 1);
}

// L-5: usage.jsonl line uses the canonical id, not the model-chosen alias
{
	notices.length = 0;
	gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-l5u", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260220-099")) } },
		ctx,
	);
	assert.ok(
		notices.some((item) => /TaskSpec id T-20260220-099 replaced by T-\d{8}-\d{3} \(generated\)/.test(item.message)),
		notices.map((item) => item.message).join(" | "),
	);
	notices.length = 0;
	await commands.get("planner-only").handler("task", ctx);
	const status = notices.at(-1).message;
	assert.match(status, /^Task: T-\d{8}-\d{3}/m);
	assert.match(status, /aliases: T-20260220-099/);
	const canonical = status.match(/^Task: (T-\d{8}-\d{3})/m)[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	await handlers.get("tool_result")(
		{
			toolCallId: "call-l5u",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: "T-20260220-099",
				evidence: {
					...workerReport.evidence,
					taskId: "T-20260220-099",
					workerRunId: "call-l5u",
					cwd: `/fixture/T-20260220-099`,
				},
			}) }],
			isError: false,
		},
		ctx,
	);
	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-l5u",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 200, output: 50, cacheRead: 10, cacheWrite: 0, cost: 0.15 },
			content: "alias usage",
		},
	}, ctx);
	const passAlias = await verdictTool.execute(
		"v-l5-pass",
		{ verdict: "pass", summary: "close on canonical", taskId: canonical },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(passAlias.isError, undefined);
	assert.equal(passAlias.details.state, "completed");
	assert.equal(passAlias.details.taskId, canonical);
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	const rows = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	assert.ok(rows.some((row) => row.taskId === canonical && row.state === "completed"));
	assert.equal(rows.some((row) => row.taskId === "T-20260220-099"), false);
}

// L-4: operator override still bypasses rules 2–4 and not rule 1 (covered above for pending/no-report vs completed)

// --------------------------------------------------------------------------
// U-2 / U-3 / U-4 / RF-6 — usage capture and failed launch through the adapter
// --------------------------------------------------------------------------

{
	sessionEntries.length = 0;
	const taskId = "T-20260905-520";
	await handlers.get("tool_call")(
		{ toolCallId: "call-u2", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	const rootTurn = await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-u2",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0, cost: { total: 0 } },
			content: "delegating",
		},
	}, ctx);
	assert.equal(rootTurn, undefined);
	assert.ok(
		sessionEntries.some((entry) => entry.customType === "planner-only-usage" && entry.data.kind === "root-turn"),
		"assistant message_end persists a root-turn entry",
	);

	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	const sync = await handlers.get("tool_result")(
		{
			toolCallId: "call-u2",
			toolName: "subagent",
			details: {
				results: [{
					agent: "worker",
					model: "volcengine/glm-5-3",
					usage: { input: 50, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.02, turns: 2 },
				}],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-u2", cwd: `/fixture/${taskId}`, changedPaths: ["src/parser.ts"] },
			}) }],
			isError: false,
		},
		ctx,
	);
	assert.match(sync.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.ok(sessionEntries.some((entry) =>
		entry.customType === "planner-only-usage"
		&& entry.data.kind === "child"
		&& entry.data.child?.source === "sync-details"
		&& entry.data.child?.pending === false,
	));
	assert.ok(sessionEntries.some((entry) => entry.data.kind === "injected"));
}

{
	const taskId = "T-20260905-521";
	await handlers.get("tool_call")(
		{ toolCallId: "call-leak", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	await handlers.get("tool_result")(
		{
			toolCallId: "call-leak",
			toolName: "subagent",
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-leak", cwd: `/fixture/${taskId}`, changedPaths: ["src/parser.ts"] },
			}) }],
			isError: false,
		},
		ctx,
	);
	sessionEntries.length = 0;
	const beforeLeak = sessionEntries.length;
	await handlers.get("tool_result")(
		{ toolCallId: "read-1", toolName: "read", content: [{ type: "text", text: "diff contents here" }] },
		ctx,
	);
	assert.ok(sessionEntries.some((entry) => entry.data.kind === "leak" && entry.data.bytes === Buffer.byteLength("diff contents here")));
	assert.equal(beforeLeak, 0);
}

{
	const taskId = "T-20260905-522";
	const runId = "run-bgw-0001";
	await handlers.get("tool_call")(
		{
			toolCallId: "call-bgw",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-bgw",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);
	sessionEntries.length = 0;
	const bg = await handlers.get("tool_result")(
		{
			toolCallId: "wait-1",
			toolName: "bg_wait",
			details: {
				completions: [{
					runId,
					agent: "worker",
					results: [{ usage: { input: 9, output: 3, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 }, model: "volcengine/glm-5-3" }],
				}],
			},
			content: [{ type: "text", text: "waited" }],
		},
		ctx,
	);
	assert.equal(bg, undefined, "bg_wait must not rewrite content");
	assert.ok(sessionEntries.some((entry) =>
		entry.data.kind === "child" && entry.data.child?.source === "bg-wait" && entry.data.child?.pending === false,
	));
	// Task stays executing: WorkerReport still comes from notify, not bg_wait
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	assert.match(notices.at(-1).message, /State: executing/);
}

{
	const taskId = "T-20260905-523";
	const runId = "run-meta-async";
	const artifacts = join(isolatedAgentDir, "sessions", "subagent-artifacts");
	mkdirSync(artifacts, { recursive: true });
	writeFileSync(join(artifacts, `${runId}_worker_meta.json`), JSON.stringify({
		runId,
		agent: "worker",
		model: "volcengine/glm-5-3",
		usage: { input: 21, output: 4, cacheRead: 0, cacheWrite: 0, cost: 0.03, turns: 1 },
	}));
	await handlers.get("tool_call")(
		{
			toolCallId: "call-meta",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-meta",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	sessionEntries.length = 0;
	const replaced = await handlers.get("message_end")({
		message: {
			role: "custom",
			customType: "subagent-notify",
			content: `Background task completed: **worker**\n\n${JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-meta", cwd: `/fixture/${taskId}`,  },
			})}`,
		},
	}, ctx);
	assert.match(replaced.message.content, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.ok(sessionEntries.some((entry) =>
		entry.data.kind === "child" && entry.data.child?.source === "meta-file" && entry.data.child?.pending === false,
	));
}

{
	const taskId = "T-20260905-530";
	const runId = "run-oracle-usage";
	const artifacts = join(isolatedAgentDir, "sessions", "subagent-artifacts");
	mkdirSync(artifacts, { recursive: true });
	writeFileSync(join(artifacts, `${runId}_oracle_meta.json`), JSON.stringify({
		runId,
		agent: "oracle",
		model: "volcengine/glm-5-3-flash:medium",
		usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0.04, turns: 3 },
	}));
	gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-ou-w", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	await handlers.get("tool_result")(
		{
			toolCallId: "call-ou-w",
			toolName: "subagent",
			details: {
				results: [{
					agent: "worker",
					model: "volcengine/glm-5-3-flash:high",
					usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.01, turns: 1 },
				}],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-ou-w", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	await handlers.get("tool_call")(
		{
			toolCallId: "call-ou-o",
			toolName: "subagent",
			input: { agent: "oracle", task: JSON.stringify(delegationSpec(taskId, "validator")) },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-ou-o",
			toolName: "subagent",
			details: { runId, results: [] },
			content: [{ type: "text", text: "HEAD matches; named tests exist." }],
			isError: false,
		},
		ctx,
	);
	const passed = await verdictTool.execute(
		"v-oracle-usage",
		{ verdict: "pass", summary: "oracle usage must land", taskId },
		undefined,
		undefined,
		ctx,
	);
	assert.equal(passed.details?.state, "completed", passed.content?.[0]?.text);
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	const canon = passed.details.taskId;
	const completed = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean)
		.map((line) => JSON.parse(line))
		.filter((row) => row.taskId === canon && row.state === "completed");
	assert.ok(completed.length >= 1);
	const last = completed.at(-1);
	assert.ok(
		last.children.some((child) => child.agent === "oracle" && child.costUsd === 0.04),
		JSON.stringify(last.children),
	);
}

{
	const taskId = "T-20260905-524";
	const runId = "run-no-meta";
	await handlers.get("tool_call")(
		{
			toolCallId: "call-pend",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-pend",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-async-dir" },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	sessionEntries.length = 0;
	await handlers.get("message_end")({
		message: {
			role: "custom",
			customType: "subagent-notify",
			content: `Background task completed: **worker**\n\n${JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-pend", cwd: `/fixture/${taskId}`,  },
			})}`,
		},
	}, ctx);
	assert.ok(sessionEntries.some((entry) =>
		entry.data.kind === "child" && entry.data.child?.source === "unavailable" && entry.data.child?.pending === true,
	));
}

{
	const taskId = "T-20260905-525";
	await handlers.get("tool_call")(
		{
			toolCallId: "call-rf6i",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
	const failed = await handlers.get("tool_result")(
		{
			toolCallId: "call-rf6i",
			toolName: "subagent",
			isError: true,
			details: { asyncId: "run-rf6i", runId: "run-rf6i" },
			content: [{ type: "text", text: "Unknown subagent model 'volcengine/glm-5-3-flash'" }],
		},
		ctx,
	);
	assert.match(failed.content[0].text, /failed to launch/);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	assert.match(notices.at(-1).message, /State: failed/);
	assert.match(notices.at(-1).message, /delegation launch failed/);
}

{
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	assert.equal(existsSync(logPath), true, "terminal tasks append usage.jsonl");
	const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
	assert.ok(lines.length >= 1);
	const parsed = JSON.parse(lines[0]);
	assert.ok(parsed.taskId);
	assert.ok(parsed.state);
	assert.ok(parsed.root);
}

// --------------------------------------------------------------------------
// U-5 — Usage reporting, decision block usage line, and soft budget warning
// --------------------------------------------------------------------------

{
	// /planner-only status includes usage log path and enabled state
	notices.length = 0;
	await commands.get("planner-only").handler("status", ctx);
	assert.match(notices.at(-1).message, /Planner-only mode is on/);
	assert.match(notices.at(-1).message, /Usage log: .*usage\.jsonl \(enabled\)/);
	assert.match(notices.at(-1).message, /无模型成本保证/);
	assert.match(notices.at(-1).message, /会话 root 预算未开启/);
}

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

{
	const taskId = "T-20260905-526";
	await handlers.get("tool_call")(
		{ toolCallId: "call-u5-1", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	// Worker completes before any Root turn has occurred
	const firstSync = await handlers.get("tool_result")(
		{
			toolCallId: "call-u5-1",
			toolName: "subagent",
			details: {
				results: [{
					agent: "worker",
					model: "volcengine/glm-5-3",
					usage: { input: 50, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.02, turns: 2 },
				}],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-u5-1", cwd: `/fixture/${taskId}`, changedPaths: ["src/parser.ts"] },
			}) }],
			isError: false,
		},
		ctx,
	);
	// Decision block before first Root turn: NO usage line
	assert.match(firstSync.content[0].text, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.doesNotMatch(firstSync.content[0].text, /\nusage: /);

	// Root turn occurs
	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-u5-1",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 200, output: 50, cacheRead: 10, cacheWrite: 0, cost: 0.15 },
			content: "evaluating evidence",
		},
	}, ctx);

	// Root records verdict with planner_verdict -> decision block now HAS usage line
	const verdictResult = await tools.get("planner_verdict").execute(
		"v-call-1",
		{ verdict: "request_changes", summary: "fix edge case", taskId },
		undefined,
		undefined,
		ctx,
	);
	const verdictText = verdictResult.content[0].text;
	const canon526 = verdictResult.details.taskId;
	assert.match(verdictText, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.match(verdictText, /\nusage: /);
	// In verdict without evidence, usage line is placed before reason:
	assert.match(verdictText, /\nusage: root .+\nreason: /);

	// /planner-only usage command tests
	notices.length = 0;
	await commands.get("planner-only").handler(`usage ${taskId}`, ctx);
	assert.match(notices.at(-1).message, new RegExp(`Usage for ${canon526}`));
	assert.match(notices.at(-1).message, /Root/);
	assert.match(notices.at(-1).message, /Child/);

	// /planner-only usage without args when active task exists
	notices.length = 0;
	await commands.get("planner-only").handler("usage", ctx);
	assert.match(notices.at(-1).message, new RegExp(`Usage for ${canon526}`));

	// /planner-only usage session
	notices.length = 0;
	await commands.get("planner-only").handler("usage session", ctx);
	assert.match(notices.at(-1).message, /Usage for session/);
	assert.match(notices.at(-1).message, /untasked:/);

	// /planner-only usage reload
	notices.length = 0;
	await commands.get("planner-only").handler("usage reload", ctx);
	assert.match(notices.at(-1).message, /reloaded pricing table/);

	// /planner-only usage unknown task
	notices.length = 0;
	await commands.get("planner-only").handler("usage T-nonexistent-000", ctx);
	assert.match(notices.at(-1).message, /Unknown planner-only task: T-nonexistent-000/);
}

// Soft budget warning tests
{
	// Case 1: Above both thresholds (root share > 0.6 AND reviewLeakBytes > 8192) on review_pending
	const taskId = "T-20260905-527";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wboth-1", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	await handlers.get("tool_result")(
		{
			toolCallId: "call-wboth-1",
			toolName: "subagent",
			details: {
				results: [{
					agent: "worker",
					model: "volcengine/glm-5-3",
					usage: { input: 100, output: 20, cost: 0.10 },
				}],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wboth-1", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);

	// Root turn with high cost (1.0 vs child 0.10 -> root share = 1.0/1.10 = 90.9% > 0.6):
	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-wboth-1",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 5000, output: 1000, cost: 1.0 },
			content: "reading diff",
		},
	}, ctx);

	// Review leak > 8192 bytes:
	const leakPayload = "x".repeat(10_000);
	await handlers.get("tool_result")(
		{ toolCallId: "read-wboth", toolName: "read", content: [{ type: "text", text: leakPayload }] },
		ctx,
	);

	// Next round / correction delegation triggers review_pending:
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wboth-2", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	const resReviewPending = await handlers.get("tool_result")(
		{
			toolCallId: "call-wboth-2",
			toolName: "subagent",
			details: {
				results: [{
					agent: "worker",
					model: "volcengine/glm-5-3",
					usage: { input: 50, output: 10, cost: 0.05 },
				}],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wboth-2", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	assert.match(resReviewPending.content[0].text, /decision: review_pending/);
	assert.match(resReviewPending.content[0].text, /evidence: .+\nusage: root .+\nreason: /);
	assert.match(resReviewPending.content[0].text, /warning: Root is reading the diff itself; consider a fresh reviewer/);
}

{
	// Case 2: Below leak threshold (leak <= 8192), root share > 0.6
	const taskId = "T-20260905-528";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wll-1", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	await handlers.get("tool_result")(
		{
			toolCallId: "call-wll-1",
			toolName: "subagent",
			details: {
				results: [{ agent: "worker", model: "volcengine/glm-5-3", usage: { input: 100, output: 20, cost: 0.10 } }],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wll-1", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);

	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-wll-1",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 5000, output: 1000, cost: 1.0 },
			content: "reading diff",
		},
	}, ctx);

	// Review leak only 1000 bytes (<= 8192):
	await handlers.get("tool_result")(
		{ toolCallId: "read-wll", toolName: "read", content: [{ type: "text", text: "x".repeat(1000) }] },
		ctx,
	);

	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wll-2", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	const resLowLeak = await handlers.get("tool_result")(
		{
			toolCallId: "call-wll-2",
			toolName: "subagent",
			details: {
				results: [{ agent: "worker", model: "volcengine/glm-5-3", usage: { input: 50, output: 10, cost: 0.05 } }],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wll-2", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	assert.match(resLowLeak.content[0].text, /decision: review_pending/);
	assert.doesNotMatch(resLowLeak.content[0].text, /warning: Root is reading the diff itself/);
}

{
	// Case 3: Below root share threshold (root share <= 0.6), leak > 8192
	const taskId = "T-20260905-529";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wls-1", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	await handlers.get("tool_result")(
		{
			toolCallId: "call-wls-1",
			toolName: "subagent",
			details: {
				results: [{ agent: "worker", model: "volcengine/glm-5-3", usage: { input: 10000, output: 2000, cost: 5.0 } }],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wls-1", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);

	// Root cost 0.10 vs child 5.0 -> root share = 0.10/5.10 = ~2% < 0.6:
	await handlers.get("message_end")({
		message: {
			role: "assistant",
			id: "msg-wls-1",
			model: "tcuni-claude/claude-fable-5-1",
			provider: "tcuni-claude",
			usage: { input: 100, output: 20, cost: 0.10 },
			content: "reading diff",
		},
	}, ctx);

	// Review leak > 8192 bytes:
	await handlers.get("tool_result")(
		{ toolCallId: "read-wls", toolName: "read", content: [{ type: "text", text: "x".repeat(10000) }] },
		ctx,
	);

	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-wls-2", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	const resLowShare = await handlers.get("tool_result")(
		{
			toolCallId: "call-wls-2",
			toolName: "subagent",
			details: {
				results: [{ agent: "worker", model: "volcengine/glm-5-3", usage: { input: 50, output: 10, cost: 0.05 } }],
			},
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-wls-2", cwd: `/fixture/${taskId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	assert.match(resLowShare.content[0].text, /decision: review_pending/);
	assert.doesNotMatch(resLowShare.content[0].text, /warning: Root is reading the diff itself/);
}

// --------------------------------------------------------------------------
// Issues 01 & 02: Host details classification & async notify dispatch
// --------------------------------------------------------------------------

// 1. Issue 01: Host details classification with Oracle-1 foreground fixture
{
	const oracle1Details = {
		mode: "single",
		runId: "79ce6075-329f-4fa3-afb4-0d5f7062d4bf",
		results: [{
			agent: "worker",
			exitCode: 0,
			outputState: "present",
			startedAt: 1757209700000,
			completedAt: 1757209701000,
		}],
		mission: { status: "completed" },
	};

	// 1a. Worker with completion evidence in details takes worker completed path, not async receipt
	const taskIdWorker = "T-20260905-801";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-ora-w", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskIdWorker)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskIdWorker}`, ctx);
	const canonWorker = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	const resWorker = await handlers.get("tool_result")(
		{
			toolCallId: "call-ora-w",
			toolName: "subagent",
			details: oracle1Details,
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: canonWorker,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId: canonWorker, workerRunId: "call-ora-w", cwd: `/fixture/${taskIdWorker}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	assert.match(resWorker.content[0].text, /\[PLANNER-ONLY WORKER REPORT\]/);
	assert.match(resWorker.content[0].text, /decision: review_pending/);
	assert.doesNotMatch(resWorker.content[0].text, /Async delegation/);

	// 1b. Unbound explorer (no TaskSpec, no Task) with completion evidence: the
	// output returns as-is without WorkerReport parsing or Task side effects.
	// R02 — an explorer WITH an embedded TaskSpec is standalone and closes its
	// Task like a worker; that lifecycle has its own orchestration coverage.
	const eCall = await handlers.get("tool_call")(
		{ toolCallId: "call-ora-e", toolName: "subagent", input: { agent: "explorer", task: "Survey the repo and report findings." } },
		ctx,
	);
	const resExplorer = await handlers.get("tool_result")(
		{
			toolCallId: "call-ora-e",
			toolName: "subagent",
			details: oracle1Details,
			content: [{ type: "text", text: "Explorer findings: inspected architecture, no changes required." }],
			isError: false,
		},
		ctx,
	);
	assert.equal(resExplorer.content[0].text, "Explorer findings: inspected architecture, no changes required.");
	assert.doesNotMatch(resExplorer.content[0].text, /\[PLANNER-ONLY/);

	// 1c. Validator with completion evidence takes validator path
	const taskIdValidator = "T-20260905-803";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-ora-vw", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskIdValidator)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskIdValidator}`, ctx);
	const canonValidator = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	await handlers.get("tool_result")(
		{
			toolCallId: "call-ora-vw",
			toolName: "subagent",
			details: oracle1Details,
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: canonValidator,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId: canonValidator, workerRunId: "call-ora-vw", cwd: `/fixture/${taskIdValidator}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);

	await handlers.get("tool_call")(
		{ toolCallId: "call-ora-v", toolName: "subagent", input: { agent: "oracle", task: JSON.stringify(delegationSpec(canonValidator, "validator")) } },
		ctx,
	);
	const resValidator = await handlers.get("tool_result")(
		{
			toolCallId: "call-ora-v",
			toolName: "subagent",
			details: oracle1Details,
			content: [{ type: "text", text: "Validator passed all independent checks." }],
			isError: false,
		},
		ctx,
	);
	assert.match(resValidator.content[0].text, /\[PLANNER-ONLY\] Validator output for task/);
	assert.doesNotMatch(resValidator.content[0].text, /Async delegation/);
}

// 2. Issue 01: True async launch receipt text formatting
{
	const taskId = "T-20260905-804";
	const runId = "run-async-enriched-804";
	await handlers.get("tool_call")(
		{ toolCallId: "call-async-804", toolName: "subagent", input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const canon = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];

	const receipt = await handlers.get("tool_result")(
		{
			toolCallId: "call-async-804",
			toolName: "subagent",
			details: { asyncId: runId, runId, asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);
	assert.equal(
		receipt.content[0].text,
		`[PLANNER-ONLY] Async delegation for task ${canon} has started (runId: ${runId}). Await the run result with bg_wait id=${runId}; bg_wait without an id may report empty briefly after launch.`,
	);
}

// 3. Issue 01: Caller explicit async: false disables prose heuristics
{
	const taskId = "T-20260905-805";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-explicit-false", toolName: "subagent", input: { agent: "worker", async: false, task: JSON.stringify(delegationSpec(taskId)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const canon = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	const resExplicitFalse = await handlers.get("tool_result")(
		{
			toolCallId: "call-explicit-false",
			toolName: "subagent",
			details: { mode: "single" }, // no asyncId, no exitCode
			content: [{
				type: "text",
				text: `Async: worker [00000000-1111-2222-3333-444444444444]\nThe async run is detached and running in the background.\n\`\`\`json\n${JSON.stringify({
					...workerReport,
					taskId: canon,
					changedFiles: ["src/parser.ts"],
					evidence: { ...workerReport.evidence, taskId: canon, workerRunId: "call-explicit-false", cwd: `/fixture/${taskId}`,  },
				})}\n\`\`\``,
			}],
			isError: false,
		},
		ctx,
	);
	// Because async: false was set, prose heuristic was skipped and worker report was parsed directly
	assert.match(resExplicitFalse.content[0].text, /\[PLANNER-ONLY WORKER REPORT\]/);
	assert.doesNotMatch(resExplicitFalse.content[0].text, /Async delegation for task/);
}

// 4. Issue 02: Async notify for reviewer with full parity to sync reviewer result
{
	// 4a. Async reviewer delegation + async notify
	const taskAsyncId = "T-20260905-806";
	const runAsyncRev = "run-rev-async-806";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-w-806", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskAsyncId)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskAsyncId}`, ctx);
	const canonAsync = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	const wResAsync = await handlers.get("tool_result")(
		{
			toolCallId: "call-w-806",
			toolName: "subagent",
			details: { mode: "single", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: canonAsync,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId: canonAsync, workerRunId: "call-w-806", cwd: `/fixture/${taskAsyncId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	const digestAsync = /workspaceDigest: ([0-9a-f]{16})/.exec(wResAsync.content[0].text)?.[1];
	assert.ok(digestAsync, "digestAsync must exist");

	await handlers.get("tool_call")(
		{ toolCallId: "call-r-806", toolName: "subagent", input: { agent: "reviewer", async: true, task: `Review ${canonAsync}` } },
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-r-806",
			toolName: "subagent",
			details: { asyncId: runAsyncRev, runId: runAsyncRev, asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: `Async: reviewer [${runAsyncRev}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);

	const reviewPayload = {
		taskId: canonAsync,
		verdict: "request_changes",
		summary: "need more regression test coverage",
		evidenceFresh: true,
		reportRevision: 1,
		workspaceDigest: digestAsync,
		findings: [{ severity: "major", category: "test", description: "boundary missing", requestedChange: "add boundary test" }],
	};
	const replacedAsync = await handlers.get("message_end")({
		message: {
			role: "custom",
			customType: "subagent-notify",
			content: `Background task completed: **reviewer**\n\n${JSON.stringify(reviewPayload)}\n\nChild runs: ${runAsyncRev}`,
			display: "Background task completed: reviewer",
		},
	}, ctx);
	assert.match(replacedAsync.message.content, /\[FRESH REVIEWER\] verdict: request_changes/);
	assert.match(replacedAsync.message.content, /decision: request_changes/);

	notices.length = 0;
	await commands.get("planner-only").handler(`task ${canonAsync}`, ctx);
	const asyncTaskStatus = notices.at(-1).message;
	assert.match(asyncTaskStatus, /State: changes_requested/);
	assert.match(asyncTaskStatus, /Worker round: 1\/3/);
	assert.match(asyncTaskStatus, /Reviews: request_changes \(reviewer\)/);

	// 4b. Sync reviewer delegation
	const taskSyncId = "T-20260905-807";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-w-807", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskSyncId)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskSyncId}`, ctx);
	const canonSync = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	const wResSync = await handlers.get("tool_result")(
		{
			toolCallId: "call-w-807",
			toolName: "subagent",
			details: { mode: "single", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: canonSync,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId: canonSync, workerRunId: "call-w-807", cwd: `/fixture/${taskSyncId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);
	const digestSync = /workspaceDigest: ([0-9a-f]{16})/.exec(wResSync.content[0].text)?.[1];
	assert.ok(digestSync, "digestSync must exist");

	await handlers.get("tool_call")(
		{ toolCallId: "call-r-807", toolName: "subagent", input: { agent: "reviewer", task: `Review ${canonSync}` } },
		ctx,
	);
	const syncReviewRes = await handlers.get("tool_result")(
		{
			toolCallId: "call-r-807",
			toolName: "subagent",
			details: { mode: "single", runId: "run-rev-sync-807", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify({ ...reviewPayload, taskId: canonSync, workspaceDigest: digestSync }) }],
			isError: false,
		},
		ctx,
	);
	assert.match(syncReviewRes.content[0].text, /\[FRESH REVIEWER\] verdict: request_changes/);
	assert.match(syncReviewRes.content[0].text, /decision: request_changes/);

	notices.length = 0;
	await commands.get("planner-only").handler(`task ${canonSync}`, ctx);
	const syncTaskStatus = notices.at(-1).message;
	assert.match(syncTaskStatus, /State: changes_requested/);
	assert.match(syncTaskStatus, /Worker round: 1\/3/);
	assert.match(syncTaskStatus, /Reviews: request_changes \(reviewer\)/);

	// Both paths produce identical task state and round
	const asyncStateMatch = /State: (\w+)/.exec(asyncTaskStatus)?.[1];
	const syncStateMatch = /State: (\w+)/.exec(syncTaskStatus)?.[1];
	assert.equal(asyncStateMatch, syncStateMatch);
	const asyncRoundMatch = /Worker round: (\d\/\d)/.exec(asyncTaskStatus)?.[1];
	const syncRoundMatch = /Worker round: (\d\/\d)/.exec(syncTaskStatus)?.[1];
	assert.equal(asyncRoundMatch, syncRoundMatch);

	// 4c. Truncated Reviewer output without file: rejected, no WorkerReport correction
	const taskTruncId = "T-20260905-808";
	const runTrunc = "run-rev-trunc-808";
	gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	await handlers.get("tool_call")(
		{ toolCallId: "call-w-808", toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskTruncId)) } },
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskTruncId}`, ctx);
	const canonTrunc = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1).message)?.[1];
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

	await handlers.get("tool_result")(
		{
			toolCallId: "call-w-808",
			toolName: "subagent",
			details: { mode: "single", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: JSON.stringify({
				...workerReport,
				taskId: canonTrunc,
				changedFiles: ["src/parser.ts"],
				evidence: { ...workerReport.evidence, taskId: canonTrunc, workerRunId: "call-w-808", cwd: `/fixture/${taskTruncId}`,  },
			}) }],
			isError: false,
		},
		ctx,
	);

	await handlers.get("tool_call")(
		{ toolCallId: "call-r-808", toolName: "subagent", input: { agent: "reviewer", async: true, task: `Review ${canonTrunc}` } },
		ctx,
	);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-r-808",
			toolName: "subagent",
			details: { asyncId: runTrunc, runId: runTrunc, asyncDir: "/no-such-dir" },
			content: [{ type: "text", text: `Async: reviewer [${runTrunc}]\nThe async run is detached and running in the background.` }],
			isError: false,
		},
		ctx,
	);

	const truncatedReviewNotify = await handlers.get("message_end")({
		message: {
			role: "custom",
			customType: "subagent-notify",
			content: `Background task completed: **reviewer**\n\n{"taskId":"${canonTrunc}","verdict":"pass"...[preview truncated]\n\nChild runs: ${runTrunc}`,
			display: "Background task completed: reviewer",
		},
	}, ctx);
	assert.match(truncatedReviewNotify.message.content, /\[PLANNER-ONLY\] Reviewer output for task .* is not a valid ReviewResult/);
	assert.match(truncatedReviewNotify.message.content, /Re-delegate review with the required ReviewResult JSON shape/);
	assert.doesNotMatch(truncatedReviewNotify.message.content, /WorkerReport/);
	assert.doesNotMatch(truncatedReviewNotify.message.content, /repair/);
}

// Issue 03: Extension hook integration for TaskSpec validation, title alias, and placeholder
{
	// 1. Missing objective blocked at tool_call level
	const promptMissingObj = `\`\`\`json\n{"taskId":"oracle-status-line-01","acceptanceCriteria":["tests pass"],"scope":{"allowedPaths":["src/"]}}\n\`\`\``;
	const callMissingObj = await handlers.get("tool_call")(
		{ toolCallId: "call-ext-cb1", toolName: "subagent", input: { agent: "worker", task: promptMissingObj } },
		ctx,
	);
	assert.equal(callMissingObj?.block, true);
	assert.match(callMissingObj?.reason, /objective must be a non-empty string/);

	// 2. validation.required not boolean blocked at tool_call level
	const promptInvalidVal = `\`\`\`json\n{"taskId":"oracle-status-line-01","objective":"fix","validation":{"required":"true"}}\n\`\`\``;
	const callInvalidVal = await handlers.get("tool_call")(
		{ toolCallId: "call-ext-cb2", toolName: "subagent", input: { agent: "worker", task: promptInvalidVal } },
		ctx,
	);
	assert.equal(callInvalidVal?.block, true);
	assert.match(callInvalidVal?.reason, /validation\.required must be a boolean/);

	// 3. required validation without commands is blocked before oracle wrapping
	const promptMissingCommands = `\`\`\`json\n{"taskId":"oracle-status-line-missing-validation","objective":"validate the change","role":"validator","validation":{"required":true}}\n\`\`\``;
	const callMissingCommands = await handlers.get("tool_call")(
		{ toolCallId: "call-ext-cb-missing-validation", toolName: "subagent", input: { agent: "oracle", task: promptMissingCommands } },
		ctx,
	);
	assert.equal(callMissingCommands?.block, true);
	assert.match(callMissingCommands?.reason, /需补充验证定义/);

	// 4. title alias allowed and creates Task
	const promptTitle = `\`\`\`json\n{"taskId":"oracle-status-line-01","title":"Ext title feature","acceptanceCriteria":["tests pass"]}\n\`\`\``;
	const callTitle = await handlers.get("tool_call")(
		{ toolCallId: "call-ext-cb3", toolName: "subagent", input: { agent: "worker", task: promptTitle } },
		ctx,
	);
	assert.equal(callTitle?.block, undefined);

	// Strict review mode refuses an unstructured worker before the child can start.
	const previousRequireReview = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	const previousStructuredDelegation = process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
	const execCallsBeforeStrictBlock = execCalls.length;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
		const strictCall = await handlers.get("tool_call")(
			{ toolCallId: "call-ext-strict-plain", toolName: "subagent", input: { agent: "worker", task: "Just run some checks" } },
			ctx,
		);
		assert.equal(strictCall?.block, true);
		assert.match(strictCall.reason, /PI_PLANNER_ONLY_REQUIRE_REVIEW=1/);
		assert.equal(execCalls.length, execCallsBeforeStrictBlock, "blocked delegation must not start a child process");
	} finally {
		if (previousRequireReview === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previousRequireReview;
		if (previousStructuredDelegation === undefined) delete process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION;
		else process.env.PI_PLANNER_ONLY_STRUCTURED_DELEGATION = previousStructuredDelegation;
	}

	// 5. Plain text without characteristics creates placeholder Task, tool_result first line announces it
	const callPlain = await handlers.get("tool_call")(
		{ toolCallId: "call-ext-cb4", toolName: "subagent", input: { agent: "worker", task: "Just run some checks" } },
		ctx,
	);
	assert.equal(callPlain?.block, undefined);
	const resPlain = await handlers.get("tool_result")(
		{
			toolCallId: "call-ext-cb4",
			toolName: "subagent",
			details: { mode: "single", results: [{ exitCode: 0, outputState: "present" }] },
			content: [{ type: "text", text: "Some plain output from worker." }],
			isError: false,
		},
		ctx,
	);
	const firstLinePlain = resPlain.content[0].text.split("\n")[0];
	assert.match(firstLinePlain, /^\[PLANNER-ONLY\] Placeholder task T-\d{8}-\d{3} created \(parent did not embed a TaskSpec; canonical id: T-\d{8}-\d{3}\)\.$/);
}

// Issue 04: /planner-only status prints actual model and thinking from details/meta
{
	// Clear any active tasks so writer lock is clean
	while (true) {
		notices.length = 0;
		await commands.get("planner-only").handler("task", ctx);
		const currentTaskNotice = notices.at(-1)?.message;
		const match = currentTaskNotice?.match(/^Task: (T-\d{8}-\d{3})/m);
		if (!match) break;
		await commands.get("planner-only").handler(`task abandon ${match[1]}`, ctx);
	}

	const taskPrompt = `\`\`\`json\n{"taskId":"T-20260907-stat10","objective":"status test","acceptanceCriteria":["tests pass"]}\n\`\`\``;
	const callResult = await handlers.get("tool_call")(
		{ toolCallId: "call-status-cb1", toolName: "subagent", input: { agent: "worker", task: taskPrompt } },
		ctx,
	);
	assert.equal(callResult?.block, undefined, callResult?.reason);
	await handlers.get("tool_result")(
		{
			toolCallId: "call-status-cb1",
			toolName: "subagent",
			details: {
				mode: "single",
				results: [{
					exitCode: 0,
					outputState: "present",
					model: "kimi-for-coding:high",
					thinking: "high",
					usage: { inputTokens: 100, outputTokens: 50 },
				}],
			},
			content: [{ type: "text", text: "Worker execution complete." }],
			isError: false,
		},
		ctx,
	);

	notices.length = 0;
	await commands.get("planner-only").handler("status", ctx);
	const statusNotice = notices.at(-1)?.message;
	assert.ok(statusNotice !== undefined);
	assert.match(statusNotice, /Delegations:/);
	assert.match(statusNotice, /worker: kimi-for-coding:high \(thinking: high\)/);
}

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

const i07AgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-i07-"));
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

// p10-r048: sync scout accounting probes scout metadata and preserves the
// documented synthetic-id limitation when no Task is active.
{
	const artifactDir = join(isolatedAgentDir, "artifacts");
	const asyncDir = join(isolatedAgentDir, "async-subagent-runs", "r048");
	mkdirSync(artifactDir, { recursive: true });
	const childEntry = (runId) => [...sessionEntries].reverse()
		.find((entry) => entry.customType === "planner-only-usage" && entry.data?.kind === "child" && entry.data.child?.runId === runId)?.data;

	const successRunId = "r048-scout-success";
	writeFileSync(join(artifactDir, `${successRunId}_scout_meta.json`), JSON.stringify({
		runId: successRunId, agent: "scout", exitCode: 0, model: "scout/model", thinking: "low",
		usage: { inputTokens: 10, outputTokens: 5 },
	}));
	await handlers.get("tool_call")({ toolCallId: "call-r048-scout-success", toolName: "subagent", input: { agent: "scout", cwd: "/fixture/r048-unbound", task: "inspect" } }, ctx);
	await handlers.get("tool_result")({
		toolCallId: "call-r048-scout-success", toolName: "subagent", details: { runId: successRunId, asyncDir, results: [] },
		content: [{ type: "text", text: "scout done" }], isError: false,
	}, ctx);
	const success = childEntry(successRunId);
	assert.ok(success, "scout meta usage must be persisted");
	assert.match(success.taskId, /^T-/);
	assert.notEqual(success.taskId, "unbound-explorer-call-r048-scout-success");
	assert.equal(success.child.agent, "scout");
	assert.equal(success.child.outcome, "succeeded");

	const failedRunId = "r048-scout-failed";
	writeFileSync(join(artifactDir, `${failedRunId}_scout_meta.json`), JSON.stringify({
		runId: failedRunId, agent: "scout", exitCode: 1,
		usage: { inputTokens: 7, outputTokens: 3 },
	}));
	await handlers.get("tool_call")({ toolCallId: "call-r048-scout-failed", toolName: "subagent", input: { agent: "scout", cwd: "/fixture/r048-unbound", task: "inspect" } }, ctx);
	await handlers.get("tool_result")({
		toolCallId: "call-r048-scout-failed", toolName: "subagent", details: { runId: failedRunId, asyncDir, results: [] },
		content: [{ type: "text", text: "scout failed" }], isError: true,
	}, ctx);
	const failed = childEntry(failedRunId);
	assert.ok(failed);
	assert.equal(failed.child.outcome, "failed");

	for (let i = 0; i < 32; i += 1) {
		await commands.get("planner-only").handler("task", ctx);
		const activeTaskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
		if (!activeTaskId) break;
		await commands.get("planner-only").handler(`task abandon ${activeTaskId}`, ctx);
	}
	await handlers.get("tool_call")({ toolCallId: "call-r048-scout-missing", toolName: "subagent", input: { agent: "scout", cwd: "/fixture/r048-unbound", task: "inspect" } }, ctx);
	await handlers.get("tool_result")({
		toolCallId: "call-r048-scout-missing", toolName: "subagent", details: { results: [] },
		content: [{ type: "text", text: "scout pending" }], isError: false,
	}, ctx);
	const missing = [...sessionEntries].reverse()
		.find((entry) => entry.customType === "planner-only-usage" && entry.data?.kind === "child" && entry.data.child?.pending)?.data;
	assert.ok(missing);
	assert.equal(missing.child.pending, true);
}

// p12-r058: an unbound oracle (synthetic placeholder, no Task named, no report
// yet) must still land its runId and costUsd on the real cwd-active Task's
// usage.jsonl children exactly once when that Task becomes terminal.
{
	const taskSpecId = "T-20260908-058";
	const taskCallId = "call-r058-task";
	const oracleCallId = "call-r058-oracle";
	const oracleRunId = "r058-oracle-run";
	notices.length = 0;
	await commands.get("planner-only").handler("task", ctx);
	const existingTaskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	if (existingTaskId) await commands.get("planner-only").handler(`task abandon ${existingTaskId}`, ctx);
	await handlers.get("tool_call")({
		toolCallId: taskCallId,
		toolName: "subagent",
		input: { agent: "worker", task: JSON.stringify(delegationSpec(taskSpecId)) },
	}, ctx);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskSpecId}`, ctx);
	const taskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	assert.ok(taskId, "real Task must exist before the unbound oracle");
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
	await handlers.get("tool_result")({
		toolCallId: taskCallId,
		toolName: "subagent",
		content: [{ type: "text", text: "worker output is not a WorkerReport" }],
		isError: false,
	}, ctx);
	const oracleCall = await handlers.get("tool_call")({
		toolCallId: oracleCallId,
		toolName: "subagent",
		input: {
			agent: "oracle",
			cwd: `/fixture/${taskSpecId}`,
			task: "validate the claim with no task named",
		},
	}, ctx);
	assert.equal(oracleCall?.block, undefined, oracleCall?.reason ?? "unbound oracle must launch");
	assert.ok(
		notices.some((notice) => notice.message.includes("validator delegation names no Task under review")),
		"oracle must take the unbound-validator path",
	);
	await handlers.get("tool_result")({
		toolCallId: oracleCallId,
		toolName: "subagent",
		details: {
			runId: oracleRunId,
			results: [{
				agent: "oracle",
				model: "volcengine/glm-5-3-flash:medium",
				usage: { input: 80, output: 16, cacheRead: 0, cacheWrite: 0, cost: 0.058, turns: 2 },
			}],
		},
		content: [{ type: "text", text: "HEAD matches; named tests exist." }],
		isError: false,
	}, ctx);
	await commands.get("planner-only").handler(`task abandon ${taskId}`, ctx);
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	const rows = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	const failed = rows.filter((row) => row.taskId === taskId && row.state === "failed");
	assert.equal(failed.length, 1, JSON.stringify({ taskId, matchingRows: rows.filter((row) => row.taskId === taskId) }));
	const oracleChildren = failed[0].children.filter((child) => child.runId === oracleRunId);
	assert.equal(oracleChildren.length, 1, JSON.stringify(failed[0].children));
	assert.equal(oracleChildren[0].agent, "oracle");
	assert.equal(oracleChildren[0].costUsd, 0.058);
	assert.equal(oracleChildren[0].kind, "validator");
}

// p11-r052: an async explorer dispatched while its worker Task is executing is
// unbound, but its usage must still be accounted to that real Task exactly once
// when the Task becomes terminal before the explorer notification.
{
	const taskSpecId = "T-20260908-052";
	const taskCallId = "call-r052-task";
	const scoutCallId = "call-r052-scout";
	const scoutRunId = "r052-scout-async";
	notices.length = 0;
	await commands.get("planner-only").handler("task", ctx);
	const existingTaskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	if (existingTaskId) await commands.get("planner-only").handler(`task abandon ${existingTaskId}`, ctx);
	await handlers.get("tool_call")({
		toolCallId: taskCallId,
		toolName: "subagent",
		input: { agent: "worker", task: JSON.stringify(delegationSpec(taskSpecId)) },
	}, ctx);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskSpecId}`, ctx);
	const taskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	assert.ok(taskId, "real Task must be created before the async explorer");
	gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\\n", stderr: "", code: 0 });

	// The worker is still executing here, so the same-cwd explorer must take
	// the unbound branch while activeForCwd still supplies accountingTaskId.
	await handlers.get("tool_call")({
		toolCallId: scoutCallId,
		toolName: "subagent",
		input: { agent: "scout", async: true, cwd: `/fixture/${taskSpecId}`, task: "inspect" },
	}, ctx);

	await handlers.get("tool_result")({
		toolCallId: taskCallId,
		toolName: "subagent",
		content: [{ type: "text", text: JSON.stringify({ ...workerReport, taskId: taskSpecId, evidence: { ...workerReport.evidence, taskId: taskSpecId, workerRunId: taskCallId, cwd: `/fixture/${taskSpecId}`, changedPaths: ["src/parser.ts"] } }) }],
		isError: false,
	}, ctx);

	await commands.get("planner-only").handler(`task abandon ${taskId}`, ctx);
	await handlers.get("tool_result")({
		toolCallId: scoutCallId,
		toolName: "subagent",
		details: { asyncId: scoutRunId, runId: scoutRunId, asyncDir: "/no-such-async-dir" },
		content: [{ type: "text", text: `Async: scout [${scoutRunId}]\\nThe async run is detached and running in the background.` }],
		isError: false,
	}, ctx);
	assert.ok(notices.some((notice) => notice.message.includes("explorer delegation is not attached to any Task")));
	const notifyText = `Background task completed: **scout**\n\nscout result\n\nChild runs: ${scoutRunId}`;
	await handlers.get("message_end")({
		message: { role: "custom", customType: "subagent-notify", content: notifyText },
	}, ctx);
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	const rows = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
	assert.equal(rows.filter((row) => row.taskId === taskId && row.state === "failed").length, 1, JSON.stringify({ taskId, matchingRows: rows.filter((row) => row.taskId === taskId) }));
}

function extractReviewResultContractExample(prompt) {
	const marker = "Return only a ReviewResult JSON object";
	const at = prompt.indexOf(marker);
	if (at < 0) throw new Error("ReviewResult contract marker missing");
	const start = prompt.indexOf("{", at);
	if (start < 0) throw new Error("ReviewResult contract example missing");
	let depth = 0;
	for (let i = start; i < prompt.length; i++) {
		const ch = prompt[i];
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return JSON.parse(prompt.slice(start, i + 1));
		}
	}
	throw new Error("ReviewResult contract example is not closed");
}

// Ticket 27 — strict mode: a reviewer that returns only the contract's fields
// (no reportRevision / workspaceDigest) must still complete the Task; the
// orchestrator fills those bindings from the ReviewRequest before record.
{
	const { extractReviewRequest } = await import("./review.ts");
	const previous = process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
	try {
		process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = "1";
		const taskId = "T-20260908-027";
		gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
		gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
		gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
		const workerCall = "call-27-worker";
		await handlers.get("tool_call")(
			{ toolCallId: workerCall, toolName: "subagent", input: { task: JSON.stringify(delegationSpec(taskId)) } },
			ctx,
		);
		gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
		gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
		const worker = await handlers.get("tool_result")(
			{
				toolCallId: workerCall,
				toolName: "subagent",
				input: {},
				content: [{ type: "text", text: JSON.stringify({
					...workerReport,
					taskId,
					evidence: { ...workerReport.evidence, taskId, workerRunId: workerCall, cwd: `/fixture/${taskId}` },
				}) }],
				isError: false,
			},
			ctx,
		);
		assert.equal(worker.isError, undefined);
		const reviewInput = {
			agent: "reviewer",
			task: JSON.stringify(delegationSpec(taskId, "reviewer")),
		};
		await handlers.get("tool_call")(
			{ toolCallId: "call-27-reviewer", toolName: "subagent", input: reviewInput },
			ctx,
		);
		const example = extractReviewResultContractExample(reviewInput.task);
		const request = extractReviewRequest(reviewInput.task);
		assert.ok(request, "reviewer packet must embed a ReviewRequest");
		const contractPass = {};
		for (const key of Object.keys(example)) {
			if (key === "taskId") contractPass.taskId = request.taskId;
			else if (key === "verdict") contractPass.verdict = "pass";
			else if (key === "summary") contractPass.summary = "meets acceptance";
			else if (key === "evidenceFresh") contractPass.evidenceFresh = true;
			else if (key === "findings") contractPass.findings = [];
			else if (key === "reportRevision" || key === "workspaceDigest") {
				continue;
			} else {
				contractPass[key] = example[key];
			}
		}
		assert.equal("reportRevision" in contractPass, false);
		assert.equal("workspaceDigest" in contractPass, false);
		gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
		const reviewed = await handlers.get("tool_result")(
			{
				toolCallId: "call-27-reviewer",
				toolName: "subagent",
				input: {},
				content: [{ type: "text", text: JSON.stringify(contractPass) }],
				isError: false,
			},
			ctx,
		);
		assert.match(reviewed.content[0].text, /decision: accept/);
		notices.length = 0;
		await commands.get("planner-only").handler(`task ${taskId}`, ctx);
		assert.match(notices.at(-1).message, /State: completed/);
	} finally {
		if (previous === undefined) delete process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW;
		else process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW = previous;
	}
}

async function abandonActiveTasks() {
	for (let i = 0; i < 32; i++) {
		notices.length = 0;
		await commands.get("planner-only").handler("task", ctx);
		const id = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
		if (!id) return;
		await commands.get("planner-only").handler(`task abandon ${id}`, ctx);
	}
}

function usageLogRows() {
	const logPath = join(isolatedAgentDir, "planner-only", "usage.jsonl");
	if (!existsSync(logPath)) return [];
	return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function metaRunIdsIn(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.map((name) => /^(.*)_(?:worker|oracle|reviewer|explorer|scout)(?:_0)?_meta\.json$/.exec(name)?.[1])
		.filter((id) => typeof id === "string");
}

// p13-r060 / ticket 35: session_shutdown while a Task is still open must write
// a usage.jsonl snapshot whose children runIds cover this session's *_meta.json.
{
	await abandonActiveTasks();
	const taskSpecId = "T-20260908-060";
	const taskCallId = "call-r060-open";
	const metaRunId = "r060-inv-meta";
	const artifactDir = join(isolatedAgentDir, "sessions", "subagent-artifacts");
	mkdirSync(artifactDir, { recursive: true });
	await handlers.get("tool_call")({
		toolCallId: taskCallId,
		toolName: "subagent",
		input: { agent: "worker", task: JSON.stringify(delegationSpec(taskSpecId)) },
	}, ctx);
	writeFileSync(join(artifactDir, `${metaRunId}_oracle_meta.json`), JSON.stringify({
		runId: metaRunId,
		agent: "oracle",
		model: "volcengine/glm-5-3-flash:medium",
		usage: { input: 40, output: 8, cacheRead: 0, cacheWrite: 0, cost: 0.02227, turns: 1 },
	}));
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const rows = usageLogRows();
	assert.ok(rows.length >= 1, "shutdown of a non-terminal Task must append usage.jsonl");
	const last = rows.at(-1);
	const childRunIds = new Set((last.children ?? []).map((child) => child.runId).filter(Boolean));
	const expectedMetaRunIds = [...new Set(metaRunIdsIn(artifactDir).filter((id) => id.startsWith("r060-inv-")))];
	assert.ok(expectedMetaRunIds.length >= 1, "fixture meta must exist");
	assert.ok(
		expectedMetaRunIds.every((id) => childRunIds.has(id)),
		`usage.jsonl last children runIds ${JSON.stringify([...childRunIds])} does not cover meta runIds ${JSON.stringify(expectedMetaRunIds)}`,
	);
	assert.equal(last.incomplete, true);
	assert.notEqual(last.state, "completed");
	assert.notEqual(last.state, "failed");
	assert.notEqual(last.state, "blocked");
}

// p13-r060: a terminal flushIfTerminal row must not be duplicated by shutdown.
{
	await abandonActiveTasks();
	const taskSpecId = "T-20260908-061";
	const taskCallId = "call-r060-dup";
	await handlers.get("tool_call")({
		toolCallId: taskCallId,
		toolName: "subagent",
		input: { agent: "worker", task: JSON.stringify(delegationSpec(taskSpecId)) },
	}, ctx);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskSpecId}`, ctx);
	const taskId = /Task: (T-\d{8}-\d{3})/.exec(notices.at(-1)?.message ?? "")?.[1];
	assert.ok(taskId);
	await handlers.get("tool_result")({
		toolCallId: taskCallId,
		toolName: "subagent",
		details: {
			results: [{
				agent: "worker",
				usage: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, cost: 0.001, turns: 1 },
			}],
		},
		content: [{ type: "text", text: "not a WorkerReport" }],
		isError: false,
	}, ctx);
	await commands.get("planner-only").handler(`task abandon ${taskId}`, ctx);
	const before = usageLogRows().filter((row) => row.taskId === taskId);
	assert.equal(before.length, 1, JSON.stringify(before));
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const after = usageLogRows().filter((row) => row.taskId === taskId);
	assert.equal(after.length, 1, JSON.stringify(after));
}

// p13-r060: reload keeps the same session file and a replacement instance
// will session_start + loadSessionUsage; do not append a snapshot here.
{
	await abandonActiveTasks();
	const taskSpecId = "T-20260908-062";
	await handlers.get("tool_call")({
		toolCallId: "call-r060-reload",
		toolName: "subagent",
		input: { agent: "worker", task: JSON.stringify(delegationSpec(taskSpecId)) },
	}, ctx);
	const beforeLen = usageLogRows().length;
	await handlers.get("session_shutdown")({ reason: "reload" }, ctx);
	assert.equal(usageLogRows().length, beforeLen);
}

// p13-r060: ghost unbound-validator cost must land in usage.jsonl as unattributed.
{
	await abandonActiveTasks();
	const oracleCallId = "call-r060-ghost";
	const oracleRunId = "r060-ghost-run";
	const ghostCall = await handlers.get("tool_call")({
		toolCallId: oracleCallId,
		toolName: "subagent",
		input: { agent: "oracle", cwd: "/repo/r060-empty", task: "validate the claim with no task named" },
	}, ctx);
	assert.equal(ghostCall?.block, undefined, ghostCall?.reason ?? "ghost oracle must launch");
	await handlers.get("tool_result")({
		toolCallId: oracleCallId,
		toolName: "subagent",
		details: {
			runId: oracleRunId,
			results: [{
				agent: "oracle",
				model: "volcengine/glm-5-3-flash:medium",
				usage: { input: 80, output: 16, cacheRead: 0, cacheWrite: 0, cost: 0.058, turns: 2 },
			}],
		},
		content: [{ type: "text", text: "HEAD matches; named tests exist." }],
		isError: false,
	}, ctx);
	await handlers.get("session_shutdown")({ reason: "quit" }, ctx);
	const ghostRows = usageLogRows().filter((row) =>
		row.unattributed === true && (row.children ?? []).some((child) => child.runId === oracleRunId),
	);
	assert.equal(ghostRows.length, 1, JSON.stringify(usageLogRows().slice(-3)));
	assert.equal(ghostRows[0].incomplete, true);
	assert.notEqual(ghostRows[0].state, "completed");
	assert.notEqual(ghostRows[0].state, "failed");
	assert.notEqual(ghostRows[0].state, "blocked");
}

// --------------------------------------------------------------------------
// Ticket 15-b: confirmed not-launched must not charge debt; budget-stop must (Z1–Z5)
// --------------------------------------------------------------------------

await abandonActiveTasks();

{
	const taskId = "T-20260908-751";
	const spec = { ...delegationSpec(taskId), cumulativeBudget: { tokens: 200000, costUsd: 0.5 } };
	async function delegate(toolCallId) {
		return await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			ctx,
		);
	}
	await delegate("call-15b-z1-1");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z1-1", toolName: "subagent", input: {},
			details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
			content: [{ type: "text", text: "worker done" }], isError: false,
		},
		ctx,
	);
	await delegate("call-15b-z1-never");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z1-never",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: "spawn failed: no such agent 'worker'" }],
			details: {},
			isError: true,
		},
		ctx,
	);
	const retry = await delegate("call-15b-z1-retry");
	// Z1: a confirmed not-launched child must not exhaust the budget with phantom debt.
	assert.equal(retry?.block, undefined, retry?.reason);
}

{
	const taskId = "T-20260908-752";
	const spec = { ...delegationSpec(taskId), cumulativeBudget: { tokens: 200000, costUsd: 0.5 } };
	async function delegate(toolCallId) {
		return await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			ctx,
		);
	}
	await delegate("call-15b-z2-1");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z2-1", toolName: "subagent", input: {},
			details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
			content: [{ type: "text", text: "worker done" }], isError: false,
		},
		ctx,
	);
	await delegate("call-15b-z2-never");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z2-never",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: "spawn failed: no such agent 'worker'" }],
			details: {},
			isError: true,
		},
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const status = notices.at(-1).message;
	// Z2: known tokens stay at the settled child's 1500; the never-launched child is not charged.
	assert.match(status, /tokens: 已用 1500 \/ 上限 200000，剩余 198500，未知项 0 项/);
}

{
	const taskId = "T-20260908-753";
	const spec = { ...delegationSpec(taskId), cumulativeBudget: { tokens: 200000, costUsd: 0.5 } };
	async function delegate(toolCallId) {
		return await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			ctx,
		);
	}
	await delegate("call-15b-z3-1");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z3-1", toolName: "subagent", input: {},
			details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
			content: [{ type: "text", text: "worker done" }], isError: false,
		},
		ctx,
	);
	await delegate("call-15b-z3-never");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z3-never",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: "spawn failed: no such agent 'worker'" }],
			details: {},
			isError: true,
		},
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const status = notices.at(-1).message;
	// Z3: known cost stays at the settled child's $0.0500.
	assert.match(status, /费用: 已用 \$0\.0500 \/ 上限 \$0\.5000，剩余 \$0\.4500，未知项 0 项/);
}

{
	const taskId = "T-20260908-754";
	const spec = { ...delegationSpec(taskId), cumulativeBudget: { tokens: 200000, costUsd: 0.5 } };
	async function delegate(toolCallId) {
		return await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			ctx,
		);
	}
	await delegate("call-15b-z4-1");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z4-1", toolName: "subagent", input: {},
			details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
			content: [{ type: "text", text: "worker done" }], isError: false,
		},
		ctx,
	);
	await delegate("call-15b-z4-never");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z4-never",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: "spawn failed: no such agent 'worker'" }],
			details: {},
			isError: true,
		},
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const status = notices.at(-1).message;
	// Z4: a never-launched child is not an unknown item.
	assert.equal((status.match(/未知项 0 项/g) ?? []).length >= 2, true, status);
}

{
	const taskId = "T-20260908-755";
	const spec = { ...delegationSpec(taskId), cumulativeBudget: { tokens: 200000, costUsd: 0.5 } };
	async function delegate(toolCallId) {
		return await handlers.get("tool_call")(
			{ toolCallId, toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			ctx,
		);
	}
	await delegate("call-15b-z5-1");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z5-1", toolName: "subagent", input: {},
			details: { results: [{ usage: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, cost: 0.05, turns: 1 }, model: "test/model" }] },
			content: [{ type: "text", text: "worker done" }], isError: false,
		},
		ctx,
	);
	await delegate("call-15b-z5-stop");
	await handlers.get("tool_result")(
		{
			toolCallId: "call-15b-z5-stop",
			toolName: "subagent",
			input: {},
			content: [{ type: "text", text: "usageBudget limit reached" }],
			details: { status: "stopped" },
			isError: true,
		},
		ctx,
	);
	notices.length = 0;
	await commands.get("planner-only").handler(`task ${taskId}`, ctx);
	const status = notices.at(-1).message;
	// Z5 (D3): a budget-stop without runId still charges debt; it is not a start failure.
	assert.match(status, /未知项 1 项/);
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-16b-idx-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		const TASK = "T-20260908-16b";
		const spec = { ...delegationSpec(TASK), cumulativeBudget: { tokens: 200000, costUsd: 0.05 } };
		const store = new TaskStore();
		const task = store.create(spec);
		task.state = "changes_requested";
		task.usage = emptyTaskUsage();
		task.usage.children = [{ input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 0.04 }];
		new LedgerSnapshotStore(dir).write(task);
		const { default: factory } = await import(`./index.ts?restore-16b=${Date.now()}`);
		const localHandlers = new Map();
		const localCommands = new Map();
		const localNotices = [];
		let localTools = ["read", "bash", "write", "subagent"];
		const pi = {
			on(name, handler) { localHandlers.set(name, handler); },
			registerCommand(name, definition) { localCommands.set(name, definition); },
			registerTool() {},
			getActiveTools() { return [...localTools]; },
			getAllTools() { return [{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "subagent" }]; },
			setActiveTools(names) { localTools = [...names]; },
			appendEntry() {},
			async exec() { return { stdout: "", stderr: "", code: 1 }; },
		};
		const localCtx = {
			hasUI: true,
			ui: { notify(message) { localNotices.push(message); }, setStatus() {}, theme: { fg(_c, t) { return t; } } },
			cwd: process.cwd(),
			sessionManager: { getEntries() { return []; }, getSessionFile() { return join(dir, "s.jsonl"); } },
		};
		factory(pi);
		await localHandlers.get("session_start")({}, localCtx);
		localNotices.length = 0;
		await localCommands.get("planner-only").handler(`task ${TASK}`, localCtx);
		const status = String(localNotices.at(-1));
		assert.match(status, /已用 \$0\.0400/, "I1: session_start restore shows spent cost");
		assert.match(status, /剩余 \$0\.0100/, "I2: session_start restore shows remaining 0.01");
		const input = { agent: "worker", task: JSON.stringify(spec) };
		const out = await localHandlers.get("tool_call")(
			{ toolCallId: "call-16b", toolName: "subagent", input },
			localCtx,
		);
		assert.equal(out?.block, undefined, "I3: restored Task may delegate");
		assert.ok(Math.abs(input.usageBudget.costUsd.hard - 0.01) < 1e-9, "I4: restored clamp is remaining, not a fresh 0.05");
	} finally {
		process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

{
	const dir = mkdtempSync(join(process.cwd(), ".planner-only-child-tools-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	try {
		const { default: factory } = await import(`./index.ts?child-tools=${Date.now()}`);
		const localHandlers = new Map();
		let localTools = ["read", "bash", "write", "edit", "subagent", "git_audit"];
		const pi = {
			on(name, handler) { localHandlers.set(name, handler); },
			registerCommand() {},
			registerTool() {},
			getActiveTools() { return [...localTools]; },
			getAllTools() {
				return [
					{ name: "read" }, { name: "bash" }, { name: "write" }, { name: "edit" },
					{ name: "subagent" }, { name: "git_audit" },
				];
			},
			setActiveTools(names) { localTools = [...names]; },
			appendEntry() {},
			async exec() { return { stdout: "", stderr: "", code: 0 }; },
		};
		const localCtx = {
			hasUI: false,
			ui: { notify() {}, setStatus() {}, theme: { fg(_c, t) { return t; } } },
			cwd: dir,
			sessionManager: { getEntries() { return []; }, getSessionFile() { return join(dir, "s.jsonl"); } },
		};
		factory(pi);
		await localHandlers.get("session_start")({}, localCtx);
		assert.equal(localTools.includes("bash"), true, "parent keeps bash so children inherit a mutation ceiling");
		assert.equal(localTools.includes("write"), true, "parent keeps write so children inherit a mutation ceiling");

		const stamp = new Date();
		const taskId = `T-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}-ct1`;
		const spec = {
			taskId,
			objective: "implement the parser",
			cwd: join(dir, "work"),
			role: "worker",
			scope: { allowedPaths: ["src/parser.ts"] },
			constraints: ["no new deps"],
			acceptanceCriteria: ["tests pass"],
			validation: { required: true, commands: ["npm test"] },
			expectedEvidence: { changedFiles: true, tests: true },
			stopConditions: ["ask if ambiguous"],
		};
		const allowed = await localHandlers.get("tool_call")(
			{ toolCallId: "call-child-tools", toolName: "subagent", input: { agent: "worker", task: JSON.stringify(spec) } },
			localCtx,
		);
		assert.equal(allowed?.block, undefined, "worker delegation is admitted");
		assert.equal(localTools.includes("bash"), true, "worker launch still sees bash on the parent");
		assert.equal(localTools.includes("write"), true, "worker launch still sees write on the parent");
		assert.equal(localTools.includes("edit"), true, "worker launch still sees edit on the parent");

		const rootWrite = await localHandlers.get("tool_call")(
			{ toolCallId: "call-child-tools-write", toolName: "write", input: { path: "x", content: "y" } },
			localCtx,
		);
		assert.equal(rootWrite?.block, true, "Root write stays blocked by policy");

		await localHandlers.get("tool_result")(
			{
				toolCallId: "call-child-tools",
				toolName: "subagent",
				input: {},
				content: [{ type: "text", text: "worker done" }],
				isError: false,
			},
			localCtx,
		);
		assert.equal(localTools.includes("bash"), true, "bash stays on the parent after the child returns");
		assert.equal(localTools.includes("write"), true, "write stays on the parent after the child returns");

		const refused = await localHandlers.get("tool_call")(
			{
				toolCallId: "call-child-tools-composite",
				toolName: "subagent",
				input: { agent: "worker", task: "x", tasks: [{ agent: "worker", task: "y" }] },
			},
			localCtx,
		);
		assert.equal(refused?.block, true, "composite workflow stays blocked");
		assert.equal(localTools.includes("bash"), true, "blocked composite does not strip mutation tools");
	} finally {
		process.env.PI_CODING_AGENT_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

// ==========================================================================
// R02 — primary acceptance: Idle read refused → pasteable example launches a
// standalone Explorer → exact-id bg_wait recovery → review → Verdict → Idle.
// ==========================================================================
{
	// A separate workspace with no live Task: Idle for gather.
	const idleCwd = "/fixture/r02-idle";
	const idleCtx = { ...ctx, cwd: idleCwd };

	// 1. Idle read refused, with a pasteable, validating TaskSpec example.
	const refused = await handlers.get("tool_call")(
		{ toolName: "read", input: { path: "docs/api.md" } },
		idleCtx,
	);
	assert.equal(refused?.block, true, "an Idle read is refused");
	assert.match(refused.reason, /idle for gather/);
	const exampleMatch = refused.reason.match(/```json\n([\s\S]*?)\n```/);
	assert.ok(exampleMatch, "the refusal carries the fenced example");
	const example = JSON.parse(exampleMatch[1]);
	assert.deepEqual(validateTaskSpec(example), [], "the example passes TaskSpec validation");
	assert.equal(example.cwd, idleCwd, "the example names the adapter workspace");

	// 1b. While Idle, a prefix bg_wait id is refused (no live Task allows the
	// generic wait tool either).
	const waitRefusedIdle = await handlers.get("tool_call")(
		{ toolName: "bg_wait", input: { id: "run-r02-idle-prefix" } },
		idleCtx,
	);
	assert.equal(waitRefusedIdle?.block, true, "a prefix id is refused while Idle");

	// 2. Paste: the example (filled with the lookup intent) launches an async
	// standalone Explorer.
	example.objective = "Look up the API base URL in docs/api.md and report it.";
	example.role = "explorer";
	const paste = await handlers.get("tool_call")(
		{
			toolCallId: "call-r02-idle-paste",
			toolName: "subagent",
			input: { agent: "explorer", task: JSON.stringify(example), async: true },
		},
		idleCtx,
	);
	assert.equal(paste, undefined, "the validating example starts the Delegation");
	const receipt = await handlers.get("tool_result")(
		{
			toolCallId: "call-r02-idle-paste",
			toolName: "subagent",
			input: {},
			details: { asyncId: "run-r02-idle", runId: "run-r02-idle", asyncDir: join(isolatedAgentDir, "async-subagent-runs", "run-r02-idle") },
			content: [{ type: "text", text: "Async: explorer [run-r02-idle]\nThe async run is detached and running in the background." }],
			isError: false,
		},
		idleCtx,
	);
	assert.match(receipt.content[0].text, /Async delegation/);
	const canonId = /task (T-\d{8}-\d{3}) has started/.exec(receipt.content[0].text)?.[1];
	assert.ok(canonId, `the receipt names the canonical Task id: ${receipt.content[0].text}`);
	assert.notEqual(canonId, "T-pending", "the sentinel never survives to the launch packet");

	// 3. The exact-id wait is authorized while Idle (the run is registered and
	// pending); an unregistered id is refused.
	const waitAllowed = await handlers.get("tool_call")(
		{ toolName: "bg_wait", input: { id: "run-r02-idle" } },
		idleCtx,
	);
	assert.equal(waitAllowed, undefined, "the authorized exact-id wait passes Policy");
	// 4. First wait: no terminal artifacts yet → pending guidance, no busy-wait.
	const firstWait = await handlers.get("tool_result")(
		{ toolCallId: "w-r02-1", toolName: "bg_wait", input: { id: "run-r02-idle" }, content: [] },
		idleCtx,
	);
	assert.match(firstWait.content[0].text, /not reached a terminal state/);

	// 5. The run finishes: host-shaped meta + saved output appear.
	mkdirSync(join(isolatedAgentDir, "artifacts", "outputs", "run-r02-idle"), { recursive: true });
	writeFileSync(
		join(isolatedAgentDir, "artifacts", "run-r02-idle_explorer_meta.json"),
		JSON.stringify({ runId: "run-r02-idle", agent: "explorer", exitCode: 0 }),
	);
	writeFileSync(
		join(isolatedAgentDir, "artifacts", "outputs", "run-r02-idle", "out.txt"),
		JSON.stringify({
			version: 1,
			taskId: canonId,
			status: "completed",
			summary: "found the API base URL in docs/api.md",
			changedFiles: [],
			validation: [],
			evidence: { cwd: idleCwd, taskId: canonId, workerRunId: "call-r02-idle-paste", changedPaths: [], gitAvailable: true, generatedAt: new Date().toISOString() },
			risks: [],
			unresolved: [],
		}),
	);
	const recovered = await handlers.get("tool_result")(
		{ toolCallId: "w-r02-2", toolName: "bg_wait", input: { id: "run-r02-idle" }, content: [] },
		idleCtx,
	);
	assert.match(recovered.content[0].text, /decision: review_pending/, recovered.content[0].text);
	assert.match(recovered.content[0].text, /\[PLANNER-ONLY WORKER REPORT\]/, "the recovered output is the processed report, delivered once");

	// 6. Root Verdict closes the standalone Task; the workspace returns to Idle.
	const verdict = await tools.get("planner_verdict").execute(
		"v-r02-idle",
		{ verdict: "pass", summary: "lookup confirmed", taskId: canonId },
		undefined,
		undefined,
		idleCtx,
	);
	assert.equal(verdict.details.state, "completed", verdict.content?.[0]?.text);

	// 7. The next read is refused: the completed Task no longer keeps gather live.
	const refusedAgain = await handlers.get("tool_call")(
		{ toolName: "read", input: { path: "docs/api.md" } },
		idleCtx,
	);
	assert.equal(refusedAgain?.block, true, "the workspace is Idle again after completion");

	// A replayed wait cannot re-consume the run or reopen gather permission.
	const replay = await handlers.get("tool_result")(
		{ toolCallId: "w-r02-3", toolName: "bg_wait", input: { id: "run-r02-idle" }, content: [] },
		idleCtx,
	);
	assert.equal(replay, undefined, "a consumed id yields no further recovery");
}

// R02 another live local Task: completing one Explorer does not Idle-refuse
// inspect while a sibling Task in the same cwd is still executing.
{
	const twinCwd = "/fixture/r02-twin";
	const twinCtx = { ...ctx, cwd: twinCwd };
	gitResponses.set("status --porcelain=v2 --branch", { stdout: "", stderr: "", code: 0 });
	gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
	const specA = { ...delegationSpec("T-pending", "explorer", twinCwd), validation: { required: false }, objective: "look up A" };
	const specB = { ...delegationSpec("T-pending", "explorer", twinCwd), validation: { required: false }, objective: "look up B" };
	assert.equal(await handlers.get("tool_call")(
		{ toolCallId: "call-twin-a", toolName: "subagent", input: { agent: "explorer", task: JSON.stringify(specA) } },
		twinCtx,
	), undefined);
	assert.equal(await handlers.get("tool_call")(
		{ toolCallId: "call-twin-b", toolName: "subagent", input: { agent: "explorer", task: JSON.stringify(specB) } },
		twinCtx,
	), undefined);
	const launchedA = await handlers.get("tool_result")(
		{
			toolCallId: "call-twin-a",
			toolName: "subagent",
			content: [{ type: "text", text: JSON.stringify({
				version: 1, taskId: "T-pending", status: "completed", summary: "looked up A",
				changedFiles: [], validation: [],
				evidence: { cwd: twinCwd, taskId: "T-pending", workerRunId: "call-twin-a", changedPaths: [], gitAvailable: true, generatedAt: new Date().toISOString() },
				risks: [], unresolved: [],
			}) }],
			isError: false,
		},
		twinCtx,
	);
	const twinId = /task (T-\d{8}-\d{3})/.exec(launchedA.content[0].text)?.[1]
		?? /taskId: (T-\d{8}-\d{3})/.exec(launchedA.content[0].text)?.[1];
	assert.ok(twinId, `completed Explorer names a canonical Task: ${launchedA.content[0].text}`);
	await tools.get("planner_verdict").execute(
		"v-r02-twin",
		{ verdict: "pass", summary: "A done", taskId: twinId },
		undefined,
		undefined,
		twinCtx,
	);
	const stillLive = await handlers.get("tool_call")(
		{ toolName: "read", input: { path: "docs/a.md" } },
		twinCtx,
	);
	assert.equal(stillLive?.block, undefined, "a sibling live Task keeps inspect on in this cwd");
}

rmSync(isolatedAgentDir, { recursive: true, force: true });

console.log("planner-only extension: PASS");
