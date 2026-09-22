import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import type { CloseoutAttempt, CloseoutGrant, CloseoutOutputArtifact, CloseoutRuntimeObservation, CloseoutValidationReceipt } from "./closeout-types.ts";
import {
	canonicalSha256, decodeCloseoutAttempt, decodeCloseoutGrant, decodeCloseoutOutputArtifact,
	decodeCloseoutReadArgs, decodeCloseoutRuntimeObservation, decodeCloseoutValidateArgs,
	decodeCloseoutValidationReceipt,
} from "./closeout-evidence.ts";

const HELPER = resolve(dirname(fileURLToPath(import.meta.url)), "closeout-journal-helper.py");
const SHA256 = /^[0-9a-f]{64}$/;

interface ClaimIdentity { version: 1; workspace: string; taskId: string; originExecutionId: string; }
export interface CloseoutJournalAudit { valid: boolean; blocked: boolean; reasons: readonly string[]; state: { version: 1; associationSha256: string | null; runId: string | null; revoked: boolean; revokeReason: string | null; settled: Readonly<Record<string, "completed" | "no_effect" | "failed">>; sealed: boolean }; attempts: readonly CloseoutAttempt[]; grantSha256: string; }

function nonEmpty(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) throw new TypeError(`${label} must be a non-empty string`);
	return value;
}

function helper<T>(payload: Record<string, unknown>): T {
	const result = spawnSync("/usr/bin/python3", [HELPER], {
		input: JSON.stringify(payload), encoding: "utf8", maxBuffer: 96 * 1024 * 1024,
		timeout: 5_000, killSignal: "SIGKILL", stdio: ["pipe", "pipe", "pipe"],
		env: { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", PYTHONDONTWRITEBYTECODE: "1",
			...(process.env.CLOSEOUT_JOURNAL_TEST_FAULT === "attempt-fsync" ? { CLOSEOUT_JOURNAL_TEST_FAULT: "attempt-fsync" } : {}) },
	});
	let parsed: { ok?: boolean; result?: T; error?: string };
	try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`closeout journal helper failed: ${result.stderr || result.error || "invalid response"}`); }
	if (result.error || result.status !== 0 || !parsed.ok) throw new Error(parsed.error ?? String(result.error ?? result.stderr));
	return parsed.result as T;
}

function canonicalRoot(value: string): string {
	const absolute = resolve(nonEmpty(value, "root"));
	if (absolute === dirname(absolute)) throw new Error("journal root must be a dedicated directory");
	const parent = realpathSync(dirname(absolute));
	return resolve(parent, absolute.slice(dirname(absolute).length + 1));
}

export class CloseoutJournal {
	readonly root: string;
	readonly workspace: string;
	readonly claimHash: string;
	readonly grant: CloseoutGrant;
	readonly grantSha256: string;
	readonly #claim: ClaimIdentity;
	readonly #writable: boolean;
	#boundRunId: string | undefined;

	private constructor(root: string, workspace: string, grant: CloseoutGrant, writable: boolean) {
		this.root = root;
		this.workspace = workspace;
		this.grant = grant;
		this.grantSha256 = canonicalSha256(grant);
		this.#claim = { version: 1, workspace, taskId: grant.taskId, originExecutionId: grant.originExecutionId };
		this.claimHash = canonicalSha256(this.#claim);
		this.#writable = writable;
	}

	static claim(input: { root: string; workspace: string; grant: unknown }): CloseoutJournal {
		const root = canonicalRoot(input.root);
		const workspace = realpathSync(input.workspace);
		const grant = decodeCloseoutGrant(input.grant);
		const journal = new CloseoutJournal(root, workspace, grant, true);
		if (grant.journalId !== journal.claimHash) throw new Error("grant journalId does not match canonical origin claim hash");
		helper({ operation: "claim", root, claimHash: journal.claimHash, claim: journal.#claim, grant });
		return journal;
	}

	static open(input: { root: string; workspace: string; taskId: string; originExecutionId: string }): CloseoutJournal {
		const root = canonicalRoot(input.root);
		const workspace = realpathSync(input.workspace);
		const claim: ClaimIdentity = { version: 1, workspace, taskId: nonEmpty(input.taskId, "taskId"), originExecutionId: nonEmpty(input.originExecutionId, "originExecutionId") };
		const claimHash = canonicalSha256(claim);
		const grant = decodeCloseoutGrant(helper<unknown>({ operation: "open", root, claimHash, claim }));
		const journal = new CloseoutJournal(root, workspace, grant, false);
		if (journal.claimHash !== claimHash || grant.journalId !== claimHash) throw new Error("stored grant does not bind the canonical origin claim");
		return journal;
	}

	associate(associationSha256: string): void {
		this.#assertWritable();
		if (!SHA256.test(associationSha256)) throw new TypeError("associationSha256 must be a lowercase SHA-256 digest");
		this.#call("associate", { associationSha256 });
	}

	bindRun(runId: string): void {
		this.#assertWritable();
		runId = nonEmpty(runId, "runId");
		this.#call("bind", { runId });
		this.#boundRunId = runId;
	}

	recordAttempt(input: { modelToolCallId: string; toolName: string; args: unknown }): CloseoutAttempt {
		this.#assertWritable();
		const modelToolCallId = nonEmpty(input.modelToolCallId, "modelToolCallId");
		const toolName = nonEmpty(input.toolName, "toolName");
		const category = toolName === "structured_output" ? "report" : "work";
		let argsSha256: string;
		let reason: string | undefined;
		let poison = false;
		let commandId: string | undefined;
		try { argsSha256 = canonicalSha256(input.args); }
		catch { argsSha256 = canonicalSha256({ invalidArgs: true }); reason = "arguments are not canonical JSON"; poison = true; }
		if (toolName === "closeout_read") {
			try { decodeCloseoutReadArgs(input.args); } catch { reason = reason ?? "invalid closeout_read arguments"; }
		} else if (toolName === "closeout_validate") {
			try {
				commandId = decodeCloseoutValidateArgs(input.args).commandId;
				if (!this.grant.commands.some((command) => command.commandId === commandId)) reason = "unknown commandId";
			} catch { reason = reason ?? "invalid closeout_validate arguments"; }
		} else if (toolName !== "structured_output") {
			reason = "unknown tool"; poison = true;
		}
		const identity = { taskId: this.grant.taskId, originExecutionId: this.grant.originExecutionId, executionId: this.grant.executionId, requestId: this.grant.requestId, ownerRunId: this.grant.ownerRunId, runId: this.#boundRunId ?? "" };
		return decodeCloseoutAttempt(this.#call("attempt", { identity, modelToolCallId, toolName, category, argsSha256, commandId, reason, poison }));
	}

	putArtifact(bytes: Buffer, complete: boolean | { complete?: boolean } = true): CloseoutOutputArtifact {
		this.#assertWritable();
		if (!Buffer.isBuffer(bytes)) throw new TypeError("artifact must be a Buffer");
		const completeValue = typeof complete === "object" ? complete.complete ?? true : complete;
		if (typeof completeValue !== "boolean") throw new TypeError("complete must be a boolean");
		return decodeCloseoutOutputArtifact(this.#call("put_artifact", { data: bytes.toString("base64"), complete: completeValue }));
	}

	putObservation(value: unknown): CloseoutRuntimeObservation {
		this.#assertWritable();
		const record = decodeCloseoutRuntimeObservation(value);
		this.#assertRecordIdentity(record);
		this.readArtifact(record.kernelEvidence);
		const attempt = this.getAttempt(record.attemptSequence);
		if (!attempt || attempt.decision !== "permitted" || attempt.toolName !== "closeout_validate") throw new Error("observation has no matching permitted validation attempt");
		return decodeCloseoutRuntimeObservation(this.#call("put_observation", { record }));
	}

	putReceipt(value: unknown): CloseoutValidationReceipt {
		this.#assertWritable();
		const record = decodeCloseoutValidationReceipt(value);
		this.#assertRecordIdentity(record);
		this.readArtifact(record.stdout); this.readArtifact(record.stderr);
		const observation = this.loadObservation(record.runtimeObservationId);
		if (observation.observationSha256 !== record.runtimeObservationSha256 || observation.attemptSequence !== record.attemptSequence) throw new Error("receipt observation binding mismatch");
		const attempt = this.getAttempt(record.attemptSequence);
		if (!attempt || attempt.decision !== "permitted" || attempt.toolName !== "closeout_validate" || attempt.commandId !== record.commandId) throw new Error("receipt has no matching permitted validation attempt");
		return decodeCloseoutValidationReceipt(this.#call("put_receipt", { record }));
	}

	loadReceipt(id: string): CloseoutValidationReceipt {
		id = nonEmpty(id, "receiptId");
		const record = decodeCloseoutValidationReceipt(this.#call("load", { kind: "receipts", id }));
		if (record.receiptId !== id) throw new Error("stored receipt ID mismatch");
		return record;
	}
	loadObservation(id: string): CloseoutRuntimeObservation {
		id = nonEmpty(id, "observationId");
		const record = decodeCloseoutRuntimeObservation(this.#call("load", { kind: "observations", id }));
		if (record.observationId !== id) throw new Error("stored observation ID mismatch");
		return record;
	}
	readArtifact(descriptor: CloseoutOutputArtifact): Buffer {
		const decoded = decodeCloseoutOutputArtifact(descriptor);
		const result = this.#call<{ data: string }>("read_artifact", { descriptor: decoded });
		return Buffer.from(result.data, "base64");
	}

	getAttempt(sequence: number): CloseoutAttempt | undefined {
		if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("sequence must be a positive safe integer");
		const audit = this.audit();
		// Prepared parallel validation calls legitimately have no receipt yet.
		// Every other corruption/revocation/restart reason prevents side effects.
		const fatal = audit.reasons.filter((reason) => !/^permitted validation attempt [1-9][0-9]* has no receipt$/.test(reason));
		if (fatal.length) throw new Error(`journal cannot authorize an effect: ${fatal.join("; ")}`);
		return audit.attempts.find((attempt) => attempt.sequence === sequence);
	}

	revoke(reason: string): void { this.#assertWritable(); this.#call("revoke", { reason: nonEmpty(reason, "reason") }); }
	/** Restart may only retire an old capability, never resume its effects. */
	abandonAfterRestart(reason: string): CloseoutJournalAudit["state"] {
		if (this.#writable) throw new Error("restart abandonment requires a reopened journal");
		return this.#call("revoke", { reason: nonEmpty(reason, "reason") });
	}
	settleAttempt(sequence: number, outcome: "completed" | "no_effect" | "failed"): void {
		this.#assertWritable();
		if (!Number.isSafeInteger(sequence) || sequence < 1) throw new TypeError("sequence must be a positive safe integer");
		if (!["completed", "no_effect", "failed"].includes(outcome)) throw new TypeError("invalid settlement outcome");
		this.#call("settle", { sequence, outcome });
	}
	finish(): void { this.#assertWritable(); this.#call("finish"); }

	audit(): CloseoutJournalAudit {
		type RawAudit = CloseoutJournalAudit & { receipts: unknown[]; observations: unknown[]; artifacts: unknown[] };
		const raw = this.#call<RawAudit>("audit");
		const reasons = Array.isArray(raw.reasons) && raw.reasons.every((reason) => typeof reason === "string") ? [...raw.reasons] : ["journal audit returned malformed reasons"];
		const stateKeys = raw.state && typeof raw.state === "object" ? Object.keys(raw.state).sort() : [];
		if (stateKeys.join(",") !== ["associationSha256", "revokeReason", "revoked", "runId", "sealed", "settled", "version"].sort().join(",")) reasons.push("journal state shape is invalid");
		if (raw.state?.version !== 1 || typeof raw.state.revoked !== "boolean" || typeof raw.state.sealed !== "boolean") reasons.push("journal state scalar values are invalid");
		if (raw.state?.associationSha256 !== null && !SHA256.test(raw.state.associationSha256)) reasons.push("journal association hash is invalid");
		if (raw.state?.runId !== null && (typeof raw.state.runId !== "string" || raw.state.runId.length === 0)) reasons.push("journal runId is invalid");
		if (raw.state?.revokeReason !== null && (typeof raw.state.revokeReason !== "string" || raw.state.revokeReason.length === 0)) reasons.push("journal revoke reason is invalid");
		if (!raw.state?.settled || typeof raw.state.settled !== "object" || Array.isArray(raw.state.settled) || Object.entries(raw.state.settled).some(([key, value]) => !/^[1-9][0-9]*$/.test(key) || !["completed", "no_effect", "failed"].includes(value))) reasons.push("journal settlements are invalid");
		if (raw.grantSha256 !== this.grantSha256) reasons.push("journal grant hash changed");
		const result = { ...raw, reasons, attempts: raw.attempts.map((attempt, index) => {
			const decoded = decodeCloseoutAttempt(attempt, `attempts[${index}]`);
			if (decoded.sequence !== index + 1 || (index > 0 && decoded.previousEntrySha256 !== raw.attempts[index - 1]?.entrySha256)) throw new Error("attempt chain is discontinuous");
			return decoded;
		}) };
		try {
			for (const [index, value] of raw.artifacts.entries()) this.readArtifact(decodeCloseoutOutputArtifact(value, `artifacts[${index}]`));
			for (const [index, value] of raw.observations.entries()) {
				const record = decodeCloseoutRuntimeObservation(value, `observations[${index}]`);
				if (this.loadObservation(record.observationId).observationSha256 !== record.observationSha256) throw new Error(`observation ${record.observationId} lookup mismatch`);
			}
			for (const [index, value] of raw.receipts.entries()) {
				const record = decodeCloseoutValidationReceipt(value, `receipts[${index}]`);
				if (this.loadReceipt(record.receiptId).receiptSha256 !== record.receiptSha256) throw new Error(`receipt ${record.receiptId} lookup mismatch`);
			}
		} catch (error) { result.reasons.push(`stored evidence audit failed: ${String(error)}`); }
		const modelIds = new Set<string>();
		const counts = { work: 0, report: 0 };
		for (const attempt of result.attempts) {
			for (const key of ["taskId", "originExecutionId", "executionId", "requestId", "ownerRunId"] as const) {
				if (attempt[key] !== this.grant[key]) result.reasons.push(`attempt ${attempt.sequence} ${key} mismatch`);
			}
			if (attempt.runId !== raw.state.runId) result.reasons.push(`attempt ${attempt.sequence} runId mismatch`);
			const category = attempt.toolName === "structured_output" ? "report" : "work";
			if (attempt.category !== category || attempt.categoryOrdinal !== ++counts[category]) result.reasons.push(`attempt ${attempt.sequence} counter mismatch`);
			if (attempt.decision === "permitted" && (counts[category] > (category === "work" ? 5 : 1) || modelIds.has(attempt.modelToolCallId))) result.reasons.push(`attempt ${attempt.sequence} violates single-use quota`);
			if (modelIds.has(attempt.modelToolCallId) && !raw.state.revoked) result.reasons.push("duplicate model tool call ID did not revoke grant");
			modelIds.add(attempt.modelToolCallId);
			if (!["closeout_read", "closeout_validate", "structured_output"].includes(attempt.toolName) && !raw.state.revoked) result.reasons.push("unknown tool did not revoke grant");
		}
		if (!this.#writable && !raw.state.sealed) result.reasons.push("journal was reopened before durable finish");
		return { valid: result.reasons.length === 0, blocked: result.reasons.length > 0, reasons: result.reasons, state: raw.state, attempts: result.attempts, grantSha256: raw.grantSha256 };
	}

	#assertWritable(): void { if (!this.#writable) throw new Error("a reopened journal is read-only"); }
	#assertRecordIdentity(record: { taskId: string; originExecutionId: string; executionId: string; requestId: string; ownerRunId: string; runId: string }): void {
		for (const field of ["taskId", "originExecutionId", "executionId", "requestId", "ownerRunId"] as const) if (record[field] !== this.grant[field]) throw new Error(`${field} mismatch`);
		if (record.runId !== this.#boundRunId) throw new Error("runId mismatch");
	}
	#call<T = unknown>(operation: string, extra: Record<string, unknown> = {}): T { return helper<T>({ operation, root: this.root, claimHash: this.claimHash, claim: this.#claim, grantSha256: this.grantSha256, ...extra }); }
}
