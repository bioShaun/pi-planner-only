import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(base, ".revalidation-accounting-"));
const agent = join(run, "agent");
const workspace = join(run, "workspace");
mkdirSync(agent);
mkdirSync(workspace);
writeFileSync(join(workspace, "fixture.txt"), "initial\n");

// index.ts fingerprints its loaded checkout through execFileSync. Replace that
// boundary before importing it so this regression remains an in-process test.
const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (file, args) => {
	assert.equal(file, "git");
	assert.deepEqual(args, ["rev-parse", "HEAD"]);
	return "fixture-plugin-head\n";
};
syncBuiltinESMExports();

Object.assign(process.env, {
	PI_CODING_AGENT_DIR: agent,
	PI_PLANNER_ONLY: "1",
	PI_PLANNER_ONLY_SEED_PRICING: "0",
	PI_PLANNER_ONLY_QUIESCENCE_MS: "0",
	PI_PLANNER_ONLY_CANCEL_GRACE_MS: "50",
	PI_PLANNER_ONLY_REQUIRE_REVIEW: "0",
	// Isolate the existing per-Task cap; request defaults have separate tests.
	PI_PLANNER_ONLY_REQUEST_TOOL_ATTEMPTS: "100",
	PI_PLANNER_ONLY_REQUEST_CHILD_LAUNCHES: "100",
	PI_PLANNER_ONLY_REQUEST_FAILURES: "100",
});
delete process.env.PI_SUBAGENT_CHILD;

try {
	const { default: plannerOnly } = await import("./index.ts");
	const { hashStatus } = await import("./evidence.ts");
	const { LedgerSnapshotStore } = await import("./ledger-store.ts");
	const { TaskStore } = await import("./task.ts");
	const {
		SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST,
		SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE,
	} = await import("./subagent-delegation-contract.ts");

	const handlers = new Map();
	const tools = new Map();
	const listeners = new Map();
	const entries = [];
	const emitted = [];
	let launches = 0;
	let sequence = 0;
	let currentHead = "head-0";
	let throwAfterRequest = false;
	const events = {
		on(name, fn) {
			const set = listeners.get(name) ?? new Set();
			set.add(fn);
			listeners.set(name, set);
			return () => set.delete(fn);
		},
		emit(name, value) {
			for (const fn of [...(listeners.get(name) ?? [])]) fn(value);
			if (name === REQUEST && throwAfterRequest) {
				throwAfterRequest = false;
				throw new Error("fixture emit failed after a listener observed REQUEST");
			}
		},
	};
	events.on(REQUEST, (request) => {
		launches += 1;
		emitted.push({ requestId: request.requestId, taskId: request.nodeId, agent: request.agent });
		const reviewer = request.agent === "reviewer";
		if (throwAfterRequest) return;
		queueMicrotask(() => events.emit(RESPONSE, {
			requestId: request.requestId,
			ownerRunId: request.ownerRunId,
			nodeId: request.nodeId,
			status: "completed",
			runId: `fixture-run-${launches}`,
			agent: request.agent ?? "worker",
			model: "fixture/no-model",
			result: {
				kind: "structured",
				value: reviewer
					? { taskId: request.nodeId, verdict: "pass", summary: "reviewed", evidenceFresh: true, findings: [] }
					: {
						version: 1,
						taskId: request.nodeId,
						status: "completed",
						summary: "read fixture; no changes",
						changedFiles: [],
						validation: [],
						risks: [],
						unresolved: [],
						evidence: {
							cwd: workspace,
							taskId: request.nodeId,
							gitAvailable: true,
							baseGitRef: currentHead,
							finalGitRef: currentHead,
							gitStatusHash: hashStatus(""),
							changedPaths: [],
							generatedAt: new Date().toISOString(),
						},
					},
			},
		}));
	});

	const pi = {
		on(name, fn) { handlers.set(name, fn); },
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
		getActiveTools() { return ["read", "bash", "write"]; },
		getAllTools() { return [...tools.keys()].map((name) => ({ name })); },
		setActiveTools() {},
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		events,
		async exec(_command, args) {
			const key = args.join(" ");
			const values = {
				"rev-parse --git-dir": ".git\n",
				"rev-parse --show-toplevel": `${workspace}\n`,
				"rev-parse HEAD": `${currentHead}\n`,
				"status --porcelain=v2 --branch": "",
			};
			return { stdout: values[key] ?? "", stderr: "", code: 0 };
		},
	};
	const ctx = {
		cwd: workspace,
		hasUI: false,
		abort() {},
		isIdle() { return true; },
		ui: { notify() {}, setStatus() {}, theme: { fg(_color, text) { return text; } } },
		sessionManager: {
			getEntries() { return entries; },
			getSessionId() { return "revalidation-accounting"; },
			getSessionFile() { return join(agent, "session.jsonl"); },
		},
	};
	plannerOnly(pi);
	await handlers.get("session_start")({}, ctx);

	async function call(name, params, toolCallId = `${name}-${++sequence}`) {
		const gate = await handlers.get("tool_call")({ toolName: name, toolCallId, input: params }, ctx);
		assert.ok(!gate?.block, gate?.reason);
		return tools.get(name).execute(toolCallId, params, undefined, undefined, ctx);
	}
	const params = {
		role: "worker",
		objective: "Inspect fixture",
		scope: { allowedPaths: ["fixture.txt"] },
		constraints: [],
		acceptanceCriteria: ["report inspection"],
		validation: { required: false },
	};
	const first = await call("planner_delegate", params);
	const taskId = first.details.taskId;
	const ledgerPath = join(agent, "planner-only", "ledger", `${taskId}.json`);
	const task = () => JSON.parse(readFileSync(ledgerPath, "utf8")).task;

	// A real reviewer pass over a changed workspace grants the first retry.
	currentHead = "head-1";
	writeFileSync(join(workspace, "fixture.txt"), "external update 1\n");
	const review = await call("planner_redelegate", { ...params, taskId, role: "reviewer" });
	assert.equal(review.details.decision, "revalidate");
	const firstGrant = task().pendingRevalidationKey;
	assert.ok(firstGrant);

	// A rejected precheck leaves the grant and counter untouched.
	await assert.rejects(
		call("planner_redelegate", { ...params, taskId, envelope: { maxTokens: -1 } }, "rejected-revalidation"),
	);
	assert.equal(task().pendingRevalidationKey, firstGrant);
	assert.equal(task().recoveryAttempts, 0);
	const beforeFirstDispatch = launches;
	await call("planner_redelegate", { ...params, taskId }, "revalidation-1");
	assert.equal(launches, beforeFirstDispatch + 1);

	// Two more real Root verdict grants consume attempts two and three.
	for (let attempt = 2; attempt <= 3; attempt += 1) {
		currentHead = `head-${attempt}`;
		writeFileSync(join(workspace, "fixture.txt"), `external update ${attempt}\n`);
		const verdict = await call("planner_verdict", { taskId, verdict: "pass", summary: `inspect revision ${attempt}` });
		assert.equal(verdict.details.action, "revalidate");
		if (attempt === 2) {
			const pending = task().pendingRevalidationKey;
			const launchesBeforeReplay = launches;
			await assert.rejects(call("planner_redelegate", { ...params, taskId }, "revalidation-1"));
			assert.equal(launches, launchesBeforeReplay);
			assert.equal(task().recoveryAttempts, 1);
			assert.equal(task().pendingRevalidationKey, pending);
			// Replaying a completed Root tool ID now closes its Request. A real
			// next settled interactive input may resume, but Task-local dispatch
			// identity and charges must still reject the same old execution.
			await handlers.get("agent_settled")({}, ctx);
			await handlers.get("input")({ source: "interactive" }, ctx);
			await assert.rejects(call("planner_redelegate", { ...params, taskId }, "revalidation-1"), /already dispatched/);
			assert.equal(launches, launchesBeforeReplay);
			assert.equal(task().recoveryAttempts, 1);
			assert.equal(task().pendingRevalidationKey, pending);
		}
		await call("planner_redelegate", { ...params, taskId }, `revalidation-${attempt}`);
	}
	const charged = task();
	assert.equal(charged.recoveryAttempts, 3);
	assert.equal(charged.pendingRevalidationKey, undefined);
	assert.equal(charged.recoveryDispatches.length, 3);
	assert.deepEqual(charged.revalidationDispatches.map((item) => item.executionId), [
		"revalidation-1", "revalidation-2", "revalidation-3",
	]);
	assert.ok(charged.revalidationDispatches.every((item) => item.requestObservedAt), JSON.stringify(charged.revalidationDispatches));

	// Reload preserves the complete charge and identity history.
	const snapshots = new LedgerSnapshotStore(agent);
	const loaded = snapshots.read(taskId);
	assert.equal(loaded.status, "ok");
	const restoredStore = new TaskStore();
	restoredStore.restore(loaded.record);
	assert.equal(restoredStore.require(taskId).recoveryAttempts, 3);
	assert.equal(restoredStore.require(taskId).revalidationDispatches.length, 3);

	// A fourth changed evidence state is blocked at the existing cap; no REQUEST.
	currentHead = "head-4";
	writeFileSync(join(workspace, "fixture.txt"), "external update 4\n");
	const launchesAtCap = launches;
	const capped = await call("planner_verdict", { taskId, verdict: "pass", summary: "inspect revision 4" });
	assert.equal(capped.details.action, "blocked");
	assert.equal(capped.details.state, "blocked");
	assert.equal(task().pendingRevalidationKey, undefined);
	await assert.rejects(call("planner_redelegate", { ...params, taskId }, "revalidation-4"));
	assert.equal(launches, launchesAtCap);
	assert.equal(task().recoveryAttempts, 3);

	assert.equal(emitted.filter((item) => item.agent !== "reviewer").length, 4, "initial worker plus exactly three revalidations");

	// A send whose event fan-out throws after a listener may have started the
	// child remains charged and is not marked as a clean pre-dispatch refusal.
	currentHead = "unknown-send-base";
	const uncertainFirst = await call("planner_delegate", params);
	const uncertainTaskId = uncertainFirst.details.taskId;
	const uncertainLedgerPath = join(agent, "planner-only", "ledger", `${uncertainTaskId}.json`);
	const uncertainTask = () => JSON.parse(readFileSync(uncertainLedgerPath, "utf8")).task;
	currentHead = "unknown-send-drift";
	writeFileSync(join(workspace, "fixture.txt"), "unknown send drift\n");
	const uncertainGrant = await call("planner_verdict", {
		taskId: uncertainTaskId,
		verdict: "pass",
		summary: "grant before uncertain send",
	});
	assert.equal(uncertainGrant.details.action, "revalidate");
	throwAfterRequest = true;
	const uncertainOutcome = await call(
		"planner_redelegate",
		{ ...params, taskId: uncertainTaskId },
		"revalidation-unknown-send",
	);
	assert.ok(uncertainOutcome.details.termination);
	assert.equal(uncertainTask().recoveryAttempts, 1);
	assert.equal(uncertainTask().pendingRevalidationKey, undefined);
	assert.equal(uncertainTask().revalidationDispatches[0].executionId, "revalidation-unknown-send");
	assert.equal(uncertainTask().revalidationDispatches[0].requestObservedAt, undefined);
	console.log("revalidation-accounting: PASS");
} finally {
	childProcess.execFileSync = originalExecFileSync;
	syncBuiltinESMExports();
	rmSync(run, { recursive: true, force: true });
}
