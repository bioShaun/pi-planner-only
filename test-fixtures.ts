/**
 * Frozen minimal test fixtures for E01-E05 runtime events.
 *
 * Grounded in the session 12:25 (01a0906e-7b39-716c-ae11-3e903f249b4f) audit
 * and optimization spec (RS-05 / A19).
 */

export interface E01Finding {
	taskId: string;
	runId: string;
	detectedAt: string;
	paths: string[];
	isNew: boolean;
	historical?: boolean;
	logLine: number;
}

export interface E02RunInterception {
	uuidPrefix: string;
	interceptedLines: number[];
	count: number;
	metaExitCode: number;
}

export interface E03LimitRun {
	sessionUuidPrefix: string;
	hostRunId: string;
	exitCode: number;
	stopReason: string;
	error: string;
	turns: number;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
	};
}

export interface E04LaunchReceipt {
	toolCallId: string;
	runId: string;
	taskId: string;
	launchTime: string;
	actualReportTime?: string;
	launchReceiptText: string;
	launchDetails: Record<string, unknown>;
}

export interface E04CrossWorkspaceRecord {
	runId: string;
	recordFile: string;
	foreignWorkspace: string;
	executionState: string;
	ingestionState: string;
	childExitTime: string;
}

export interface E05ModelChainItem {
	taskId: string;
	requestedModel?: string;
	hostDefaultModel: string;
	hostOverrideModel: string;
	actualModel: string;
}

/** E01: Read-only false undeclared attribution (4 new executions + 1 historical echo). */
export const E01_FIXTURE = Object.freeze({
	historicalFindings: Object.freeze([
		{
			taskId: "T-20260911-001",
			runId: "baa3c241-1f9f-4fcb-bb1b-3dd4c9cb9f23",
			detectedAt: "2026-09-11T09:53:24.890Z",
			paths: ["orchestrate.ts"],
			isNew: false,
			historical: true,
			logLine: 51,
		},
	]),
	newFindings: Object.freeze([
		{
			taskId: "T-20260911-004",
			runId: "801f40d3-08d7-4c9c-aadf-9cad60107273",
			detectedAt: "2026-09-11T12:42:48.621Z",
			paths: ["task.ts"],
			isNew: true,
			logLine: 83,
		},
		{
			taskId: "T-20260911-009",
			runId: "2f084856-0be7-4067-8919-bae1b70e3164",
			detectedAt: "2026-09-11T13:22:58.424Z",
			paths: ["task.ts", "types.ts"],
			isNew: true,
			logLine: 542,
		},
		{
			taskId: "T-20260911-010",
			runId: "856510f9-7e42-4f0b-9e2b-37ece84ffdf2",
			detectedAt: "2026-09-11T13:23:08.649Z",
			paths: [
				"CHANGELOG.md",
				"README.md",
				"architecture.test.mjs",
				"docs/runtime-reliability-2026-09-11-progress.md",
				"index.test.mjs",
				"index.ts",
				"orchestrate.test.mjs",
				"orchestrate.ts",
				"policy.test.mjs",
				"policy.ts",
				"report.test.mjs",
				"report.ts",
				"review.test.mjs",
				"review.ts",
				"role-models.test.mjs",
				"role-models.ts",
				"roles.test.mjs",
				"roles.ts",
			],
			isNew: true,
			logLine: 547,
		},
		{
			taskId: "T-20260911-012",
			runId: "ece875b9-ce14-4a20-824c-ed1f368e8424",
			detectedAt: "2026-09-11T13:34:30.193Z",
			paths: [
				"completion.ts",
				"index.ts",
				"notify.ts",
				"orchestrate.ts",
				"package.json",
				"policy.ts",
				"roles.ts",
				"task.ts",
				"types.ts",
				"usage.ts",
			],
			isNew: true,
			logLine: 569,
		},
	]),
});

/** E02: Tool budget hard limit reached (36 actual interceptions across 12 runs). */
export const E02_FIXTURE = Object.freeze({
	runs: Object.freeze([
		{ uuidPrefix: "557ee6be", interceptedLines: [37], count: 1, metaExitCode: 0 },
		{ uuidPrefix: "7f6f34c2", interceptedLines: [39], count: 1, metaExitCode: 0 },
		{ uuidPrefix: "a7f12b58", interceptedLines: [41, 42], count: 2, metaExitCode: 0 },
		{ uuidPrefix: "dfacf32b", interceptedLines: [37, 39], count: 2, metaExitCode: 0 },
		{ uuidPrefix: "1b6b7461", interceptedLines: [31, 32, 42, 43], count: 4, metaExitCode: 0 },
		{ uuidPrefix: "7a15f015", interceptedLines: [30], count: 1, metaExitCode: 0 },
		{ uuidPrefix: "3e711f6d", interceptedLines: [31, 32, 33, 34, 35, 36], count: 6, metaExitCode: 0 },
		{ uuidPrefix: "ab3ffc7c", interceptedLines: [31, 32, 33, 34, 35], count: 5, metaExitCode: 0 },
		{ uuidPrefix: "339ff9bf", interceptedLines: [32, 33, 34, 35, 36], count: 5, metaExitCode: 0 },
		{ uuidPrefix: "293a8707", interceptedLines: [33, 34, 35, 36, 37], count: 5, metaExitCode: 0 },
		{ uuidPrefix: "88ecfa6d", interceptedLines: [32, 33, 34], count: 3, metaExitCode: 0 },
		{ uuidPrefix: "27e93913", interceptedLines: [34], count: 1, metaExitCode: 0 },
	]),
});

/** E03: Kimi 403 usage limit (2 independent runs, five-hour usage limit). */
export const E03_FIXTURE = Object.freeze({
	runs: Object.freeze([
		{
			sessionUuidPrefix: "9fe4853c",
			hostRunId: "ab905e46-ba0c-4c2c-89f2-193ab19d308a",
			exitCode: 1,
			stopReason: "error",
			error: "403 permission_error: five-hour usage limit",
			turns: 11,
			usage: { input: 15029, output: 2799, cacheRead: 84224 },
		},
		{
			sessionUuidPrefix: "b2c37a2b",
			hostRunId: "e8d59a89-5746-4501-896b-9448067c1bd5",
			exitCode: 1,
			stopReason: "error",
			error: "403 permission_error: five-hour usage limit",
			turns: 55,
			usage: { input: 126843, output: 45612, cacheRead: 4462080 },
		},
	]),
});

/** E04: Premature REPORT_SCHEMA_INVALID at launch time and cross-workspace / mixed ledger. */
export const E04_FIXTURE = Object.freeze({
	prematureLaunchReceipts: Object.freeze([
		{
			toolCallId: "call_176444",
			runId: "9bef983d-31bb-40c4-8b57-3fffa096c667",
			taskId: "T-20260911-008",
			launchTime: "2026-09-11T13:20:35.060Z",
			actualReportTime: "2026-09-11T13:32:13.589Z",
			launchReceiptText: "[PLANNER-ONLY] Async delegation for task T-20260911-008 has started (runId: 9bef983d-31bb-40c4-8b57-3fffa096c667).",
			launchDetails: {
				mode: "single",
				runId: "9bef983d-31bb-40c4-8b57-3fffa096c667",
				asyncId: "9bef983d-31bb-40c4-8b57-3fffa096c667",
				asyncDir: "/tmp/pi-subagents-uid-1000/async-subagent-runs/9bef983d-31bb-40c4-8b57-3fffa096c667",
				results: [],
			},
		},
		{
			toolCallId: "call_154313",
			runId: "3e711f6d-a8c1-4a9f-8b83-370de23e3734",
			taskId: "T-20260911-008",
			launchTime: "2026-09-11T13:15:00.000Z",
			launchReceiptText: "Async: worker [3e711f6d-a8c1-4a9f-8b83-370de23e3734]",
			launchDetails: {
				runId: "3e711f6d-a8c1-4a9f-8b83-370de23e3734",
				asyncId: "3e711f6d-a8c1-4a9f-8b83-370de23e3734",
			},
		},
		{
			toolCallId: "call_141608",
			runId: "ab3ffc7c-1111-2222-3333-444455556666",
			taskId: "T-20260911-007",
			launchTime: "2026-09-11T13:10:00.000Z",
			launchReceiptText: "Async: worker [ab3ffc7c-1111-2222-3333-444455556666]",
			launchDetails: {
				runId: "ab3ffc7c-1111-2222-3333-444455556666",
				asyncId: "ab3ffc7c-1111-2222-3333-444455556666",
			},
		},
		{
			toolCallId: "call_191425",
			runId: "339ff9bf-2222-3333-4444-555566667777",
			taskId: "T-20260911-006",
			launchTime: "2026-09-11T13:05:00.000Z",
			launchReceiptText: "Async: worker [339ff9bf-2222-3333-4444-555566667777]",
			launchDetails: {
				runId: "339ff9bf-2222-3333-4444-555566667777",
				asyncId: "339ff9bf-2222-3333-4444-555566667777",
			},
		},
		{
			toolCallId: "call_280102",
			runId: "293a8707-3333-4444-5555-666677778888",
			taskId: "T-20260911-005",
			launchTime: "2026-09-11T13:00:00.000Z",
			launchReceiptText: "Async: worker [293a8707-3333-4444-5555-666677778888]",
			launchDetails: {
				runId: "293a8707-3333-4444-5555-666677778888",
				asyncId: "293a8707-3333-4444-5555-666677778888",
			},
		},
		{
			toolCallId: "call_191504",
			runId: "88ecfa6d-4444-5555-6666-777788889999",
			taskId: "T-20260911-004",
			launchTime: "2026-09-11T12:55:00.000Z",
			launchReceiptText: "Async: worker [88ecfa6d-4444-5555-6666-777788889999]",
			launchDetails: {
				runId: "88ecfa6d-4444-5555-6666-777788889999",
				asyncId: "88ecfa6d-4444-5555-6666-777788889999",
			},
		},
	]),
	crossWorkspace: Object.freeze({
		runId: "e8d59a89-5746-4501-896b-9448067c1bd5",
		recordFile: "unknown-session-_public_scripts_tc-probe-design-v2-tool_CoQV87XTKn7GQ64ZggXPJDm6.json",
		foreignWorkspace: "/public/scripts/tc-probe-design-v2",
		executionState: "running",
		ingestionState: "waiting",
		childExitTime: "2026-09-11T12:46:03.211Z",
	}),
	mixedLedgerCounts: Object.freeze({
		totalTasks: 14,
		completed: 7,
		blocked: 4,
		changes_requested: 3,
	}),
});

/** E05: Model override chain. */
export const E05_FIXTURE = Object.freeze({
	hostDefault: "gemini-3.8-flash-high",
	hostWorkerOverride: "tcuni-luna/gpt-5.6-luna",
	hostReviewerOverride: "tcuni-luna/gpt-5.6-luna",
	unspecifiedPayloadModel: undefined,
});

/** Aggregate validation and counts for RS-05/A19 fixtures. */
export const EVENT_FIXTURES = {
	e01: E01_FIXTURE,
	e02: E02_FIXTURE,
	e03: E03_FIXTURE,
	e04: E04_FIXTURE,
	e05: E05_FIXTURE,

	countE01Findings(): { newFindings: number; historicalFindings: number; total: number } {
		return {
			newFindings: E01_FIXTURE.newFindings.length,
			historicalFindings: E01_FIXTURE.historicalFindings.length,
			total: E01_FIXTURE.newFindings.length + E01_FIXTURE.historicalFindings.length,
		};
	},

	countE02Interceptions(): { runs: number; totalInterceptions: number } {
		const totalInterceptions = E02_FIXTURE.runs.reduce((sum, run) => sum + run.count, 0);
		return {
			runs: E02_FIXTURE.runs.length,
			totalInterceptions,
		};
	},

	countE03Errors(): { runs: number; total403: number } {
		return {
			runs: E03_FIXTURE.runs.length,
			total403: E03_FIXTURE.runs.filter((r) => r.exitCode === 1 && r.error.includes("403")).length,
		};
	},

	countE04PrematureReceipts(): number {
		return E04_FIXTURE.prematureLaunchReceipts.length;
	},
};
