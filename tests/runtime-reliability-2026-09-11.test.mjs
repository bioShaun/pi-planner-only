import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateTaskSpec } from "../task.ts";
import {
	createReplayWorkspace,
	loadFixture,
	replayNotification,
	replayReport,
} from "./fixtures/runtime-2026-09-11/replay-harness.mjs";

const fixtureDir = join(process.cwd(), "tests", "fixtures", "runtime-2026-09-11");
const completionFixture = loadFixture("completion-l19-l76.json");
const resumeFixture = loadFixture("resume-c8e08f46-to-873bcc27.json");
const staleFixture = loadFixture("stale-same-name-agent-notification.json");
const delegationFixture = loadFixture("delegation-step2-handoff.json");

// Checked-in fixture paths must remain symbolic until the harness creates its
// isolated tree. This also prevents accidental capture of audit-machine paths.
for (const name of [
	"completion-l19-l76.json",
	"resume-c8e08f46-to-873bcc27.json",
	"stale-same-name-agent-notification.json",
	"delegation-step2-handoff.json",
]) {
	const source = readFileSync(join(fixtureDir, name), "utf8");
	assert.doesNotMatch(source, /\/(?:home|Users|project|tmp)\//, `${name} must not contain a machine path`);
}

// L19/L76: preserve the host completion envelope and prove that the synthetic
// final bodies can be read from the explicit outputPath in a temp workspace.
{
	assert.equal(completionFixture.fixtureVersion, 1);
	assert.equal(completionFixture.source, "bg_wait");
	assert.deepEqual(completionFixture.cases.map(({ id }) => id), ["L19", "L76"]);
	const replay = createReplayWorkspace();
	try {
		for (const fixtureCase of completionFixture.cases) {
			const materialized = replay.materialize(fixtureCase);
			const completion = materialized.details.completions[0];
			assert.equal(materialized.details.completions.length, 1, `${fixtureCase.id} has one child completion`);
			assert.equal(completion.outputState, "present");
			assert.equal(completion.agent, "worker");
			assert.equal(typeof completion.runId, "string");
			assert.equal(completion.artifactPaths.outputPath.startsWith(replay.root), true);
			assert.equal(completion.artifactPaths.archivePath.startsWith(replay.root), true);
			assert.equal(existsSync(replay.path(materialized.legacyOutputDirectory ?? "${TEMP_ROOT}/legacy")), false);

			const outputPath = replay.writeText(
				completion.artifactPaths.outputPath,
				JSON.stringify(replay.materialize(fixtureCase.report)),
			);
			assert.equal(outputPath, replay.path(completion.artifactPaths.outputPath));
			const extracted = replayReport(readFileSync(outputPath, "utf8"), fixtureCase.report.taskId);
			assert.ok(extracted.report, `${fixtureCase.id} report must be parseable`);
			assert.deepEqual(extracted.repairs, []);
			assert.equal(extracted.report.taskId, fixtureCase.report.taskId);

			const notification = replayNotification(fixtureCase.notification);
			assert.ok(notification, `${fixtureCase.id} notification must be parseable`);
			assert.equal(notification.agent, "worker");
			assert.equal(notification.taskIdHint, fixtureCase.report.taskId);
		}
	} finally {
		replay.cleanup();
	}
}

// Resume: c8e08f46 is the previous execution and 873bcc27 is a distinct new
// execution for the same canonical Task. Both host and plugin-facing details
// retain the linkage and explicit output references.
{
	const replay = createReplayWorkspace();
	try {
		const materialized = replay.materialize(resumeFixture);
		const receipt = materialized.receipt;
		assert.equal(resumeFixture.previousRunId, "c8e08f46");
		assert.equal(resumeFixture.newRunId, "873bcc27");
		assert.equal(receipt.action, "resume");
		assert.equal(receipt.previousRunId, "c8e08f46");
		assert.equal(receipt.runId, "873bcc27");
		assert.equal(receipt.details.runId, receipt.runId);
		assert.equal(receipt.details.previousRunId, receipt.previousRunId);
		assert.equal(receipt.taskId, resumeFixture.taskId);
		assert.notEqual(receipt.previousRunId, receipt.runId);
		assert.equal(receipt.details.outputState, "present");
		assert.equal(receipt.details.artifactPaths.outputPath.startsWith(replay.root), true);
	} finally {
		replay.cleanup();
	}
}

// Same-name stale notification: routing by agent alone would select the new
// Task. The strict replay key is the complete task hint, so the current Task
// has no match and its state/budget/report count remain byte-for-byte stable.
{
	const notification = replayNotification(staleFixture.notification.content);
	assert.ok(notification);
	assert.equal(notification.agent, staleFixture.notification.agent);
	assert.equal(notification.taskIdHint, staleFixture.notification.taskIdHint);
	assert.equal(staleFixture.staleTask.agent, staleFixture.currentTask.agent);
	assert.notEqual(staleFixture.staleTask.taskId, staleFixture.currentTask.taskId);
	const before = structuredClone(staleFixture.currentTask);
	const strictMatch = notification.taskIdHint === staleFixture.currentTask.taskId
		? staleFixture.currentTask
		: undefined;
	assert.equal(strictMatch, undefined);
	assert.deepEqual(staleFixture.currentTask, before);
	assert.equal(staleFixture.expected.mutatedTaskId, null);
	assert.equal(staleFixture.expected.currentTaskUnchanged, true);
}

// Step 2 and handoff: the packet oracle keeps the raw delegation body and its
// facts/references alongside a canonical TaskSpec. This is the input contract
// RR-04 will consume; no live runtime packet transformation is introduced here.
{
	assert.deepEqual(delegationFixture.cases.map(({ id }) => id), ["step-2", "handoff"]);
	const replay = createReplayWorkspace();
	try {
		for (const fixtureCase of delegationFixture.cases) {
			const materialized = replay.materialize(fixtureCase);
			const packet = materialized.expectedChildPacket;
			assert.equal(packet.version, 1);
			assert.deepEqual(packet.spec, materialized.taskSpec);
			assert.equal(packet.spec.taskId, materialized.taskId);
			assert.equal(packet.instructions, materialized.rawBody);
			assert.equal(validateTaskSpec(packet.spec).length, 0);
			assert.ok(packet.knownFacts.length > 0);
			assert.ok(packet.artifactRefs.length > 0);
			for (const ref of packet.artifactRefs) {
				assert.equal(ref.startsWith(replay.workspace), true);
			}
		}
	} finally {
		replay.cleanup();
	}
	const step2 = delegationFixture.cases[0].rawBody;
	const handoff = delegationFixture.cases[1].rawBody;
	for (const marker of ["4.2.1", "symlink", "make-db", "smoke test"]) assert.equal(step2.includes(marker), true, marker);
	for (const marker of ["1,204,876", "--cohort durum-100k", "SNP+INDEL", "paused next step"]) assert.equal(handoff.includes(marker), true, marker);
}

console.log("planner-only runtime reliability fixtures: PASS");
