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

	release(taskId: string, toolCallId: string): void {
		const reservations = this.held.get(taskId);
		if (!reservations) return;
		reservations.delete(toolCallId);
		if (reservations.size === 0) this.held.delete(taskId);
	}

	releaseByToolCall(toolCallId: string): void {
		for (const [taskId, reservations] of this.held) {
			if (reservations.delete(toolCallId) && reservations.size === 0) this.held.delete(taskId);
		}
	}
}

export type { CumulativeBudgetLimits };
