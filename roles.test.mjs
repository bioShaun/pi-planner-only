import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	MUTATING_TOOLS,
	ROLE_AGENTS,
	ROLE_TOOL_PROFILES,
	applyRoleDelegation,
	buildTaskPacket,
	extractTaskPacket,
	hasMissingRequiredValidationCommands,
	inferRoleFromAgent,
	lastWorkerValidationPassed,
	missingTaskSpecValidationCommands,
	oracleSuiteMode,
	prepareRoleDelegation,
	resolveDelegationTarget,
	roleAllowsMutatingTools,
	stripDelegationKeys,
	taskSpecRequestsFullSuite,
	STRIPPED_DELEGATION_KEYS,
	wrapOracleContract,
	wrapWorkerContract,
} from "./roles.ts";
import { createTaskSpec } from "./task.ts";
import { validateWorkerReport, workerReportShapeReminder, extractWorkerReport } from "./report.ts";
import { extractReviewRequest, reviewerPrompt } from "./review.ts";

const RUN5_ARTIFACTS = join(process.cwd(), ".scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts");
function readRun5Output(prefix) {
	const name = prefix === "75d7ae1c"
		? "75d7ae1c-1105-489c-9987-8522f1c3e006_delegate_output.md"
		: "e63c7583-b530-4915-9a40-54564c188ff1_worker_output.md";
	return readFileSync(join(RUN5_ARTIFACTS, name), "utf8");
}

assert.equal(hasMissingRequiredValidationCommands(createTaskSpec({ objective: "missing commands", cwd: process.cwd(), validation: { required: true } })), true);
assert.equal(hasMissingRequiredValidationCommands(createTaskSpec({ objective: "empty commands", cwd: process.cwd(), validation: { required: true, commands: [] } })), true);
assert.equal(hasMissingRequiredValidationCommands(createTaskSpec({ objective: "defined commands", cwd: process.cwd(), validation: { required: true, commands: ["npm test"] } })), false);
assert.deepEqual(
	missingTaskSpecValidationCommands(
		createTaskSpec({ objective: "file check does not cover test", cwd: process.cwd(), validation: { commands: ["npm test"] } }),
		{ validation: [{ command: "test -f src/parser.test.ts", status: "passed", exitCode: 0 }] },
	),
	["npm test"],
);
assert.equal(taskSpecRequestsFullSuite(createTaskSpec({ objective: "e2e", cwd: process.cwd(), validation: { commands: ["npm test", "npm run test:e2e"] } })), true);
assert.equal(taskSpecRequestsFullSuite(createTaskSpec({ objective: "unit", cwd: process.cwd(), validation: { commands: ["npm test"] } })), false);
assert.equal(taskSpecRequestsFullSuite(createTaskSpec({ objective: "types", cwd: process.cwd(), validation: { commands: ["npm run typecheck"] } })), false);

// A copied reminder must remain a valid shape while conservatively proving no validation ran.
{
	const reminderReport = JSON.parse(workerReportShapeReminder("T-copy"));
	const spec = createTaskSpec({
		objective: "copy detection",
		cwd: process.cwd(),
		validation: { commands: ["npm test"] },
	});
	assert.deepEqual(validateWorkerReport(reminderReport), []);
	assert.equal(lastWorkerValidationPassed(reminderReport), false);
	assert.deepEqual(missingTaskSpecValidationCommands(spec, reminderReport), ["npm test"]);
}

// Ticket 34: inferred passes from the real run5 reports do not satisfy either gate.
for (const prefix of ["75d7ae1c", "e63c7583"]) {
	const extracted = extractWorkerReport(readRun5Output(prefix));
	const report = extracted.report;
	const command = report.validation[0].command;
	const spec = createTaskSpec({ objective: "inferred validation", cwd: process.cwd(), validation: { commands: [command] } });
	assert.equal(lastWorkerValidationPassed(report), false, prefix);
	assert.deepEqual(missingTaskSpecValidationCommands(spec, report), [command], prefix);
}

// Explicit worker-declared passes retain both gates.
{
	const explicit = { status: "completed", validation: [{ command: "npm test", status: "passed", exitCode: 0 }] };
	const spec = createTaskSpec({ objective: "explicit validation", cwd: process.cwd(), validation: { commands: ["npm test"] } });
	assert.equal(lastWorkerValidationPassed(explicit), true);
	assert.deepEqual(missingTaskSpecValidationCommands(spec, explicit), []);
}

// Reviewer children launch with --no-extensions, so git_audit does not exist
// there. Root passes a bounded Git evidence packet instead.
assert.deepEqual([...ROLE_TOOL_PROFILES.reviewer].sort(), ["find", "grep", "ls", "read"]);
assert.deepEqual([...ROLE_TOOL_PROFILES.validator].sort(), ["bash", "find", "grep", "ls", "read"]);
assert.equal(ROLE_TOOL_PROFILES.worker, undefined);

assert.equal(roleAllowsMutatingTools("explorer"), false);
assert.equal(roleAllowsMutatingTools("reviewer"), false);
assert.equal(roleAllowsMutatingTools("validator"), true);
assert.equal(roleAllowsMutatingTools("worker"), true);
for (const tool of MUTATING_TOOLS) {
	assert.equal(ROLE_TOOL_PROFILES.explorer.includes(tool), false);
	assert.equal(ROLE_TOOL_PROFILES.reviewer.includes(tool), false);
}
assert.equal(ROLE_TOOL_PROFILES.validator.includes("edit"), false);
assert.equal(ROLE_TOOL_PROFILES.validator.includes("write"), false);

assert.equal(ROLE_AGENTS.explorer, "reviewer");
assert.equal(ROLE_AGENTS.reviewer, "reviewer");
assert.equal(ROLE_AGENTS.validator, "oracle");
assert.equal(ROLE_AGENTS.worker, undefined);

assert.equal(inferRoleFromAgent("reviewer"), "reviewer");
assert.equal(inferRoleFromAgent("oracle"), "validator");
assert.equal(inferRoleFromAgent("worker"), "worker");
assert.equal(inferRoleFromAgent("scout"), "explorer");
assert.equal(inferRoleFromAgent("ScOuT"), "explorer");
assert.equal(inferRoleFromAgent("delegate"), undefined);

const scout = { agent: "scout", task: "Survey the repo." };
assert.equal(applyRoleDelegation(scout, { role: "explorer" }).role, "explorer");
assert.equal(scout.agent, "scout");
const preparedScout = { agent: "ScOuT", task: "Survey the repo." };
prepareRoleDelegation(preparedScout, () => undefined);
assert.equal(preparedScout.agent, "ScOuT");

const worker = { agent: "worker", task: "implement it", context: "fork" };
assert.equal(applyRoleDelegation(worker, { role: "worker", taskId: "T-20260831-001" }).mutated, true);
assert.equal(worker.agent, "worker");
assert.equal(worker.context, "fresh");
assert.match(worker.task, /\[PLANNER-ONLY WORKER CONTRACT\]/);
assert.match(worker.task, /Do not run npm install, pnpm install, or any other command that modifies a lockfile/);
assert.match(worker.task, /unless the TaskSpec explicitly requires it/);
assert.match(worker.task, /lockfile-readonly install \(npm ci, pnpm install --frozen-lockfile\)/);
assert.match(worker.task, /If a lockfile is modified anyway, list it in changedFiles/);
assert.match(worker.task, /"taskId":"T-20260831-001"/);
assert.equal(applyRoleDelegation(worker, { role: "worker", taskId: "T-20260831-001" }).mutated, false, "already wrapped");

const explorer = { agent: "worker", task: "find the parser" };
assert.equal(applyRoleDelegation(explorer, { role: "explorer" }).mutated, true);
assert.equal(explorer.agent, "reviewer");
assert.equal(explorer.task, "find the parser");
assert.equal("context" in explorer, false);

const validator = { agent: "worker", task: "run tests" };
assert.equal(applyRoleDelegation(validator, { role: "validator" }).mutated, true);
assert.equal(validator.agent, "oracle");
assert.equal(validator.context, "fresh");
assert.match(validator.task, /\[PLANNER-ONLY ORACLE\]/);
assert.match(validator.task, /ORACLE_SUITE=full/);
assert.doesNotMatch(validator.task, /ORACLE_SUITE=bounded/);
assert.doesNotMatch(validator.task, /Do not run npm test/);
assert.equal(lastWorkerValidationPassed(undefined), false);
const unknownValidationReport = {
	status: "completed",
	validation: [],
};
assert.equal(lastWorkerValidationPassed(unknownValidationReport), false);
const failedWithoutValidation = {
	status: "failed",
	validation: [],
};
assert.equal(lastWorkerValidationPassed(failedWithoutValidation), false);

const boundedValidator = { agent: "oracle", task: "run tests" };
const passedReport = {
	status: "completed",
	validation: [{ status: "passed", exitCode: 0 }],
};
assert.equal(lastWorkerValidationPassed(passedReport), true);
const notRunReport = {
	status: "completed",
	validation: [{ status: "not-run", exitCode: 0 }],
};
assert.equal(lastWorkerValidationPassed(notRunReport), false);
const passedNonZeroReport = {
	status: "completed",
	validation: [{ status: "passed", exitCode: 1 }],
};
assert.equal(lastWorkerValidationPassed(passedNonZeroReport), false);
const contradictoryValidator = { agent: "oracle", task: "run tests" };
applyRoleDelegation(contradictoryValidator, {
	role: "validator",
	workerValidationPassed: false,
});
assert.match(contradictoryValidator.task, /ORACLE_SUITE=full/);
applyRoleDelegation(boundedValidator, { role: "validator", workerValidationPassed: true });
assert.match(boundedValidator.task, /ORACLE_SUITE=bounded/);
assert.doesNotMatch(boundedValidator.task, /ORACLE_SUITE=full/);

const reviewer = {
	agent: "worker",
	task: "Parent reasoning: I already decided this should pass.\nPlease rubber-stamp it.",
	context: "fork",
};
const packet = "[PLANNER-ONLY FRESH REVIEW]\nReturn a ReviewResult.";
const result = applyRoleDelegation(reviewer, { role: "reviewer", packet });
assert.equal(result.mutated, true);
assert.equal(reviewer.agent, "reviewer");
assert.equal(reviewer.context, "fresh");
assert.equal(reviewer.task, packet);
assert.doesNotMatch(reviewer.task, /rubber-stamp/);

const already = { agent: "reviewer", task: "review", context: "fresh" };
assert.equal(applyRoleDelegation(already, { role: "reviewer" }).mutated, false);
assert.equal(already.agent, "reviewer");

const reviewerSpec = {
	taskId: "T-20260831-009",
	objective: "review the parser",
	cwd: "/repo",
	role: "reviewer",
	scope: {},
	constraints: [],
	acceptanceCriteria: [],
	validation: { required: false },
	expectedEvidence: {},
	stopConditions: [],
};

{
	const payload = { agent: "worker", task: JSON.stringify(reviewerSpec) };
	prepareRoleDelegation(payload, () => undefined);
	assert.equal(payload.agent, "reviewer");
	assert.equal(payload.context, "fresh");
	assert.match(String(payload.task), /PLANNER-ONLY FRESH REVIEW/);
}

// A reviewer packet names the Task and carries Root's Git evidence
{
	const originalSpec = {
		...reviewerSpec,
		role: "worker",
		objective: "implement the parser",
		acceptanceCriteria: ["empty input returns []"],
	};
	const existing = {
		taskId: "T-20260831-009",
		spec: originalSpec,
		reports: [],
		reviews: [],
		overrides: [],
	};
	const payload = { agent: "reviewer", task: JSON.stringify(reviewerSpec) };
	prepareRoleDelegation(payload, () => existing, {
		git: { gitAvailable: true, head: "abc1234", diffCheck: "no whitespace errors" },
		evidence: "fresh",
	});
	assert.match(payload.task, /"reviewMode": "fresh"/);
	assert.match(payload.task, /"reportTaskId": "T-20260831-009"/);
	assert.match(payload.task, /"evidenceSummary": "fresh"/);
	assert.match(payload.task, /"gitAvailable": true/);
	// the packet shows the Task's original spec, never a reviewer spec
	assert.match(payload.task, /implement the parser/);
	assert.doesNotMatch(payload.task, /"role": "reviewer"/);
}

// Ticket 27 — workspaceDigest is omitted from ReviewRequest when the Task
// has a report but no bound snapshot. reportRevision is still present.
{
	const originalSpec = {
		...reviewerSpec,
		role: "worker",
		objective: "implement the parser",
		acceptanceCriteria: ["empty input returns []"],
	};
	const existing = {
		taskId: "T-20260831-027",
		spec: originalSpec,
		reports: [{
			version: 1,
			taskId: "T-20260831-027",
			status: "completed",
			summary: "done",
			changedFiles: ["src/parser.ts"],
			validation: [],
			evidence: {
				cwd: "/repo",
				taskId: "T-20260831-027",
				workerRunId: "call-27",
				gitAvailable: true,
				generatedAt: "2026-09-08T00:00:00.000Z",
			},
			risks: [],
			unresolved: [],
		}],
		reviews: [],
		overrides: [],
	};
	const payload = { agent: "reviewer", task: JSON.stringify(reviewerSpec) };
	prepareRoleDelegation(payload, () => existing);
	const request = extractReviewRequest(payload.task);
	assert.ok(request);
	assert.equal(request.reportRevision, 1);
	assert.equal("workspaceDigest" in request, false);
}

// The reviewer prompt no longer advertises tools the child cannot have
assert.doesNotMatch(reviewerPrompt("T-20260831-009"), /git_audit/);
assert.match(reviewerPrompt("T-20260831-009"), /Git evidence is supplied by Root/);

// Delegation targets: a ReviewRequest outranks an embedded TaskSpec
{
	const specPayload = {
		agent: "worker",
		task: JSON.stringify({ ...reviewerSpec, role: "worker", objective: "implement" }),
	};
	assert.equal(resolveDelegationTarget(specPayload, () => undefined).role, "worker");

	const request = {
		version: 1,
		taskId: "T-20260831-009",
		reportTaskId: "T-20260831-009",
		reviewMode: "fresh",
		taskSpec: { ...reviewerSpec, role: "worker" },
	};
	const packetPayload = { agent: "reviewer", task: `"reviewMode":"fresh"\n${JSON.stringify(request)}` };
	const target = resolveDelegationTarget(packetPayload, (taskId) => ({ taskId, spec: reviewerSpec }));
	assert.equal(target.role, "reviewer");
	assert.equal(target.taskId, "T-20260831-009");
}

// RF-7: a correction prompt that names one live Task binds to it
{
	const live = {
		taskId: "T-20260905-902",
		state: "changes_requested",
		cwd: "/repo",
		spec: { taskId: "T-20260905-902", role: "worker", objective: "implement", cwd: "/repo" },
	};
	const correction = {
		agent: "worker",
		task: "Do not modify files. Return only a valid WorkerReport for task T-20260905-902.",
	};
	const bound = resolveDelegationTarget(correction, (id) => id === live.taskId ? live : undefined);
	assert.equal(bound.role, "worker");
	assert.equal(bound.taskId, "T-20260905-902");
	assert.equal(bound.task.taskId, "T-20260905-902");
	assert.equal(bound.spec, undefined);
	assert.deepEqual(bound.namedTaskIds, ["T-20260905-902"]);
}

// Blocked and failed Tasks stay bindable for a prompt that names exactly one
// Task id: TASK_TRANSITIONS lets them return to executing. Only completed is
// excluded from rebinding.
{
	const makeTask = (state) => ({
		taskId: "T-20260905-904",
		state,
		cwd: "/repo",
		spec: { taskId: "T-20260905-904", role: "worker", objective: "implement", cwd: "/repo" },
	});
	const resume = {
		agent: "worker",
		task: "Resume task T-20260905-904 and unblock it.",
	};
	for (const state of ["blocked", "failed"]) {
		const bound = resolveDelegationTarget(resume, () => makeTask(state));
		assert.equal(bound.taskId, "T-20260905-904", state);
		assert.equal(bound.task.state, state);
		assert.equal(bound.spec, undefined);
		assert.deepEqual(bound.namedTaskIds, ["T-20260905-904"]);
	}
	const done = resolveDelegationTarget(resume, () => makeTask("completed"));
	assert.equal(done.taskId, undefined);
	assert.equal(done.task, undefined);
	assert.deepEqual(done.namedTaskIds, ["T-20260905-904"]);
}

// L-5: RF-7 named-id scanning resolves aliases through lookup
{
	const live = {
		taskId: "T-20260905-001",
		state: "changes_requested",
		cwd: "/repo",
		aliases: ["T-20260220-001"],
		spec: { taskId: "T-20260905-001", role: "worker", objective: "implement", cwd: "/repo" },
	};
	const lookup = (id) => (id === live.taskId || live.aliases.includes(id) ? live : undefined);
	const correction = {
		agent: "worker",
		task: "Do not modify files. Return only a valid WorkerReport for task T-20260220-001.",
	};
	const bound = resolveDelegationTarget(correction, lookup);
	assert.equal(bound.role, "worker");
	assert.equal(bound.task.taskId, "T-20260905-001");
	assert.equal(bound.taskId, "T-20260220-001");
	assert.deepEqual(bound.namedTaskIds, ["T-20260220-001"]);
}

{
	const two = {
		agent: "worker",
		task: "Look at T-20260905-001 and T-20260905-002 then continue.",
	};
	const target = resolveDelegationTarget(two, () => undefined);
	assert.equal(target.taskId, undefined);
	assert.deepEqual(target.namedTaskIds, ["T-20260905-001", "T-20260905-002"]);
}

// U-5 updated for floors: stricter wins, floors cannot be raised, missing dimensions completed
{
	const input = { agent: "worker", task: "implement" };
	const res = applyRoleDelegation(input, {
		role: "worker",
		budget: { tokens: 100_000, costUsd: 2.5 },
	});
	assert.equal(res.mutated, true);
	// Stricter floor 0.50 wins over 2.5
	assert.deepEqual(input.usageBudget, {
		tokens: { hard: 100_000 },
		costUsd: { hard: 0.50 },
	});
}

{
	const input = { agent: "worker", task: "implement" };
	applyRoleDelegation(input, {
		role: "worker",
		budget: { tokens: 50_000 },
	});
	// Missing costUsd completed by floor 0.50
	assert.deepEqual(input.usageBudget, {
		tokens: { hard: 50_000 },
		costUsd: { hard: 0.50 },
	});
}

{
	const input = { agent: "worker", task: "implement" };
	applyRoleDelegation(input, {
		role: "worker",
		budget: { costUsd: 0.75 },
	});
	// Missing tokens completed by floor 100_000, looser 0.75 clamped to floor 0.50
	assert.deepEqual(input.usageBudget, {
		tokens: { hard: 100_000 },
		costUsd: { hard: 0.50 },
	});
}

// Explicit usageBudget in the input: stricter wins per dimension
{
	const input = {
		agent: "worker",
		task: "implement",
		usageBudget: { tokens: { hard: 10_000 } },
	};
	const res = applyRoleDelegation(input, {
		role: "worker",
		budget: { tokens: 100_000, costUsd: 5.0 },
	});
	assert.equal(res.mutated, true);
	assert.deepEqual(input.usageBudget, {
		tokens: { hard: 10_000 },
		costUsd: { hard: 0.50 },
	});
	assert.match(input.task, /\[PLANNER-ONLY WORKER CONTRACT\]/);
}

// prepareRoleDelegation passes TaskSpec.budget through and clamps looser values
{
	const specWithBudget = {
		taskId: "T-20260905-b01",
		objective: "budgeted task",
		cwd: "/repo",
		role: "worker",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		expectedEvidence: {},
		stopConditions: [],
		budget: { tokens: 42_000, costUsd: 1.25 },
	};
	const payload = { agent: "worker", task: JSON.stringify(specWithBudget) };
	prepareRoleDelegation(payload, () => undefined);
	assert.deepEqual(payload.usageBudget, {
		tokens: { hard: 42_000 },
		costUsd: { hard: 0.50 },
	});
	assert.match(payload.task, /\[PLANNER-ONLY WORKER CONTRACT\]/);
	assert.match(payload.task, /budgeted task/);
}

{
	assert.equal(oracleSuiteMode({}), "bounded");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "full" }), "full");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "FULL" }), "full");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "bounded" }), "bounded");
}

{
	const bounded = wrapOracleContract("run tests", "bounded", true);
	assert.match(bounded, /\[PLANNER-ONLY ORACLE\]/);
	assert.match(bounded, /ORACLE_SUITE=bounded/);
	assert.match(bounded, /You MAY run only the test files named in the WorkerReport/);
	assert.match(bounded, /status must be exactly completed, partial, blocked, or failed/);
	assert.match(bounded, /validation status must be exactly passed, failed, or not-run/);
	assert.match(bounded, /Do not run npm test, npm run test:e2e, or the full suite/);
	assert.match(bounded, /Check git rev-parse HEAD and git status --porcelain/);
	assert.doesNotMatch(bounded, /ORACLE_SUITE=full/);
	assert.equal(wrapOracleContract(bounded, "bounded", true), bounded);

	const full = wrapOracleContract("run tests", "full", true);
	assert.match(full, /ORACLE_SUITE=full/);
	assert.doesNotMatch(full, /You MAY run only the test files named in the WorkerReport/);
	assert.doesNotMatch(full, /Do not run npm test, npm run test:e2e, or the full suite/);

	const failed = wrapOracleContract("run tests", "bounded", false);
	assert.match(failed, /ORACLE_SUITE=full/);

	const missing = wrapOracleContract("Validate T", "missing", false, ["npm run typecheck"]);
	assert.match(missing, /\[PLANNER-ONLY ORACLE\]/);
	assert.match(missing, /ORACLE_SUITE=missing/);
	assert.match(missing, /npm run typecheck/);
	assert.doesNotMatch(missing, /ORACLE_SUITE=full/);
	assert.doesNotMatch(missing, /ORACLE_SUITE=bounded/);
	assert.doesNotMatch(missing, /Re-run the listed validation commands/);
	assert.match(missing, /command restriction applies only to validation commands/);
	assert.match(missing, /source inspection and acceptance criterion/);
	assert.match(missing, /checked, reused, not-run, or failed/);
	assert.equal(wrapOracleContract(missing, "missing", false, ["npm run typecheck"]), missing);
}

{
	const fixtureSpec = {
		taskId: "T-20260907-043",
		objective: "validate fixture",
		cwd: process.cwd(),
		role: "worker",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: true, commands: ["npm test", "npm run typecheck"] },
		expectedEvidence: {},
		stopConditions: [],
	};
	const partialReport = {
		version: 1,
		taskId: "T-20260907-043",
		status: "completed",
		summary: "done",
		changedFiles: ["src/a.ts"],
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "tests pass" },
		],
		evidence: { taskId: "T-20260907-043" },
		risks: [],
		unresolved: [],
	};
	assert.deepEqual(
		missingTaskSpecValidationCommands(fixtureSpec, partialReport),
		["npm run typecheck"],
	);

	const fullReport = {
		...partialReport,
		validation: [
			{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "tests pass" },
			{ command: "npm run typecheck", type: "typecheck", status: "passed", exitCode: 0, summary: "typecheck pass" },
		],
	};
	assert.deepEqual(
		missingTaskSpecValidationCommands(fixtureSpec, fullReport),
		[],
	);

	const emptyReport = {
		...partialReport,
		validation: [],
	};
	assert.deepEqual(
		missingTaskSpecValidationCommands(fixtureSpec, emptyReport),
		["npm test", "npm run typecheck"],
	);
}

{
	const packet = wrapOracleContract(
		JSON.stringify({ taskId: "T-20260905-061", objective: "x", validation: { required: true, commands: ["npm test"] } }),
		"bounded",
		true,
	);
	const fromPacket = applyRoleDelegation(
		{ agent: "oracle", task: "Validate T-20260905-061" },
		{ role: "validator", packet },
	);
	assert.equal(fromPacket.oracleSuiteConflict, undefined, "injected TaskSpec packet must not count as Root full-suite prose");

	const fromRoot = applyRoleDelegation(
		{ agent: "oracle", task: "Validate T-20260905-061 by running npm test" },
		{ role: "validator", workerValidationPassed: true },
	);
	assert.equal(fromRoot.oracleSuiteConflict, true);
}

{
	const workerWrap = wrapWorkerContract("implement it", "T-20260831-001");
	assert.match(workerWrap, /\[PLANNER-ONLY WORKER CONTRACT\]/);
	assert.match(workerWrap, /Do not run \/code-review/);
	assert.match(workerWrap, /"taskId":"T-20260831-001"/);
	assert.match(workerWrap, /canonical Task id from your launch packet/);
	assert.match(workerWrap, /must not ask Root or supervisor for the taskId/);
	assert.match(workerWrap, /status must be exactly completed, partial, blocked, or failed/);
	assert.match(workerWrap, /validation status must be exactly passed, failed, or not-run/);
	assert.match(workerWrap, /final message must contain only the WorkerReport JSON/);
	assert.equal(wrapWorkerContract(workerWrap, "T-20260831-001"), workerWrap);
}

{
	const explorerPayload = { agent: "explorer", task: JSON.stringify({
		taskId: "T-20260911-001",
		objective: "inspect packet contract",
		cwd: "/repo",
		role: "explorer",
		scope: { allowedPaths: [] },
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: false },
		expectedEvidence: {},
		stopConditions: [],
	}) };
	prepareRoleDelegation(explorerPayload, () => undefined);
	assert.match(explorerPayload.task, /\[PLANNER-ONLY WORKER CONTRACT\]/);
	assert.match(explorerPayload.task, /canonical Task id from your launch packet/);
	assert.match(explorerPayload.task, /must not ask Root or supervisor for the taskId/);
	assert.match(explorerPayload.task, /status must be exactly completed, partial, blocked, or failed/);
	assert.match(explorerPayload.task, /validation status must be exactly passed, failed, or not-run/);
}

{
	const fullOracle = { agent: "oracle", task: "run tests" };
	applyRoleDelegation(fullOracle, { role: "validator", oracleMode: "full" });
	assert.match(fullOracle.task, /ORACLE_SUITE=full/);
	assert.match(fullOracle.task, /status must be exactly completed, partial, blocked, or failed/);
	assert.match(fullOracle.task, /validation status must be exactly passed, failed, or not-run/);
}

{
	const failedWorker = {
		taskId: "T-20260905-b02",
		spec: {
			taskId: "T-20260905-b02",
			objective: "implement",
			cwd: "/repo",
			role: "worker",
			scope: {},
			constraints: [],
			acceptanceCriteria: [],
			validation: { required: true, commands: ["npm test"] },
			expectedEvidence: {},
			stopConditions: [],
		},
		reports: [{
			version: 1,
			taskId: "T-20260905-b02",
			status: "completed",
			summary: "done",
			changedFiles: ["src/a.ts"],
			validation: [{ type: "test", status: "failed", summary: "npm test", exitCode: 1 }],
			evidence: { taskId: "T-20260905-b02" },
			risks: [],
			unresolved: [],
		}],
		reviews: [],
		overrides: [],
	};
	const payload = { agent: "oracle", task: JSON.stringify({
		taskId: "T-20260905-b02",
		objective: "validate",
		cwd: "/repo",
		role: "validator",
		scope: {},
		constraints: [],
		acceptanceCriteria: [],
		validation: { required: true, commands: ["npm test"] },
		expectedEvidence: {},
		stopConditions: [],
	}) };
	prepareRoleDelegation(payload, () => failedWorker);
	assert.match(payload.task, /ORACLE_SUITE=full/);
}

// Issue 03: Title alias in roles and invalid candidate guard
{
	const titlePrompt = `Please review:\n\`\`\`json\n${JSON.stringify({
		taskId: "oracle-status-line-01",
		title: "Roles title feature",
		acceptanceCriteria: ["roles test passes"],
	})}\n\`\`\``;
	const target = resolveDelegationTarget({ agent: "reviewer", task: titlePrompt }, () => undefined);
	assert.equal(target.role, "reviewer");
	assert.ok(target.spec !== undefined);
	assert.equal(target.spec.objective, "Roles title feature");
	assert.deepEqual(target.spec.acceptanceCriteria, ["roles test passes"]);

	const payload = { agent: "reviewer", task: titlePrompt };
	prepareRoleDelegation(payload, () => undefined);
	const request = extractReviewRequest(payload.task);
	assert.ok(request !== undefined);
	assert.equal(request.taskSpec?.objective, "Roles title feature");
	assert.deepEqual(request.taskSpec?.acceptanceCriteria, ["roles test passes"]);

	// Invalid candidate (missing objective) should not mutate rawInput
	const invalidPayload = { agent: "worker", task: `\`\`\`json\n{"taskId":"T-1","acceptanceCriteria":["x"]}\n\`\`\`` };
	const originalTask = invalidPayload.task;
	prepareRoleDelegation(invalidPayload, () => undefined);
	assert.equal(invalidPayload.task, originalTask, "invalid TaskSpec candidate does not trigger contract mutation");
}

// Issue 04: Worker and Validator fresh default, bounded execution packet without Root markers
{
	const unrelatedRootMarker = "UNRELATED_ROOT_CONVERSATION_HISTORY_MARKER_xyz987";
	const workerTask = `${unrelatedRootMarker}\nHere is the spec:\n\`\`\`json\n${JSON.stringify({
		taskId: "T-20260907-001",
		objective: "implement bounded packet",
		acceptanceCriteria: ["all tests pass"],
	})}\n\`\`\``;
	const workerPayload = { agent: "worker", task: workerTask, context: "fork" };
	prepareRoleDelegation(workerPayload, () => undefined);
	assert.equal(workerPayload.context, "fresh", "Worker context forced to fresh");
	assert.equal(workerPayload.__contextOverridden, true, "Worker context override flagged");
	assert.doesNotMatch(workerPayload.task, new RegExp(unrelatedRootMarker), "Root unrelated marker stripped from Worker packet");
	assert.match(workerPayload.task, /\[PLANNER-ONLY WORKER CONTRACT\]/, "Worker contract present");
	assert.match(workerPayload.task, /"taskId":\s*"T-20260907-001"/, "TaskSpec present in packet");

	const validatorTask = `${unrelatedRootMarker}\nPlease validate:\n\`\`\`json\n${JSON.stringify({
		taskId: "T-20260907-002",
		objective: "validate bounded packet",
		acceptanceCriteria: ["all tests pass"],
	})}\n\`\`\``;
	const validatorPayload = { agent: "oracle", task: validatorTask };
	prepareRoleDelegation(validatorPayload, () => undefined);
	assert.equal(validatorPayload.context, "fresh", "Validator context defaults to fresh");
	assert.doesNotMatch(validatorPayload.task, new RegExp(unrelatedRootMarker), "Root unrelated marker stripped from Validator packet");
	assert.match(validatorPayload.task, /\[PLANNER-ONLY ORACLE\]/, "Validator contract present");
	assert.match(validatorPayload.task, /"taskId":\s*"T-20260907-002"/, "TaskSpec present in packet");
}

// Issue 04: Context reuse handling (same-task vs cross-task vs root history vs unverified)
{
	const mockPreviousTask = {
		taskId: "T-20260907-reuse-1",
		cwd: "/repo",
		state: "changes_requested",
		reports: [{
			version: 1,
			taskId: "T-20260907-reuse-1",
			status: "completed",
			changedFiles: ["foo.ts"],
			evidence: ["npm test passed"],
			validation: [],
		}],
		baseEvidence: { workerRunId: "run-001", finalGitRef: "git-ref-1" },
		lastComparison: { diff: "changed foo.ts" },
		aliases: [],
		reviews: [],
		overrides: [],
	};

	// 1. Same-task explicit reuse succeeds and enters packet
	const sameTaskPayload = {
		agent: "worker",
		task: `\`\`\`json\n{"taskId":"T-20260907-reuse-1","objective":"fix bug"}\n\`\`\``,
		reuseTaskId: "T-20260907-reuse-1",
	};
	prepareRoleDelegation(sameTaskPayload, (id) => id === "T-20260907-reuse-1" ? mockPreviousTask : undefined);
	assert.equal(sameTaskPayload.context, "fresh", "remains fresh bounded context");
	assert.match(sameTaskPayload.task, /\[PLANNER-ONLY REUSED TASK CONTEXT\]/, "previous context injected into packet");
	assert.match(sameTaskPayload.task, /foo\.ts/, "previous report details in packet");
	assert.equal(sameTaskPayload.__reuseOutcome?.reused, true);

	// 2. Cross-task explicit reuse is rejected and falls back to fresh
	const crossTaskPayload = {
		agent: "worker",
		task: `\`\`\`json\n{"taskId":"T-20260907-reuse-1","objective":"fix bug"}\n\`\`\``,
		reuseTaskId: "T-OTHER-TASK",
	};
	prepareRoleDelegation(crossTaskPayload, (id) => id === "T-20260907-reuse-1" ? mockPreviousTask : undefined);
	assert.equal(crossTaskPayload.context, "fresh");
	assert.doesNotMatch(crossTaskPayload.task, /\[PLANNER-ONLY REUSED TASK CONTEXT\]/);
	assert.equal(crossTaskPayload.__reuseOutcome?.reused, false);
	assert.match(crossTaskPayload.__reuseOutcome?.reason, /does not match canonical task/);

	// 3. Root history requested is rejected and falls back to fresh
	const rootForkPayload = {
		agent: "worker",
		task: `\`\`\`json\n{"taskId":"T-20260907-reuse-1","objective":"fix bug"}\n\`\`\``,
		context: "fork",
		reuseRootHistory: true,
	};
	prepareRoleDelegation(rootForkPayload, (id) => id === "T-20260907-reuse-1" ? mockPreviousTask : undefined);
	assert.equal(rootForkPayload.context, "fresh");
	assert.equal(rootForkPayload.__contextOverridden, true);
	assert.equal(rootForkPayload.__reuseOutcome?.reused, false);
	assert.match(rootForkPayload.__reuseOutcome?.reason, /Root history cannot be reused/);

	// 4. Unverifiable context (no previous task or report) is rejected and falls back to fresh
	const missingReportPayload = {
		agent: "worker",
		task: `\`\`\`json\n{"taskId":"T-20260907-reuse-2","objective":"fix bug"}\n\`\`\``,
		reuseTaskId: "T-20260907-reuse-2",
	};
	prepareRoleDelegation(missingReportPayload, () => undefined);
	assert.equal(missingReportPayload.context, "fresh");
	assert.equal(missingReportPayload.__reuseOutcome?.reused, false);
	assert.match(missingReportPayload.__reuseOutcome?.reason, /cannot verify previous execution context/);
}

// Issue 04: Reviewer behaviour remains unchanged
{
	const reviewerSpec = {
		taskId: "T-20260907-rev-1",
		objective: "review changes",
		role: "reviewer",
	};
	const reviewerPayload = {
		agent: "reviewer",
		task: JSON.stringify(reviewerSpec),
	};
	prepareRoleDelegation(reviewerPayload, () => undefined);
	assert.equal(reviewerPayload.agent, "reviewer");
	assert.equal(reviewerPayload.context, "fresh");
	assert.match(reviewerPayload.task, /\[PLANNER-ONLY FRESH REVIEW\]/);
}

// Issue 04 / Defect 2: Private fields and caller reuse keys stripped before handing to host
{
	const payloadWithKeys = {
		agent: "worker",
		task: "implement feature",
		reuseTaskId: "T-1",
		reuseContext: "T-1",
		reuseRootHistory: true,
		reuse: true,
		__reuseOutcome: { reused: true, reason: "ok" },
		__contextOverridden: true,
	};
	stripDelegationKeys(payloadWithKeys);
	for (const key of STRIPPED_DELEGATION_KEYS) {
		assert.equal(key in payloadWithKeys, false, `key ${key} must be stripped`);
	}
	assert.equal(payloadWithKeys.agent, "worker");
	assert.equal(payloadWithKeys.task, "implement feature");
}

// ----------------------------------------------------------------------
// Issue 05: Default floors for bounded delegations, initial worker, and stricter resolution
// ----------------------------------------------------------------------

// Checkbox 1: Bounded report correction (worker + reports.length > 0) gets toolBudget.hard=20 and usageBudget floors
{
	const taskRecordWithReports = {
		taskId: "T-20260907-corr-1",
		cwd: "/test",
		spec: { taskId: "T-20260907-corr-1", objective: "fix report", role: "worker" },
		reports: [{
			version: 1,
			taskId: "T-20260907-corr-1",
			status: "completed",
			summary: "initial report",
			changedFiles: [],
			validation: [],
			evidence: { cwd: "/test", taskId: "T-20260907-corr-1", workerRunId: "run-1" },
		}],
	};
	const payload = {
		agent: "worker",
		task: JSON.stringify({ taskId: "T-20260907-corr-1", objective: "fix report", role: "worker" }),
	};
	prepareRoleDelegation(payload, (id) => id === "T-20260907-corr-1" ? taskRecordWithReports : undefined);
	assert.deepEqual(payload.toolBudget, { hard: 20 });
	assert.deepEqual(payload.usageBudget, {
		tokens: { hard: 40_000 },
		costUsd: { hard: 0.10 },
	});
	assert.deepEqual(payload.__floorLimits?.toolBudget, { value: 20, source: "floor" });
	assert.deepEqual(payload.__floorLimits?.tokens, { value: 40_000, source: "floor" });
	assert.deepEqual(payload.__floorLimits?.costUsd, { value: 0.10, source: "floor" });
}

// Checkbox 2: Validator & Explorer get toolBudget.hard=20 and usageBudget floors; initial worker has no toolBudget floor
{
	// Explorer
	const explorerPayload = { agent: "explorer", task: "investigate repo" };
	prepareRoleDelegation(explorerPayload, () => undefined);
	assert.deepEqual(explorerPayload.toolBudget, { hard: 20 });
	assert.deepEqual(explorerPayload.usageBudget, {
		tokens: { hard: 40_000 },
		costUsd: { hard: 0.10 },
	});

	// Validator (oracle)
	const validatorPayload = { agent: "validator", task: "run tests" };
	prepareRoleDelegation(validatorPayload, () => undefined);
	assert.deepEqual(validatorPayload.toolBudget, { hard: 20 });
	assert.deepEqual(validatorPayload.usageBudget, {
		tokens: { hard: 40_000 },
		costUsd: { hard: 0.10 },
	});

	// Worker initial (no prior reports)
	const initialWorkerPayload = {
		agent: "worker",
		task: JSON.stringify({ taskId: "T-20260907-init-1", objective: "do work", role: "worker" }),
	};
	prepareRoleDelegation(initialWorkerPayload, () => undefined);
	assert.equal(initialWorkerPayload.toolBudget, undefined, "initial worker must not have default toolBudget floor");
	assert.deepEqual(initialWorkerPayload.usageBudget, {
		tokens: { hard: 100_000 },
		costUsd: { hard: 0.50 },
	});
	assert.deepEqual(initialWorkerPayload.__floorLimits?.tokens, { value: 100_000, source: "floor" });
	assert.deepEqual(initialWorkerPayload.__floorLimits?.costUsd, { value: 0.50, source: "floor" });

	// Worker without any TaskSpec embedded also receives default initial usage floor (no zero guardrail)
	const noSpecWorkerPayload = { agent: "worker", task: "implement something without spec" };
	prepareRoleDelegation(noSpecWorkerPayload, () => undefined);
	assert.equal(noSpecWorkerPayload.toolBudget, undefined);
	assert.deepEqual(noSpecWorkerPayload.usageBudget, {
		tokens: { hard: 100_000 },
		costUsd: { hard: 0.50 },
	});
}

// Checkbox 3: Stricter caller vs stricter TaskSpec vs looser both
{
	// Caller more strict
	const callerStrict = {
		agent: "worker",
		task: JSON.stringify({ taskId: "T-1", objective: "work", role: "worker" }),
		usageBudget: { tokens: { hard: 30_000 }, costUsd: { hard: 0.20 } },
	};
	prepareRoleDelegation(callerStrict, () => undefined);
	assert.deepEqual(callerStrict.usageBudget, {
		tokens: { hard: 30_000 },
		costUsd: { hard: 0.20 },
	});
	assert.equal(callerStrict.__floorLimits?.tokens.source, "caller");
	assert.equal(callerStrict.__floorLimits?.costUsd.source, "caller");

	// TaskSpec more strict
	const specStrict = {
		agent: "worker",
		task: JSON.stringify({
			taskId: "T-2",
			objective: "work",
			role: "worker",
			budget: { tokens: 25_000, costUsd: 0.15 },
		}),
	};
	prepareRoleDelegation(specStrict, () => undefined);
	assert.deepEqual(specStrict.usageBudget, {
		tokens: { hard: 25_000 },
		costUsd: { hard: 0.15 },
	});
	assert.equal(specStrict.__floorLimits?.tokens.source, "taskSpec");
	assert.equal(specStrict.__floorLimits?.costUsd.source, "taskSpec");

	// Both looser -> floor wins, neither caller nor spec raises floor
	const bothLooser = {
		agent: "worker",
		task: JSON.stringify({
			taskId: "T-3",
			objective: "work",
			role: "worker",
			budget: { tokens: 500_000, costUsd: 5.0 },
		}),
		usageBudget: { tokens: { hard: 200_000 }, costUsd: { hard: 2.0 } },
	};
	prepareRoleDelegation(bothLooser, () => undefined);
	assert.deepEqual(bothLooser.usageBudget, {
		tokens: { hard: 100_000 },
		costUsd: { hard: 0.50 },
	});
	assert.equal(bothLooser.__floorLimits?.tokens.source, "floor");
	assert.equal(bothLooser.__floorLimits?.costUsd.source, "floor");
}

// Checkbox 4: Source literals and summary format
{
	const mixedPayload = {
		agent: "validator",
		task: "run check",
		toolBudget: { hard: 10 },
		usageBudget: { tokens: { hard: 20_000 } },
	};
	prepareRoleDelegation(mixedPayload, () => undefined);
	assert.deepEqual(mixedPayload.__floorLimits?.toolBudget, { value: 10, source: "caller" });
	assert.deepEqual(mixedPayload.__floorLimits?.tokens, { value: 20_000, source: "caller" });
	assert.deepEqual(mixedPayload.__floorLimits?.costUsd, { value: 0.10, source: "floor" });
}

// RR-04: worker packets preserve the direct instructions and expose a stable
// structured envelope; applying the role wrapper a second time is idempotent.
{
	const spec = createTaskSpec({
		taskId: "T-20260911-901",
		objective: "prepare the handoff",
		cwd: process.cwd(),
		role: "worker",
		constraints: ["keep the symlink"],
		scope: { allowedPaths: ["docs/handoff.md"] },
	});
	const payload = {
		agent: "worker",
		task: `Retain the verified count and run the smoke check.\n${JSON.stringify(spec)}`,
	};
	prepareRoleDelegation(payload, () => undefined);
	const firstPacketText = payload.task.slice(0, payload.task.indexOf("\n\n[PLANNER-ONLY WORKER CONTRACT]"));
	const firstPacket = JSON.parse(firstPacketText);
	assert.equal(firstPacket.version, 1);
	assert.equal(firstPacket.spec.taskId, spec.taskId);
	assert.match(firstPacket.instructions, /verified count/);
	assert.deepEqual(firstPacket.knownFacts, ["keep the symlink"]);
	assert.deepEqual(firstPacket.artifactRefs, ["docs/handoff.md"]);
	assert.ok(extractTaskPacket(firstPacketText));
	prepareRoleDelegation(payload, () => undefined);
	const secondPacketText = payload.task.slice(0, payload.task.indexOf("\n\n[PLANNER-ONLY WORKER CONTRACT]"));
	assert.deepEqual(JSON.parse(secondPacketText), firstPacket);
}

console.log("planner-only roles: PASS");
