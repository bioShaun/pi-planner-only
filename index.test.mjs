import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const isolatedAgentDir = mkdtempSync(join(process.cwd(), ".planner-only-test-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;

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
	"subagent",
	"git_audit",
	"planner_verdict",
]);
assert.equal(activeTools.includes("grep"), false);
assert.equal(activeTools.includes("bash"), false);
assert.equal(activeTools.includes("write"), false);
assert.equal(activeTools.includes("custom_mutator"), false);
assert.equal(setActiveCalls.length, 1);

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
assert.equal(activeTools.includes("edit"), false);

const prompt = await handlers.get("before_agent_start")({ systemPrompt: "BASE" });
assert.match(prompt.systemPrompt, /^BASE/);
assert.match(prompt.systemPrompt, /root orchestrator/);
assert.match(prompt.systemPrompt, /WorkerReport/);
assert.match(prompt.systemPrompt, /git_audit/);
assert.match(prompt.systemPrompt, /Never fix rejected work yourself/);
assert.match(prompt.systemPrompt, /Do not pre-compose worker.+reviewer as a workflowScript, tasks array, or chain/s);
assert.match(prompt.systemPrompt, /one lifecycle invocation/);
assert.match(prompt.systemPrompt, /direct \{agent, task\}/);
assert.match(prompt.systemPrompt, /Call the reviewer only after the worker returns/);
assert.doesNotMatch(prompt.systemPrompt, /diffStat/);

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
	"subagent",
	"git_audit",
	"planner_verdict",
	"bash",
	"write",
	"custom_mutator",
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
			assert.deepEqual(activeTools, ["read", "subagent"]);
			assert.equal(activeTools.includes("grep"), false);

			activeTools.push("other_extension_tool");
			await commands.get("planner-only").handler("off", ctx);
			assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "planner-only.off")), true);
			assert.deepEqual(activeTools, [
				"read", "subagent", "other_extension_tool", "bash", "write",
			]);

			await commands.get("planner-only").handler("on", ctx);
			assert.equal(existsSync(join(process.env.PI_CODING_AGENT_DIR, "planner-only.off")), false);
			assert.deepEqual(activeTools, ["read", "subagent"]);
			assert.equal(activeTools.includes("grep"), false);
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

			// D1: marker present + PI_PLANNER_ONLY=1 -> tools restricted, status source: env
			process.env.PI_PLANNER_ONLY = "1";
			writeFileSync(markerPath, "Disabled\\n");
			const d1 = makePi(["read", "bash", "subagent", "write"]);
			plannerOnly(d1.pi);
			const notices1 = [];
			const ctx1 = { hasUI: true, ui: { notify(msg) { notices1.push(msg); }, setStatus() {}, theme: { fg(_c, t) { return t; } } } };
			await d1.handlers.get("session_start")({}, ctx1);
			assert.deepEqual(d1.getActive(), ["read", "subagent"]);
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

			// Default: no marker + env unset -> tools restricted, status source: default
			rmSync(markerPath);
			const d3 = makePi(["read", "bash", "subagent", "write"]);
			plannerOnly(d3.pi);
			const notices3 = [];
			const ctx3 = { hasUI: true, ui: { notify(msg) { notices3.push(msg); }, setStatus() {}, theme: { fg(_c, t) { return t; } } } };
			await d3.handlers.get("session_start")({}, ctx3);
			assert.deepEqual(d3.getActive(), ["read", "subagent"]);
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
// v0.2 lifecycle: git_audit, delegation, worker reports, review commands
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

function delegationSpec(taskId, role = "worker", cwd = `/fixture/${taskId}`) {
	return {
		taskId,
		objective: `do ${taskId}`,
		cwd,
		role,
		scope: { allowedPaths: ["src/parser.ts"] },
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
		input: { agent: "worker", task: `Do this:\n\n\`\`\`json\n${JSON.stringify(delegationSpec("T-20260831-100"))}\n\`\`\`` },
	},
	ctx,
);
notices.length = 0;
await commands.get("planner-only").handler("task", ctx);
assert.match(notices.at(-1).message, /Task: T-20260831-100/);
assert.match(notices.at(-1).message, /State: executing/);
assert.match(notices.at(-1).message, /Review mode: root/);

gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });

// the worker returns a valid report wrapped in noise; the parent sees a bounded report
const workerReport = {
	version: 1,
	taskId: "T-20260831-100",
	status: "completed",
	summary: "Implemented the parser and its tests.",
	changedFiles: ["src/parser.ts", "src/parser.test.ts"],
	validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" }],
	evidence: {
		cwd: "/fixture/T-20260831-100",
		taskId: "T-20260831-100",
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
assert.match(workerText, /\[PLANNER-ONLY REVIEW STATE\]/);
assert.match(workerText, /taskId: T-20260831-100/);
assert.match(workerText, /decision: review_pending/);
assert.match(workerText, /evidence: fresh/);
assert.match(workerText, /\[PLANNER-ONLY WORKER REPORT\]/);
assert.match(workerText, /- \[passed\] test: npm test exit 0/);
assert.match(workerText, /Reviewer prompt template/);
// the raw worker transcript is replaced, not forwarded
assert.doesNotMatch(workerText, /lots of raw noise/);

// a fresh reviewer on the same task records a verdict and advances the state
const reviewerSpec = delegationSpec("T-20260831-100", "reviewer");
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
assert.match(reviewInput.task, /T-20260831-100/);
assert.match(reviewInput.task, /Implemented the parser/);
assert.doesNotMatch(reviewInput.task, /rubber-stamp/);
assert.doesNotMatch(reviewInput.task, /I already decided/);
const reviewResult = {
	taskId: "T-20260831-100",
	verdict: "request_changes",
	summary: "the parser has no test coverage",
	evidenceFresh: true,
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
await commands.get("planner-only").handler(`review T-20260831-100`, ctx);
assert.match(notices.at(-1).message, /State: changes_requested/);
assert.match(notices.at(-1).message, /Round: 1\/3/);

// root accepts despite the reviewer; the override is recorded, not silent
notices.length = 0;
await commands.get("planner-only").handler("review T-20260831-100 pass finding was out of scope", ctx);
assert.match(notices.at(-1).message, /decision: accept/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260831-100", ctx);
assert.match(notices.at(-1).message, /State: completed/);
assert.match(notices.at(-1).message, /Overrides: 1/);
assert.match(notices.at(-1).message, /Changed files: 2/);

// review mode switching
notices.length = 0;
await handlers.get("tool_call")(
	{ toolCallId: "call-110", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260831-110")) } },
	ctx,
);
await commands.get("planner-only").handler("review T-20260831-110 fresh", ctx);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260831-110", ctx);
assert.match(notices.at(-1).message, /Review mode: fresh/);
await commands.get("planner-only").handler("review T-20260831-110 root", ctx);

// malformed worker output triggers exactly one report-only correction
await handlers.get("tool_call")(
	{ toolCallId: "call-120", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260831-120")) } },
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
		input: { task: JSON.stringify(delegationSpec("T-20260831-200", "worker", "/fixture/shared")) },
	},
	ctx,
);
const blockedWriter = await handlers.get("tool_call")(
	{
		toolCallId: "call-201",
		toolName: "subagent",
		input: { task: JSON.stringify(delegationSpec("T-20260831-201", "worker", "/fixture/shared")) },
	},
	ctx,
);
assert.equal(blockedWriter.block, true);
assert.match(blockedWriter.reason, /write lock/);
assert.match(blockedWriter.reason, /T-20260831-200/);
// readers never take the write lock
const readerCall = await handlers.get("tool_call")(
	{ toolCallId: "call-202", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260831-202", "explorer")) } },
	ctx,
);
assert.equal(readerCall, undefined);
const explorerInput = { agent: "worker", task: JSON.stringify(delegationSpec("T-20260831-203", "explorer")) };
await handlers.get("tool_call")(
	{ toolCallId: "call-203", toolName: "subagent", input: explorerInput },
	ctx,
);
assert.equal(explorerInput.agent, "reviewer");

const workerInput = { agent: "worker", context: "fork", task: JSON.stringify(delegationSpec("T-20260831-204")) };
await handlers.get("tool_call")(
	{ toolCallId: "call-204", toolName: "subagent", input: workerInput },
	ctx,
);
assert.equal(workerInput.agent, "worker");
assert.equal(workerInput.context, "fork");

// evidence drift: an external edit after the report marks the evidence stale
await handlers.get("tool_call")(
	{ toolCallId: "call-300", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260831-300")) } },
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
				taskId: "T-20260831-300",
				evidence: { ...workerReport.evidence, taskId: "T-20260831-300", workerRunId: "call-300", cwd: "/fixture/T-20260831-300", gitStatusHash: cleanHash, changedPaths: ["src/parser.ts"] },
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
	{ toolCallId: "call-400", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260831-400")) } },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
const freshReport = {
	...workerReport,
	taskId: "T-20260831-400",
	evidence: { ...workerReport.evidence, taskId: "T-20260831-400", workerRunId: "call-400", cwd: "/fixture/T-20260831-400", changedPaths: ["src/parser.ts"] },
};
const raceWorker = await handlers.get("tool_result")(
	{ toolCallId: "call-400", toolName: "subagent", input: {}, content: [{ type: "text", text: JSON.stringify(freshReport) }], isError: false },
	ctx,
);
assert.match(raceWorker.content[0].text, /decision: review_pending/);
gitResponses.set("rev-parse HEAD", { stdout: "def5678\n", stderr: "", code: 0 });
notices.length = 0;
await commands.get("planner-only").handler("review T-20260831-400 pass accepting late", ctx);
assert.match(notices.at(-1).message, /decision: revalidate/);
assert.match(notices.at(-1).message, /evidence: stale/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260831-400", ctx);
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
	const taskId = "T-20260831-b6";
	const runId = "b6b6b6b6-0000-0000-0000-0000000000b6";
	await handlers.get("tool_call")(
		{
			toolCallId: "call-b6",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(delegationSpec(taskId)) },
		},
		ctx,
	);
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
	assert.match(receipt.content[0].text, /Async delegation for task T-20260831-b6 has started/);

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

// §4: the prompt is re-read every turn, so it stays under a hard size bound
assert.ok(PLANNER_PROMPT.length <= 2500, `PLANNER_PROMPT is ${PLANNER_PROMPT.length} chars`);
assert.match(PLANNER_PROMPT, /5\. record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict/);
assert.match(PLANNER_PROMPT, /\/planner-only review is the operator's override; you record verdicts with planner_verdict\./);
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

// pass with no recorded WorkerReport -> refused, state unchanged
const noReportVerdict = await verdictTool.execute(
	"v-1",
	{ verdict: "pass", summary: "nothing to judge", taskId: "T-20260831-110" },
	undefined,
	undefined,
	ctx,
);
assert.equal(noReportVerdict.isError, true);
assert.match(noReportVerdict.content[0].text, /no recorded WorkerReport/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260831-110", ctx);
assert.match(notices.at(-1).message, /State: executing/, "a refused verdict changes nothing");

// a worker task with a fresh report, then a pending reviewer run
gitResponses.set("rev-parse HEAD", { stdout: "abc1234\n", stderr: "", code: 0 });
gitResponses.set("status --porcelain=v2 --branch", { stdout: emptyStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: "", stderr: "", code: 0 });
await handlers.get("tool_call")(
	{ toolCallId: "call-v10", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-v10")) } },
	ctx,
);
gitResponses.set("status --porcelain=v2 --branch", { stdout: cleanStatus, stderr: "", code: 0 });
gitResponses.set("diff HEAD --stat", { stdout: " src/parser.ts | 2 +-\n", stderr: "", code: 0 });
const v10Report = {
	...workerReport,
	taskId: "T-20260905-v10",
	evidence: { ...workerReport.evidence, taskId: "T-20260905-v10", workerRunId: "call-v10", cwd: "/fixture/T-20260905-v10", changedPaths: ["src/parser.ts"] },
};
const v10Worker = await handlers.get("tool_result")(
	{ toolCallId: "call-v10", toolName: "subagent", input: {}, content: [{ type: "text", text: JSON.stringify(v10Report) }], isError: false },
	ctx,
);
assert.match(v10Worker.content[0].text, /decision: review_pending/);

// pass while a reviewer delegation is pending -> refused
await handlers.get("tool_call")(
	{ toolCallId: "call-v11", toolName: "subagent", input: { agent: "reviewer", task: JSON.stringify(delegationSpec("T-20260905-v10", "reviewer")) } },
	ctx,
);
const pendingVerdict = await verdictTool.execute(
	"v-2",
	{ verdict: "pass", summary: "jumping the gun", taskId: "T-20260905-v10" },
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
			taskId: "T-20260905-v10",
			verdict: "request_changes",
			summary: "missing empty-input coverage",
			evidenceFresh: true,
			findings: [{ severity: "major", category: "test", description: "no empty-input case", requestedChange: "add a case" }],
		}) }],
		isError: false,
	},
	ctx,
);
assert.match(v11Outcome.content[0].text, /decision: request_changes/);
const rootPass = await verdictTool.execute(
	"v-3",
	{ verdict: "pass", summary: "finding is out of scope for this task", taskId: "T-20260905-v10" },
	undefined,
	undefined,
	ctx,
);
assert.equal(rootPass.isError, undefined);
assert.equal(rootPass.details.taskId, "T-20260905-v10");
assert.equal(rootPass.details.verdict, "pass");
assert.equal(rootPass.details.action, "accept");
assert.equal(rootPass.details.state, "completed");
assert.match(rootPass.content[0].text, /^\[PLANNER-ONLY REVIEW STATE\]/);
assert.match(rootPass.content[0].text, /decision: accept/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-v10", ctx);
assert.match(notices.at(-1).message, /State: completed/);
assert.match(notices.at(-1).message, /Reviews: request_changes \(reviewer\), pass \(root\)/);
assert.match(notices.at(-1).message, /Overrides: 1/);

// blocked with no report is allowed (no delegation pending)
await handlers.get("tool_call")(
	{ toolCallId: "call-v12", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-v12")) } },
	ctx,
);
await handlers.get("tool_result")(
	{ toolCallId: "call-v12", toolName: "subagent", input: {}, content: [{ type: "text", text: "I could not produce a report." }], isError: false },
	ctx,
);
const blockedVerdict = await verdictTool.execute(
	"v-4",
	{ verdict: "blocked", summary: "worker cannot proceed without credentials", taskId: "T-20260905-v12" },
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
	{ toolCallId: "call-v13", toolName: "subagent", input: { task: JSON.stringify(delegationSpec("T-20260905-v13")) } },
	ctx,
);
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-v13 pass forcing the issue", ctx);
assert.ok(
	notices.some((notice) => notice.type === "warning" && /bypassed refusal/i.test(notice.message)),
	"the override prints which refusal it bypassed",
);
assert.match(notices.at(-1).message, /\[PLANNER-ONLY REVIEW STATE\]/);
notices.length = 0;
await commands.get("planner-only").handler("task T-20260905-v13", ctx);
assert.match(notices.at(-1).message, /Reviews: pass \(operator\)/);
notices.length = 0;
await commands.get("planner-only").handler("review T-20260905-v13 pass again", ctx);
assert.match(notices.at(-1).message, /already completed/);
const terminalVerdict = await verdictTool.execute(
	"v-5",
	{ verdict: "pass", summary: "again", taskId: "T-20260905-v13" },
	undefined,
	undefined,
	ctx,
);
assert.equal(terminalVerdict.isError, true);
assert.match(terminalVerdict.content[0].text, /already completed/);

// --------------------------------------------------------------------------
// U-2 / U-3 / U-4 / RF-6 — usage capture and failed launch through the adapter
// --------------------------------------------------------------------------

{
	sessionEntries.length = 0;
	const taskId = "T-20260905-u2";
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
	const taskId = "T-20260905-leak";
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
	const taskId = "T-20260905-bgw";
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
	const taskId = "T-20260905-meta";
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
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-meta", cwd: `/fixture/${taskId}`, changedPaths: ["src/parser.ts"] },
			})}`,
		},
	}, ctx);
	assert.match(replaced.message.content, /\[PLANNER-ONLY REVIEW STATE\]/);
	assert.ok(sessionEntries.some((entry) =>
		entry.data.kind === "child" && entry.data.child?.source === "meta-file" && entry.data.child?.pending === false,
	));
}

{
	const taskId = "T-20260905-pend";
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
				evidence: { ...workerReport.evidence, taskId, workerRunId: "call-pend", cwd: `/fixture/${taskId}`, changedPaths: ["src/parser.ts"] },
			})}`,
		},
	}, ctx);
	assert.ok(sessionEntries.some((entry) =>
		entry.data.kind === "child" && entry.data.child?.source === "unavailable" && entry.data.child?.pending === true,
	));
}

{
	const taskId = "T-20260905-rf6i";
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

rmSync(isolatedAgentDir, { recursive: true, force: true });

console.log("planner-only extension: PASS");
