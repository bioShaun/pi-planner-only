import assert from "node:assert/strict";
import { ROLE_AGENTS, buildTaskPacket, lastWorkerValidationPassed, missingTaskSpecValidationCommands, oracleSuiteMode } from "./roles.ts";
import { createTaskSpec } from "./task.ts";
import { reviewerPrompt } from "./review.ts";


assert.deepEqual(
	missingTaskSpecValidationCommands(
		createTaskSpec({ objective: "file check does not cover test", cwd: process.cwd(), validation: { commands: ["npm test"] } }),
		{ validation: [{ command: "test -f src/parser.test.ts", status: "passed", exitCode: 0 }] },
	),
	["npm test"],
);

// Explicit worker-declared passes retain both gates.
{
	const explicit = { status: "completed", validation: [{ command: "npm test", status: "passed", exitCode: 0 }] };
	const spec = createTaskSpec({ objective: "explicit validation", cwd: process.cwd(), validation: { commands: ["npm test"] } });
	assert.equal(lastWorkerValidationPassed(explicit), true);
	assert.deepEqual(missingTaskSpecValidationCommands(spec, explicit), []);
}


assert.equal(ROLE_AGENTS.explorer, "scout");
assert.equal(ROLE_AGENTS.reviewer, "reviewer");
assert.equal(ROLE_AGENTS.validator, "oracle");
assert.equal(ROLE_AGENTS.worker, undefined);


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

// The reviewer prompt no longer advertises tools the child cannot have
assert.doesNotMatch(reviewerPrompt("T-20260831-009"), /git_audit/);
assert.match(reviewerPrompt("T-20260831-009"), /Git evidence is supplied by Root/);


{
	assert.equal(oracleSuiteMode({}), "bounded");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "full" }), "full");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "FULL" }), "full");
	assert.equal(oracleSuiteMode({ PI_PLANNER_ONLY_ORACLE: "bounded" }), "bounded");
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


console.log("planner-only roles: PASS");
