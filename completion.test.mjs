import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { createTaskSpec } from "./task.ts";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	ARCHIVE_UNSUPPORTED,
	OUTPUT_AMBIGUOUS,
	OUTPUT_NOT_READABLE,
	MAX_OUTPUT_RETRIES,
	OUTPUT_PENDING,
	OUTPUT_TOO_LARGE,
	OutputResolver,
	RunRecordStore,
	makeRunRecord,
	normalizeCompletionReceipt,
} from "./completion.ts";

const root = mkdtempSync(join(process.cwd(), ".planner-only-completion-"));
try {
	const resolver = new OutputResolver({ trustedRoots: [root], maxOutputBytes: 64 });
	const reportOnly = normalizeCompletionReceipt({ runId: "run-report", status: "completed", output: '{"status":"completed"}' }, "notify");
	assert.equal(reportOnly?.terminal, undefined, "a report-shaped payload is not terminal provenance");
	const explicitReportOnly = normalizeCompletionReceipt({ runId: "run-report-explicit", terminal: { state: "completed" }, terminalSource: "report-only" }, "sync");
	assert.equal(explicitReportOnly?.terminalSource, "report-only", "untrusted report-only provenance survives normalization");
	const hostTerminal = normalizeCompletionReceipt({ runId: "run-host", terminal: { state: "completed", exitCode: 0 } }, "bg-wait");
	assert.equal(hostTerminal?.terminalSource, "host-meta", "host terminal envelope carries trusted provenance");

	// C01: explicit outputPath is authoritative even when the old run directory
	// is absent, and its complete body is loaded once.
	{
		const outputPath = join(root, "host-output.json");
		const body = '{"version":1,"taskId":"T-C01","status":"completed"}';
		writeFileSync(outputPath, body);
		const result = resolver.resolve({
			version: 1,
			source: "bg-wait",
			runId: "run-c01",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath },
		});
		assert.equal(result.kind, "loaded");
		assert.equal(result.kind === "loaded" ? result.text : "", body);
	}

	// C02: archive-only completions select by exact run identity, never by size.
	{
		const archivePath = join(root, "archive.json");
		writeFileSync(archivePath, JSON.stringify({ results: [
			{ runId: "other", agent: "worker", output: "wrong" },
			{ runId: "run-c02", agent: "worker", output: "right" },
		] }));
		const result = resolver.resolve({
			version: 1,
			source: "bg-wait",
			runId: "run-c02",
			agent: "worker",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { archivePath },
		});
		assert.deepEqual(result.kind === "loaded" ? result.text : undefined, "right");
	}

	// C03: a terminal event before the file write remains pending and can be
	// retried by a later event without consuming a report correction.
	{
		const outputPath = join(root, "late-output.json");
		const receipt = { version: 1, source: "bg-wait", runId: "run-c03", observedAt: new Date().toISOString(), outputState: "present", outputRef: { outputPath } };
		const first = resolver.resolve(receipt);
		assert.equal(first.kind, "pending");
		assert.equal(first.kind === "pending" ? first.code : undefined, OUTPUT_PENDING);
		writeFileSync(outputPath, "complete report");
		const second = resolver.resolve(receipt);
		assert.equal(second.kind, "loaded");
	}

	// Automatic retries are bounded and duplicate attempt keys are idempotent.
	{
		const retryDir = join(root, "retry-records");
		const retryStore = new RunRecordStore(retryDir);
		let record = retryStore.put(makeRunRecord({ sessionId: "session", workspaceId: "workspace", taskId: "T-C03", executionId: "retry", agent: "worker", role: "worker", executionState: "terminal", ingestionState: "output-pending" }));
		for (let attempt = 0; attempt < MAX_OUTPUT_RETRIES; attempt += 1) record = retryStore.recordOutputAttempt(record, `path:${attempt}`);
		assert.equal(record.outputAttempts, MAX_OUTPUT_RETRIES);
		assert.equal(retryStore.canRetryOutput(record, "path:1"), true);
		const exhausted = retryStore.recordOutputAttempt(record, "path:3");
		assert.equal(exhausted.ingestionState, "unavailable");
		const legacyDir = join(root, "legacy-records");
		mkdirSync(legacyDir);
		writeFileSync(join(legacyDir, "legacy.json"), JSON.stringify({
			version: 1,
			sessionId: "legacy-session",
			workspaceId: "legacy-workspace",
			taskId: "T-legacy",
			executionId: "legacy-execution",
			agent: "worker",
			role: "worker",
			executionState: "terminal",
			ingestionState: "recorded",
		}));
		const legacy = new RunRecordStore(legacyDir).load();
		assert.equal(legacy.length, 1, "records written before provenance still load");
		assert.equal(legacy[0].loadedProvenance, undefined);
	}

	// C04: each infrastructure failure is explicit; an ambiguous archive is not
	// resolved by ranking candidates.
	{
		const missing = resolver.resolve({ version: 1, source: "reconcile", observedAt: new Date().toISOString(), outputState: "absent", outputRef: { outputPath: join(root, "missing") } });
		assert.equal(missing.kind, "unavailable");
		assert.equal(missing.kind === "unavailable" ? missing.code : undefined, "OUTPUT_UNAVAILABLE");
		const directory = join(root, "directory-output");
		mkdirSync(directory);
		const unreadable = resolver.resolve({ version: 1, source: "reconcile", observedAt: new Date().toISOString(), outputState: "present", outputRef: { outputPath: directory } });
		assert.equal(unreadable.kind, "unavailable");
		assert.equal(unreadable.kind === "unavailable" ? unreadable.code : undefined, OUTPUT_NOT_READABLE);
		const oversized = join(root, "large-output");
		writeFileSync(oversized, "x".repeat(65));
		const tooLarge = resolver.resolve({ version: 1, source: "reconcile", observedAt: new Date().toISOString(), outputState: "present", outputRef: { outputPath: oversized } });
		assert.equal(tooLarge.kind, "unavailable");
		assert.equal(tooLarge.kind === "unavailable" ? tooLarge.code : undefined, OUTPUT_TOO_LARGE);
		const ambiguousPath = join(root, "ambiguous.json");
		writeFileSync(ambiguousPath, JSON.stringify({ results: [
			{ runId: "run-c04", agent: "worker", output: "a" },
			{ runId: "run-c04", agent: "worker", output: "b" },
		] }));
		const ambiguous = resolver.resolve({ version: 1, source: "reconcile", runId: "run-c04", agent: "worker", observedAt: new Date().toISOString(), outputState: "present", outputRef: { archivePath: ambiguousPath } });
		assert.equal(ambiguous.kind, "unavailable");
		assert.equal(ambiguous.kind === "unavailable" ? ambiguous.code : undefined, OUTPUT_AMBIGUOUS);
		const unsupportedPath = join(root, "unsupported.json");
		writeFileSync(unsupportedPath, "not json");
		const unsupported = resolver.resolve({ version: 1, source: "reconcile", observedAt: new Date().toISOString(), outputState: "present", outputRef: { archivePath: unsupportedPath } });
		assert.equal(unsupported.kind, "unavailable");
		assert.equal(unsupported.kind === "unavailable" ? unsupported.code : undefined, ARCHIVE_UNSUPPORTED);
	}

	// Regression: role-bearing outputPath with tool-call-only final assistant must not fall back to loaded.text
	{
		const normalResolver = new OutputResolver({ trustedRoots: [root] });
		const roleOnlyPath = join(root, "tool-only-events.jsonl");
		writeFileSync(roleOnlyPath, [
			JSON.stringify({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "task" }] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", id: "call_1", name: "bash" }] } }),
		].join("\n"));
		const toolOnlyRes = normalResolver.resolve({
			version: 1,
			source: "reconcile",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: roleOnlyPath },
		});
		assert.equal(toolOnlyRes.kind, "unavailable", "tool-call-only role output must be unavailable, not loaded");
		assert.equal(toolOnlyRes.kind === "unavailable" ? toolOnlyRes.code : undefined, "OUTPUT_UNAVAILABLE");
	}

	// C06: provider failures take the durable provider-error taxonomy through
	// the orchestrator reconcile handler, not just the output store.
	{
		const artifacts = join(root, "provider-artifacts");
		mkdirSync(artifacts);
		const orch = new PlannerOrchestrator({
			gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
			concurrency: new ConcurrencyController({ savedLimit: 2 }),
			ledgerDir: root,
			artifactDirs: () => [artifacts],
		});
		const taskId = "T-20260911-006";
		const toolCallId = "call-c06";
		const runId = "run-c06";
		await orch.beginDelegation({
			toolCallId,
			input: { task: JSON.stringify(createTaskSpec({ objective: "provider taxonomy", cwd: root }, taskId)) },
		}, root);
		await orch.handleSubagentResult({
			toolCallId,
			toolName: "subagent",
			details: { asyncId: runId, runId },
			content: [{ type: "text", text: `Async: worker [${runId}]\nThe async run is detached and running in the background.` }],
		});
		const unrelatedAlias = "T-20260911-007";
		const unrelatedToolCallId = "call-c06-unrelated";
		const unrelatedRunId = "run-c06-unrelated";
		const unrelatedWorkspace = join(root, "unrelated-workspace");
		await orch.beginDelegation({
			toolCallId: unrelatedToolCallId,
			input: { task: JSON.stringify(createTaskSpec({ objective: "unrelated workspace", cwd: unrelatedWorkspace }, unrelatedAlias)) },
		}, root);
		await orch.handleSubagentResult({
			toolCallId: unrelatedToolCallId,
			toolName: "subagent",
			details: { asyncId: unrelatedRunId, runId: unrelatedRunId },
			content: [{ type: "text", text: `Async: worker [${unrelatedRunId}]\nThe async run is detached and running in the background.` }],
		});
		const canonicalTaskId = orch.store.get(taskId)?.taskId;
		const unrelatedCanonicalTaskId = orch.store.get(unrelatedAlias)?.taskId;
		assert.ok(canonicalTaskId && canonicalTaskId !== taskId, "caller task id is retained as an alias");
		assert.ok(unrelatedCanonicalTaskId && unrelatedCanonicalTaskId !== unrelatedAlias, "unrelated caller task id is retained as an alias");
		writeFileSync(join(artifacts, `${runId}_worker_meta.json`), JSON.stringify({
			runId, agent: "worker", exitCode: 1, stopReason: "error", error: "403 permission_error: usage limit",
		}));
		assert.equal(await orch.reconcilePendingDelegations(unrelatedAlias), 0, "an unrelated workspace alias does not match another delegation");
		assert.equal(orch.pendingDelegationCount(), 2, "unrelated alias filtering leaves both delegations pending");
		assert.equal(await orch.reconcilePendingDelegations(taskId), 1, "caller-supplied alias reconciles its canonical delegation");
		assert.equal(await orch.reconcilePendingDelegations(unrelatedCanonicalTaskId), 0, "canonical filtering does not consume a different task");
		writeFileSync(join(artifacts, `${unrelatedRunId}_worker_meta.json`), JSON.stringify({
			runId: unrelatedRunId, agent: "worker", exitCode: 1, stopReason: "error", error: "unrelated failure",
		}));
		assert.equal(await orch.reconcilePendingDelegations(unrelatedCanonicalTaskId), 1, "canonical task id filtering still reconciles");
		const record = new RunRecordStore(join(root, "planner-only", "run-state"))
			.load().find((item) => item.executionId === toolCallId);
		assert.equal(record?.terminalErrorClass, "provider-error");
		assert.equal(record?.nextAction, "do-not-retry-provider");
		assert.equal(record?.lastError?.code, "PROVIDER_403_RATE_LIMIT");
	}

	// C05: load-before-report and report-before-ack crashes leave durable state
	// that can be completed after reload without adding another report.
	{
		const dir = join(root, "run-records");
		const base = makeRunRecord({ sessionId: "session", workspaceId: "workspace", taskId: "T-C05", executionId: "execution", runId: "run-c05", agent: "worker", role: "worker", executionState: "terminal", ingestionState: "waiting" });
		let faultPoint = "before-report";
		const first = new RunRecordStore(dir, { fault: (point) => { if (point === faultPoint) throw new Error(point); } });
		assert.throws(() => first.commitLoaded(base, { kind: "loaded", text: "report", digest: "digest-c05", source: "inline" }, () => 1));
		const loaded = new RunRecordStore(dir);
		loaded.load();
		assert.equal(loaded.pendingCommits().length, 1);
		faultPoint = "after-report";
		let reportCount = 0;
		const second = new RunRecordStore(join(root, "run-records-after"), { fault: (point) => { if (point === faultPoint) throw new Error(point); } });
		assert.throws(() => second.commitLoaded(base, { kind: "loaded", text: "report", digest: "digest-c05", source: "inline" }, () => { reportCount += 1; return 1; }));
		assert.equal(reportCount, 1);
		const reloaded = new RunRecordStore(join(root, "run-records-after"));
		reloaded.load();
		const pending = reloaded.pendingCommits()[0];
		assert.ok(pending);
		const recorded = reloaded.commitReport(pending, 1);
		assert.equal(recorded.ingestionState, "recorded");
		const acked = reloaded.ack(recorded);
		assert.equal(acked.acknowledged, true);
		const final = new RunRecordStore(join(root, "run-records-after"));
		final.load();
		assert.equal(final.list()[0]?.acknowledged, true);
	}

	// Regression: Multi-step events via OutputResolver - selecting non-last step, ambiguous missing binding, same-name agent ambiguity
	{
		const multiEventsPath = join(root, "multi-step-events.jsonl");
		const step0Report = JSON.stringify({
			version: 1, taskId: "T-multi-resolver", status: "completed", summary: "Step 0 worker output.",
			changedFiles: ["a.ts"], validation: [], evidence: { taskId: "T-multi-resolver" }, risks: [], unresolved: [],
		});
		const step1Report = JSON.stringify({
			version: 1, taskId: "T-multi-resolver", status: "completed", summary: "Step 1 reviewer output.",
			changedFiles: [], validation: [], evidence: { taskId: "T-multi-resolver" }, risks: [], unresolved: [],
		});
		writeFileSync(multiEventsPath, [
			JSON.stringify({ type: "subagent.step.started", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "message_end", stepIndex: 0, agent: "worker", message: { role: "assistant", content: [{ type: "text", text: step0Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "subagent.step.started", stepIndex: 1, agent: "reviewer" }),
			JSON.stringify({ type: "message_end", stepIndex: 1, agent: "reviewer", message: { role: "assistant", content: [{ type: "text", text: step1Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 1, agent: "reviewer" }),
		].join("\n"));

		const resolver = new OutputResolver({ trustedRoots: [root] });

		// 1. Target non-last step (step 0): MUST select step 0, not step 1
		const resStep0 = resolver.resolve({
			version: 1,
			source: "sync",
			agent: "worker",
			stepIndex: 0,
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: multiEventsPath },
		});
		assert.equal(resStep0.kind, "loaded");
		assert.match(resStep0.text, /Step 0 worker output/);
		assert.doesNotMatch(resStep0.text, /Step 1 reviewer output/);

		// 2. Missing binding on multi-step: MUST reject as OUTPUT_AMBIGUOUS
		const resUnbound = resolver.resolve({
			version: 1,
			source: "sync",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: multiEventsPath },
		});
		assert.equal(resUnbound.kind, "unavailable");
		assert.equal(resUnbound.code, OUTPUT_AMBIGUOUS);

		// 3. Same-name agent ambiguity on multi-step (both step 0 and step 1 are worker)
		const sameNamePath = join(root, "same-name-events.jsonl");
		writeFileSync(sameNamePath, [
			JSON.stringify({ type: "subagent.step.started", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "message_end", stepIndex: 0, agent: "worker", message: { role: "assistant", content: [{ type: "text", text: step0Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "subagent.step.started", stepIndex: 1, agent: "worker" }),
			JSON.stringify({ type: "message_end", stepIndex: 1, agent: "worker", message: { role: "assistant", content: [{ type: "text", text: step1Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 1, agent: "worker" }),
		].join("\n"));

		const resSameName = resolver.resolve({
			version: 1,
			source: "sync",
			agent: "worker",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: sameNamePath },
		});
		assert.equal(resSameName.kind, "unavailable");
		assert.equal(resSameName.code, OUTPUT_AMBIGUOUS);

		// 4. Mismatched binding: agent that does not exist in events
		const resMismatch = resolver.resolve({
			version: 1,
			source: "sync",
			agent: "oracle",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: multiEventsPath },
		});
		assert.equal(resMismatch.kind, "unavailable");
		assert.equal(resMismatch.code, "OUTPUT_UNAVAILABLE");
	}

	// Regression: Orchestration entry point with events.jsonl outputRef binding & relative sessionFile resolution
	{
		const orchRoot = join(root, "orch-test");
		mkdirSync(orchRoot, { recursive: true });
		const orch = new PlannerOrchestrator({
			gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
			concurrency: new ConcurrencyController({ savedLimit: 2 }),
			ledgerDir: orchRoot,
			artifactDirs: () => [orchRoot],
		});

		const taskId = "T-20260913-ORCH";
		const toolCallId = "call-orch-step0";
		const runId = "run-orch-step0";
		const asyncDir = join(orchRoot, "async-subagent-runs", runId);
		mkdirSync(asyncDir, { recursive: true });

		const step0Report = JSON.stringify({
			version: 1, taskId, status: "completed", summary: "Step 0 worker output through orchestrator.",
			changedFiles: ["feature.ts"], validation: [], evidence: { taskId }, risks: [], unresolved: [],
		});
		const step1Report = JSON.stringify({
			version: 1, taskId, status: "completed", summary: "Step 1 reviewer output through orchestrator.",
			changedFiles: [], validation: [], evidence: { taskId }, risks: [], unresolved: [],
		});

		writeFileSync(join(asyncDir, "events.jsonl"), [
			JSON.stringify({ type: "subagent.step.started", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "message_end", stepIndex: 0, agent: "worker", message: { role: "assistant", content: [{ type: "text", text: step0Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 0, agent: "worker" }),
			JSON.stringify({ type: "subagent.step.started", stepIndex: 1, agent: "reviewer" }),
			JSON.stringify({ type: "message_end", stepIndex: 1, agent: "reviewer", message: { role: "assistant", content: [{ type: "text", text: step1Report }] } }),
			JSON.stringify({ type: "subagent.step.completed", stepIndex: 1, agent: "reviewer" }),
		].join("\n"));

		writeFileSync(join(orchRoot, `${runId}_worker_meta.json`), JSON.stringify({
			runId, agent: "worker", exitCode: 0,
		}));

		await orch.beginDelegation({
			toolCallId,
			input: { task: JSON.stringify(createTaskSpec({ objective: "multi-step orch", cwd: orchRoot }, taskId)) },
		}, orchRoot);

		// Record delegation state with asyncDir
		const record = orch.delegations.get(toolCallId);
		assert.ok(record);
		record.runId = runId;
		record.asyncDir = asyncDir;
		record.agent = "worker";
		record.outputRef = { outputPath: join(asyncDir, "events.jsonl"), agent: "worker", stepIndex: 0 };

		// Reconcile delegation: must consume step 0, not step 1
		const outcome = await orch.reconcileDelegation(toolCallId, record);
		assert.ok(outcome);
		const outcomeText = outcome.content[0]?.text ?? "";
		assert.match(outcomeText, /Step 0 worker output through orchestrator/);
		assert.doesNotMatch(outcomeText, /Step 1 reviewer output/);

		// Regression: Relative sessionFile in status.json resolved relative to asyncDir successfully
		const relRunId = "run-orch-rel";
		const relToolCallId = "call-orch-rel";
		const relTaskId = "T-20260913-REL";
		const relAsyncDir = join(orchRoot, "async-subagent-runs", relRunId);
		mkdirSync(join(relAsyncDir, "run-0"), { recursive: true });

		const relReport = JSON.stringify({
			version: 1, taskId: relTaskId, status: "completed", summary: "Relative sessionFile resolved successfully.",
			changedFiles: [], validation: [], evidence: { taskId: relTaskId }, risks: [], unresolved: [],
		});
		writeFileSync(join(relAsyncDir, "run-0", "session.jsonl"), [
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: relReport }] } }),
		].join("\n"));
		writeFileSync(join(relAsyncDir, "status.json"), JSON.stringify({
			runId: relRunId,
			sessionFile: "run-0/session.jsonl",
		}));
		writeFileSync(join(orchRoot, `${relRunId}_worker_meta.json`), JSON.stringify({
			runId: relRunId, agent: "worker", exitCode: 0,
		}));

		await orch.beginDelegation({
			toolCallId: relToolCallId,
			input: { task: JSON.stringify(createTaskSpec({ objective: "rel session orch", cwd: orchRoot }, relTaskId)) },
		}, orchRoot);

		const relRecord = orch.delegations.get(relToolCallId);
		assert.ok(relRecord);
		relRecord.runId = relRunId;
		relRecord.asyncDir = relAsyncDir;
		relRecord.agent = "worker";
		const relOutputRef = { outputPath: join(relAsyncDir, "run-0", "session.jsonl"), agent: "worker" };
		relRecord.outputRef = relOutputRef;

		const relOutcome = await orch.reconcileDelegation(relToolCallId, relRecord);
		assert.ok(relOutcome);
		const relOutcomeText = relOutcome.content[0]?.text ?? "";
		assert.match(relOutcomeText, /Relative sessionFile resolved successfully/);

		// Regression: Sibling run attribution defect in status.json / trustedRoots
		// 1. Sibling run absolute path negative case
		const siblingRunId = "run-orch-sibling";
		const siblingDir = join(orchRoot, "async-subagent-runs", siblingRunId);
		mkdirSync(siblingDir, { recursive: true });
		const siblingReport = JSON.stringify({
			version: 1, taskId: "T-SIBLING", status: "completed", summary: "Sibling run output must never be ingested.",
			changedFiles: [], validation: [], evidence: { taskId: "T-SIBLING" }, risks: [], unresolved: [],
		});
		writeFileSync(join(siblingDir, "session.jsonl"), [
			JSON.stringify({ type: "session", version: 3, id: "session-sibling", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "session_info", name: "subagent-worker-run-orch-sibling-1" }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: siblingReport }] } }),
		].join("\n"));

		const victimRunId = "run-orch-victim";
		const victimDir = join(orchRoot, "async-subagent-runs", victimRunId);
		mkdirSync(victimDir, { recursive: true });
		// victim status.json legitimately binds its own sessionFile
		writeFileSync(join(victimDir, "status.json"), JSON.stringify({
			runId: victimRunId,
			sessionFile: "run-0/session.jsonl",
		}));
		writeFileSync(join(orchRoot, `${victimRunId}_worker_meta.json`), JSON.stringify({
			runId: victimRunId, agent: "worker", exitCode: 0,
		}));

		await orch.beginDelegation({
			toolCallId: "call-orch-victim",
			input: { task: JSON.stringify(createTaskSpec({ objective: "victim", cwd: orchRoot }, "T-VICTIM")) },
		}, orchRoot);

		const victimRecord = orch.delegations.get("call-orch-victim");
		assert.ok(victimRecord);
		victimRecord.runId = victimRunId;
		victimRecord.asyncDir = victimDir;
		victimRecord.agent = "worker";
		victimRecord.launchCwd = orchRoot;

		// Reconcile delegation with outputRef pointing to sibling must fail with OUTPUT_NOT_READABLE
		victimRecord.outputRef = { outputPath: join(siblingDir, "session.jsonl"), agent: "worker" };
		const victimResolution = orch.resolveDelegationOutput(victimRecord);
		assert.equal(victimResolution.kind, "unavailable");
		assert.equal(victimResolution.code, OUTPUT_NOT_READABLE);

		const victimReconcile = await orch.reconcileDelegation("call-orch-victim", victimRecord);
		assert.equal(victimReconcile, undefined, "reconcileDelegation must reject sibling run session");

		// 2. Sibling run relative path negative case ("../run-orch-sibling/session.jsonl")
		writeFileSync(join(victimDir, "status.json"), JSON.stringify({
			runId: victimRunId,
			sessionFile: "../run-orch-sibling/session.jsonl",
		}));
		victimRecord.outputRef = undefined;
		const victimRelativeDelivery = await orch.recoverPendingRun({ id: victimRunId }, orchRoot);
		assert.equal(victimRelativeDelivery?.outputRef, undefined, "recoverPendingRun must not bind relative sibling session");

		// 3. Symlink escape counterexample
		const symlinkSession = join(victimDir, "symlink-session.jsonl");
		symlinkSync(join(siblingDir, "session.jsonl"), symlinkSession);
		writeFileSync(join(victimDir, "status.json"), JSON.stringify({
			runId: victimRunId,
			sessionFile: symlinkSession,
		}));
		const victimSymlinkDelivery = await orch.recoverPendingRun({ id: victimRunId }, orchRoot);
		assert.equal(victimSymlinkDelivery?.outputRef, undefined, "recoverPendingRun must not bind symlink escaping asyncDir");
		orch.endDelegation("call-orch-victim");

		// 3b. Sibling run session merely mentioning target runId in prompt/text must NOT be bound
		const mentionRunId = "run-orch-mention";
		const mentionDir = join(orchRoot, "async-subagent-runs", mentionRunId);
		mkdirSync(mentionDir, { recursive: true });
		const mentionSessionFile = join(orchRoot, "external-sessions", "mention-session.jsonl");
		mkdirSync(join(orchRoot, "external-sessions"), { recursive: true });
		writeFileSync(mentionSessionFile, [
			JSON.stringify({ type: "session", version: 3, id: "session-mention", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "session_info", name: "subagent-worker-mention-1" }),
			JSON.stringify({ type: "message", message: { role: "user", content: [{ type: "text", text: `Review sibling ${mentionRunId} report` }] } }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: JSON.stringify({ version: 1, taskId: "T-M", status: "completed", summary: "Leaked" }) }] } }),
		].join("\n"));
		writeFileSync(join(mentionDir, "status.json"), JSON.stringify({
			runId: mentionRunId,
			sessionDir: join(orchRoot, "external-sessions"),
			sessionFile: "run-0/session.jsonl",
		}));
		writeFileSync(join(orchRoot, `${mentionRunId}_worker_meta.json`), JSON.stringify({
			runId: mentionRunId, agent: "worker", exitCode: 0,
		}));
		await orch.beginDelegation({
			toolCallId: "call-orch-mention",
			input: { task: JSON.stringify(createTaskSpec({ objective: "mention", cwd: orchRoot }, "T-MENTION")) },
		}, orchRoot);
		const mentionRecord = orch.delegations.get("call-orch-mention");
		assert.ok(mentionRecord);
		mentionRecord.runId = mentionRunId;
		mentionRecord.asyncDir = mentionDir;
		mentionRecord.agent = "worker";
		mentionRecord.launchCwd = orchRoot;
		mentionRecord.outputRef = { outputPath: mentionSessionFile, agent: "worker" };
		const mentionResolution = orch.resolveDelegationOutput(mentionRecord);
		assert.equal(mentionResolution.kind, "unavailable");
		assert.equal(mentionResolution.code, OUTPUT_NOT_READABLE, "sibling session mentioning runId must be rejected by resolveDelegationOutput");
		orch.endDelegation("call-orch-mention");

		// 4. Trusted host-bound external sessionDir positive case (no childSessionFile in meta!)
		const extRunId = "run-orch-ext";
		const extSessionsDir = join(orchRoot, "external-sessions");
		mkdirSync(extSessionsDir, { recursive: true });
		const extSessionFile = join(extSessionsDir, "session.jsonl");
		const extReport = JSON.stringify({
			version: 1, taskId: "T-EXT-ORCH", status: "completed", summary: "External session resolved successfully.",
			changedFiles: [], validation: [], evidence: { taskId: "T-EXT-ORCH" }, risks: [], unresolved: [],
		});
		writeFileSync(extSessionFile, [
			JSON.stringify({ type: "session", version: 3, id: "session-ext", timestamp: new Date().toISOString() }),
			JSON.stringify({ type: "session_info", name: "subagent-worker-run-orch-ext-1" }),
			JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: extReport }] } }),
		].join("\n"));

		const extAsyncDir = join(orchRoot, "async-subagent-runs", extRunId);
		mkdirSync(extAsyncDir, { recursive: true });
		writeFileSync(join(extAsyncDir, "status.json"), JSON.stringify({
			runId: extRunId,
			sessionDir: extSessionsDir,
			steps: [{ agent: "worker", sessionFile: extSessionFile }],
		}));
		writeFileSync(join(orchRoot, `${extRunId}_worker_meta.json`), JSON.stringify({
			runId: extRunId, agent: "worker", exitCode: 0,
		}));

		await orch.beginDelegation({
			toolCallId: "call-orch-ext",
			input: { task: JSON.stringify(createTaskSpec({ objective: "ext session orch", cwd: orchRoot }, "T-EXT-ORCH")) },
		}, orchRoot);

		const extRecord = orch.delegations.get("call-orch-ext");
		assert.ok(extRecord);
		extRecord.runId = extRunId;
		extRecord.asyncDir = extAsyncDir;
		extRecord.agent = "worker";
		extRecord.launchCwd = orchRoot;

		const extDelivery = await orch.recoverPendingRun({ id: extRunId }, orchRoot);
		assert.ok(extDelivery, "external session must be recovered");
		assert.equal(extDelivery.status, "recovered");
		assert.match(extDelivery.content[0]?.text ?? "", /External session resolved successfully/);

		// 5. Read-only playback of real host sample run 927d07f0-c193-428b-b226-6daa851ec308 in orchestrator
		const realSampleRunId = "927d07f0-c193-428b-b226-6daa851ec308";
		const realSampleAsyncDir = `/tmp/pi-subagents-uid-1000/async-subagent-runs/${realSampleRunId}`;
		const realSampleSessionFile = "/public/pi/pi-planner-only/.scratch/nx-followups/host-validation/session-binding-fix-sessions/4432154a-dcd3-42a1-bb15-57b57b25ffc4/run-0/session.jsonl";
		if (existsSync(realSampleAsyncDir) && existsSync(realSampleSessionFile)) {
			const realSampleRecord = {
				taskId: "T-REAL-SAMPLE",
				kind: "worker",
				runId: realSampleRunId,
				asyncDir: realSampleAsyncDir,
				agent: "worker",
				launchCwd: orchRoot,
				outputRef: { outputPath: realSampleSessionFile, agent: "worker" },
			};
			const realSampleResolution = orch.resolveDelegationOutput(realSampleRecord);
			assert.equal(realSampleResolution.kind, "loaded", "real sample external session must resolve as loaded");
			assert.match(realSampleResolution.text ?? "", /acceptance-report/, "real sample report must contain acceptance report");
		}


		// Path traversal attempting to escape trustedRoots must NOT be readable
		const maliciousResolver = new OutputResolver({ trustedRoots: [orchRoot] });
		const maliciousResult = maliciousResolver.resolve({
			version: 1,
			source: "sync",
			observedAt: new Date().toISOString(),
			outputState: "present",
			outputRef: { outputPath: "/etc/passwd" },
		});
		assert.equal(maliciousResult.kind, "unavailable");
		assert.equal(maliciousResult.code, OUTPUT_NOT_READABLE);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("planner-only completion RR-02 C01-C06: PASS");
