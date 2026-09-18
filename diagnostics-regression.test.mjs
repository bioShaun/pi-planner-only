import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const agentDir = mkdtempSync(join(tmpdir(), "planner-only-diagnostics-regression-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_PLANNER_ONLY_SEED_PRICING = "0";
delete process.env.PI_SUBAGENT_CHILD;

const [{ LedgerSnapshotStore }, { PlannerOrchestrator }, { TaskStore, createTaskSpec }, { default: plannerOnly }] = await Promise.all([
	import("./ledger-store.ts"),
	import("./orchestrate.ts"),
	import("./task.ts"),
	import("./index.ts"),
]);

const gitRunner = async () => ({ code: 0, stdout: "", stderr: "" });

function record(taskId, extra = {}) {
	return {
		taskId,
		cwd: "/fixture/diagnostics",
		state: "blocked",
		role: "worker",
		executions: [],
		reports: [],
		reviews: [],
		updatedAt: "2026-09-18T00:00:00.000Z",
		...extra,
	};
}

try {
	const ledger = new LedgerSnapshotStore(agentDir);

	// Persisted history may omit probeFailures, but every present failure needs
	// the three identity fields consumed by diagnostics. Check each sample path.
	const optional = record("T-20260918-probe-optional", {
		executions: [{ executionId: "call-optional", aRun: {}, cReport: {}, stopSamples: [{}] }],
	});
	delete optional.state;
	ledger.write(optional);
	assert.equal(ledger.read(optional.taskId).status, "ok", "historical samples may omit probeFailures");
	const historicalOrchestrator = new PlannerOrchestrator({ gitRunner, ledgerDir: agentDir });
	const historical = historicalOrchestrator.describeTaskDiagnostics("/fixture/diagnostics", optional.taskId).diagnostics;
	assert.equal(historical.state, "unknown", "historical missing state renders safely");
	assert.equal(historical.executions[0].kind, "unknown", "historical missing execution kind renders safely");

	for (const [sampleName, install] of [
		["aRun", (execution, failures) => { execution.aRun.probeFailures = failures; }],
		["cReport", (execution, failures) => { execution.cReport = { probeFailures: failures }; }],
		["stopSamples[0]", (execution, failures) => { execution.stopSamples = [{ probeFailures: failures }]; }],
	]) {
		for (const field of ["operation", "kind", "cwd"]) {
			const suffix = `${sampleName.replace(/[^A-Za-z0-9]/g, "-")}-${field}`;
			const task = record(`T-20260918-probe-${suffix}`);
			const failure = { operation: "diff HEAD --stat", kind: "probe-error", cwd: "/fixture/diagnostics" };
			delete failure[field];
			const execution = { executionId: "call-probe", kind: "worker", aRun: {} };
			install(execution, [failure]);
			task.executions = [execution];
			ledger.write(task);
			const read = ledger.read(task.taskId);
			assert.equal(read.status, "corrupt", `${sampleName}.${field} is required`);
			assert.equal(read.reason, `task.executions[0].${sampleName}.probeFailures[0].${field} must be a string`);
		}
	}

	// Constructor-level bounds cover persisted identity/time/enum-like strings
	// and every guidance interpolation, including an invalid execution query.
	const huge = "x".repeat(20_000);
	const taskId = `T-${huge}`;
	const store = new TaskStore({ now: () => new Date("2026-09-18T00:00:00.000Z") });
	const task = store.create(createTaskSpec({ objective: "bounded identities", cwd: "/fixture/diagnostics" }, taskId));
	task.state = huge;
	task.writerHold = { executionId: huge, reason: huge, since: huge };
	task.recovery = { required: true, reason: huge, executionId: huge };
	task.executions.push({
		executionId: huge,
		kind: huge,
		status: huge,
		capability: huge,
		cwd: "/fixture/diagnostics",
		endedAt: huge,
		aRun: { probeFailures: [{ operation: "probe", kind: huge, cwd: "/fixture/diagnostics" }] },
	});
	const orchestrator = new PlannerOrchestrator({ gitRunner, store });
	const constructed = orchestrator.describeTaskDiagnostics("/fixture/diagnostics", taskId).diagnostics;
	assert.equal(constructed.truncated, true, "constructor truncation is disclosed");
	assert.ok(constructed.taskId.length <= 200, "top-level taskId is capped");
	assert.ok(constructed.state.length <= 100, "top-level state is capped");
	assert.ok(constructed.writerHold.executionId.length <= 200, "writer hold identity is capped");
	assert.ok(constructed.writerHold.since.length <= 100, "writer hold timestamp is capped");
	assert.ok(constructed.recovery.executionId.length <= 200, "recovery identity is capped");
	assert.ok(constructed.executions[0].kind.length <= 100, "execution kind is capped");
	assert.ok(constructed.executions[0].status.length <= 100, "execution status is capped");
	assert.ok(constructed.executions[0].capability.length <= 100, "execution capability is capped");
	assert.ok(constructed.executions[0].endedAt.length <= 100, "execution end timestamp is capped");
	assert.ok(constructed.executions[0].probeFailures[0].kind.length <= 100, "probe kind is capped");
	assert.ok(constructed.guidance.every((line) => line.length < 1_000), "guidance interpolations are capped");
	assert.ok(JSON.stringify(constructed).length < 10_000, "constructor output remains bounded");
	const unmatched = orchestrator.describeTaskDiagnostics("/fixture/diagnostics", taskId, `missing-${huge}`).diagnostics;
	assert.ok(unmatched.guidance.some((line) => line.startsWith("no execution ") && line.length < 300), "an unmatched execution query is capped in guidance");
	const invalidTask = historicalOrchestrator.describeTaskDiagnostics("/fixture/diagnostics", `../${huge}`);
	assert.equal(invalidTask.error, "TASK_ID_INVALID");
	assert.ok(invalidTask.reason.length < 500, "an invalid task query is capped in its diagnostic reason");

	// Exercise the actual registered return boundary. The constructor first
	// keeps the latest 20; a tighter UTF-8 budget must continue dropping oldest.
	const tools = new Map();
	const pi = {
		on() {},
		registerCommand() {},
		registerTool(definition) { tools.set(definition.name, definition); },
		getActiveTools() { return []; },
		getAllTools() { return []; },
		setActiveTools() {},
		appendEntry() {},
		events: { on() { return () => {}; }, emit() {} },
		exec: gitRunner,
	};
	plannerOnly(pi);
	const budgetTask = record("T-20260918-budget-tail");
	budgetTask.executions = Array.from({ length: 25 }, (_, index) => ({
		executionId: `call-byte-${index}`,
		kind: "worker",
		status: "stop_unconfirmed",
		capability: "writer",
		cwd: "/fixture/diagnostics",
		worktreeRoots: Array.from({ length: 50 }, () => `/${"界".repeat(500)}`),
		aRun: {
			probeFailures: Array.from({ length: 10 }, (_, failureIndex) => ({
				operation: `probe-${failureIndex}`,
				kind: "probe-error",
				cwd: "/fixture/diagnostics",
				error: "界".repeat(4_000),
			})),
		},
	}));
	ledger.write(budgetTask);
	const before = ledger.read(budgetTask.taskId);
	const output = await tools.get("planner_tasks").execute(
		"call-budget",
		{ taskId: budgetTask.taskId },
		undefined,
		() => {},
		{ cwd: "/fixture/diagnostics", sessionManager: { getSessionFile() { return undefined; } } },
	);
	const diagnostics = output.details.diagnostics;
	const ids = diagnostics.executions.map((execution) => execution.executionId);
	assert.ok(ids.length > 0 && ids.length < 20, "fixture forces a second-stage execution cap");
	assert.deepEqual(ids, Array.from({ length: ids.length }, (_, index) => `call-byte-${25 - ids.length + index}`), "budget cap preserves the chronological tail");
	assert.equal(diagnostics.totalExecutions, 25, "the original total survives every cap");
	const labels = [...diagnostics.guidance, output.content[0].text]
		.flatMap((text) => [...text.matchAll(/latest (\d+) of 25/g)].map((match) => Number(match[1])));
	assert.ok(labels.length >= 2, "structured and rendered truncation labels are present");
	assert.ok(labels.every((count) => count === ids.length), "every latest-N label matches the returned tail");
	assert.equal(diagnostics.truncated, true, "structured truncation is disclosed");
	assert.match(output.content[0].text, /diagnostics truncated/, "rendered truncation is disclosed");
	assert.ok(Buffer.byteLength(JSON.stringify(output.details), "utf8") < 64 * 1024, "UTF-8 details stay below 64 KiB");
	assert.deepEqual(ledger.read(budgetTask.taskId), before, "budgeting leaves the ledger source unchanged");

	console.log("diagnostics regression tests passed");
} finally {
	rmSync(agentDir, { recursive: true, force: true });
}
