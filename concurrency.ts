/**
 * Session-wide admission control for child executions.
 *
 * The controller is deliberately independent from Task lifecycle: a child slot
 * is held from accepted launch through the trusted terminal result, while
 * workspace access is checked separately from capacity.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const DEFAULT_CONCURRENCY_LIMIT = 3;
export const MAX_CONCURRENCY_LIMIT = 100;

export type ConcurrencySource = "session" | "saved" | "default";
export type ConcurrencyCapability = "reader" | "writer" | "reviewer";

export interface ConcurrencyReservationRequest {
	id: string;
	taskId?: string;
	state?: string;
	structured?: boolean;
	role: string;
	capability: ConcurrencyCapability;
	workspaces?: readonly string[];
}

export interface ConcurrencyReservation {
	id: string;
	taskId?: string;
	role: string;
	capability: ConcurrencyCapability;
	workspaces: string[];
	reservedAt: string;
}

export interface ConcurrencyStatus {
	limit: number;
	source: ConcurrencySource;
	occupied: number;
	available: number;
	reservations: ConcurrencyReservation[];
}

export interface ConcurrencyRefusal {
	code: "CONCURRENCY_LIMIT_REACHED" | "WORKSPACE_CONFLICT";
	reason: string;
	limit: number;
	occupied: number;
	available: number;
	conflictingIds?: string[];
}

export interface ConcurrencyReserveOutcome {
	reservation?: ConcurrencyReservation;
	refusal?: ConcurrencyRefusal;
}

export interface PersistentConcurrencyConfig {
	limit?: number;
}

export function parseConcurrencyLimit(value: string | number): number | undefined {
	const text = String(value).trim();
	if (!/^[1-9][0-9]*$/.test(text)) return undefined;
	const limit = Number(text);
	return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_CONCURRENCY_LIMIT ? limit : undefined;
}

export function loadConcurrencyDefault(path: string): { limit: number; source: "saved" | "default"; diagnostic?: string } {
	try {
		if (!existsSync(path)) return { limit: DEFAULT_CONCURRENCY_LIMIT, source: "default" };
		const parsed = JSON.parse(readFileSync(path, "utf8")) as PersistentConcurrencyConfig;
		const limit = parsed && typeof parsed === "object" ? parseConcurrencyLimit(String(parsed.limit ?? "")) : undefined;
		return limit === undefined
			? { limit: DEFAULT_CONCURRENCY_LIMIT, source: "default", diagnostic: `invalid concurrency configuration at ${path}; using default ${DEFAULT_CONCURRENCY_LIMIT}` }
			: { limit, source: "saved" };
	} catch (error) {
		return {
			limit: DEFAULT_CONCURRENCY_LIMIT,
			source: "default",
			diagnostic: `could not read concurrency configuration at ${path}; using default ${DEFAULT_CONCURRENCY_LIMIT}: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

export function saveConcurrencyDefault(path: string, limit: number): { ok: true } | { ok: false; error: string } {
	const parsed = parseConcurrencyLimit(limit);
	if (parsed === undefined) return { ok: false, error: "concurrency limit must be a positive safe integer" };
	const temporary = `${path}.${process.pid}.tmp`;
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(temporary, `${JSON.stringify({ limit: parsed }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
		renameSync(temporary, path);
		return { ok: true };
	} catch (error) {
		try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* report the original failure */ }
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function normalizedWorkspace(path: string): string {
	return resolve(path);
}

export class ConcurrencyController {
	private savedLimit: number;
	private hasSavedLimit: boolean;
	private readonly enforceWorkspace: boolean;
	private sessionLimit?: number;
	private readonly reservations = new Map<string, ConcurrencyReservation>();

	constructor(options: { savedLimit?: number; saved?: boolean; enforceWorkspace?: boolean } = {}) {
		this.savedLimit = parseConcurrencyLimit(options.savedLimit ?? DEFAULT_CONCURRENCY_LIMIT) ?? DEFAULT_CONCURRENCY_LIMIT;
		this.hasSavedLimit = options.saved === true;
		this.enforceWorkspace = options.enforceWorkspace !== false;
	}

	setSessionLimit(limit: number): { ok: true } | { ok: false; error: string } {
		const parsed = parseConcurrencyLimit(limit);
		if (parsed === undefined) return { ok: false, error: "concurrency limit must be a positive safe integer" };
		this.sessionLimit = parsed;
		return { ok: true };
	}

	resetSessionLimit(): void {
		this.sessionLimit = undefined;
	}
	setSavedLimit(limit: number): { ok: true } | { ok: false; error: string } {
		const parsed = parseConcurrencyLimit(limit);
		if (parsed === undefined) return { ok: false, error: "concurrency limit must be a positive safe integer" };
		this.savedLimit = parsed;
		this.hasSavedLimit = true;
		return { ok: true };
	}

	getLimit(): number { return this.sessionLimit ?? this.savedLimit; }
	getSource(): ConcurrencySource { return this.sessionLimit !== undefined ? "session" : this.hasSavedLimit ? "saved" : "default"; }

	reserve(request: ConcurrencyReservationRequest): ConcurrencyReserveOutcome {
		if (this.reservations.has(request.id)) return { reservation: this.reservations.get(request.id) };
		const limit = this.getLimit();
		const occupied = this.reservations.size;
		if (occupied >= limit) {
			return { refusal: { code: "CONCURRENCY_LIMIT_REACHED", reason: `CONCURRENCY_LIMIT_REACHED: occupied ${occupied}/${limit}; no execution slot is available`, limit, occupied, available: 0 } };
		}
		const workspaces = [...new Set((request.workspaces ?? []).filter(Boolean).map(normalizedWorkspace))];
		const conflicts = this.enforceWorkspace ? [...this.reservations.values()].filter((active) => {
			// A blocked/failed Task may be retried against its own stale claim, but
			// that exception never suppresses checks against another execution.
			if (request.taskId && active.taskId === request.taskId && request.state !== "executing") return false;
			// Reader/reader overlap is safe. Any overlapping writer or reviewer must
			// wait, including structured retries and same-task aliases while active.
			const bothReaders = request.capability === "reader" && active.capability === "reader";
			return !bothReaders && workspaces.some((workspace) => active.workspaces.includes(workspace));
		}) : [];
		if (conflicts.length > 0) {
			return {
				refusal: {
					code: "WORKSPACE_CONFLICT",
					reason: `WORKSPACE_CONFLICT: ${request.capability} cannot run beside active ${conflicts.map((item) => `${item.role} ${item.taskId ?? item.id}`).join(", ")}`,
					limit,
					occupied,
					available: limit - occupied,
					conflictingIds: conflicts.map((item) => item.id),
				},
			};
		}
		const reservation: ConcurrencyReservation = {
			id: request.id,
			...(request.taskId ? { taskId: request.taskId } : {}),
			role: request.role,
			capability: request.capability,
			workspaces,
			reservedAt: new Date().toISOString(),
		};
		this.reservations.set(request.id, reservation);
		return { reservation };
	}

	release(id: string): boolean { return this.reservations.delete(id); }
	setTaskId(id: string, taskId: string): void {
		const reservation = this.reservations.get(id);
		if (reservation) reservation.taskId = taskId;
	}
	get(id: string): ConcurrencyReservation | undefined { return this.reservations.get(id); }
	status(): ConcurrencyStatus {
		const limit = this.getLimit();
		return { limit, source: this.getSource(), occupied: this.reservations.size, available: Math.max(0, limit - this.reservations.size), reservations: [...this.reservations.values()] };
	}
}
