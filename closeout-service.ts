import { randomUUID } from "node:crypto";
import type { CloseoutAttempt, CloseoutIdentity, CloseoutValidationReceipt } from "./closeout-types.ts";
import type { CloseoutBrokerEffects } from "./closeout-broker.ts";
import { CloseoutJournal } from "./closeout-journal.ts";
import { canonicalSha256, decodeCloseoutValidateArgs } from "./closeout-evidence.ts";
import { readCloseoutSnapshot, verifyCloseoutSnapshot, type CloseoutSnapshot } from "./closeout-snapshot.ts";
import { runCloseoutSandbox, type CloseoutRuntimeProfile } from "./closeout-sandbox.ts";

export interface CloseoutServiceOptions {
  journal: CloseoutJournal;
  snapshot: CloseoutSnapshot;
  runtimeProfile: CloseoutRuntimeProfile;
  /** Existing private directory outside the mounted input/runtime closure. */
  artifactRoot: string;
  /** Called after the report permit is consumed and earlier validations sealed.
   * The caller retains ordinary WorkerReport/schema/evidence/verdict checks. */
  submitReport: (args: unknown, attempt: CloseoutAttempt, signal: AbortSignal) => Promise<unknown>;
}

/** Host effects used by the closed child runtime. Nothing here accepts a shell
 * string, executable, environment, output path, or receipt body from the model. */
export function createCloseoutEffects(options: CloseoutServiceOptions): CloseoutBrokerEffects {
  const { journal, snapshot, runtimeProfile } = options;
  const grant = journal.grant;
  const deadlineMs = Date.parse(grant.executionDeadline);
  const commandsRun = new Set<string>();
  if (canonicalSha256(snapshot.binding) !== canonicalSha256(grant.expectedInputs)
    || runtimeProfile.dependencyManifestSha256 !== grant.expectedInputs.dependencyManifestSha256
    || runtimeProfile.isolationProfileSha256 !== grant.expectedInputs.isolationProfileSha256) {
    throw new Error("Closeout service input/profile does not match the grant");
  }
  function check(attempt: CloseoutAttempt, signal: AbortSignal): CloseoutIdentity {
    if (signal.aborted || Date.now() >= deadlineMs) throw new Error("Closeout effect cancelled or expired");
    const stored = journal.getAttempt(attempt.sequence);
    if (!stored || canonicalSha256(stored) !== canonicalSha256(attempt) || attempt.decision !== "permitted") {
      throw new Error("Closeout effect has no durable matching attempt");
    }
    return { taskId: attempt.taskId, originExecutionId: attempt.originExecutionId, executionId: attempt.executionId,
      requestId: attempt.requestId, ownerRunId: attempt.ownerRunId, runId: attempt.runId };
  }
  return {
    async read(args, attempt, signal) {
      check(attempt, signal);
      if (attempt.toolName !== "closeout_read") throw new Error("Closeout read permit mismatch");
      verifyCloseoutSnapshot(snapshot, deadlineMs);
      return readCloseoutSnapshot(snapshot, args);
    },
    async validate(args, attempt, signal) {
      const identity = check(attempt, signal);
      const { commandId } = decodeCloseoutValidateArgs(args);
      const command = grant.commands.find((entry) => entry.commandId === commandId);
      if (attempt.toolName !== "closeout_validate" || attempt.commandId !== commandId || !command || commandsRun.has(commandId)) {
        throw new Error("Closeout command has no unused validation permit");
      }
      commandsRun.add(commandId);
      const beforeInputs = verifyCloseoutSnapshot(snapshot, deadlineMs);
      let sealed: CloseoutValidationReceipt | undefined;
      try {
        const result = await runCloseoutSandbox({
          command, identity, attemptSequence: attempt.sequence, expectedControls: grant.expectedControls,
          isolationProfileSha256: grant.expectedInputs.isolationProfileSha256,
          snapshotRoot: snapshot.snapshotRoot, originalCwd: snapshot.originalCwd,
          runtimeProfile, deadlineMs, signal, artifactRoot: options.artifactRoot,
          async onResult(raw) {
            if (raw.outcome === "passed" && (raw.exitCode !== 0 || raw.signal !== null
              || raw.timedOut || raw.cancelled || raw.startupError !== null || !raw.processTreeStopped
              || !raw.stdoutComplete || !raw.stderrComplete || raw.stdout.length > 1024 * 1024 || raw.stderr.length > 1024 * 1024
              || raw.runtimeObservation.state !== "complete" || !raw.runtimeObservation.before || !raw.runtimeObservation.after
              || raw.runtimeObservation.isolationProfileSha256 !== grant.expectedInputs.isolationProfileSha256
              || canonicalSha256(raw.runtimeObservation.before.controls) !== canonicalSha256(grant.expectedControls)
              || canonicalSha256(raw.runtimeObservation.after.controls) !== canonicalSha256(grant.expectedControls))) {
              throw new Error("Closeout runner returned passed without complete matching evidence");
            }
            // A failed sample cannot be represented as a complete input binding.
            // Leave the attempt unresolved/failed rather than inventing one.
            const afterInputs = verifyCloseoutSnapshot(snapshot, deadlineMs);
            const stdout = journal.putArtifact(raw.stdout, raw.stdoutComplete);
            const stderr = journal.putArtifact(raw.stderr, raw.stderrComplete);
            const kernelEvidence = journal.putArtifact(raw.runtimeObservation.kernelEvidence);
            const observationBody = { ...raw.runtimeObservation, observationId: randomUUID(), kernelEvidence };
            const observation = journal.putObservation({ ...observationBody, observationSha256: canonicalSha256(observationBody) });
            const receiptBody = {
              version: 1 as const, ...identity, receiptId: randomUUID(), attemptSequence: attempt.sequence,
              commandId, descriptorSha256: command.descriptorSha256, grantSha256: journal.grantSha256,
              startedAt: raw.startedAt, endedAt: raw.endedAt, durationMs: Math.ceil(raw.durationMs),
              outcome: raw.outcome, exitCode: raw.exitCode, signal: raw.signal, timedOut: raw.timedOut,
              cancelled: raw.cancelled, startupError: raw.startupError, processTreeStopped: raw.processTreeStopped,
              beforeInputs, afterInputs, stdout, stderr,
              runtimeObservationId: observation.observationId, runtimeObservationSha256: observation.observationSha256,
            };
            sealed = journal.putReceipt({ ...receiptBody, receiptSha256: canonicalSha256(receiptBody) });
          },
        });
        if (!sealed || result.outcome !== sealed.outcome || result.processTreeStopped !== sealed.processTreeStopped) {
          throw new Error("Closeout supervisor did not confirm the sealed execution result");
        }
        if (!result.processTreeStopped) throw new Error("Closeout validation process tree has not stopped");
        return { receiptId: sealed.receiptId, commandId, outcome: sealed.outcome, exitCode: sealed.exitCode };
      } catch (error) {
        journal.revoke("Closeout validation could not seal trustworthy evidence");
        throw error;
      }
    },
    async report(args, attempt, signal) {
      check(attempt, signal);
      if (attempt.toolName !== "structured_output") throw new Error("Closeout report permit mismatch");
      verifyCloseoutSnapshot(snapshot, deadlineMs);
      return options.submitReport(args, attempt, signal);
    },
  };
}
