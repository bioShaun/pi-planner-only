import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CloseoutBroker, type CloseoutBrokerRegistrar } from "./closeout-broker.ts";
import { canonicalSha256, validateCloseoutEvidence } from "./closeout-evidence.ts";
import { CloseoutJournal } from "./closeout-journal.ts";
import { createCloseoutEffects } from "./closeout-service.ts";
import { createCloseoutCommands, createCloseoutSnapshot, verifyCloseoutSnapshot, type CloseoutSnapshot } from "./closeout-snapshot.ts";
import type { CloseoutRuntimeProfile } from "./closeout-sandbox.ts";
import type { CloseoutGrant, CloseoutOutputArtifact } from "./closeout-types.ts";
import { compareExecutionTruth } from "./evidence.ts";
import { validateWorkerReport } from "./report.ts";
import type { TaskRecord, TaskStore } from "./task.ts";
import type { RecoveryDecision, TaskExecutionRecord, TaskSpec, WorkerReport } from "./types.ts";

export const CLOSEOUT_RECOVERY_ACTION = "resume_report_only";

export interface CloseoutRecoveryConfig {
	registrar: CloseoutBrokerRegistrar;
	stateRoot: string;
	discoverRuntimeProfile(): Promise<CloseoutRuntimeProfile>;
}

export interface CloseoutOrigin {
	origin: TaskExecutionRecord;
	inheritedTruthPaths: string[];
}

/** A restored host cannot resume an interrupted one-shot capability. */
export function reconcileRestoredCloseout(store: TaskStore, task: TaskRecord): void {
	const execution = task.executions.at(-1);
	const metadata = execution?.closeout;
	const explicitlyAborted = task.recovery?.nextAction === "abort";
	const needsRecovery = task.state === "blocked" && !explicitlyAborted
		&& (!task.recovery?.required || task.recovery.executionId !== execution?.executionId);
	if (!execution || !metadata || (task.state !== "executing"
		&& !needsRecovery && !["running", "cancel_requested", "stopping", "stop_unconfirmed"].includes(execution.status ?? ""))) return;
	if (task.state === "blocked" && execution.endedReason === "tool_error"
		&& (explicitlyAborted || (task.recovery?.required && task.recovery.executionId === execution.executionId))) return;
	let noLaunch = false;
	let reason = "interrupted closeout cannot resume after host restart";
	try {
		const journal = CloseoutJournal.open({ root: metadata.journalRoot, workspace: task.cwd,
			taskId: task.taskId, originExecutionId: metadata.originExecutionId });
		if (journal.grantSha256 !== metadata.grantSha256 || journal.grant.executionId !== execution.executionId
			|| journal.grant.requestId !== metadata.requestId || journal.grant.journalId !== metadata.journalId) {
			throw new Error("closeout restart journal identity mismatch");
		}
		// Revocation is atomic with the returned state and prevents a late bind.
		const state = journal.abandonAfterRestart(reason);
		noLaunch = execution.startedAt === null && state.associationSha256 === null && state.runId === null;
	} catch (error) {
		reason += `; journal reconciliation failed: ${error instanceof Error ? error.message : String(error)}`;
	}
	const stopped = noLaunch || execution.terminationConfirmed === true;
	store.finalizeExecution(task.taskId, execution.executionId, {
		status: stopped ? "failed" : "stop_unconfirmed", endedReason: "tool_error",
		endedAt: store.now().toISOString(), terminationConfirmed: stopped,
		...(noLaunch ? { confirmationBasis: "no-launch" as const, usageComplete: false } : {}),
		truthPaths: [],
	});
	store.transition(task.taskId, "blocked");
	store.setStateReason(task.taskId, reason);
	if (!explicitlyAborted) store.setRecoveryRequired(task.taskId, { executionId: execution.executionId,
		reason: `${reason}; choose explicit full retry_same_plan after confirmed stop, or planner_abort` });
	store.persistOrThrow(store.require(task.taskId));
}

function contained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function requireCloseoutOrigin(task: TaskRecord, decision: RecoveryDecision, spec: TaskSpec): CloseoutOrigin {
	if (decision.action !== CLOSEOUT_RECOVERY_ACTION) throw new Error("closeout recovery action mismatch");
	if (task.writerHold) throw new Error("origin writer hold is still active");
	if (spec.additionalWorktreeRoots?.length) throw new Error("closeout v1 supports one complete worktree only");
	if (spec.acceptanceMode === "observation" || spec.role !== "worker") throw new Error("closeout supports ordinary worker tasks only");
	const origin = task.executions.find((item) => item.executionId === decision.executionId);
	if (!origin) throw new Error("closeout origin execution is missing");
	if (origin.kind !== "worker" || origin.readOnly || origin.auxiliary || origin.reportOnly || origin.closeout) throw new Error("closeout origin must be an ordinary worker execution");
	if (origin.cReport || origin.reportIndex !== undefined) throw new Error("closeout origin already has an admitted report boundary");
	if (origin.terminationConfirmed !== true || !origin.confirmationBasis || !origin.cTerminal || origin.evidenceIncomplete) throw new Error("closeout origin lacks confirmed complete terminal evidence");
	for (const sample of [origin.aRun, origin.cTerminal]) {
		if (sample.gitAvailable === false || sample.statusProbeFailed || sample.snapshotGap || sample.unavailableWorktreeRoots?.length) {
			throw new Error("closeout origin has no complete attributed samples");
		}
	}
	if (!origin.cTerminal.diffStat?.trim()) throw new Error("closeout origin terminal diffStat is empty");
	if (origin.endedReason !== "worker_runaway" || !origin.runawayObservation
		|| !["tokens", "wall"].includes(origin.runawayObservation.signal)) {
		throw new Error("closeout requires a persisted tokens/wall worker_runaway cancellation");
	}
	if (origin.rawTerminal?.status !== "cancelled") throw new Error("closeout origin terminal is not persisted as cancelled");
	if (task.executions.some((item) => item.closeout?.originExecutionId === origin.executionId)) {
		throw new Error("closeout origin was already consumed");
	}
	const commands = spec.validation.commands ?? [];
	if (spec.validation.required !== true || commands.length < 1 || commands.length > 5) {
		throw new Error("closeout requires one to five required validation commands");
	}
	const truth = compareExecutionTruth(origin.aRun, origin.cTerminal, undefined, {
		...(spec.scope ? { scope: spec.scope } : {}),
		...(spec.additionalWorktreeRoots?.length ? { additionalWorktreeRoots: spec.additionalWorktreeRoots } : {}),
	});
	if (!truth.verifiable || truth.truthPaths.length === 0 || truth.outOfScopePaths.length > 0
		|| truth.attributionGapPaths?.length) {
		throw new Error(`closeout origin has no complete attributed in-scope change set: ${truth.reasons.join("; ")}`);
	}
	return { origin, inheritedTruthPaths: [...truth.truthPaths] };
}

export interface PreparedCloseout {
	grant: CloseoutGrant;
	journal: CloseoutJournal;
	broker: CloseoutBroker;
	snapshot: CloseoutSnapshot;
	associationSha256: string;
	snapshotManifestArtifact: CloseoutOutputArtifact;
	inheritedTruthPaths: string[];
	getSubmittedReport(): WorkerReport | undefined;
	getReceiptIds(): string[];
	verifyEvidence(runId: string, requirePassed: boolean): void;
}

export async function prepareCloseout(input: {
	config: CloseoutRecoveryConfig;
	task: TaskRecord;
	spec: TaskSpec;
	origin: CloseoutOrigin;
	executionId: string;
	requestId: string;
	ownerRunId: string;
	executionDeadline: string;
	beforeClaim(): Promise<void>;
	onClaim(journal: CloseoutJournal, associationSha256: string): void;
}): Promise<PreparedCloseout> {
	const workspace = realpathSync(input.task.cwd);
	const stateRoot = resolve(input.config.stateRoot);
	if (contained(workspace, stateRoot)) throw new Error("closeout state root must be outside the task workspace");
	mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
	const stagingParent = resolve(stateRoot, "snapshots");
	const journalRoot = resolve(stateRoot, "journal");
	const grantId = randomUUID();
	const artifactRoot = resolve(stateRoot, "artifacts", grantId);
	for (const directory of [stagingParent, journalRoot, artifactRoot]) mkdirSync(directory, { recursive: true, mode: 0o700 });
	const profile = await input.config.discoverRuntimeProfile();
	await input.beforeClaim();
	const commands = createCloseoutCommands(input.spec.validation.commands ?? [], workspace, profile);
	const snapshot = createCloseoutSnapshot({
		cwd: workspace,
		stagingParent,
		dependencyManifestSha256: profile.dependencyManifestSha256,
		isolationProfileSha256: profile.isolationProfileSha256,
		deadlineMs: Date.parse(input.executionDeadline),
	});
	const journalId = canonicalSha256({ version: 1, workspace, taskId: input.task.taskId, originExecutionId: input.origin.origin.executionId });
	const grant: CloseoutGrant = {
		version: 1,
		grantId,
		taskId: input.task.taskId,
		originExecutionId: input.origin.origin.executionId,
		executionId: input.executionId,
		requestId: input.requestId,
		ownerRunId: input.ownerRunId,
		specSha256: canonicalSha256(input.spec),
		originEvidenceSha256: canonicalSha256({ aRun: input.origin.origin.aRun, cTerminal: input.origin.origin.cTerminal }),
		expectedInputs: snapshot.binding,
		expectedControls: profile.controls,
		commands,
		workAttemptsLimit: 5,
		reportAttemptsLimit: 1,
		executionDeadline: input.executionDeadline,
		journalId,
	};
	const journal = CloseoutJournal.claim({ root: journalRoot, workspace, grant });
	const associationSha256 = canonicalSha256({
		version: 1, taskId: input.task.taskId, originExecutionId: grant.originExecutionId,
		executionId: grant.executionId, journalId, grantSha256: journal.grantSha256,
	});
	// No await may separate the permanent claim from its strict Task marker.
	input.onClaim(journal, associationSha256);
	const snapshotManifestArtifact = journal.putArtifact(Buffer.from(JSON.stringify({
		originalCwd: snapshot.originalCwd, snapshotRoot: snapshot.snapshotRoot,
		binding: snapshot.binding, entries: snapshot.entries,
	}), "utf8"));
	let submittedReport: WorkerReport | undefined;
	let receiptIds: string[] = [];
	let broker!: CloseoutBroker;
	const effects = createCloseoutEffects({
		journal, snapshot, runtimeProfile: profile, artifactRoot,
		async submitReport(value, attempt) {
			const errors = validateWorkerReport(value);
			if (errors.length) throw new Error(`closeout WorkerReport is invalid: ${errors.join("; ")}`);
			const report = value as WorkerReport;
			if (report.taskId !== input.task.taskId || report.evidence.taskId !== input.task.taskId) throw new Error("closeout report task identity mismatch");
			const reportTruth = compareExecutionTruth(input.origin.origin.aRun, input.origin.origin.cTerminal!, report, {
				...(input.spec.scope ? { scope: input.spec.scope } : {}),
				...(input.spec.additionalWorktreeRoots?.length ? { additionalWorktreeRoots: input.spec.additionalWorktreeRoots } : {}),
			});
			if (!reportTruth.verifiable || reportTruth.undeclaredPaths.length || reportTruth.outOfScopePaths.length
				|| reportTruth.extraDeclaredPaths.length || reportTruth.missingPaths.length
				|| canonicalSha256(reportTruth.truthPaths) !== canonicalSha256(input.origin.inheritedTruthPaths)) {
				throw new Error(`closeout report does not exactly declare inherited origin changes: ${reportTruth.reasons.join("; ")}`);
			}
			const commandEntries = report.validation.filter((item) => item.command);
			const byCommand = new Map(commandEntries.map((item) => [item.command!, item]));
			if (byCommand.size !== commandEntries.length || commandEntries.some((item) => !commands.some((command) => command.originalCommand === item.command))) {
				throw new Error("closeout report has duplicate or unexpected validation commands");
			}
			receiptIds = commands.map((command) => {
				const validation = byCommand.get(command.originalCommand);
				if (!validation?.receiptId) throw new Error(`closeout report lacks receiptId for ${command.originalCommand}`);
				return validation.receiptId;
			});
			const currentInputs = verifyCloseoutSnapshot(snapshot, Date.parse(grant.executionDeadline));
			if (new Set(receiptIds).size !== receiptIds.length) throw new Error("closeout report reuses a receiptId");
			const evidence = validateCloseoutEvidence({
				grant, currentInputs,
				identity: { taskId: grant.taskId, originExecutionId: grant.originExecutionId, executionId: grant.executionId,
					requestId: grant.requestId, ownerRunId: grant.ownerRunId, runId: attempt.runId },
				expectedCommandIds: commands.map((command) => command.commandId), receiptIds, store: journal,
				requirePassed: report.status === "completed",
			});
			if (!evidence.valid) throw new Error(`closeout validation evidence failed: ${evidence.errors.join("; ")}`);
			for (let index = 0; index < commands.length; index += 1) {
				const declared = byCommand.get(commands[index].originalCommand)!;
				const actual = evidence.receipts.find((receipt) => receipt.receiptId === receiptIds[index])!;
				const passed = actual.outcome === "passed" && actual.exitCode === 0 && actual.signal === null
					&& !actual.timedOut && !actual.cancelled && actual.startupError === null && actual.processTreeStopped;
				if ((declared.status === "passed") !== passed || (declared.exitCode ?? actual.exitCode) !== actual.exitCode) {
					throw new Error(`closeout report contradicts receipt ${actual.receiptId}`);
				}
			}
			submittedReport = structuredClone(report);
			return report;
		},
	});
	// The host service returns domain values. The child SDK consumes tool
	// results; without this adapter it silently drops the receipt/read content.
	const toolResult = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }], details: {} });
	broker = new CloseoutBroker({ grant, nodeId: input.task.taskId, journal, effects: {
		read: async (...args) => toolResult(await effects.read(...args)),
		validate: async (...args) => toolResult(await effects.validate(...args)),
		report: async (...args) => { await effects.report(...args); return toolResult({ submitted: true }); },
	} });
	return {
		grant, journal, broker, snapshot, associationSha256, snapshotManifestArtifact,
		inheritedTruthPaths: [...input.origin.inheritedTruthPaths],
		getSubmittedReport: () => submittedReport ? structuredClone(submittedReport) : undefined,
		getReceiptIds: () => [...receiptIds],
		verifyEvidence(runId, requirePassed) {
			if (!submittedReport || receiptIds.length !== commands.length) throw new Error("closeout report was not durably submitted");
			const result = validateCloseoutEvidence({
				grant, currentInputs: verifyCloseoutSnapshot(snapshot, Date.parse(grant.executionDeadline)),
				identity: { taskId: grant.taskId, originExecutionId: grant.originExecutionId, executionId: grant.executionId,
					requestId: grant.requestId, ownerRunId: grant.ownerRunId, runId },
				expectedCommandIds: commands.map((command) => command.commandId), receiptIds, store: journal, requirePassed,
			});
			if (!result.valid) throw new Error(`closeout evidence recheck failed: ${result.errors.join("; ")}`);
		},
	};
}

/** Reopens only durable host artifacts. Used at every PASS boundary, including after restart. */
export function validatePersistedCloseout(task: TaskRecord, execution: TaskExecutionRecord, report: WorkerReport): string[] {
	const errors: string[] = [];
	const metadata = execution.closeout;
	if (execution.status !== "completed" || execution.endedReason !== "normal" || execution.terminationConfirmed !== true) errors.push("closeout execution did not complete successfully with confirmed termination");
	if (!metadata || !execution.runId || !execution.cReport || execution.reportIndex === undefined || !metadata.snapshotManifestArtifact) return ["closeout execution binding is incomplete"];
	try {
		const origin = task.executions.find((item) => item.executionId === metadata.originExecutionId);
		if (!origin?.cTerminal || origin.cReport || origin.reportIndex !== undefined) errors.push("closeout origin was rewritten or gained a report boundary");
		else if (canonicalSha256({ aRun: origin.aRun, cTerminal: origin.cTerminal }) !== metadata.originEvidenceSha256) errors.push("closeout origin evidence binding changed");
		const journal = CloseoutJournal.open({ root: metadata.journalRoot, workspace: task.cwd, taskId: task.taskId, originExecutionId: metadata.originExecutionId });
		if (metadata.requestId !== journal.grant.requestId) errors.push("closeout transport request identity mismatch");
		if (journal.grantSha256 !== metadata.grantSha256 || journal.grant.journalId !== metadata.journalId) errors.push("closeout journal/grant association mismatch");
		if (!task.spec || journal.grant.specSha256 !== canonicalSha256(task.spec)) errors.push("closeout grant TaskSpec binding mismatch");
		if (canonicalSha256(journal.grant.commands.map((command) => command.originalCommand)) !== canonicalSha256(task.spec?.validation.commands ?? [])) errors.push("closeout grant commands no longer match TaskSpec validation commands");
		const audit = journal.audit();
		if (!audit.valid || audit.blocked || audit.state.associationSha256 !== metadata.associationSha256 || !audit.state.sealed || audit.state.runId !== execution.runId) errors.push(...audit.reasons, "closeout journal is not durably sealed and associated to the execution run");
		const raw = JSON.parse(journal.readArtifact(metadata.snapshotManifestArtifact).toString("utf8")) as Partial<CloseoutSnapshot>;
		if (typeof raw.originalCwd !== "string" || typeof raw.snapshotRoot !== "string" || !raw.binding || !Array.isArray(raw.entries)) throw new Error("snapshot manifest artifact is malformed");
		const entries = raw.entries;
		const files = new Map(entries.filter((entry) => entry.kind === "file").map((entry) => [createHash("sha256").update(entry.path).digest("hex"), entry]));
		const snapshot: CloseoutSnapshot = { originalCwd: raw.originalCwd, snapshotRoot: raw.snapshotRoot, binding: raw.binding,
			entries, files };
		const currentInputs = verifyCloseoutSnapshot(snapshot, Date.now() + 5_000);
		const evidence = validateCloseoutEvidence({
			grant: journal.grant, currentInputs,
			identity: { taskId: task.taskId, originExecutionId: metadata.originExecutionId, executionId: execution.executionId,
				requestId: metadata.requestId, ownerRunId: journal.grant.ownerRunId, runId: execution.runId },
			expectedCommandIds: journal.grant.commands.map((command) => command.commandId), receiptIds: metadata.receiptIds ?? [],
			store: journal, requirePassed: true,
		});
		if (!evidence.valid) errors.push(...evidence.errors);
		const expectedBinding = canonicalSha256({
			version: 1, taskId: task.taskId, originExecutionId: metadata.originExecutionId,
			executionId: execution.executionId, requestId: metadata.requestId,
			ownerRunId: journal.grant.ownerRunId, runId: execution.runId, reportRevision: execution.reportIndex + 1,
			reportSha256: canonicalSha256(report), receiptIds: metadata.receiptIds ?? [],
			originEvidenceSha256: metadata.originEvidenceSha256,
			freshEvidenceSha256: canonicalSha256({ aRun: execution.aRun, cReport: execution.cReport }),
			inheritedTruthPaths: metadata.inheritedTruthPaths, newTruthPaths: [],
		});
		if (expectedBinding !== metadata.reportBindingSha256) errors.push("closeout report binding hash mismatch");
		if (execution.truthPaths?.length) errors.push("closeout execution must not contribute new Truth");
		if (report.status !== "completed") errors.push("non-completed closeout report cannot pass");
	} catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
	return [...new Set(errors.filter(Boolean))];
}
