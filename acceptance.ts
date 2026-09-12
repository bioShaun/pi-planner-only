export type EvidenceMatrixStatus = "implemented" | "handler-verified" | "host-verified" | "unproven";

export interface EvidenceMatrixEntry {
	id: string;
	status: EvidenceMatrixStatus;
	evidence: string[];
	/** Recorded when provenance was missing and a claimed verified status was
	 * refused (spec L143: 任一缺失不能升格). */
	downgradedFrom?: "handler-verified" | "host-verified";
	/** Explicit not-done reason for unproven entries (C17). */
	notDoneReason?: string;
}

export type EvidenceMatrixClaim = EvidenceMatrixStatus | {
	status: EvidenceMatrixStatus;
	evidence?: string[];
	notDoneReason?: string;
};

export interface AcceptanceEvidenceMatrixOptions {
	sourcePath?: string;
	loadedFingerprint?: string;
	diskHead?: string;
	rootSessionId?: string;
	runIds?: readonly string[];
	executionIds?: readonly string[];
	criteria?: Partial<Record<string, EvidenceMatrixClaim>>;
	behaviors?: Partial<Record<string, EvidenceMatrixClaim>>;
}

const CRITERIA = Array.from({ length: 18 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
const BEHAVIORS = Array.from({ length: 24 }, (_, index) => `B${String(index + 1).padStart(2, "0")}`);

function missingHostProvenance(options: AcceptanceEvidenceMatrixOptions): string[] {
	const missing: string[] = [];
	if (!options.sourcePath) missing.push("sourcePath");
	if (!options.loadedFingerprint) missing.push("loadedFingerprint");
	if (!options.diskHead) missing.push("diskHead");
	if (!options.rootSessionId) missing.push("rootSessionId");
	if (!options.runIds?.length && !options.executionIds?.length) missing.push("run/execution id");
	return missing;
}

function resolveEntry(id: string, claim: EvidenceMatrixClaim | undefined, context: string[], missingHost: string[]): EvidenceMatrixEntry {
	const notDoneReason = typeof claim === "object" && claim ? claim.notDoneReason : undefined;
	if (!claim || (typeof claim === "string" && claim === "unproven")) {
		return { id, status: "unproven", evidence: context, ...(notDoneReason ? { notDoneReason } : {}) };
	}
	const claimedStatus = typeof claim === "string" ? claim : claim.status;
	const claimedEvidence = typeof claim === "string" ? [] : claim.evidence ?? [];
	if (claimedStatus === "host-verified" && missingHost.length > 0) {
		return {
			id,
			status: "implemented",
			evidence: [...context, ...claimedEvidence, `downgraded from host-verified: missing ${missingHost.join(", ")}`],
			downgradedFrom: "host-verified",
		};
	}
	if (claimedStatus === "handler-verified" && claimedEvidence.length === 0) {
		return {
			id,
			status: "implemented",
			evidence: [...context, "downgraded from handler-verified: no handler-run evidence supplied"],
			downgradedFrom: "handler-verified",
		};
	}
	return {
		id,
		status: claimedStatus,
		evidence: [...context, ...claimedEvidence],
		...(notDoneReason ? { notDoneReason } : {}),
	};
}

/**
 * Build the C01-C18/B01-B24 release matrix (spec L143/L148). Status levels are
 * 代码完成 (implemented) / handler 验证 (handler-verified) / 宿主验证
 * (host-verified); missing provenance cannot upgrade — a claimed host pass
 * without full provenance, or a handler claim without handler evidence, is
 * recorded as implemented with an explicit downgrade note. Entries without any
 * claim stay unproven, and a passing helper test cannot silently become a host
 * pass.
 */
export function buildAcceptanceEvidenceMatrix(options: AcceptanceEvidenceMatrixOptions = {}): EvidenceMatrixEntry[] {
	const context = [
		options.sourcePath ? `sourcePath=${options.sourcePath}` : "sourcePath unavailable",
		options.loadedFingerprint ? `loadedFingerprint=${options.loadedFingerprint}` : "loaded fingerprint unavailable",
		options.diskHead ? `diskHead=${options.diskHead}` : "disk HEAD unavailable",
		options.rootSessionId ? `rootSessionId=${options.rootSessionId}` : "Root session unavailable",
		options.runIds?.length ? `runId=${options.runIds.join(",")}` : "runId unavailable",
		options.executionIds?.length ? `executionId=${options.executionIds.join(",")}` : "executionId unavailable",
	];
	const missingHost = missingHostProvenance(options);
	return [
		...CRITERIA.map((id) => resolveEntry(id, options.criteria?.[id], context, missingHost)),
		...BEHAVIORS.map((id) => resolveEntry(id, options.behaviors?.[id], context, missingHost)),
	];
}

export const ACCEPTANCE_CRITERIA_IDS = Object.freeze([...CRITERIA]);
export const ACCEPTANCE_BEHAVIOR_IDS = Object.freeze([...BEHAVIORS]);
