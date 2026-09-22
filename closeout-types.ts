/** Host-owned closeout wire/storage shapes.
 * Runtime decoders must reject malformed/unknown versions before using these
 * types. None of these caller-supplied objects is itself an authority token.
 */
export type Sha256 = string; // decoder: exactly 64 lowercase hexadecimal chars
export type ReceiptId = string; // host-issued UUID; never a caller-supplied path

export interface CloseoutIdentity {
  taskId: string;
  originExecutionId: string;
  executionId: string;
  requestId: string;
  ownerRunId: string;
  runId: string; // launcher STARTED binding, required before tool permission
}

export interface CloseoutCommand {
  commandId: string; // host-generated unique ID; at most five commands
  specCommandIndex: number;
  originalCommand: string; // exact immutable TaskSpec validation.commands entry
  executable: string; // host-resolved absolute executable from allowlisted profile
  argv: readonly string[]; // shell:false; no caller substitutions
  cwd: string; // canonical original workspace path
  environmentProfileId: string; // host allowlist, no inherited process.env
  timeoutMs: number; // positive, further clamped to execution/Request remainder
  descriptorSha256: Sha256; // canonical descriptor, excluding this hash field
}

export interface CloseoutInputBinding {
  workspaceId: string;
  head: string;
  sourceManifestSha256: Sha256; // full declared verification input manifest
  gitMetadataManifestSha256: Sha256; // index/ref/config inputs used by verification
  dependencyManifestSha256: Sha256; // resolved readonly tool/runtime mounts
  isolationProfileSha256: Sha256;
  snapshotArtifactId: string; // host-owned artifact; no arbitrary read path
  capturedAt: string;
  state: "complete"; // unknown/partial snapshots cannot construct this binding
}

export interface CloseoutGrant {
  version: 1;
  grantId: string; // opaque host handle, never included in model tools/prompt
  taskId: string;
  originExecutionId: string;
  executionId: string;
  requestId: string;
  ownerRunId: string;
  specSha256: Sha256;
  originEvidenceSha256: Sha256; // binds BOTH original A_run and C_terminal
  expectedInputs: CloseoutInputBinding;
  expectedControls: CloseoutEffectiveControls; // resolved immutable profile values
  commands: readonly CloseoutCommand[];
  workAttemptsLimit: 5;
  reportAttemptsLimit: 1;
  executionDeadline: string; // Request closure still overrides this
  journalId: string;
}

/** New optional structured REQUEST field; its receiver must ACK capability
 * BEFORE a model prompt. Grant lookup must also match the transport identity.
 * No callbacks/functions or raw command argv are accepted from the child.
 */
export interface CloseoutRequestCapability {
  version: 1;
  grantId: string;
  grantSha256: Sha256;
}

interface CloseoutAckIdentity {
  version: 1;
  grantId: string;
  grantSha256: Sha256;
  requestId: string;
  ownerRunId: string;
  nodeId: string;
}
export type CloseoutCapabilityAck = CloseoutAckIdentity & (
  | { status: "ready"; runId: string; profileSha256: Sha256;
      activeTools: readonly ["closeout_read", "closeout_validate", "structured_output"] }
  | { status: "unavailable"; reason: string }
);

export interface CloseoutAttempt extends CloseoutIdentity {
  version: 1;
  sequence: number; // monotonic host journal sequence, NOT toolCallId
  occurrenceId: string; // host-created event occurrence identity
  modelToolCallId: string; // diagnostic only; duplicate => poison/refuse
  toolName: string;
  category: "work" | "report";
  categoryOrdinal: number; // includes invalid/over-limit attempts
  argsSha256: Sha256;
  commandId?: string;
  decision: "permitted" | "denied";
  reason?: string;
  recordedAt: string;
  previousEntrySha256: Sha256;
  entrySha256: Sha256;
}

export interface CloseoutOutputArtifact {
  artifactId: string; // parent journal resolves this, child cannot choose path
  sha256: Sha256;
  bytes: number;
  complete: boolean; // false => cannot satisfy successful validation
}

export interface CloseoutEffectiveControls {
  memoryMaxBytes: number;
  memorySwapMaxBytes: number;
  pidsMax: number;
  cpuQuotaUs: number;
  cpuPeriodUs: number;
}

/** Host supervisor reads kernel state before releasing the exec barrier and
 * after sandbox termination, while its scope is still alive. Never decoded
 * from test stdout. Completeness is explicit; partial evidence cannot pass.
 */
export interface CloseoutRuntimeObservation extends CloseoutIdentity {
  version: 1;
  observationId: string;
  attemptSequence: number;
  isolationProfileSha256: Sha256;
  state: "complete" | "unknown";
  unknownReason?: string;
  scopeUnit: string;
  cgroupPath: string;
  cgroupId: string; // kernel directory identity, not only a reusable path
  hostBootId: string;
  namespaceInitPid: number;
  namespaceInitStartTicks: string; // /proc PID reuse guard
  before: { observedAt: string; controls: CloseoutEffectiveControls } | null;
  after: { observedAt: string; controls: CloseoutEffectiveControls } | null;
  kernelEvidence: CloseoutOutputArtifact; // raw host-only control/identity reads
  /** SHA-256 of UTF-8 stableStringify(record WITHOUT observationSha256),
   * no trailing newline. All other fields, including kernelEvidence, bind.
   */
  observationSha256: Sha256;
}

export interface CloseoutValidationReceipt extends CloseoutIdentity {
  version: 1;
  receiptId: ReceiptId;
  attemptSequence: number;
  commandId: string;
  descriptorSha256: Sha256;
  grantSha256: Sha256;
  startedAt: string;
  endedAt: string;
  durationMs: number; // monotonic clock; dates are diagnostic only
  outcome: "passed" | "failed" | "timed_out" | "cancelled" | "startup_failed" | "evidence_failed";
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  startupError: string | null;
  processTreeStopped: boolean;
  beforeInputs: CloseoutInputBinding;
  afterInputs: CloseoutInputBinding;
  stdout: CloseoutOutputArtifact;
  stderr: CloseoutOutputArtifact;
  runtimeObservationId: string;
  runtimeObservationSha256: Sha256; // equals the recomputed observationSha256; host journal lookup
  receiptSha256: Sha256; // canonical bytes excluding this field; integrity not authorship
}

/** Host-only association. Worker references receiptId on validation entries;
 * host loads authoritative journal/artifacts and verifies every field. The
 * existing WorkerReport.evidence remains a fresh EvidenceRef, not this record.
 */
export interface CloseoutReportBinding extends CloseoutIdentity {
  version: 1;
  reportRevision: number;
  reportSha256: Sha256;
  reportAttemptSequence: number;
  receiptIds: readonly ReceiptId[];
  originEvidenceSha256: Sha256;
  freshEvidenceSha256: Sha256; // current execution A_run and C_report
  currentInputs: CloseoutInputBinding;
  inheritedTruthPaths: readonly string[]; // attribution belongs to origin
  newTruthPaths: readonly []; // this execution writes no new source
}

export type CloseoutReadArgs = { pathId: string; offset: number; limit: number };
export type CloseoutValidateArgs = { commandId: string };

export const CLOSEOUT_WORK_ATTEMPTS = 5;
export const CLOSEOUT_REPORT_ATTEMPTS = 1;
