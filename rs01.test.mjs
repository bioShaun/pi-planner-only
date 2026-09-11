import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

import {
	computeLoadedFingerprint,
	getLoadedPluginFingerprint,
	reloadLoadedFingerprint,
	getDiskHead,
	createLoadedPluginFingerprint,
} from "./index.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { TaskStore, TaskIdAllocator, createTaskSpec } from "./task.ts";
import { UsageLedger } from "./usage.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { RunRecordStore } from "./completion.ts";
import {
	EVENT_FIXTURES,
	E01_FIXTURE,
	E02_FIXTURE,
	E03_FIXTURE,
	E04_FIXTURE,
	E05_FIXTURE,
} from "./test-fixtures.ts";

const dummyGitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

test("A01: Loaded plugin fingerprint is recorded from loaded build, distinct from disk HEAD", async () => {
	const initialFingerprint = getLoadedPluginFingerprint();
	assert.match(initialFingerprint, /^[0-9a-f]{64}$/, "fingerprint is a valid sha256 hex string");

	const diskHead = getDiskHead();
	assert.ok(typeof diskHead === "string" && diskHead.length > 0, "disk HEAD is queryable");

	// Loaded fingerprint is distinct from Git disk HEAD
	assert.notEqual(initialFingerprint, diskHead, "loaded fingerprint is distinct from disk HEAD");

	// Create fingerprint info object
	const fpInfo = createLoadedPluginFingerprint(undefined, { diskHead });
	assert.equal(fpInfo.loadedFingerprint, initialFingerprint);
	assert.equal(fpInfo.diskHead, diskHead);
	assert.ok(fpInfo.capabilities.includes("planner-only"));
	assert.ok(fpInfo.capabilities.includes("concurrency"));

	// Modifying disk files in a separate directory should produce a different fingerprint on reload
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-a01-"));
	try {
		writeFileSync(join(tempDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "0.4.1" }));
		writeFileSync(join(tempDir, "index.ts"), "export const dummy = 1;");
		const customFingerprint = computeLoadedFingerprint(tempDir);
		assert.match(customFingerprint, /^[0-9a-f]{64}$/);
		assert.notEqual(customFingerprint, initialFingerprint);

		// The memory loaded fingerprint has not changed
		assert.equal(getLoadedPluginFingerprint(), initialFingerprint);

		// But if reloadLoadedFingerprint is called for that directory, it changes
		const reloaded = reloadLoadedFingerprint(tempDir);
		assert.equal(reloaded, customFingerprint);

		// Reloading original directory restores it
		reloadLoadedFingerprint();
		assert.equal(getLoadedPluginFingerprint(), initialFingerprint);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}

	// Orchestrator stores and exposes loaded fingerprint
	const orch = new PlannerOrchestrator({ gitRunner: dummyGitRunner });
	orch.setLoadedFingerprint(fpInfo);
	const retrieved = orch.getLoadedFingerprint();
	assert.equal(retrieved?.loadedFingerprint, initialFingerprint);
	assert.equal(retrieved?.diskHead, diskHead);
});

test("A02: Replaying E04 launch receipt -> final report does not produce REPORT_SCHEMA_INVALID at launch time and maintains single report", async () => {
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-a02-"));
	const orch = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		ledgerDir: tempDir,
	});
	const store = orch.store;

	const taskId = "T-20260911-008";
	const toolCallId = "call_176444";
	const runId = "9bef983d-31bb-40c4-8b57-3fffa096c667";

	// 1. Begin delegation with embedded TaskSpec
	await orch.beginDelegation({
		toolCallId,
		input: {
			task: JSON.stringify(createTaskSpec({
				objective: "Implement runtime channel",
				cwd: tempDir,
			}, taskId)),
		},
	}, tempDir);

	// 2. Receive async launch receipt (from E04 fixture)
	const launchEvent = E04_FIXTURE.prematureLaunchReceipts[0];
	const launchResult = await orch.handleSubagentResult({
		toolCallId,
		toolName: "subagent",
		content: [{ type: "text", text: launchEvent.launchReceiptText }],
		details: launchEvent.launchDetails,
	});

	// At launch time: must confirm async delegation started, NOT REPORT_SCHEMA_INVALID
	assert.ok(launchResult?.content[0]?.text.includes("has started"), "launch receipt confirms started");
	assert.ok(!launchResult?.content[0]?.text.includes("REPORT_SCHEMA_INVALID"), "no REPORT_SCHEMA_INVALID at launch");

	const taskAfterLaunch = store.get(taskId);
	assert.ok(taskAfterLaunch, "task exists");
	assert.equal(taskAfterLaunch.reportCorrections, 0, "no corrections consumed at launch time");
	assert.equal(taskAfterLaunch.reports.length, 0, "no premature reports recorded");

	// Check persisted run record: executionState is running, ingestionState is waiting (NOT report-invalid)
	const runRecordStore = new RunRecordStore(join(tempDir, "planner-only", "run-state"));
	const records = runRecordStore.load();
	const launchRunRecord = records.find((r) => r.executionId === toolCallId);
	assert.ok(launchRunRecord, "run record exists");
	assert.equal(launchRunRecord.executionState, "running");
	assert.equal(launchRunRecord.ingestionState, "waiting");
	assert.equal(launchRunRecord.lastError, undefined, "no error logged at launch time");

	// 3. Child completes and sends final report via subagent-notify
	const validReport = {
		version: 1,
		taskId,
		status: "completed",
		summary: "Finished batch B runtime implementation",
		changedFiles: ["orchestrate.ts", "roles.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0 }],
		evidence: { taskId, workerRunId: toolCallId },
		risks: [],
		unresolved: [],
	};

	const notifyContent = `Background task completed: **worker**\n\n${JSON.stringify(validReport)}\n\nChild runs: ${runId}`;
	const notifyOutcome = await orch.handleAsyncNotify(notifyContent);
	assert.ok(notifyOutcome, "notify outcome returned");

	const taskAfterComplete = store.get(taskId);
	assert.ok(taskAfterComplete);
	assert.equal(taskAfterComplete.reports.length, 1, "exactly one report is recorded");
	assert.equal(taskAfterComplete.reportCorrections, 0, "corrections counter remains 0");

	const recordsAfterComplete = runRecordStore.load();
	const completeRunRecord = recordsAfterComplete.find((r) => r.executionId === toolCallId);
	assert.equal(completeRunRecord?.executionState, "terminal");
	assert.equal(completeRunRecord?.ingestionState, "recorded");

	// 4. Replaying completion notice or receipt maintains single report
	await orch.handleAsyncNotify(notifyContent);
	const taskAfterReplay = store.get(taskId);
	assert.equal(taskAfterReplay?.reports.length, 1, "replaying notify maintains single report");

	rmSync(tempDir, { recursive: true, force: true });
});

test("A03: 403 errors release run slot once, record terminal state without fake completion or unprompted model switch", async () => {
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-a03-"));
	const concurrency = new ConcurrencyController({ savedLimit: 3 });
	const orch = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		concurrency,
		ledgerDir: tempDir,
		artifactDirs: () => [join(tempDir, "artifacts")],
	});
	const store = orch.store;

	const artifactsDir = join(tempDir, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });

	const taskId = "T-20260911-003";
	const toolCallId = "call_403";
	const runId = E03_FIXTURE.runs[0].hostRunId;

	// 1. Begin delegation -> slot is reserved
	await orch.beginDelegation({
		toolCallId,
		input: {
			task: JSON.stringify(createTaskSpec({ objective: "test 403 handling", cwd: tempDir }, taskId)),
		},
	}, tempDir);

	// Deliver launch receipt to establish runId and advance to running
	await orch.handleSubagentResult({
		toolCallId,
		toolName: "subagent",
		details: { asyncId: runId, runId },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	});

	assert.equal(concurrency.status().occupied, 1, "execution slot is occupied");

	// Write 403 child meta file into artifacts dir
	writeFileSync(join(artifactsDir, `${runId}_worker_meta.json`), JSON.stringify({
		runId,
		agent: "worker",
		exitCode: 1,
		stopReason: "error",
		error: "403 permission_error: five-hour usage limit",
	}));

	// 2. Reconcile terminal run with 403 error
	const result = await orch.reconcilePendingDelegations(taskId);
	assert.equal(result, 1, "delegation was reconciled");

	// Verify slot is released
	assert.equal(concurrency.status().occupied, 0, "concurrency slot was released");
	assert.equal(orch.pendingDelegationCount(), 0, "provider 403 does not leave a delegation available for model switching");
	assert.equal(store.get(taskId)?.executions.length, 1, "provider 403 does not start a replacement execution");

	// Verify task is failed, NOT completed (no fake completion)
	const task = store.get(taskId);
	assert.ok(task);
	assert.equal(task.state, "failed", "task transitioned to failed, never completed");
	assert.ok(task.stateReason?.includes("403") || task.stateReason?.includes("rate limit") || task.stateReason?.includes("usage limit"));
	assert.equal(task.reports.length, 0, "no fake report was generated");

	// Verify RunRecord terminal state
	const runRecordStore = new RunRecordStore(join(tempDir, "planner-only", "run-state"));
	const records = runRecordStore.load();
	const record = records.find((r) => r.executionId === toolCallId);
	assert.ok(record);
	assert.equal(record.executionState, "terminal");
	assert.equal(record.ingestionState, "unavailable");
	assert.equal(record.lastError?.code, "PROVIDER_403_RATE_LIMIT");
	assert.equal(record.terminalErrorClass, "provider-error");
	assert.equal(record.nextAction, "do-not-retry-provider");
	assert.equal(record.slotReleased, true);
	assert.equal(record.terminalSource, "host-meta");

	assert.equal(E03_FIXTURE.runs.map((run) => run.turns).join(","), "11,55", "A03 covers both the 11-turn and 55-turn provider runs");
	assert.equal(record?.reportRevision, undefined, "provider 403 does not synthesize a completed report");
	assert.equal(record?.outputRef, undefined, "provider 403 does not claim synthetic output");

	// Calling reconcile again is idempotent: slot is not re-released, state unchanged
	const secondReconcile = await orch.reconcilePendingDelegations(taskId);
	assert.equal(secondReconcile, 0);
	assert.equal(concurrency.status().occupied, 0);

	// E03's second observed 403 run has the same provider shape and must take
	// the same terminal taxonomy path, without synthetic output or model swap.
	const secondRun = E03_FIXTURE.runs[1];
	const secondTaskId = "T-20260911-013";
	const secondToolCallId = "call_403_second";
	await orch.beginDelegation({
		toolCallId: secondToolCallId,
		input: { task: JSON.stringify(createTaskSpec({ objective: "test second 403 shape", cwd: tempDir }, secondTaskId)) },
	}, tempDir);
	await orch.handleSubagentResult({
		toolCallId: secondToolCallId,
		toolName: "subagent",
		details: { asyncId: secondRun.hostRunId, runId: secondRun.hostRunId },
		content: [{ type: "text", text: `Async: worker [${secondRun.hostRunId}]\nThe async run is detached and running in the background.` }],
	});
	writeFileSync(join(artifactsDir, `${secondRun.hostRunId}_worker_meta.json`), JSON.stringify({
		runId: secondRun.hostRunId,
		agent: "worker",
		exitCode: secondRun.exitCode,
		stopReason: secondRun.stopReason,
		error: secondRun.error,
	}));
	assert.equal(await orch.reconcilePendingDelegations(secondTaskId), 1);
	const secondTask = store.get(secondTaskId);
	assert.equal(secondTask?.reports.length, 0);
	const secondRecord = new RunRecordStore(join(tempDir, "planner-only", "run-state"))
		.load().find((item) => item.executionId === secondToolCallId);
	assert.equal(secondRecord?.terminalErrorClass, "provider-error");
	assert.equal(secondRecord?.nextAction, "do-not-retry-provider");
	assert.equal(secondRecord?.slotReleased, true);
	assert.equal(concurrency.status().occupied, 0);

	rmSync(tempDir, { recursive: true, force: true });
});

test("A04: notify/wait/recover idempotency: deduplicate receipts, ensure report and usage are counted once", async () => {
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-a04-"));
	const concurrency = new ConcurrencyController({ savedLimit: 3 });
	const pricing = { version: 1, currency: "USD", rates: { "test/model": { inputRate: 1, outputRate: 2 } } };
	let store;
	const ledger = new UsageLedger({ pricing, resolveTaskId: (id) => store?.get(id)?.taskId ?? id });
	const orch = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		concurrency,
		ledgerDir: tempDir,
		artifactDirs: () => [join(tempDir, "artifacts")],
		recordCompletionUsage: (taskId, receipt, receiptToolCallId) => {
			if (!receipt.usage || typeof receipt.usage !== "object") return;
			const usage = receipt.usage;
			ledger.recordChild(taskId, {
				kind: "worker",
				runId: receipt.runId,
				toolCallId: receiptToolCallId,
				agent: "worker",
				model: "test/model",
				input: usage.input,
				output: usage.output,
				pending: false,
				turns: 1,
			});
		},
	});
	store = orch.store;

	const artifactsDir = join(tempDir, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });

	const taskId = "T-20260911-004";
	const toolCallId = "call_idem";
	const runId = "run_idem_123";

	await orch.beginDelegation({
		toolCallId,
		input: {
			task: JSON.stringify(createTaskSpec({ objective: "test idempotency", cwd: tempDir }, taskId)),
		},
	}, tempDir);

	// Deliver launch receipt to establish runId and advance to running
	await orch.handleSubagentResult({
		toolCallId,
		toolName: "subagent",
		details: { asyncId: runId, runId },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	});

	assert.equal(concurrency.status().occupied, 1);

	// Output file on disk
	const validReport = {
		version: 1,
		taskId,
		status: "completed",
		summary: "Completed once",
		changedFiles: ["index.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0 }],
		evidence: { taskId, workerRunId: toolCallId },
		risks: [],
		unresolved: [],
	};
	const outputPath = join(artifactsDir, `${runId}_worker_output.json`);
	writeFileSync(outputPath, JSON.stringify(validReport));
	writeFileSync(join(artifactsDir, `${runId}_worker_meta.json`), JSON.stringify({
		runId,
		agent: "worker",
		exitCode: 0,
		model: "test/model",
		usage: { input: 100, output: 50 },
	}));

	// 1. First arrival via registerCompletionReceipt (bg_wait)
	orch.registerCompletionReceipt({
		runId,
		agent: "worker",
		terminal: { state: "completed", exitCode: 0 },
		outputState: "present",
		outputRef: { outputPath },
		usage: { input: 100, output: 50 },
	});

	// The terminal receipt can arrive before its output file. Recovery must
	// leave the slot released, then ingest the late file through the same path.
	unlinkSync(outputPath);
	await orch.reconcilePendingDelegations(taskId);
	assert.equal(store.get(taskId)?.reports.length, 0, "terminal without output remains pending");
	writeFileSync(outputPath, JSON.stringify(validReport));
	const lateRecovery = await orch.reingestOriginalReport(runId, tempDir, taskId);
	assert.equal(lateRecovery.status, "recorded", "late output is ingested after terminal receipt");
	assert.equal(lateRecovery.nextAction, undefined);
	assert.equal(concurrency.status().occupied, 0, "late output does not reacquire the released slot");

	// 1b. Reload/retry sees the durable record and remains idempotent.
	const reloaded = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		ledgerDir: tempDir,
		artifactDirs: () => [join(tempDir, "artifacts")],
	});
	reloaded.restoreFromLedger();
	const reloadRecovery = await reloaded.reingestOriginalReport(runId, tempDir, taskId);
	assert.equal(reloadRecovery.status, "duplicate", "reload does not ingest the report twice");

	const reloadRunRecordStore = new RunRecordStore(join(tempDir, "planner-only", "run-state"));
	const reloadRecord = reloadRunRecordStore.load().find((item) => item.executionId === toolCallId);
	assert.equal(reloadRecord?.slotReleased, true, "reload sees the durable release marker");
	reloaded.registerCompletionReceipt({
		runId,
		agent: "worker",
		terminal: { state: "completed", exitCode: 0 },
		outputState: "present",
		outputRef: { outputPath },
	});
	assert.equal(reloaded.getConcurrencyStatus().occupied, 0, "reloaded duplicate receipt does not reacquire or release a second slot");
	assert.equal(new RunRecordStore(join(tempDir, "planner-only", "run-state")).load().find((item) => item.executionId === toolCallId)?.slotReleased, true);

	assert.equal(concurrency.status().occupied, 0, "slot released after first reconcile");
	assert.equal(store.get(taskId)?.reports.length, 1, "first receipt records report");

	assert.equal(ledger.taskUsage(taskId)?.children.length, 1);

	// 2. Second arrival via handleAsyncNotify
	const notifyContent = `Background task completed: **worker**\n\n${JSON.stringify(validReport)}\n\nChild runs: ${runId}`;
	await orch.handleAsyncNotify(notifyContent);

	assert.equal(store.get(taskId)?.reports.length, 1, "report still exactly 1 after duplicate notify");
	assert.equal(concurrency.status().occupied, 0, "slot occupancy stays 0");

	assert.equal(ledger.taskUsage(taskId)?.children.length, 1, "usage children count remains 1 after notify");

	// 3. Third arrival via reingestOriginalReport (recover)
	const recovery = await orch.reingestOriginalReport(runId, tempDir, taskId);
	assert.equal(recovery.status, "duplicate", "recovery recognises already recorded report");
	assert.equal(recovery.code, "RUN_ALREADY_RECORDED");
	assert.equal(store.get(taskId)?.reports.length, 1, "report still exactly 1 after recovery");

	rmSync(tempDir, { recursive: true, force: true });
});

test("A04 permutations: notify/wait/recover arrivals converge once across reload and late output", async () => {
	const orders = [
		["notify", "wait", "recover"],
		["recover", "wait", "notify"],
		["wait", "recover", "notify"],
	];
	for (const [index, order] of orders.entries()) {
		const tempDir = mkdtempSync(join(process.cwd(), `.planner-only-test-a04-order-${index}-`));
		const artifactsDir = join(tempDir, "artifacts");
		mkdirSync(artifactsDir, { recursive: true });
		const concurrency = new ConcurrencyController({ savedLimit: 1 });
		const pricing = { version: 1, currency: "USD", rates: { "test/model": { inputRate: 1, outputRate: 2 } } };
		let active;
		const ledger = new UsageLedger({ pricing, resolveTaskId: (id) => active?.store.get(id)?.taskId ?? id });
		const taskId = `T-20260911-10${index + 1}`;
		const toolCallId = `call_a04_${index}`;
		const runId = `run_a04_${index}`;
		const outputPath = join(artifactsDir, `${runId}_worker_output.json`);
		const validReport = {
			version: 1,
			taskId,
			status: "completed",
			summary: "permuted completion",
			changedFiles: [],
			validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0 }],
			evidence: { taskId, workerRunId: toolCallId },
			risks: [],
			unresolved: [],
		};
		const recordUsage = (id, receipt, receiptToolCallId) => {
			if (!receipt.usage || typeof receipt.usage !== "object") return;
			ledger.recordChild(id, {
				kind: "worker", runId: receipt.runId, toolCallId: receiptToolCallId, agent: "worker",
				model: "test/model", input: receipt.usage.input, output: receipt.usage.output,
				pending: false, turns: 1,
			});
		};
		active = new PlannerOrchestrator({
			gitRunner: dummyGitRunner,
			concurrency,
			ledgerDir: tempDir,
			artifactDirs: () => [artifactsDir],
			recordCompletionUsage: recordUsage,
		});
		await active.beginDelegation({
			toolCallId,
			input: { task: JSON.stringify(createTaskSpec({ objective: "permuted idempotency", cwd: tempDir }, taskId)) },
		}, tempDir);
		await active.handleSubagentResult({
			toolCallId,
			toolName: "subagent",
			details: { asyncId: runId, runId, outputRef: { outputPath } },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
		});
		writeFileSync(join(artifactsDir, `${runId}_worker_meta.json`), JSON.stringify({
			runId, agent: "worker", exitCode: 0, model: "test/model", usage: { input: 100, output: 50 },
		}));
		// Terminal metadata exists first; output is deliberately late.
		const receipt = {
			runId, agent: "worker", terminal: { state: "completed", exitCode: 0 },
			outputState: "present", outputRef: { outputPath }, usage: { input: 100, output: 50 },
		};
		for (const [arrivalIndex, arrival] of order.entries()) {
			if (arrival === "notify") {
				const reportText = `Background task completed: **worker**\n\n${JSON.stringify(validReport)}\n\nChild runs: ${runId}`;
				await active.handleAsyncNotify(reportText);
			} else if (arrival === "wait") {
				active.registerCompletionReceipt(receipt);
			} else {
				const recovered = await active.recoverPendingRun({ id: runId }, tempDir);
				if (!recovered) await active.reingestOriginalReport(runId, tempDir, taskId);
			}
			if (arrivalIndex === 0) {
				writeFileSync(outputPath, JSON.stringify(validReport));
				active = new PlannerOrchestrator({
					gitRunner: dummyGitRunner,
					concurrency,
					ledgerDir: tempDir,
					artifactDirs: () => [artifactsDir],
					recordCompletionUsage: recordUsage,
				});
				active.restoreFromLedger();
			}
		}
		const task = active.store.get(taskId);
		assert.equal(task?.reports.length, 1, `${order.join("->")} records one report`);
		assert.equal(ledger.taskUsage(taskId)?.children.length, 1, `${order.join("->")} counts usage once`);
		const run = new RunRecordStore(join(tempDir, "planner-only", "run-state"))
			.load().find((item) => item.executionId === toolCallId);
		assert.equal(run?.slotReleased, true, `${order.join("->")} releases slot durably once`);
		assert.equal(active.getConcurrencyStatus().occupied, 0, `${order.join("->")} has no occupied slot after reload`);
		rmSync(tempDir, { recursive: true, force: true });
	}
});


test("A04 crash point: loaded receipt state retries through a fresh orchestrator once", async () => {
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-test-a04-crash-"));
	const artifactsDir = join(tempDir, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });
	const taskId = "T-20260911-007";
	const toolCallId = "call_a04_crash";
	const runId = "run_a04_crash";
	const outputPath = join(artifactsDir, `${runId}_worker_output.json`);
	const report = {
		version: 1, taskId, status: "completed", summary: "crash-point report", changedFiles: [],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0 }],
		evidence: { taskId, workerRunId: toolCallId }, risks: [], unresolved: [],
	};
	const fault = (point) => { if (point === "before-report") throw new Error(point); };
	const crashing = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		ledgerDir: tempDir,
		artifactDirs: () => [artifactsDir],
		runRecordFault: fault,
	});
	await crashing.beginDelegation({
		toolCallId,
		input: { task: JSON.stringify(createTaskSpec({ objective: "crash point", cwd: tempDir }, taskId)) },
	}, tempDir);
	await crashing.handleSubagentResult({
		toolCallId,
		toolName: "subagent",
		details: { asyncId: runId, runId },
		content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
	});
	writeFileSync(outputPath, JSON.stringify(report));
	await assert.rejects(
		() => crashing.handleAsyncNotify(`Background task completed: **worker**\n\n${JSON.stringify(report)}\n\nChild runs: ${runId}`),
		/before-report/,
	);
	const pending = new RunRecordStore(join(tempDir, "planner-only", "run-state")).load()
		.find((item) => item.executionId === toolCallId);
	assert.equal(pending?.ingestionState, "loaded", "crash leaves durable loaded state before report commit");

	const reloaded = new PlannerOrchestrator({
		gitRunner: dummyGitRunner,
		ledgerDir: tempDir,
		artifactDirs: () => [artifactsDir],
	});
	reloaded.restoreFromLedger();
	await reloaded.handleAsyncNotify(`Background task completed: **worker**\n\n${JSON.stringify(report)}\n\nChild runs: ${runId}`);
	assert.equal(reloaded.store.get(taskId)?.reports.length, 1);
	const final = new RunRecordStore(join(tempDir, "planner-only", "run-state")).load()
		.find((item) => item.executionId === toolCallId);
	assert.equal(final?.ingestionState, "recorded");
	rmSync(tempDir, { recursive: true, force: true });
});
test("A05: Multi-process shared ledger allocation, quarantine, and cross-workspace checks pass", async () => {
	const root = mkdtempSync(join(process.cwd(), ".planner-only-test-a05-"));
	const now = () => new Date("2026-09-11T12:00:00.000Z");

	try {
		// 1. Allocator in process A allocates T-20260911-001
		const allocA = new TaskIdAllocator(root, { now });
		const id1 = allocA.allocate();
		assert.equal(id1, "T-20260911-001");

		// 2. Fresh allocator in process B sees T-20260911-001 is claimed and allocates T-20260911-002
		const allocB = new TaskIdAllocator(root, { now });
		const id2 = allocB.allocate();
		assert.equal(id2, "T-20260911-002");

		// 3. Quarantined / unparseable ledger file occupies ID and is not reused
		mkdirSync(join(root, "planner-only", "ledger"), { recursive: true });
		writeFileSync(
			join(root, "planner-only", "ledger", "T-20260911-003.json"),
			"corrupt unparseable json content",
		);

		const id3 = allocB.allocate();
		assert.equal(id3, "T-20260911-004", "allocator skipped corrupt 003 file and allocated 004");

		// Explicit reuse of occupied ID throws conflict
		assert.throws(
			() => allocB.reserve("T-20260911-003"),
			(err) => err?.code === "TASK_ID_CONFLICT",
			"explicit reserve throws TASK_ID_CONFLICT",
		);

		// 4. Cross-workspace continuation is refused
		const store = new TaskStore();
		const spec1 = createTaskSpec({ objective: "workspace 1 task", cwd: "/workspace/one" }, "T-20260911-001");
		store.create(spec1);

		assert.throws(
			() => store.continueTask("T-20260911-001", "/workspace/two"),
			(err) => err?.code === "TASK_WORKSPACE_MISMATCH",
			"continuing across different workspace throws TASK_WORKSPACE_MISMATCH",
		);

		// Same workspace succeeds
		const continued = store.continueTask("T-20260911-001", "/workspace/one");
		assert.equal(continued.taskId, "T-20260911-001");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("A19 minimal fixtures: frozen minimal fixture for E01-E05 events", () => {
	// E01 checks: 4 new findings + 1 historical echo
	const e01Counts = EVENT_FIXTURES.countE01Findings();
	assert.equal(e01Counts.newFindings, 4, "E01 has exactly 4 new findings");
	assert.equal(e01Counts.historicalFindings, 1, "E01 has exactly 1 historical echo");
	assert.equal(e01Counts.total, 5);

	// Check that historical finding is tagged correctly
	assert.equal(E01_FIXTURE.historicalFindings[0].historical, true);
	assert.equal(E01_FIXTURE.historicalFindings[0].taskId, "T-20260911-001");

	// E02 checks: 12 runs, 36 interceptions
	const e02Counts = EVENT_FIXTURES.countE02Interceptions();
	assert.equal(e02Counts.runs, 12, "E02 has exactly 12 runs");
	assert.equal(e02Counts.totalInterceptions, 36, "E02 has exactly 36 interceptions");

	// E03 checks: 2 403 limit runs
	const e03Counts = EVENT_FIXTURES.countE03Errors();
	assert.equal(e03Counts.runs, 2, "E03 has exactly 2 runs");
	assert.equal(e03Counts.total403, 2, "E03 has exactly 2 403 limit errors");
	for (const run of E03_FIXTURE.runs) {
		assert.equal(run.exitCode, 1);
		assert.ok(run.error.includes("403"));
	}

	// E04 checks: 6 premature launch receipts
	const e04Count = EVENT_FIXTURES.countE04PrematureReceipts();
	assert.equal(e04Count, 6, "E04 has exactly 6 premature launch receipts");
	assert.equal(E04_FIXTURE.crossWorkspace.foreignWorkspace, "/public/scripts/tc-probe-design-v2");

	// E05 checks: model override chain
	assert.equal(E05_FIXTURE.hostDefault, "gemini-3.8-flash-high");
	assert.equal(E05_FIXTURE.hostWorkerOverride, "tcuni-luna/gpt-5.6-luna");
});
