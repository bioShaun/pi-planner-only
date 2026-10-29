export type StageAPair = "S1" | "S2";
export type StageAChannel = "native-async" | "lite-foreground";
export type StageAStatus = "awaiting_children" | "awaiting_acceptance" | "accepted" | "failed";

export interface StageAIdentity {
	requestId: string;
	ownerRunId: string;
	nodeId: string;
}

export interface StageALaunch {
	channel: StageAChannel;
	role: string;
	agent: string;
	identity: StageAIdentity;
	runId?: string;
	mode?: string;
}

export interface StageAReceipt {
	channel: StageAChannel;
	role: string;
	agent: string;
	identity: StageAIdentity;
	runId: string;
	status: string;
	source?: string;
}

const expectedChildren: Record<StageAPair, readonly { role: string; agent: string }[]> = {
	S1: [{ role: "worker", agent: "worker" }],
	S2: [{ role: "validator", agent: "oracle" }, { role: "reviewer", agent: "reviewer" }],
};

function sameIdentity(a: StageAIdentity, b: StageAIdentity): boolean {
	return a.requestId === b.requestId && a.ownerRunId === b.ownerRunId && a.nodeId === b.nodeId;
}

export function createStageALifecycle(pair: StageAPair, timeoutMs: number, startedAt = Date.now()) {
	const expected = expectedChildren[pair];
	const children = new Map<string, { launch: StageALaunch; completed: boolean }>();
	let status: StageAStatus = "awaiting_children";
	let rootTurnSettled = false;
	let accepted = false;
	let costAudited = false;
	let sequence = 0;
	let lastCompletionSequence = 0;
	let rootResponseSequence = 0;
	let failure: string | undefined;

	const allCompleted = () => children.size === expected.length && [...children.values()].every(child => child.completed);
	const fail = (reason: string) => {
		status = "failed";
		failure = reason;
		accepted = false;
		costAudited = false;
	};
	const checkDeadline = (now: number) => {
		if (status !== "failed" && now - startedAt >= timeoutMs) fail("timeout");
	};

	return {
		launch(launch: StageALaunch, now = Date.now()): boolean {
			checkDeadline(now);
			const expectedChild = expected.find(item => item.role === launch.role);
			if (status === "failed" || !expectedChild || launch.agent !== expectedChild.agent
				|| (launch.channel !== "native-async" && launch.channel !== "lite-foreground")
				|| !launch.identity.requestId || !launch.identity.ownerRunId || !launch.identity.nodeId) return false;
			if (children.has(launch.role) || (launch.channel === "native-async" && (!launch.runId || launch.mode !== "single"))) return false;
			children.set(launch.role, { launch: { ...launch, identity: { ...launch.identity } }, completed: false });
			rootTurnSettled = false;
			return true;
		},
		rootSettled(now = Date.now()): StageAStatus {
			checkDeadline(now);
			sequence++;
			rootTurnSettled = status !== "failed" && allCompleted() && rootResponseSequence > lastCompletionSequence;
			if (rootTurnSettled) status = "awaiting_acceptance";
			return status;
		},
		activity(now = Date.now()): void {
			checkDeadline(now);
			sequence++;
			rootTurnSettled = false;
			rootResponseSequence = 0;
			if (status === "accepted") {
				accepted = false;
				costAudited = false;
				status = "awaiting_acceptance";
			}
		},
		rootResponse(acceptedByRoot: boolean, now = Date.now()): boolean {
			checkDeadline(now);
			sequence++;
			if (status === "failed" || !allCompleted()) return false;
			if (!acceptedByRoot) {
				fail("root-rejected");
				return false;
			}
			rootResponseSequence = sequence;
			rootTurnSettled = false;
			status = "awaiting_acceptance";
			return true;
		},
		complete(receipt: StageAReceipt, now = Date.now()): boolean {
			checkDeadline(now);
			if (status === "failed" || !receipt.runId) return false;
			const child = children.get(receipt.role);
			if (!child || child.completed || child.launch.channel !== receipt.channel || child.launch.agent !== receipt.agent
				|| !sameIdentity(child.launch.identity, receipt.identity)
				|| (receipt.channel === "native-async" && (child.launch.runId !== receipt.runId || child.launch.mode !== "single" || receipt.source !== "async"))) return false;
			if (receipt.status !== "completed") {
				fail(`child-${receipt.status || "invalid"}`);
				return false;
			}
			child.completed = true;
			sequence++;
			lastCompletionSequence = sequence;
			rootTurnSettled = false;
			if (allCompleted()) status = "awaiting_acceptance";
			return true;
		},
		nativeNotice(message: unknown, now = Date.now()): number {
			const value = message as { customType?: unknown; details?: { runs?: unknown } } | null;
			if (value?.customType !== "subagent-notify" || !Array.isArray(value.details?.runs)) return 0;
			let completed = 0;
			for (const run of value.details.runs) {
				const item = run as { runId?: unknown; agent?: unknown; status?: unknown; source?: unknown };
				if (typeof item.runId !== "string") continue;
				const child = [...children.values()].find(({ launch }) => launch.channel === "native-async" && launch.runId === item.runId);
				if (!child) continue;
				if (child.completed) {
					fail("duplicate-native-completion");
					break;
				}
				if ((item.source !== undefined && item.source !== "async") || item.agent !== child.launch.agent) {
					fail("invalid-native-completion-identity");
					break;
				}
				if (this.complete({ ...child.launch, runId: item.runId, status: String(item.status ?? ""), source: "async" }, now)) completed++;
			}
			return completed;
		},
		liteReceipt(details: unknown, now = Date.now()): boolean {
			const value = details as { requestId?: unknown; ownerRunId?: unknown; nodeId?: unknown; agent?: unknown; runId?: unknown; status?: unknown } | null;
			if (!value || typeof value.requestId !== "string" || typeof value.ownerRunId !== "string"
				|| typeof value.nodeId !== "string" || typeof value.agent !== "string") return false;
			const child = [...children.values()].find(({ launch }) => launch.channel === "lite-foreground"
				&& launch.identity.requestId === value.requestId && launch.identity.ownerRunId === value.ownerRunId
				&& launch.identity.nodeId === value.nodeId && launch.agent === value.agent);
			if (!child) return false;
			if (typeof value.runId !== "string" || typeof value.status !== "string") {
				fail("invalid-lite-terminal-receipt");
				return false;
			}
			return this.complete({ channel: "lite-foreground", role: child.launch.role, agent: child.launch.agent,
				identity: child.launch.identity, runId: value.runId, status: value.status }, now);
		},
		fail(reason: string): void { fail(reason); },
		accept(acceptedByRoot: boolean, now = Date.now()): boolean {
			checkDeadline(now);
			if (status !== "awaiting_acceptance" || !rootTurnSettled || !allCompleted() || !acceptedByRoot) {
				if (!acceptedByRoot && allCompleted()) fail("root-rejected");
				return false;
			}
			accepted = true;
			status = "accepted";
			return true;
		},
		costAudit(available: boolean, now = Date.now()): boolean {
			checkDeadline(now);
			if (!accepted || status !== "accepted") return false;
			if (!available) {
				fail("usage-unavailable");
				return false;
			}
			costAudited = true;
			return true;
		},
		timeout(): void { fail("timeout"); },
		exit(): boolean { return status === "accepted" && accepted && costAudited; },
		snapshot() {
			return {
				pair, expectedChildren: expected.map(item => ({ ...item })), status, rootTurnSettled, accepted, costAudited,
				sequence, completionSequence: lastCompletionSequence, rootResponseSequence,
				children: [...children.values()].map(({ launch, completed }) => ({ ...launch, completed })),
				failure,
			};
		},
	};
}
