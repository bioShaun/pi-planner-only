import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ==========================================================================
// Ticket 05 B — adapter-level cutover coverage (tool_call hook, no flag).
// This file never asserts under PI_PLANNER_ONLY_LEGACY_SUBAGENT; the one
// pre-cutover behavior it still needs — registering a real pending run for
// the bg_wait check — is driven by toggling the flag for exactly two calls.
// ==========================================================================

const isolatedAgentDir = mkdtempSync(join(tmpdir(), "planner-only-cutover-"));
process.env.PI_CODING_AGENT_DIR = isolatedAgentDir;
process.env.PI_PLANNER_ONLY_SEED_PRICING = "0";
delete process.env.PI_PLANNER_ONLY_LEGACY_SUBAGENT;
delete process.env.PI_SUBAGENT_CHILD;

const { default: plannerOnly } = await import("./index.ts");

const handlers = new Map();
const commands = new Map();
const tools = new Map();
const notices = [];
const sessionEntries = [];
const activeToolNames = ["read", "bash", "write", "subagent", "bg_wait", "git_audit", "planner_verdict", "planner_recover", "planner_delegate"];
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
		return [...activeToolNames];
	},
	getAllTools() {
		return activeToolNames.map((name) => ({ name }));
	},
	setActiveTools() {},
	appendEntry(customType, data) {
		sessionEntries.push({ type: "custom", customType, data });
	},
	async exec() {
		return { stdout: "", stderr: "", code: 0 };
	},
};

plannerOnly(pi);

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

const ledgerDir = join(isolatedAgentDir, "planner-only", "ledger");
const ledgerTaskCount = () =>
	(existsSync(ledgerDir) ? readdirSync(ledgerDir) : []).filter((name) => name.endsWith(".json")).length;

const stamp = new Date();
const fixtureTaskId = (suffix) =>
	`T-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, "0")}${String(stamp.getDate()).padStart(2, "0")}-${suffix}`;

// --------------------------------------------------------------------------
// 1. subagent is refused outright — input.task is a *valid* TaskSpec document
//    on purpose: the refusal must not depend on (or read) the input.
// --------------------------------------------------------------------------
{
	const validSpec = {
		taskId: fixtureTaskId("901"),
		objective: "create hello.txt",
		role: "worker",
		cwd: process.cwd(),
		scope: { allowedPaths: ["hello.txt"] },
		constraints: [],
		acceptanceCriteria: ["hello.txt exists"],
		validation: { required: false },
	};
	notices.length = 0;
	const refused = await handlers.get("tool_call")(
		{
			toolCallId: "call-05b-subagent",
			toolName: "subagent",
			input: { agent: "worker", task: JSON.stringify(validSpec) },
		},
		ctx,
	);
	assert.equal(refused?.block, true);
	assert.match(refused.reason, /^Planner-only guard: the parent process may not call 'subagent'\./);
	assert.ok(refused.reason.includes("planner_delegate"), "the refusal names the replacement tool");
	assert.equal(refused.reason.includes("```json"), false, "no TaskSpec repair — the prompt is never read");
	assert.deepEqual(
		notices.at(-1),
		{ message: "Blocked parent tool: subagent", type: "warning" },
		"the refusal toast is unchanged",
	);
	assert.equal(ledgerTaskCount(), 0, "the refused call mints no Task");

	// No Delegation is bound to the refused call: a late host receipt for that
	// toolCallId is unmanaged and passes through untouched.
	const orphanReceipt = await handlers.get("tool_result")(
		{
			toolCallId: "call-05b-subagent",
			toolName: "subagent",
			input: {},
			details: { runId: "run-05b-orphan", asyncId: "run-05b-orphan" },
			content: [{ type: "text", text: "Async: worker [run-05b-orphan]\nThe async run is detached and running in the background." }],
			isError: false,
		},
		ctx,
	);
	assert.equal(orphanReceipt, undefined, "no Delegation was registered for the refused call");
	assert.equal(ledgerTaskCount(), 0);
}

// --------------------------------------------------------------------------
// 2. The composite {gate, workflow} shape gets the same cutover refusal — the
//    composite-workflow reason no longer applies.
// --------------------------------------------------------------------------
{
	const refused = await handlers.get("tool_call")(
		{
			toolCallId: "call-05b-composite",
			toolName: "subagent",
			input: { agent: "worker", gate: "npm test", workflow: "review" },
		},
		ctx,
	);
	assert.equal(refused?.block, true);
	assert.match(refused.reason, /may not call 'subagent'/);
	assert.equal(refused.reason.includes("composite"), false, "the cutover refusal replaced the composite-workflow reason");
	assert.equal(ledgerTaskCount(), 0);
}

// --------------------------------------------------------------------------
// 3. bg_wait with a real registered pending run id is refused — the exact-id
//    Idle recovery no longer exists. The run is registered through the
//    flagged legacy path, then the flag comes straight back off.
// --------------------------------------------------------------------------
const pendingCwd = "/fixture/cutover-05b";
{
	const pendingCtx = { ...ctx, cwd: pendingCwd };
	const spec = {
		taskId: fixtureTaskId("902"),
		objective: "pending run fixture",
		role: "worker",
		cwd: pendingCwd,
		scope: { allowedPaths: ["x.txt"] },
		constraints: [],
		acceptanceCriteria: ["x"],
		validation: { required: false },
	};
	process.env.PI_PLANNER_ONLY_LEGACY_SUBAGENT = "1";
	const launched = await handlers.get("tool_call")(
		{
			toolCallId: "call-05b-pending",
			toolName: "subagent",
			input: { agent: "worker", async: true, task: JSON.stringify(spec) },
		},
		pendingCtx,
	);
	assert.equal(launched, undefined, "the legacy path still launches while the flag is on");
	const receipt = await handlers.get("tool_result")(
		{
			toolCallId: "call-05b-pending",
			toolName: "subagent",
			input: {},
			details: {
				asyncId: "run-05b-pending",
				runId: "run-05b-pending",
				asyncDir: join(isolatedAgentDir, "async-subagent-runs", "run-05b-pending"),
			},
			content: [{ type: "text", text: "Async: worker [run-05b-pending]\nThe async run is detached and running in the background." }],
			isError: false,
		},
		pendingCtx,
	);
	assert.match(receipt?.content?.[0]?.text ?? "", /Async delegation for task/, "the run is registered as pending");
	// Same call under the flag: the registered exact id is a legal wait.
	const legacyWait = await handlers.get("tool_call")(
		{ toolName: "bg_wait", input: { id: "run-05b-pending" } },
		pendingCtx,
	);
	assert.equal(legacyWait, undefined, "the exact registered id passes the legacy rules");
	delete process.env.PI_PLANNER_ONLY_LEGACY_SUBAGENT;

	const refused = await handlers.get("tool_call")(
		{ toolName: "bg_wait", input: { id: "run-05b-pending", timeout: 1000 } },
		pendingCtx,
	);
	assert.equal(refused?.block, true, "even a registered pending run id is refused post-cutover");
	assert.match(refused.reason, /may not call 'bg_wait'/);
	assert.ok(refused.reason.includes("no asynchronous wait"));
}

// --------------------------------------------------------------------------
// 4. Idle-for-gather allowlist: git_audit passes; planner_recover is refused;
//    an inspect refusal still carries the fenced TaskSpec repair.
// --------------------------------------------------------------------------
{
	const idleCtx = { ...ctx, cwd: "/fixture/cutover-05b-idle" };
	const audit = await handlers.get("tool_call")(
		{ toolCallId: "call-05b-audit", toolName: "git_audit", input: { operation: "status" } },
		idleCtx,
	);
	assert.equal(audit, undefined, "git_audit is allowed while Idle");

	const recover = await handlers.get("tool_call")(
		{ toolName: "planner_recover", input: { taskId: fixtureTaskId("902"), runId: "run-05b-pending" } },
		idleCtx,
	);
	assert.equal(recover?.block, true, "planner_recover left the Idle allowlist");
	assert.match(recover.reason, /idle for gather/);

	const read = await handlers.get("tool_call")(
		{ toolName: "read", input: { path: "docs/x.md" } },
		idleCtx,
	);
	assert.equal(read?.block, true);
	assert.ok(read.reason.includes("```json"), "non-delegation Idle refusals still carry the TaskSpec repair");
}

// --------------------------------------------------------------------------
// 5. planner_delegate passes the hook while a Task is live and while Idle —
//    the hook only decides policy; it never runs the delegation itself.
// --------------------------------------------------------------------------
{
	// The worker Task minted in check 3 is still executing for pendingCwd.
	const liveCtx = { ...ctx, cwd: pendingCwd };
	const liveCall = await handlers.get("tool_call")(
		{
			toolCallId: "call-05b-pd-live",
			toolName: "planner_delegate",
			input: { role: "validator", taskId: fixtureTaskId("902"), objective: "re-check", validation: { required: false } },
		},
		liveCtx,
	);
	assert.equal(liveCall, undefined, "planner_delegate passes while live");
	const idleCall = await handlers.get("tool_call")(
		{
			toolCallId: "call-05b-pd-idle",
			toolName: "planner_delegate",
			input: { role: "worker", objective: "x", scope: { allowedPaths: ["x.txt"] }, constraints: [], acceptanceCriteria: ["x"], validation: { required: false } },
		},
		{ ...ctx, cwd: "/fixture/cutover-05b-idle" },
	);
	assert.equal(idleCall, undefined, "planner_delegate passes while Idle");
}

// --------------------------------------------------------------------------
// 6. A child instance (PI_SUBAGENT_CHILD=1) never blocks subagent: the
//    extension no-ops there, so no tool_call handler exists to refuse it.
//    The isChild short-circuit itself is covered in policy.test.mjs.
// --------------------------------------------------------------------------
{
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
}

// --------------------------------------------------------------------------
// 7. /planner-only off lets subagent through; on refuses it again.
// --------------------------------------------------------------------------
{
	await commands.get("planner-only").handler("off", ctx);
	const allowed = await handlers.get("tool_call")(
		{ toolCallId: "call-05b-off", toolName: "subagent", input: { agent: "worker", task: "anything" } },
		ctx,
	);
	assert.equal(allowed, undefined, "subagent passes while the guard is off");
	assert.equal(ledgerTaskCount(), 1, "the off-guard call is not intercepted — and this extension registers nothing for it");

	await commands.get("planner-only").handler("on", ctx);
	const refused = await handlers.get("tool_call")(
		{ toolCallId: "call-05b-on", toolName: "subagent", input: { agent: "worker", task: "anything" } },
		ctx,
	);
	assert.equal(refused?.block, true, "subagent is refused again once the guard is back on");
	assert.match(refused.reason, /may not call 'subagent'/);
}

rmSync(isolatedAgentDir, { recursive: true, force: true });

console.log("planner-only policy cutover: PASS");
