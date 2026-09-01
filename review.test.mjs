import assert from "node:assert/strict";
import {
	TaskStore,
	createTaskSpec,
} from "./task.ts";
import { extractWorkerReport } from "./report.ts";
import {
	decideReview,
	deriveVerdict,
	extractReviewResult,
	summarizeFindings,
	validateReviewResult,
	validateReviewResultIdentity,
	buildFreshReviewerTask,
	buildReviewRequest,
	extractReviewRequest,
	validateReviewRequest,
	applyReviewDecision,
} from "./review.ts";
import { compareEvidence } from "./evidence.ts";
import { MAX_REVIEW_ROUNDS } from "./types.ts";

const CWD = "/repo";

function makeReport(overrides = {}) {
	return {
		version: 1,
		taskId: "T-20260831-001",
		status: "completed",
		summary: "Implemented the parser.",
		changedFiles: ["src/parser.ts"],
		validation: [{ command: "npm test", type: "test", status: "passed", exitCode: 0, summary: "42 passed" }],
		evidence: {
			cwd: CWD,
			taskId: "T-20260831-001",
			workerRunId: "call-1",
			finalGitRef: "abc1234",
			gitStatusHash: "hash-one",
			changedPaths: ["src/parser.ts"],
			gitAvailable: true,
			generatedAt: "2026-08-31T10:00:00.000Z",
		},
		risks: [],
		unresolved: [],
		...overrides,
	};
}

function makeReview(verdict, findings = [], summary = "looks good") {
	return {
		taskId: "T-20260831-001",
		verdict,
		summary,
		findings,
		evidenceFresh: true,
	};
}

function finding(severity, category = "correctness") {
	return { severity, category, description: `${severity} finding`, requestedChange: "fix it" };
}

function apply(store, taskId, decision) {
	return applyReviewDecision(store, taskId, decision);
}

function newTask() {
	const store = new TaskStore();
	const task = store.create(createTaskSpec({ objective: "x", cwd: CWD }, "T-20260831-001"));
	store.transition(task.taskId, "executing");
	return store;
}

// --------------------------------------------------------------------------
// Verdict derivation (§8.1)
// --------------------------------------------------------------------------

assert.equal(deriveVerdict([]), "pass");
assert.equal(deriveVerdict([finding("info")]), "pass");
assert.equal(deriveVerdict([finding("minor"), finding("info")]), "pass");
assert.equal(deriveVerdict([finding("major")]), "request_changes");
assert.equal(deriveVerdict([finding("blocker")]), "request_changes");
assert.equal(deriveVerdict([finding("minor"), finding("blocker")]), "request_changes");

// --------------------------------------------------------------------------
// ReviewResult validation
// --------------------------------------------------------------------------

assert.deepEqual(validateReviewResult(makeReview("pass")), []);
assert.ok(validateReviewResult({ ...makeReview("pass"), verdict: "maybe" }).length > 0);
assert.ok(validateReviewResult({ ...makeReview("pass"), evidenceFresh: "yes" }).length > 0);
assert.ok(validateReviewResult({ ...makeReview("pass"), findings: [{}] }).length > 0);
assert.ok(validateReviewResult({ ...makeReview("pass"), findings: [finding("critical")] }).length > 0);

assert.deepEqual(extractReviewResult("no json here").error, "reviewer output did not contain a ReviewResult object");
assert.deepEqual(extractReviewResult("").error, "reviewer returned no output");
assert.deepEqual(extractReviewResult(JSON.stringify(makeReview("pass"))).review, makeReview("pass"));
assert.deepEqual(
	extractReviewResult(`Sure:\n\`\`\`json\n${JSON.stringify(makeReview("request_changes", [finding("major")]))}\n\`\`\``).review,
	makeReview("request_changes", [finding("major")]),
);
assert.ok(extractReviewResult(JSON.stringify(makeReview("nope"))).error);
// a WorkerReport is not a ReviewResult
assert.ok(extractReviewResult(JSON.stringify(makeReport())).error);

assert.deepEqual(summarizeFindings([]), ["Findings: (none)"]);
assert.match(summarizeFindings([finding("major", "test")]).join("\n"), /\[major\] test: major finding → requested: fix it/);

// --------------------------------------------------------------------------
// Happy path: pass on the first review
// --------------------------------------------------------------------------

{
	const store = newTask();
	const report = makeReport();
	let decision = decideReview({ task: store.require("T-20260831-001"), report });
	assert.equal(decision.action, "review_pending", "no verdict means no silent accept");

	decision = decideReview({ task: store.require("T-20260831-001"), report, review: makeReview("pass") });
	assert.equal(decision.action, "accept");
	assert.equal(decision.nextState, "completed");
	assert.equal(decision.consumesRound, false);
	assert.equal(apply(store, "T-20260831-001", decision).state, "completed");
}

// --------------------------------------------------------------------------
// One correction, then pass (§7 state sequence)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const report = makeReport();
	store.recordReport("T-20260831-001", report);

	let decision = decideReview({
		task: store.require("T-20260831-001"),
		report,
		review: makeReview("request_changes", [finding("major")], "test is missing"),
	});
	assert.equal(decision.action, "request_changes");
	assert.equal(decision.nextState, "changes_requested");
	assert.equal(decision.consumesRound, true);
	assert.equal(apply(store, "T-20260831-001", decision).state, "changes_requested");
	assert.equal(store.require("T-20260831-001").reviewRound, 1);

	// re-delegation returns to executing, then the second report passes
	store.transition("T-20260831-001", "executing");
	decision = decideReview({ task: store.require("T-20260831-001"), report, review: makeReview("pass") });
	assert.equal(decision.action, "accept");
	assert.equal(apply(store, "T-20260831-001", decision).state, "completed");
	assert.equal(store.require("T-20260831-001").reviewRound, 1, "accepting does not consume a round");
}

// --------------------------------------------------------------------------
// Max review rounds -> blocked (§7.1)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const report = makeReport();
	for (let round = 0; round < MAX_REVIEW_ROUNDS; round += 1) {
		const decision = decideReview({
			task: store.require("T-20260831-001"),
			report,
			review: makeReview("request_changes", [finding("major")], `round ${round}`),
		});
		assert.equal(decision.action, "request_changes");
		apply(store, "T-20260831-001", decision);
		assert.equal(store.require("T-20260831-001").state, "changes_requested");
		store.transition("T-20260831-001", "executing");
	}
	assert.equal(store.require("T-20260831-001").reviewRound, MAX_REVIEW_ROUNDS);

	const exhausted = decideReview({
		task: store.require("T-20260831-001"),
		report,
		review: makeReview("request_changes", [finding("blocker")], "still broken"),
	});
	assert.equal(exhausted.action, "blocked");
	assert.equal(exhausted.nextState, "blocked");
	assert.equal(exhausted.consumesRound, false);
	assert.match(exhausted.guidance.join("\n"), /Report to the user/);
	assert.equal(apply(store, "T-20260831-001", exhausted).state, "blocked");
}

// --------------------------------------------------------------------------
// Worker blocked is not worker failed (§19.2)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const decision = decideReview({
		task: store.require("T-20260831-001"),
		report: makeReport({ status: "blocked", summary: "missing credentials" }),
	});
	assert.equal(decision.action, "blocked");
	assert.equal(decision.nextState, "blocked");
	assert.equal(decision.consumesRound, false);
	assert.match(decision.guidance.join("\n"), /is not a failed worker/);
}

// --------------------------------------------------------------------------
// Worker failed -> bounded retry (§19.1)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const failed = makeReport({ status: "failed", summary: "npm test exited 1" });
	let decision = decideReview({ task: store.require("T-20260831-001"), report: failed });
	assert.equal(decision.action, "request_changes");
	assert.equal(decision.consumesRound, true);
	assert.match(decision.reason, /npm test exited 1/);
	apply(store, "T-20260831-001", decision);

	for (let round = 1; round < MAX_REVIEW_ROUNDS; round += 1) {
		store.transition("T-20260831-001", "executing");
		apply(store, "T-20260831-001", decideReview({ task: store.require("T-20260831-001"), report: failed }));
	}
	store.transition("T-20260831-001", "executing");
	const exhausted = decideReview({ task: store.require("T-20260831-001"), report: failed });
	assert.equal(exhausted.action, "blocked");
	assert.match(exhausted.reason, /failed repeatedly/);
}

// --------------------------------------------------------------------------
// Malformed report (§19.3)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const extracted = extractWorkerReport("I could not finish, sorry.");
	assert.ok(extracted.error);

	let decision = decideReview({
		task: store.require("T-20260831-001"),
		reportError: extracted.error,
	});
	assert.equal(decision.action, "report_correction");
	assert.equal(decision.consumesRound, true);
	assert.match(decision.guidance.join("\n"), /Do not modify files/);
	apply(store, "T-20260831-001", decision);

	store.transition("T-20260831-001", "executing");
	decision = decideReview({ task: store.require("T-20260831-001"), reportError: "still broken" });
	assert.equal(decision.action, "blocked");
	assert.match(decision.reason, /could not be obtained/);
}

// --------------------------------------------------------------------------
// Stale evidence cannot pass (§10.2)
// --------------------------------------------------------------------------

{
	const store = newTask();
	const report = makeReport();
	const current = {
		cwd: CWD,
		taskId: "T-20260831-001",
		workerRunId: "call-1",
		finalGitRef: "def5678",
		gitStatusHash: "hash-two",
		changedPaths: ["src/parser.ts"],
		gitAvailable: true,
		generatedAt: "2026-08-31T11:00:00.000Z",
	};
	const comparison = compareEvidence(report, current);
	assert.equal(comparison.fresh, false);

	// even an explicit pass is overridden by stale evidence
	const decision = decideReview({
		task: store.require("T-20260831-001"),
		report,
		comparison,
		review: makeReview("pass"),
	});
	assert.equal(decision.action, "revalidate");
	assert.equal(decision.nextState, "changes_requested");
	assert.equal(decision.consumesRound, true);
	assert.match(decision.reason, /evidence is stale/);
	assert.match(decision.guidance.join("\n"), /re-delegate validation/);
}

// unrelated out-of-scope drift lets review continue
{
	const store = newTask();
	const report = makeReport();
	const comparison = compareEvidence(report, {
		cwd: CWD,
		taskId: "T-20260831-001",
		workerRunId: "call-1",
		finalGitRef: "abc1234",
		gitStatusHash: "hash-two",
		changedPaths: ["src/parser.ts", "docs/readme.md"],
		gitAvailable: true,
		generatedAt: "2026-08-31T11:00:00.000Z",
	});
	assert.equal(comparison.fresh, false);
	const decision = decideReview({
		task: store.require("T-20260831-001"),
		report,
		comparison,
		review: makeReview("pass"),
	});
	assert.equal(decision.action, "accept");
}

// --------------------------------------------------------------------------
// Root override is recorded, not silent (§12)
// --------------------------------------------------------------------------

{
	const store = newTask();
	store.recordReview("T-20260831-001", makeReview("request_changes", [finding("major")]));
	store.recordOverride("T-20260831-001", {
		reviewerVerdict: "request_changes",
		rootVerdict: "pass",
		reason: "the finding is out of scope for this task",
	});
	const overrides = store.require("T-20260831-001").overrides;
	assert.equal(overrides.length, 1);
	assert.equal(overrides[0].reviewerVerdict, "request_changes");
	assert.equal(overrides[0].rootVerdict, "pass");
	assert.match(overrides[0].reason, /out of scope/);
}

// --------------------------------------------------------------------------
// Fresh reviewer packet: a ReviewRequest, never the parent's transcript
// --------------------------------------------------------------------------

{
	const spec = createTaskSpec({
		objective: "review the parser",
		cwd: CWD,
		role: "worker",
		acceptanceCriteria: ["empty input returns []"],
	});
	const git = { gitAvailable: true, head: "abc1234", diffCheck: "(no whitespace errors)" };
	const packet = buildFreshReviewerTask({
		taskId: spec.taskId,
		spec,
		report: makeReport(),
		evidence: "fresh",
		git,
	});
	assert.match(packet, /\[PLANNER-ONLY FRESH REVIEW\]/);
	assert.match(packet, new RegExp(`isolated reviewer for task ${spec.taskId}`));
	assert.match(packet, /empty input returns \[\]/);
	assert.match(packet, /Implemented the parser/);
	assert.doesNotMatch(packet, /rubber-stamp|I already decided/);

	// the packet is a parseable ReviewRequest carrying the original spec
	const embedded = extractReviewRequest(packet);
	assert.deepEqual(embedded, {
		version: 1,
		taskId: spec.taskId,
		reportTaskId: "T-20260831-001",
		reviewMode: "fresh",
		taskSpec: spec,
		workerReport: makeReport(),
		evidenceSummary: "fresh",
		evidencePacket: git,
	});
	assert.equal(extractReviewRequest("no packet here"), undefined);
	assert.deepEqual(validateReviewRequest({ ...embedded, reviewMode: "root" }).length, 1);
}

{
	const request = buildReviewRequest({
		taskId: "T-20260831-001",
		report: makeReport(),
		evidence: "stale (revalidate)",
	});
	assert.equal(request.version, 1);
	assert.equal(request.reviewMode, "fresh");
	assert.equal(request.reportTaskId, "T-20260831-001");
	assert.equal(request.evidenceSummary, "stale (revalidate)");
	assert.equal("taskSpec" in request, false);
	// without a report the request still names the task it reviews
	assert.equal(buildReviewRequest({ taskId: "T-20260831-002" }).reportTaskId, "T-20260831-002");
}

// --------------------------------------------------------------------------
// ReviewResult task identity (§P0-2)
// --------------------------------------------------------------------------

assert.deepEqual(validateReviewResultIdentity(makeReview("pass"), "T-20260831-001"), []);
assert.match(
	validateReviewResultIdentity(makeReview("pass"), "T-20260831-999").join(""),
	/ReviewResult taskId mismatch: expected T-20260831-999, got T-20260831-001/,
);

console.log("planner-only review: PASS");
