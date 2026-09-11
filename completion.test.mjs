import assert from "node:assert/strict";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { ConcurrencyController } from "./concurrency.ts";
import { createTaskSpec } from "./task.ts";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("planner-only completion RR-02 C01-C06: PASS");
