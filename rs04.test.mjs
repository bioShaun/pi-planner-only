import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { RunRecordStore } from "./completion.ts";
import { applyRoleDelegation } from "./roles.ts";
import {
	formatFloorLimitsSummary,
	resolveEffectiveLimits,
} from "./floors.ts";
import { normalizeWorkerReport, validateWorkerReport } from "./report.ts";

// A15: bounded tool floors carry the staged default and finalizing guidance.
{
	const limits = resolveEffectiveLimits({ role: "validator" });
	assert.equal(limits.toolBudget?.value, 20);
	assert.equal(limits.toolBudget?.soft, 16);
	assert.equal(limits.toolBudget?.advisoryOnly, true);

	const payload = {
		agent: "validator",
		task: "finalize the validation phase",
		toolBudget: { hard: 20, callerField: "preserve" },
	};
	applyRoleDelegation(payload, { role: "validator" });
	assert.equal(payload.toolBudget.soft, 16);
	assert.equal(payload.toolBudget.hard, 20);
	assert.equal(payload.toolBudget.callerField, "preserve");
	assert.match(formatFloorLimitsSummary(limits), /toolBudget\.hard=20/);
}

// A16: soft enforcement is explicitly advisory when the host has no staged
// tool-budget enforcement guarantee.
{
	const limits = resolveEffectiveLimits({ role: "explorer" });
	const summary = formatFloorLimitsSummary(limits);
	assert.equal(limits.toolBudget?.advisoryOnly, true);
	assert.equal(formatFloorLimitsSummary(limits), "toolBudget.hard=20 (floor), usageBudget.tokens.hard=40000 (floor), usageBudget.costUsd.hard=0.1 (floor)");
}

// A17: a partial report remains structured, including completed/uncompleted
// item breakdown and the checkpoint identity needed for recovery.
{
	const raw = {
		version: 1,
		taskId: "T-20260912-017",
		status: "partial",
		summary: JSON.stringify({
			completed: ["floor resolution"],
			uncompleted: ["provider verification"],
			checkpoint: "checkpoint-2",
		}),
		changedFiles: ["floors.ts"],
		validation: [{ type: "manual", status: "not-run", summary: "provider verification pending" }],
		evidence: { cwd: "/public/pi/pi-planner-only", taskId: "T-20260912-017", workerRunId: "run-checkpoint-2", generatedAt: new Date(0).toISOString() },
		risks: [],
		unresolved: ["provider verification"],
	};
	const normalized = normalizeWorkerReport(raw).report;
	assert.equal(validateWorkerReport(normalized).length, 0);
	assert.equal(normalized.status, "partial");
	const breakdown = JSON.parse(normalized.summary);
	assert.deepEqual(breakdown.completed, ["floor resolution"]);
	assert.deepEqual(breakdown.uncompleted, ["provider verification"]);
	assert.equal(breakdown.checkpoint, "checkpoint-2");
	assert.equal(normalized.evidence.workerRunId, "run-checkpoint-2");
}

// A18: provider failure is terminal and non-retryable; the persisted run
// record exposes the recovery action instead of inventing a completion.
{
	const tempDir = mkdtempSync(join(process.cwd(), ".planner-only-rs04-"));
	const artifactsDir = join(tempDir, "artifacts");
	mkdirSync(artifactsDir, { recursive: true });
	const taskId = "T-20260912-018";
	const executionId = "rs04-provider-403";
	const runId = "rs04-provider-run";
	const orch = new PlannerOrchestrator({
		gitRunner: async () => ({ stdout: "", stderr: "", code: 0 }),
		ledgerDir: tempDir,
		artifactDirs: () => [artifactsDir],
	});
	try {
		await orch.beginDelegation({
			toolCallId: executionId,
			input: {
				task: JSON.stringify({
					version: 1,
					taskId,
					objective: "provider checkpoint recovery",
					cwd: tempDir,
					role: "worker",
					scope: { allowedPaths: [] },
					constraints: [],
					acceptanceCriteria: [],
					validation: { required: false },
					expectedEvidence: {},
					stopConditions: [],
				}),
			},
		}, tempDir);
		await orch.handleSubagentResult({
			toolCallId: executionId,
			toolName: "subagent",
			details: { asyncId: runId, runId },
			content: [{ type: "text", text: `Async: worker [${runId}]\\nThe async run is detached and running in the background.` }],
		});
		writeFileSync(join(artifactsDir, `${runId}_worker_meta.json`), JSON.stringify({
			runId,
			agent: "worker",
			exitCode: 1,
			stopReason: "error",
			error: "403 permission_error: five-hour usage limit",
		}));
		assert.equal(await orch.reconcilePendingDelegations(taskId), 1);
		const record = new RunRecordStore(join(tempDir, "planner-only", "run-state"))
			.load().find((item) => item.executionId === executionId);
		assert.equal(record?.terminalErrorClass, "provider-error");
		assert.equal(record?.nextAction, "do-not-retry-provider");
		assert.equal(record?.reportRevision, undefined);
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
}

console.log("rs04: PASS");
