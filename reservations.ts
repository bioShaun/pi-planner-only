import type { BudgetDimension, CumulativeBudgetLimits } from "./usage.ts";

export interface ReservationBudget {
	tokens: BudgetDimension;
	costUsd: BudgetDimension;
}

export interface ReservationDesired {
	toolCallId: string;
	tokens?: number;
	costUsd?: number;
}

export interface ReservationRefusal {
	dimension: "tokens" | "costUsd";
	available: number;
	held: number;
	budget: BudgetDimension;
}

export interface ReserveOutcome {
	grant?: { tokens?: number; costUsd?: number };
	refused?: ReservationRefusal;
}

interface HeldReservation {
	tokens?: number;
	costUsd?: number;
}

export class BudgetReservations {
	private readonly held = new Map<string, Map<string, HeldReservation>>();

	inFlight(taskId: string): { tokens: number; costUsd: number } {
		const reservations = this.held.get(taskId);
		let tokens = 0;
		let costUsd = 0;
		if (reservations) {
			for (const reservation of reservations.values()) {
				tokens += reservation.tokens ?? 0;
				costUsd += reservation.costUsd ?? 0;
			}
		}
		return { tokens, costUsd };
	}

	/** How many in-flight calls currently hold a reservation for this Task. */
	heldCount(taskId: string): number {
		return this.held.get(taskId)?.size ?? 0;
	}

	reserve(taskId: string, budget: ReservationBudget, desired: ReservationDesired): ReserveOutcome {
		const held = this.inFlight(taskId);
		const availableTokens = budget.tokens.limit === undefined
			? undefined
			: budget.tokens.limit - budget.tokens.known - held.tokens;
		const availableCostUsd = budget.costUsd.limit === undefined
			? undefined
			: budget.costUsd.limit - budget.costUsd.known - held.costUsd;
		if (availableTokens !== undefined && availableTokens <= 0) {
			return { refused: { dimension: "tokens", available: availableTokens, held: held.tokens, budget: budget.tokens } };
		}
		if (availableCostUsd !== undefined && availableCostUsd <= 0) {
			return { refused: { dimension: "costUsd", available: availableCostUsd, held: held.costUsd, budget: budget.costUsd } };
		}

		const reservation: HeldReservation = {};
		const grant: { tokens?: number; costUsd?: number } = {};
		if (availableTokens !== undefined && desired.tokens !== undefined) {
			grant.tokens = Math.min(availableTokens, desired.tokens);
			reservation.tokens = grant.tokens;
		}
		if (availableCostUsd !== undefined && desired.costUsd !== undefined) {
			grant.costUsd = Math.min(availableCostUsd, desired.costUsd);
			reservation.costUsd = grant.costUsd;
		}
		if (Object.keys(reservation).length > 0) {
			let reservations = this.held.get(taskId);
			if (!reservations) {
				reservations = new Map();
				this.held.set(taskId, reservations);
			}
			reservations.set(desired.toolCallId, reservation);
		}
		return { grant };
	}

	/**
	 * What is currently held for one in-flight call, whichever Task holds it.
	 * Ticket 15 charges an unresolved child this amount as debt, so the figure
	 * has to be readable from outside without knowing the taskId.
	 */
	grantFor(toolCallId: string): HeldReservation | undefined {
		for (const reservations of this.held.values()) {
			const reservation = reservations.get(toolCallId);
			if (reservation) return reservation;
		}
		return undefined;
	}

	release(taskId: string, toolCallId: string): void {
		const reservations = this.held.get(taskId);
		if (!reservations) return;
		reservations.delete(toolCallId);
		if (reservations.size === 0) this.held.delete(taskId);
	}

	/**
	 * Move one in-flight reservation from one Task id to another.
	 * Used when shouldReplaceTaskId mints a canonical id after the gate
	 * reserved against spec.taskId. Missing source is a no-op.
	 */
	rekey(fromTaskId: string, toTaskId: string, toolCallId: string): void {
		if (fromTaskId === toTaskId) return;
		const source = this.held.get(fromTaskId);
		if (!source) return;
		const reservation = source.get(toolCallId);
		if (!reservation) return;
		source.delete(toolCallId);
		if (source.size === 0) this.held.delete(fromTaskId);
		let dest = this.held.get(toTaskId);
		if (!dest) {
			dest = new Map();
			this.held.set(toTaskId, dest);
		}
		dest.set(toolCallId, reservation);
	}

	releaseByToolCall(toolCallId: string): void {
		for (const [taskId, reservations] of this.held) {
			if (reservations.delete(toolCallId) && reservations.size === 0) this.held.delete(taskId);
		}
	}
}

export type { CumulativeBudgetLimits };
