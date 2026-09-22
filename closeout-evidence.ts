import { createHash } from "node:crypto";
import { stableStringify } from "./report.ts";
import type {
	CloseoutAttempt,
	CloseoutCapabilityAck,
	CloseoutCommand,
	CloseoutEffectiveControls,
	CloseoutGrant,
	CloseoutIdentity,
	CloseoutInputBinding,
	CloseoutOutputArtifact,
	CloseoutReadArgs,
	CloseoutReportBinding,
	CloseoutRequestCapability,
	CloseoutRuntimeObservation,
	CloseoutValidateArgs,
	CloseoutValidationReceipt,
} from "./closeout-types.ts";

type ObjectValue = Record<string, unknown>;
type Decoder<T> = (value: unknown, label?: string) => T;

const SHA256 = /^[0-9a-f]{64}$/;

function fail(label: string, message: string): never {
	throw new TypeError(`${label} ${message}`);
}

function object(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): ObjectValue {
	if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label, "must be an object");
	const record = value as ObjectValue;
	const proto = Object.getPrototypeOf(record);
	if (proto !== Object.prototype && proto !== null) fail(label, "must be a plain object");
	const allowed = new Set([...required, ...optional]);
	for (const ownKey of Reflect.ownKeys(record)) {
		if (typeof ownKey !== "string") fail(label, "contains a symbol field");
		const key = ownKey;
		if (!Object.prototype.propertyIsEnumerable.call(record, key)) fail(`${label}.${key}`, "must be enumerable");
		if (!allowed.has(key)) fail(label, `contains unknown field ${key}`);
		if (record[key] === undefined) fail(`${label}.${key}`, "must not be undefined");
	}
	for (const key of required) if (!Object.hasOwn(record, key)) fail(label, `is missing ${key}`);
	return record;
}

function string(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) fail(label, "must be a non-empty string");
	return value;
}

function sha(value: unknown, label: string): string {
	const result = string(value, label);
	if (!SHA256.test(result)) fail(label, "must be a lowercase SHA-256 digest");
	return result;
}

function integer(value: unknown, label: string, minimum = 0): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(label, `must be a safe integer >= ${minimum}`);
	return value as number;
}

function bool(value: unknown, label: string): boolean {
	if (typeof value !== "boolean") fail(label, "must be a boolean");
	return value;
}

function literal<T extends string | number>(value: unknown, label: string, allowed: readonly T[]): T {
	if (!allowed.includes(value as T)) fail(label, `must be one of ${allowed.join(", ")}`);
	return value as T;
}

function nullable<T>(value: unknown, decode: (input: unknown) => T): T | null {
	return value === null ? null : decode(value);
}

function isoDate(value: unknown, label: string): string {
	const result = string(value, label);
	const date = new Date(result);
	if (!Number.isFinite(date.valueOf()) || date.toISOString() !== result) fail(label, "must be a canonical ISO-8601 timestamp");
	return result;
}

function stringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) fail(label, "must be an array");
	if (Reflect.ownKeys(value).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))) || Object.keys(value).length !== value.length) fail(label, "must be a dense array without extra fields");
	return Array.from(value, (entry, index) => string(entry, `${label}[${index}]`));
}

function assertJson(value: unknown, label = "value", seen = new Set<object>()): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) fail(label, "contains a non-finite number");
		return;
	}
	if (typeof value !== "object") fail(label, `contains unsupported ${typeof value}`);
	if (seen.has(value as object)) fail(label, "contains a cycle");
	seen.add(value as object);
	if (Array.isArray(value)) {
		if (Reflect.ownKeys(value).some((key) => key !== "length" && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key))) || Object.keys(value).length !== value.length) fail(label, "contains a sparse array or extra array field");
		value.forEach((entry, index) => assertJson(entry, `${label}[${index}]`, seen));
	}
	else {
		const proto = Object.getPrototypeOf(value);
		if (proto !== Object.prototype && proto !== null) fail(label, "contains a non-plain object");
		for (const ownKey of Reflect.ownKeys(value as object)) {
			if (typeof ownKey !== "string") fail(label, "contains a symbol field");
			if (!Object.prototype.propertyIsEnumerable.call(value, ownKey)) fail(`${label}.${ownKey}`, "must be enumerable");
			const key = ownKey;
			const entry = (value as ObjectValue)[key];
			if (entry === undefined) fail(`${label}.${key}`, "must not be undefined");
			assertJson(entry, `${label}.${key}`, seen);
		}
	}
	seen.delete(value as object);
}

export function canonicalSha256(value: unknown): string {
	assertJson(value);
	return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function without<T extends ObjectValue>(value: T, field: string): ObjectValue {
	const result = { ...value };
	delete result[field];
	return result;
}

const IDENTITY_FIELDS = ["taskId", "originExecutionId", "executionId", "requestId", "ownerRunId", "runId"] as const;

export function decodeCloseoutIdentity(value: unknown, label = "CloseoutIdentity"): CloseoutIdentity {
	const record = object(value, label, IDENTITY_FIELDS);
	return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, string(record[field], `${label}.${field}`)])) as unknown as CloseoutIdentity;
}

function identity(record: ObjectValue, label: string): CloseoutIdentity {
	return Object.fromEntries(IDENTITY_FIELDS.map((field) => [field, string(record[field], `${label}.${field}`)])) as unknown as CloseoutIdentity;
}

export const decodeCloseoutEffectiveControls: Decoder<CloseoutEffectiveControls> = (value, label = "CloseoutEffectiveControls") => {
	const fields = ["memoryMaxBytes", "memorySwapMaxBytes", "pidsMax", "cpuQuotaUs", "cpuPeriodUs"] as const;
	const record = object(value, label, fields);
	return {
		memoryMaxBytes: integer(record.memoryMaxBytes, `${label}.memoryMaxBytes`, 1),
		memorySwapMaxBytes: integer(record.memorySwapMaxBytes, `${label}.memorySwapMaxBytes`),
		pidsMax: integer(record.pidsMax, `${label}.pidsMax`, 1),
		cpuQuotaUs: integer(record.cpuQuotaUs, `${label}.cpuQuotaUs`, 1),
		cpuPeriodUs: integer(record.cpuPeriodUs, `${label}.cpuPeriodUs`, 1),
	};
};

export const decodeCloseoutOutputArtifact: Decoder<CloseoutOutputArtifact> = (value, label = "CloseoutOutputArtifact") => {
	const record = object(value, label, ["artifactId", "sha256", "bytes", "complete"]);
	return { artifactId: string(record.artifactId, `${label}.artifactId`), sha256: sha(record.sha256, `${label}.sha256`), bytes: integer(record.bytes, `${label}.bytes`), complete: bool(record.complete, `${label}.complete`) };
};

export const decodeCloseoutInputBinding: Decoder<CloseoutInputBinding> = (value, label = "CloseoutInputBinding") => {
	const fields = ["workspaceId", "head", "sourceManifestSha256", "gitMetadataManifestSha256", "dependencyManifestSha256", "isolationProfileSha256", "snapshotArtifactId", "capturedAt", "state"] as const;
	const record = object(value, label, fields);
	return {
		workspaceId: string(record.workspaceId, `${label}.workspaceId`), head: string(record.head, `${label}.head`),
		sourceManifestSha256: sha(record.sourceManifestSha256, `${label}.sourceManifestSha256`), gitMetadataManifestSha256: sha(record.gitMetadataManifestSha256, `${label}.gitMetadataManifestSha256`),
		dependencyManifestSha256: sha(record.dependencyManifestSha256, `${label}.dependencyManifestSha256`), isolationProfileSha256: sha(record.isolationProfileSha256, `${label}.isolationProfileSha256`),
		snapshotArtifactId: string(record.snapshotArtifactId, `${label}.snapshotArtifactId`), capturedAt: isoDate(record.capturedAt, `${label}.capturedAt`), state: literal(record.state, `${label}.state`, ["complete"]),
	};
};

export const decodeCloseoutCommand: Decoder<CloseoutCommand> = (value, label = "CloseoutCommand") => {
	const fields = ["commandId", "specCommandIndex", "originalCommand", "executable", "argv", "cwd", "environmentProfileId", "timeoutMs", "descriptorSha256"] as const;
	const record = object(value, label, fields);
	const result: CloseoutCommand = {
		commandId: string(record.commandId, `${label}.commandId`), specCommandIndex: integer(record.specCommandIndex, `${label}.specCommandIndex`), originalCommand: string(record.originalCommand, `${label}.originalCommand`),
		executable: string(record.executable, `${label}.executable`), argv: stringArray(record.argv, `${label}.argv`), cwd: string(record.cwd, `${label}.cwd`), environmentProfileId: string(record.environmentProfileId, `${label}.environmentProfileId`),
		timeoutMs: integer(record.timeoutMs, `${label}.timeoutMs`, 1), descriptorSha256: sha(record.descriptorSha256, `${label}.descriptorSha256`),
	};
	if (!result.executable.startsWith("/") || !result.cwd.startsWith("/")) fail(label, "executable and cwd must be absolute paths");
	if (result.timeoutMs > 60_000) fail(`${label}.timeoutMs`, "must be <= 60000");
	if (canonicalSha256(without(result as unknown as ObjectValue, "descriptorSha256")) !== result.descriptorSha256) fail(`${label}.descriptorSha256`, "does not match canonical descriptor bytes");
	return result;
};

export const decodeCloseoutGrant: Decoder<CloseoutGrant> = (value, label = "CloseoutGrant") => {
	const fields = ["version", "grantId", "taskId", "originExecutionId", "executionId", "requestId", "ownerRunId", "specSha256", "originEvidenceSha256", "expectedInputs", "expectedControls", "commands", "workAttemptsLimit", "reportAttemptsLimit", "executionDeadline", "journalId"] as const;
	const record = object(value, label, fields);
	if (!Array.isArray(record.commands) || record.commands.length < 1 || record.commands.length > 5) fail(`${label}.commands`, "must contain 1 to 5 commands");
	const commands = record.commands.map((entry, index) => decodeCloseoutCommand(entry, `${label}.commands[${index}]`));
	if (new Set(commands.map((command) => command.commandId)).size !== commands.length) fail(`${label}.commands`, "contains duplicate commandId");
	if (new Set(commands.map((command) => command.specCommandIndex)).size !== commands.length) fail(`${label}.commands`, "contains duplicate specCommandIndex");
	return {
		version: literal(record.version, `${label}.version`, [1]), grantId: string(record.grantId, `${label}.grantId`), taskId: string(record.taskId, `${label}.taskId`), originExecutionId: string(record.originExecutionId, `${label}.originExecutionId`), executionId: string(record.executionId, `${label}.executionId`), requestId: string(record.requestId, `${label}.requestId`), ownerRunId: string(record.ownerRunId, `${label}.ownerRunId`),
		specSha256: sha(record.specSha256, `${label}.specSha256`), originEvidenceSha256: sha(record.originEvidenceSha256, `${label}.originEvidenceSha256`), expectedInputs: decodeCloseoutInputBinding(record.expectedInputs, `${label}.expectedInputs`), expectedControls: decodeCloseoutEffectiveControls(record.expectedControls, `${label}.expectedControls`), commands,
		workAttemptsLimit: literal(record.workAttemptsLimit, `${label}.workAttemptsLimit`, [5]), reportAttemptsLimit: literal(record.reportAttemptsLimit, `${label}.reportAttemptsLimit`, [1]), executionDeadline: isoDate(record.executionDeadline, `${label}.executionDeadline`), journalId: string(record.journalId, `${label}.journalId`),
	};
};

export const decodeCloseoutRequestCapability: Decoder<CloseoutRequestCapability> = (value, label = "CloseoutRequestCapability") => {
	const record = object(value, label, ["version", "grantId", "grantSha256"]);
	return { version: literal(record.version, `${label}.version`, [1]), grantId: string(record.grantId, `${label}.grantId`), grantSha256: sha(record.grantSha256, `${label}.grantSha256`) };
};

export const decodeCloseoutCapabilityAck: Decoder<CloseoutCapabilityAck> = (value, label = "CloseoutCapabilityAck") => {
	if (typeof value !== "object" || value === null || Array.isArray(value)) fail(label, "must be an object");
	const status = (value as ObjectValue).status;
	const required = status === "ready" ? ["version", "grantId", "grantSha256", "requestId", "ownerRunId", "nodeId", "status", "runId", "profileSha256", "activeTools"] : ["version", "grantId", "grantSha256", "requestId", "ownerRunId", "nodeId", "status", "reason"];
	const record = object(value, label, required);
	const base = { version: literal(record.version, `${label}.version`, [1]) as 1, grantId: string(record.grantId, `${label}.grantId`), grantSha256: sha(record.grantSha256, `${label}.grantSha256`), requestId: string(record.requestId, `${label}.requestId`), ownerRunId: string(record.ownerRunId, `${label}.ownerRunId`), nodeId: string(record.nodeId, `${label}.nodeId`) };
	if (status === "ready") {
		if (!Array.isArray(record.activeTools) || stableStringify(record.activeTools) !== stableStringify(["closeout_read", "closeout_validate", "structured_output"])) fail(`${label}.activeTools`, "must be the exact ordered closeout tool set");
		return { ...base, status: "ready", runId: string(record.runId, `${label}.runId`), profileSha256: sha(record.profileSha256, `${label}.profileSha256`), activeTools: ["closeout_read", "closeout_validate", "structured_output"] } as unknown as CloseoutCapabilityAck;
	}
	return { ...base, status: literal(status, `${label}.status`, ["unavailable"]), reason: string(record.reason, `${label}.reason`) } as unknown as CloseoutCapabilityAck;
};

export const decodeCloseoutAttempt: Decoder<CloseoutAttempt> = (value, label = "CloseoutAttempt") => {
	const required = ["version", ...IDENTITY_FIELDS, "sequence", "occurrenceId", "modelToolCallId", "toolName", "category", "categoryOrdinal", "argsSha256", "decision", "recordedAt", "previousEntrySha256", "entrySha256"];
	const record = object(value, label, required, ["commandId", "reason"]);
	const result: CloseoutAttempt = {
		version: literal(record.version, `${label}.version`, [1]), ...identity(record, label), sequence: integer(record.sequence, `${label}.sequence`, 1), occurrenceId: string(record.occurrenceId, `${label}.occurrenceId`), modelToolCallId: string(record.modelToolCallId, `${label}.modelToolCallId`), toolName: string(record.toolName, `${label}.toolName`), category: literal(record.category, `${label}.category`, ["work", "report"]), categoryOrdinal: integer(record.categoryOrdinal, `${label}.categoryOrdinal`, 1), argsSha256: sha(record.argsSha256, `${label}.argsSha256`), decision: literal(record.decision, `${label}.decision`, ["permitted", "denied"]), recordedAt: isoDate(record.recordedAt, `${label}.recordedAt`), previousEntrySha256: sha(record.previousEntrySha256, `${label}.previousEntrySha256`), entrySha256: sha(record.entrySha256, `${label}.entrySha256`),
		...(record.commandId === undefined ? {} : { commandId: string(record.commandId, `${label}.commandId`) }), ...(record.reason === undefined ? {} : { reason: string(record.reason, `${label}.reason`) }),
	};
	if (canonicalSha256(without(result as unknown as ObjectValue, "entrySha256")) !== result.entrySha256) fail(`${label}.entrySha256`, "does not match canonical entry bytes");
	return result;
};

function decodeObservationSample(value: unknown, label: string): { observedAt: string; controls: CloseoutEffectiveControls } | null {
	if (value === null) return null;
	const record = object(value, label, ["observedAt", "controls"]);
	return { observedAt: isoDate(record.observedAt, `${label}.observedAt`), controls: decodeCloseoutEffectiveControls(record.controls, `${label}.controls`) };
}

export const decodeCloseoutRuntimeObservation: Decoder<CloseoutRuntimeObservation> = (value, label = "CloseoutRuntimeObservation") => {
	const required = ["version", ...IDENTITY_FIELDS, "observationId", "attemptSequence", "isolationProfileSha256", "state", "scopeUnit", "cgroupPath", "cgroupId", "hostBootId", "namespaceInitPid", "namespaceInitStartTicks", "before", "after", "kernelEvidence", "observationSha256"];
	const record = object(value, label, required, ["unknownReason"]);
	const state = literal(record.state, `${label}.state`, ["complete", "unknown"]);
	const maybeEmpty = (entry: unknown, field: string) => {
		if (typeof entry !== "string") fail(`${label}.${field}`, "must be a string");
		return entry;
	};
	const result: CloseoutRuntimeObservation = {
		version: literal(record.version, `${label}.version`, [1]), ...identity(record, label), observationId: string(record.observationId, `${label}.observationId`), attemptSequence: integer(record.attemptSequence, `${label}.attemptSequence`, 1), isolationProfileSha256: sha(record.isolationProfileSha256, `${label}.isolationProfileSha256`), state,
		scopeUnit: maybeEmpty(record.scopeUnit, "scopeUnit"), cgroupPath: maybeEmpty(record.cgroupPath, "cgroupPath"), cgroupId: maybeEmpty(record.cgroupId, "cgroupId"), hostBootId: maybeEmpty(record.hostBootId, "hostBootId"), namespaceInitPid: integer(record.namespaceInitPid, `${label}.namespaceInitPid`, state === "complete" ? 1 : 0), namespaceInitStartTicks: maybeEmpty(record.namespaceInitStartTicks, "namespaceInitStartTicks"), before: decodeObservationSample(record.before, `${label}.before`), after: decodeObservationSample(record.after, `${label}.after`), kernelEvidence: decodeCloseoutOutputArtifact(record.kernelEvidence, `${label}.kernelEvidence`), observationSha256: sha(record.observationSha256, `${label}.observationSha256`),
		...(record.unknownReason === undefined ? {} : { unknownReason: string(record.unknownReason, `${label}.unknownReason`) }),
	};
	if (result.state === "complete" && (result.before === null || result.after === null || result.unknownReason !== undefined)) fail(label, "complete state requires before/after and no unknownReason");
	if (result.state === "complete" && [result.scopeUnit, result.cgroupPath, result.cgroupId, result.hostBootId, result.namespaceInitStartTicks].some((entry) => entry.length === 0)) fail(label, "complete state requires non-empty runtime identity fields");
	if (result.state === "unknown" && result.unknownReason === undefined) fail(label, "unknown state requires unknownReason");
	if (canonicalSha256(without(result as unknown as ObjectValue, "observationSha256")) !== result.observationSha256) fail(`${label}.observationSha256`, "does not match canonical observation bytes");
	return result;
};

export const decodeCloseoutValidationReceipt: Decoder<CloseoutValidationReceipt> = (value, label = "CloseoutValidationReceipt") => {
	const fields = ["version", ...IDENTITY_FIELDS, "receiptId", "attemptSequence", "commandId", "descriptorSha256", "grantSha256", "startedAt", "endedAt", "durationMs", "outcome", "exitCode", "signal", "timedOut", "cancelled", "startupError", "processTreeStopped", "beforeInputs", "afterInputs", "stdout", "stderr", "runtimeObservationId", "runtimeObservationSha256", "receiptSha256"];
	const record = object(value, label, fields);
	const result: CloseoutValidationReceipt = {
		version: literal(record.version, `${label}.version`, [1]), ...identity(record, label), receiptId: string(record.receiptId, `${label}.receiptId`), attemptSequence: integer(record.attemptSequence, `${label}.attemptSequence`, 1), commandId: string(record.commandId, `${label}.commandId`), descriptorSha256: sha(record.descriptorSha256, `${label}.descriptorSha256`), grantSha256: sha(record.grantSha256, `${label}.grantSha256`), startedAt: isoDate(record.startedAt, `${label}.startedAt`), endedAt: isoDate(record.endedAt, `${label}.endedAt`), durationMs: integer(record.durationMs, `${label}.durationMs`), outcome: literal(record.outcome, `${label}.outcome`, ["passed", "failed", "timed_out", "cancelled", "startup_failed", "evidence_failed"]),
		exitCode: nullable(record.exitCode, (entry) => integer(entry, `${label}.exitCode`)), signal: nullable(record.signal, (entry) => string(entry, `${label}.signal`)), timedOut: bool(record.timedOut, `${label}.timedOut`), cancelled: bool(record.cancelled, `${label}.cancelled`), startupError: nullable(record.startupError, (entry) => string(entry, `${label}.startupError`)), processTreeStopped: bool(record.processTreeStopped, `${label}.processTreeStopped`), beforeInputs: decodeCloseoutInputBinding(record.beforeInputs, `${label}.beforeInputs`), afterInputs: decodeCloseoutInputBinding(record.afterInputs, `${label}.afterInputs`), stdout: decodeCloseoutOutputArtifact(record.stdout, `${label}.stdout`), stderr: decodeCloseoutOutputArtifact(record.stderr, `${label}.stderr`), runtimeObservationId: string(record.runtimeObservationId, `${label}.runtimeObservationId`), runtimeObservationSha256: sha(record.runtimeObservationSha256, `${label}.runtimeObservationSha256`), receiptSha256: sha(record.receiptSha256, `${label}.receiptSha256`),
	};
	if (canonicalSha256(without(result as unknown as ObjectValue, "receiptSha256")) !== result.receiptSha256) fail(`${label}.receiptSha256`, "does not match canonical receipt bytes");
	return result;
};

export const decodeCloseoutReportBinding: Decoder<CloseoutReportBinding> = (value, label = "CloseoutReportBinding") => {
	const fields = ["version", ...IDENTITY_FIELDS, "reportRevision", "reportSha256", "reportAttemptSequence", "receiptIds", "originEvidenceSha256", "freshEvidenceSha256", "currentInputs", "inheritedTruthPaths", "newTruthPaths"];
	const record = object(value, label, fields);
	if (!Array.isArray(record.newTruthPaths) || record.newTruthPaths.length !== 0) fail(`${label}.newTruthPaths`, "must be empty");
	const receiptIds = stringArray(record.receiptIds, `${label}.receiptIds`);
	if (new Set(receiptIds).size !== receiptIds.length) fail(`${label}.receiptIds`, "must not contain duplicates");
	return { version: literal(record.version, `${label}.version`, [1]), ...identity(record, label), reportRevision: integer(record.reportRevision, `${label}.reportRevision`, 1), reportSha256: sha(record.reportSha256, `${label}.reportSha256`), reportAttemptSequence: integer(record.reportAttemptSequence, `${label}.reportAttemptSequence`, 1), receiptIds, originEvidenceSha256: sha(record.originEvidenceSha256, `${label}.originEvidenceSha256`), freshEvidenceSha256: sha(record.freshEvidenceSha256, `${label}.freshEvidenceSha256`), currentInputs: decodeCloseoutInputBinding(record.currentInputs, `${label}.currentInputs`), inheritedTruthPaths: stringArray(record.inheritedTruthPaths, `${label}.inheritedTruthPaths`), newTruthPaths: [] };
};

export const decodeCloseoutReadArgs: Decoder<CloseoutReadArgs> = (value, label = "CloseoutReadArgs") => {
	const record = object(value, label, ["pathId", "offset", "limit"]);
	const result = { pathId: string(record.pathId, `${label}.pathId`), offset: integer(record.offset, `${label}.offset`), limit: integer(record.limit, `${label}.limit`, 1) };
	if (result.limit > 65_536) fail(`${label}.limit`, "must be <= 65536");
	return result;
};

export const decodeCloseoutValidateArgs: Decoder<CloseoutValidateArgs> = (value, label = "CloseoutValidateArgs") => {
	const record = object(value, label, ["commandId"]);
	return { commandId: string(record.commandId, `${label}.commandId`) };
};

export interface CloseoutEvidenceStore {
	loadReceipt(id: string): CloseoutValidationReceipt;
	loadObservation(id: string): CloseoutRuntimeObservation;
	readArtifact(descriptor: CloseoutOutputArtifact): Buffer;
	getAttempt(sequence: number): CloseoutAttempt | undefined;
	audit(): { valid: boolean; blocked: boolean; reasons: readonly string[] };
}

export interface CloseoutEvidenceRequest {
	grant: unknown;
	identity: CloseoutIdentity;
	store: CloseoutEvidenceStore;
	expectedCommandIds: readonly string[];
	receiptIds: readonly string[];
	currentInputs: unknown;
	/** False admits authentic failed receipts for an honest non-completed report. */
	requirePassed?: boolean;
}

export interface CloseoutEvidenceResult {
	valid: boolean;
	errors: readonly string[];
	receipts: readonly CloseoutValidationReceipt[];
}

function equal(left: unknown, right: unknown): boolean { return stableStringify(left) === stableStringify(right); }
function sameIdentity(value: CloseoutIdentity, expected: CloseoutIdentity): boolean { return IDENTITY_FIELDS.every((field) => value[field] === expected[field]); }

export function validateCloseoutEvidence(request: CloseoutEvidenceRequest): CloseoutEvidenceResult {
	const errors: string[] = [];
	let grant: CloseoutGrant;
	let currentInputs: CloseoutInputBinding;
	let expectedIdentity: CloseoutIdentity;
	try { grant = decodeCloseoutGrant(request.grant); } catch (error) { return { valid: false, errors: [String(error)], receipts: [] }; }
	try { currentInputs = decodeCloseoutInputBinding(request.currentInputs); } catch (error) { return { valid: false, errors: [String(error)], receipts: [] }; }
	try { expectedIdentity = decodeCloseoutIdentity(request.identity); } catch (error) { return { valid: false, errors: [String(error)], receipts: [] }; }
	const grantSha256 = canonicalSha256(grant);
	try {
		const audit = request.store.audit();
		if (!audit.valid || audit.blocked) errors.push(...(audit.reasons.length > 0 ? audit.reasons.map((reason) => `journal: ${reason}`) : ["journal audit failed closed"]));
	} catch (error) { errors.push(`journal audit failed: ${String(error)}`); }
	if (!sameIdentity({ ...grant, runId: expectedIdentity.runId }, expectedIdentity)) errors.push("grant identity does not match expected identity");
	if (!equal(currentInputs, grant.expectedInputs)) errors.push("current input binding does not match grant");
	if (new Set(request.expectedCommandIds).size !== request.expectedCommandIds.length) errors.push("expected command IDs contain duplicates");
	if (!equal(request.expectedCommandIds, grant.commands.map((command) => command.commandId))) errors.push("expected command IDs do not exactly match grant order");
	if (new Set(request.receiptIds).size !== request.receiptIds.length) errors.push("receipt IDs contain duplicates");
	const receipts: CloseoutValidationReceipt[] = [];
	for (const receiptId of request.receiptIds) {
		try {
			const receipt = decodeCloseoutValidationReceipt(request.store.loadReceipt(receiptId));
			if (receipt.receiptId !== receiptId) throw new Error("loaded receipt ID mismatch");
			receipts.push(receipt);
		} catch (error) { errors.push(`receipt ${receiptId}: ${String(error)}`); }
	}
	const byCommand = new Map<string, CloseoutValidationReceipt[]>();
	for (const receipt of receipts) byCommand.set(receipt.commandId, [...(byCommand.get(receipt.commandId) ?? []), receipt]);
	for (const command of grant.commands) {
		const matches = byCommand.get(command.commandId) ?? [];
		if (matches.length !== 1) errors.push(`command ${command.commandId} must have exactly one receipt`);
	}
	for (const commandId of byCommand.keys()) if (!request.expectedCommandIds.includes(commandId)) errors.push(`unexpected receipt command ${commandId}`);
	for (const receipt of receipts) {
		const command = grant.commands.find((entry) => entry.commandId === receipt.commandId);
		if (!command) continue;
		if (!sameIdentity(receipt, expectedIdentity)) errors.push(`receipt ${receipt.receiptId} identity mismatch`);
		if (receipt.grantSha256 !== grantSha256 || receipt.descriptorSha256 !== command.descriptorSha256) errors.push(`receipt ${receipt.receiptId} grant/descriptor binding mismatch`);
		if (!equal(receipt.beforeInputs, grant.expectedInputs) || !equal(receipt.afterInputs, currentInputs)) errors.push(`receipt ${receipt.receiptId} input binding mismatch`);
		if (request.requirePassed !== false && (receipt.outcome !== "passed" || receipt.exitCode !== 0 || receipt.signal !== null || receipt.timedOut || receipt.cancelled || receipt.startupError !== null || !receipt.processTreeStopped)) errors.push(`receipt ${receipt.receiptId} is not a clean passed execution`);
		const attempt = request.store.getAttempt(receipt.attemptSequence);
		if (!attempt || decodeCloseoutAttempt(attempt).decision !== "permitted" || attempt.toolName !== "closeout_validate" || attempt.commandId !== command.commandId || !sameIdentity(attempt, expectedIdentity)) errors.push(`receipt ${receipt.receiptId} has no matching permitted attempt`);
		let observation: CloseoutRuntimeObservation | undefined;
		try {
			observation = decodeCloseoutRuntimeObservation(request.store.loadObservation(receipt.runtimeObservationId));
			if (observation.observationId !== receipt.runtimeObservationId) throw new Error("loaded observation ID mismatch");
		} catch (error) { errors.push(`receipt ${receipt.receiptId} observation: ${String(error)}`); }
		if (observation) {
			if (!sameIdentity(observation, expectedIdentity) || observation.attemptSequence !== receipt.attemptSequence || observation.isolationProfileSha256 !== grant.expectedInputs.isolationProfileSha256 || observation.observationSha256 !== receipt.runtimeObservationSha256) errors.push(`receipt ${receipt.receiptId} observation binding mismatch`);
			if (request.requirePassed !== false && (observation.state !== "complete" || !observation.before || !observation.after || !equal(observation.before?.controls, grant.expectedControls) || !equal(observation.after?.controls, grant.expectedControls))) errors.push(`receipt ${receipt.receiptId} runtime controls are incomplete or mismatched`);
			if (observation.before && !equal(observation.before.controls, grant.expectedControls)) errors.push(`receipt ${receipt.receiptId} before controls mismatch`);
			if (observation.after && !equal(observation.after.controls, grant.expectedControls)) errors.push(`receipt ${receipt.receiptId} after controls mismatch`);
			for (const descriptor of [observation.kernelEvidence]) verifyArtifact(request.store, descriptor, `observation ${observation.observationId}`, errors, request.requirePassed !== false);
		}
		verifyArtifact(request.store, receipt.stdout, `receipt ${receipt.receiptId} stdout`, errors, request.requirePassed !== false);
		verifyArtifact(request.store, receipt.stderr, `receipt ${receipt.receiptId} stderr`, errors, request.requirePassed !== false);
	}
	return { valid: errors.length === 0, errors, receipts };
}

function verifyArtifact(store: CloseoutEvidenceStore, descriptor: CloseoutOutputArtifact, label: string, errors: string[], requireComplete = true): void {
	if (requireComplete && !descriptor.complete) errors.push(`${label} artifact is incomplete`);
	try {
		const bytes = store.readArtifact(descriptor);
		if (bytes.length !== descriptor.bytes || createHash("sha256").update(bytes).digest("hex") !== descriptor.sha256) errors.push(`${label} artifact content mismatch`);
	} catch (error) { errors.push(`${label} artifact: ${String(error)}`); }
}
