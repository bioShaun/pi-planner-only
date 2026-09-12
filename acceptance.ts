export type EvidenceMatrixStatus = "implemented" | "unit-verified" | "host-verified" | "unproven";

export interface EvidenceMatrixEntry {
	id: string;
	status: EvidenceMatrixStatus;
	evidence: string[];
}

export interface AcceptanceEvidenceMatrixOptions {
	sourcePath?: string;
	loadedFingerprint?: string;
	diskHead?: string;
	rootSessionId?: string;
	runIds?: readonly string[];
	executionIds?: readonly string[];
	criteria?: Partial<Record<string, EvidenceMatrixStatus | { status: EvidenceMatrixStatus; evidence?: string[] }>>;
	behaviors?: Partial<Record<string, EvidenceMatrixStatus | { status: EvidenceMatrixStatus; evidence?: string[] }>>;
}

const CRITERIA = Array.from({ length: 18 }, (_, index) => `C${String(index + 1).padStart(2, "0")}`);
const BEHAVIORS = Array.from({ length: 24 }, (_, index) => `B${String(index + 1).padStart(2, "0")}`);

function entry(id: string, value: EvidenceMatrixStatus | { status: EvidenceMatrixStatus; evidence?: string[] } | undefined, context: string[]): EvidenceMatrixEntry {
	if (typeof value === "string") return { id, status: value, evidence: context };
	if (value) return { id, status: value.status, evidence: [...context, ...(value.evidence ?? [])] };
	return { id, status: "unproven", evidence: context };
}

/**
 * Build the C01-C18/B01-B24 release matrix. Missing host provenance remains
 * explicitly unproven; a passing helper test cannot silently become a host pass.
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
	return [
		...CRITERIA.map((id) => entry(id, options.criteria?.[id], context)),
		...BEHAVIORS.map((id) => entry(id, options.behaviors?.[id], context)),
	];
}

export const ACCEPTANCE_CRITERIA_IDS = Object.freeze([...CRITERIA]);
export const ACCEPTANCE_BEHAVIOR_IDS = Object.freeze([...BEHAVIORS]);
