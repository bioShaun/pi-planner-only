/**
 * WorkerReport protocol: the only structured thing a Worker returns.
 *
 * Schema validation, identity checks, and stable serialization live here so
 * Reviewer parsing and Task lifecycle do not share a kitchen-sink module.
 */

import { WORKER_REPORT_VERSION } from "./types.ts";
import type {
	ValidationStatus,
	ValidationType,
	WorkerReport,
	WorkerStatus,
} from "./types.ts";

const WORKER_STATUSES: readonly WorkerStatus[] = ["completed", "partial", "blocked", "failed"];
const VALIDATION_TYPES: readonly ValidationType[] = [
	"test",
	"build",
	"lint",
	"typecheck",
	"manual",
	"other",
];
const VALIDATION_STATUSES: readonly ValidationStatus[] = ["passed", "failed", "not-run"];

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function validateValidationResult(value: unknown, index: number): string[] {
	const label = `validation[${index}]`;
	if (!isPlainObject(value)) return [`${label} must be an object`];
	const errors: string[] = [];
	if (!isNonEmptyString(value.type) || !VALIDATION_TYPES.includes(value.type as ValidationType)) {
		errors.push(`${label}.type must be one of ${VALIDATION_TYPES.join(", ")}`);
	}
	if (
		!isNonEmptyString(value.status) ||
		!VALIDATION_STATUSES.includes(value.status as ValidationStatus)
	) {
		errors.push(`${label}.status must be one of ${VALIDATION_STATUSES.join(", ")}`);
	}
	if (!isNonEmptyString(value.summary)) errors.push(`${label}.summary must be a non-empty string`);
	if (value.exitCode !== undefined && !Number.isInteger(value.exitCode)) {
		errors.push(`${label}.exitCode must be an integer when present`);
	}
	if (value.receiptId !== undefined && !isNonEmptyString(value.receiptId)) {
		errors.push(`${label}.receiptId must be a non-empty string when present`);
	}
	return errors;
}

export function validateWorkerReport(value: unknown): string[] {
	if (!isPlainObject(value)) return ["WorkerReport must be an object"];
	const errors: string[] = [];
	if (value.version !== WORKER_REPORT_VERSION) {
		errors.push(`version must be ${WORKER_REPORT_VERSION}`);
	}
	if (!isNonEmptyString(value.taskId)) errors.push("taskId must be a non-empty string");
	if (!isNonEmptyString(value.status) || !WORKER_STATUSES.includes(value.status as WorkerStatus)) {
		errors.push(`status must be one of ${WORKER_STATUSES.join(", ")}`);
	}
	if (typeof value.summary !== "string") errors.push("summary must be a string");
	for (const key of ["changedFiles", "risks", "unresolved"] as const) {
		if (!Array.isArray(value[key])) errors.push(`${key} must be an array`);
		else if (!isStringArray(value[key])) errors.push(`${key} must be an array of strings`);
	}
	if (!Array.isArray(value.validation)) errors.push("validation must be an array");
	else value.validation.forEach((item, index) => errors.push(...validateValidationResult(item, index)));
	if (!isPlainObject(value.evidence)) errors.push("evidence must be an object");
	else {
		if (!isNonEmptyString(value.evidence.taskId)) errors.push("evidence.taskId must be a non-empty string");
		if (isNonEmptyString(value.taskId) && value.evidence.taskId !== value.taskId) {
			errors.push("evidence.taskId must match taskId");
		}
	}
	if (value.notes !== undefined && !isStringArray(value.notes)) {
		errors.push("notes must be an array of strings when present");
	}
	return errors;
}

/** The task identity a Worker result must claim: the delegated task and run. */
export interface WorkerReportIdentity {
	taskId: string;
	aliases?: readonly string[];
	workerRunId?: string;
}

function identityMatches(value: string, expected: WorkerReportIdentity): boolean {
	return value === expected.taskId || (expected.aliases ?? []).includes(value);
}

/**
 * §P0-1 — a schema-valid WorkerReport may still belong to a different task.
 *
 * Identity is checked against the delegation, not the report itself:
 * `taskId`, `evidence.taskId` must match the delegated task or any alias, and
 * `evidence.workerRunId` is Root-stamped at admission; the check here guards restored ledgers at the verdict boundary.
 */
export function validateWorkerReportIdentity(
	report: WorkerReport,
	expected: WorkerReportIdentity,
): string[] {
	const errors: string[] = [];
	if (!identityMatches(report.taskId, expected)) {
		errors.push(
			`WorkerReport taskId mismatch: expected ${expected.taskId}, got ${report.taskId}`,
		);
	}
	if (!identityMatches(report.evidence.taskId, expected)) {
		errors.push(
			`WorkerReport evidence.taskId mismatch: expected ${expected.taskId}, got ${report.evidence.taskId}`,
		);
	}
	if (
		expected.workerRunId &&
		report.evidence.workerRunId &&
		report.evidence.workerRunId !== expected.workerRunId
	) {
		errors.push(
			`WorkerReport evidence.workerRunId mismatch: expected ${expected.workerRunId}, got ${report.evidence.workerRunId}`,
		);
	}
	return errors;
}
