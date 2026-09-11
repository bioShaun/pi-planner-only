import assert from "node:assert/strict";
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
} from "./completion.ts";

const root = mkdtempSync(join(process.cwd(), ".planner-only-completion-"));
try {
	const resolver = new OutputResolver({ trustedRoots: [root], maxOutputBytes: 64 });

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

console.log("planner-only completion RR-02 C01-C05: PASS");
