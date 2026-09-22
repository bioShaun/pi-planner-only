import { createHash } from "node:crypto";
import { stableStringify } from "./report.ts";
import { decodeCloseoutGrant } from "./closeout-evidence.ts";
import type { CloseoutAttempt, CloseoutGrant, CloseoutIdentity, CloseoutRequestCapability } from "./closeout-types.ts";

export const CLOSEOUT_TOOLS = Object.freeze(["closeout_read", "closeout_validate", "structured_output"] as const);
export interface CloseoutToolStart {
  modelToolCallId: string;
  toolName: string;
  args: unknown;
}

/** Only a host-created strict journal implements this authority. Neither this
 * object nor effect callbacks travel in a model tool's arguments. */
export interface CloseoutAttemptAuthority {
  associate(associationSha256: string): void;
  bindRun(runId: string): void;
  recordAttempt(input: CloseoutToolStart): CloseoutAttempt;
  settleAttempt(sequence: number, outcome: "completed" | "no_effect" | "failed"): void;
  finish(): void;
  revoke(reason: string): void;
}
export interface CloseoutBrokerEffects {
  read(args: unknown, attempt: CloseoutAttempt, signal: AbortSignal): Promise<unknown>;
  validate(args: unknown, attempt: CloseoutAttempt, signal: AbortSignal): Promise<unknown>;
  report(args: unknown, attempt: CloseoutAttempt, signal: AbortSignal): Promise<unknown>;
}
export interface CloseoutBrokerBinding {
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  runId: string;
  grantId: string;
  grantSha256: string;
  activeTools: readonly string[];
}
export interface CloseoutReportAdapter {
  /** Runs the existing child structured-output schema/acceptance checks. */
  validate(args: unknown): Promise<unknown>;
  /** Commits the child's structured capture only after host checks succeed. */
  capture(value: unknown): void;
}
interface Permit {
  attempt: CloseoutAttempt;
  claimed: boolean;
  settled: boolean;
  previous: Promise<void>;
  done: Promise<void>;
  finish(): void;
}
export interface CloseoutReady {
  version: 1;
  status: "ready";
  requestId: string;
  ownerRunId: string;
  nodeId: string;
  runId: string;
  grantId: string;
  grantSha256: string;
  profileSha256: string;
  activeTools: readonly ["closeout_read", "closeout_validate", "structured_output"];
}

/** SDK starts are observed before schema validation. Executes are separately
 * guarded; observing an event is never treated as preventing SDK execution. */
export class CloseoutBroker {
  readonly capability: CloseoutRequestCapability;
  readonly #grant: CloseoutGrant;
  readonly #nodeId: string;
  readonly #journal: CloseoutAttemptAuthority;
  readonly #effects: CloseoutBrokerEffects;
  readonly #abort = new AbortController();
  readonly #permits = new Map<string, Permit>();
  readonly #timer: ReturnType<typeof setTimeout>;
  #tail = Promise.resolve();
  #identity: CloseoutIdentity | undefined;
  #associated = false;
  #associationStarted = false;
  #closed = false;
  #reportSubmitted = false;

  constructor(options: { grant: CloseoutGrant; nodeId: string; journal: CloseoutAttemptAuthority; effects: CloseoutBrokerEffects }) {
    this.#grant = decodeCloseoutGrant(options.grant);
    this.#nodeId = options.nodeId;
    this.#journal = options.journal;
    this.#effects = options.effects;
    this.capability = Object.freeze({ version: 1, grantId: this.#grant.grantId,
      grantSha256: createHash("sha256").update(stableStringify(this.#grant)).digest("hex") });
    const remaining = Date.parse(this.#grant.executionDeadline) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 2_147_483_647) throw new Error("Invalid closeout deadline");
    this.#timer = setTimeout(() => {
      try { this.revoke("Closeout deadline expired"); }
      catch { /* Revocation is already irreversible in memory; claim persists. */ }
    }, remaining);
    this.#timer.unref();
  }

  /** The callback MUST strictly persist and cross-check ledger/claim association.
   * This host-only activation finishes before REQUEST registration/first prompt.
   * A failure consumes the permanent claim and cannot activate another run. */
  async associate(persistAndCheck: () => Promise<string>): Promise<void> {
    this.#assertLive(false);
    if (this.#associationStarted) throw new Error("Closeout association was already attempted");
    this.#associationStarted = true;
    try {
      const associationSha256 = await persistAndCheck();
      this.#assertLive(false);
      this.#journal.associate(associationSha256);
      this.#associated = true;
    } catch (error) { this.revoke("Closeout ledger association failed"); throw error; }
  }

  bindSession(binding: CloseoutBrokerBinding): CloseoutReady {
    this.#assertLive(false);
    try {
      if (!this.#associated || this.#identity || !binding.runId
        || binding.requestId !== this.#grant.requestId || binding.ownerRunId !== this.#grant.ownerRunId
        || binding.nodeId !== this.#nodeId || binding.grantId !== this.#grant.grantId
        || binding.grantSha256 !== this.capability.grantSha256) throw new Error("Closeout capability identity mismatch");
      this.assertTools(binding.activeTools);
      this.#journal.bindRun(binding.runId);
      this.#identity = { taskId: this.#grant.taskId, originExecutionId: this.#grant.originExecutionId,
        executionId: this.#grant.executionId, requestId: this.#grant.requestId, ownerRunId: this.#grant.ownerRunId, runId: binding.runId };
      return { version: 1, status: "ready", requestId: binding.requestId, ownerRunId: binding.ownerRunId,
        nodeId: binding.nodeId, runId: binding.runId, grantId: binding.grantId, grantSha256: binding.grantSha256,
        profileSha256: this.#grant.expectedInputs.isolationProfileSha256, activeTools: CLOSEOUT_TOOLS };
    } catch (error) { this.revoke("Closeout session binding failed"); throw error; }
  }

  assertTools(names: readonly string[]): void {
    if (names.length !== CLOSEOUT_TOOLS.length || [...names].sort().join("\0") !== [...CLOSEOUT_TOOLS].sort().join("\0")) {
      this.revoke("Closeout callable tool set changed");
      throw new Error("Closeout requires exactly three callable tools");
    }
  }

  observeToolStart(input: CloseoutToolStart): void {
    this.#assertLive();
    let attempt: CloseoutAttempt;
    try { attempt = this.#journal.recordAttempt(input); }
    catch (error) { this.revoke("Closeout attempt persistence failed"); throw error; }
    if (this.#permits.has(input.modelToolCallId) || !CLOSEOUT_TOOLS.includes(input.toolName as typeof CLOSEOUT_TOOLS[number])) {
      this.revoke("Closeout duplicate model ID or unknown tool");
      return;
    }
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const permit: Permit = { attempt, claimed: false, settled: false, previous: this.#tail, done, finish };
    this.#permits.set(input.modelToolCallId, permit);
    this.#tail = done;
    // Denied attempts have no side effects to serialize.
    if (attempt.decision !== "permitted") this.#settle(permit);
  }

  /** Must be called for SDK schema/lookup failures as well as successful tools. */
  observeToolEnd(modelToolCallId: string): void {
    const permit = this.#permits.get(modelToolCallId);
    if (permit && !permit.claimed && !permit.settled) this.#finishAttempt(permit, "no_effect");
  }

  async execute(modelToolCallId: string, toolName: string, args: unknown, reportAdapter?: CloseoutReportAdapter): Promise<unknown> {
    this.#assertLive();
    const permit = this.#permits.get(modelToolCallId);
    if (!permit || permit.claimed || permit.settled || permit.attempt.decision !== "permitted"
      || permit.attempt.toolName !== toolName) throw new Error("Closeout tool has no unused permit");
    permit.claimed = true;
    let completed = false;
    let failed = false;
    try {
      const digest = createHash("sha256").update(stableStringify(args)).digest("hex");
      if (digest !== permit.attempt.argsSha256) throw new Error("Closeout tool arguments changed after start");
      await permit.previous;
      this.#assertLive();
      let result: unknown;
      switch (toolName) {
        case "closeout_read": result = await this.#effects.read(args, permit.attempt, this.#abort.signal); break;
        case "closeout_validate": result = await this.#effects.validate(args, permit.attempt, this.#abort.signal); break;
        case "structured_output": {
          // The host-only adapter preserves the child runtime's existing inner
          // schema checks while placing them after durable report consumption.
          const value = reportAdapter ? await reportAdapter.validate(args) : args;
          this.#assertLive();
          result = await this.#effects.report(value, permit.attempt, this.#abort.signal);
          this.#assertLive();
          reportAdapter?.capture(value);
          this.#reportSubmitted = true;
          break;
        }
        default: throw new Error("Unknown closeout tool");
      }
      completed = true;
      return result;
    } catch (error) { failed = true; throw error; }
    finally {
      try { this.#finishAttempt(permit, completed ? "completed" : "failed"); }
      catch (error) { if (!failed) throw error; }
    }
  }

  /** Normal terminal: retire capability, retain sealed evidence for verdict.
   * A missing report or unresolved tool cannot use this successful seal path. */
  close(): void {
    this.#assertLive();
    if (!this.#reportSubmitted || [...this.#permits.values()].some((permit) => !permit.settled)) {
      this.revoke("Closeout ended without a report or with pending tools");
      throw new Error("Closeout is not ready for durable finish");
    }
    try { this.#journal.finish(); }
    catch (error) { this.revoke("Closeout durable finish failed"); throw error; }
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#abort.abort(new Error("Closeout completed"));
  }

  revoke(reason: string): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#abort.abort(new Error(reason));
    for (const permit of this.#permits.values()) this.#settle(permit);
    // Persistence failure cannot undo in-memory revocation. The original
    // permanent claim remains consumed even if revocation cannot be written.
    this.#journal.revoke(reason);
  }

  #settle(permit: Permit): void {
    if (!permit.settled) {
      permit.settled = true;
      // A later schema failure/denial may finish before an earlier process.
      // Its queue node must still preserve that earlier process's barrier.
      void permit.previous.then(permit.finish);
    }
  }
  #finishAttempt(permit: Permit, outcome: "completed" | "no_effect" | "failed"): void {
    if (permit.settled) return;
    try {
      if (!this.#closed && permit.attempt.decision === "permitted") this.#journal.settleAttempt(permit.attempt.sequence, outcome);
    } catch (error) { this.revoke("Closeout attempt settlement failed"); throw error; }
    finally { this.#settle(permit); }
  }
  #assertLive(requireBinding = true): void {
    if (this.#closed || this.#abort.signal.aborted || Date.now() >= Date.parse(this.#grant.executionDeadline)) throw new Error("Closeout capability revoked or expired");
    if (requireBinding && !this.#identity) throw new Error("Closeout child run has not been bound");
  }
}

/** The upstream registry owns its Map. Planner registers through the host's
 * explicit registrar, avoiding accidental duplicated module-singleton Maps.
 * This interface is host-only, never a JSON event or model-facing tool. */
export interface CloseoutBrokerRegistrar {
  version: 1;
  register(binding: { requestId: string; ownerRunId: string; nodeId: string; capability: CloseoutRequestCapability }, broker: CloseoutBroker): () => void;
}
