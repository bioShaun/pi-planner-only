/**
 * Pure usage ledger: Root/child token counts, cost resolution, and rendering.
 * No Pi host imports.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
	ChildUsage,
	DelegationKind,
	RootUsage,
	TaskState,
	TaskUsage,
	TokenCounts,
	UsagePhase,
} from "./types.ts";

export interface PiUsageLike {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cacheWrite1h?: number;
	reasoning?: number;
	totalTokens?: number;
	cost?: number | { total?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
	turns?: number;
}

export interface PricingRates {
	input: number | null;
	output: number | null;
	cacheRead: number | null;
	cacheWrite: number | null;
}

export interface PricingTable {
	version?: number;
	currency: "USD" | "CNY";
	rates: Record<string, PricingRates>;
}

export function childOutcomeFromExitCode(exitCode: number | undefined): "succeeded" | "failed" | "unknown" {
	if (exitCode === undefined) return "unknown";
	return exitCode === 0 ? "succeeded" : "failed";
}


export type UsageEntryKind = "root-turn" | "child" | "injected" | "leak";

export interface UsageEntry {
	id: string;
	kind: UsageEntryKind;
	taskId?: string;
	at: string;
	state?: TaskState;
	model?: string;
	provider?: string;
	usage?: PiUsageLike;
	child?: ChildUsage;
	bytes?: number;
	messageId?: string;
	toolCallId?: string;
	runId?: string;
}

export interface RootTurnRecord {
	id: string;
	taskId?: string;
	at: string;
	model?: string;
	provider?: string;
	state?: TaskState;
	tokens: TokenCounts;
	costUsd?: number;
	tokensUnknown: boolean;
	phase?: UsagePhase;
}

export interface ChildUsageIds {
	runId?: string;
	toolCallId?: string;
	agent?: string;
	model?: string;
	thinking?: string;
	source: ChildUsage["source"];
	pending?: boolean;
}

const USAGE_PHASES: readonly UsagePhase[] = ["planning", "executing", "reviewing"];
const LINE_CAP_BYTES = 160;

function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function emptyTokenCounts(): TokenCounts {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

function emptyPhaseCounts(): TokenCounts & { turns: number } {
	return { ...emptyTokenCounts(), turns: 0 };
}

export function emptyRootUsage(): RootUsage {
	return {
		...emptyTokenCounts(),
		turns: 0,
		tokensUnknownTurns: 0,
		byPhase: {
			planning: emptyPhaseCounts(),
			executing: emptyPhaseCounts(),
			reviewing: emptyPhaseCounts(),
		},
		reviewLeakBytes: 0,
		injectedBytes: 0,
	};
}

export function emptyTaskUsage(): TaskUsage {
	return { root: emptyRootUsage(), children: [], costUnknown: false };
}

export function modelIdForPricing(model: string): string {
	return model.replace(/:[^:/]+$/, "");
}

function tokensFromUsage(usage: PiUsageLike): TokenCounts {
	const counts: TokenCounts = {
		input: num(usage.input),
		output: num(usage.output),
		cacheRead: num(usage.cacheRead),
		cacheWrite: num(usage.cacheWrite) + num(usage.cacheWrite1h),
	};
	if (usage.reasoning) counts.reasoning = num(usage.reasoning);
	return counts;
}

function isAllZero(tokens: TokenCounts): boolean {
	return tokens.input === 0 && tokens.output === 0 && tokens.cacheRead === 0 && tokens.cacheWrite === 0;
}

function addTokens(target: TokenCounts, src: TokenCounts): void {
	target.input += src.input;
	target.output += src.output;
	target.cacheRead += src.cacheRead;
	target.cacheWrite += src.cacheWrite;
	if (src.reasoning || target.reasoning) {
		target.reasoning = (target.reasoning ?? 0) + (src.reasoning ?? 0);
	}
}

function cloneChild(child: ChildUsage): ChildUsage {
	return { ...child };
}

function phaseFor(state?: TaskState): UsagePhase | undefined {
	if (state === "planning") return "planning";
	if (state === "executing") return "executing";
	if (state === "reviewing" || state === "changes_requested") return "reviewing";
	return undefined;
}

function piReportedCost(usage: PiUsageLike): number | undefined {
	const cost = usage.cost;
	if (typeof cost === "number") return cost > 0 ? cost : undefined;
	if (cost && typeof cost === "object" && typeof cost.total === "number" && cost.total > 0) {
		return cost.total;
	}
	return undefined;
}

export function lookupRates(pricing: PricingTable, provider: string | undefined, model: string | undefined): PricingRates | undefined {
	if (!model) return undefined;
	const stripped = modelIdForPricing(model);
	const keys: string[] = [];
	if (provider) keys.push(`${provider}/${stripped}`);
	keys.push(stripped);
	if (stripped.includes("/")) {
		const bare = stripped.slice(stripped.indexOf("/") + 1);
		if (bare) keys.push(bare);
	}
	for (const key of keys) {
		if (key in pricing.rates) return pricing.rates[key];
	}
	return undefined;
}

type UsablePricingRates = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

function hasUsableRates(rates: PricingRates | undefined): rates is UsablePricingRates {
	return rates !== undefined
		&& Number.isFinite(rates.input)
		&& Number.isFinite(rates.output)
		&& Number.isFinite(rates.cacheRead)
		&& Number.isFinite(rates.cacheWrite);
}

function tableCost(rates: PricingRates | undefined, tokens: TokenCounts): number | undefined {
	if (!hasUsableRates(rates)) return undefined;
	return (
		(tokens.input * rates.input) +
		(tokens.output * rates.output) +
		(tokens.cacheRead * rates.cacheRead) +
		(tokens.cacheWrite * rates.cacheWrite)
	) / 1_000_000;
}

/**
 * True when the pricing table can compute a cost for this model: lookupRates
 * finds an entry and all four rate fields are finite numbers. Zero rates count
 * as usable; a missing entry or any null/missing field does not.
 */
export function hasUsableRate(pricing: PricingTable, provider: string | undefined, model: string | undefined): boolean {
	return tableCost(lookupRates(pricing, provider, model), emptyTokenCounts()) !== undefined;
}

function resolveCost(
	pricing: PricingTable,
	usage: PiUsageLike | undefined,
	tokens: TokenCounts,
	provider: string | undefined,
	model: string | undefined,
	precomputed?: number,
): number | undefined {
	if (typeof precomputed === "number" && precomputed > 0) return precomputed;
	if (usage) {
		const reported = piReportedCost(usage);
		if (reported !== undefined) return reported;
	}
	return tableCost(lookupRates(pricing, provider, model), tokens);
}

function parseRates(value: unknown): PricingRates | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const rec = value as Record<string, unknown>;
	const field = (key: string): number | null | undefined => {
		const raw = rec[key];
		if (raw === null) return null;
		if (typeof raw === "number" && Number.isFinite(raw)) return raw;
		return undefined;
	};
	const input = field("input");
	const output = field("output");
	const cacheRead = field("cacheRead");
	const cacheWrite = field("cacheWrite");
	if (input === undefined || output === undefined || cacheRead === undefined || cacheWrite === undefined) {
		return undefined;
	}
	return { input, output, cacheRead, cacheWrite };
}

export function emptyPricingTable(): PricingTable {
	return { version: 1, currency: "USD", rates: {} };
}

export function pricingPath(env: NodeJS.ProcessEnv = process.env): string {
	const override = env.PI_PLANNER_ONLY_PRICING;
	return override && override.trim()
		? override
		: join(
			env.PI_CODING_AGENT_DIR ? resolve(env.PI_CODING_AGENT_DIR) : join(homedir(), ".pi", "agent"),
			"planner-only",
			"pricing.json",
		);
}

export function loadPricingTable(env: NodeJS.ProcessEnv = process.env): PricingTable {
	const path = pricingPath(env);
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return emptyPricingTable();
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const currency = parsed.currency === "CNY" ? "CNY" : "USD";
		const rates: Record<string, PricingRates> = {};
		const src = parsed.rates && typeof parsed.rates === "object" && !Array.isArray(parsed.rates)
			? parsed.rates as Record<string, unknown>
			: {};
		for (const [key, value] of Object.entries(src)) {
			if (key.startsWith("_")) continue;
			const parsedRates = parseRates(value);
			if (parsedRates) rates[key] = parsedRates;
		}
		return {
			version: typeof parsed.version === "number" ? parsed.version : 1,
			currency,
			rates,
		};
	} catch {
		return emptyPricingTable();
	}
}

function providerFromModel(model: string | undefined): string | undefined {
	if (!model) return undefined;
	const stripped = modelIdForPricing(model);
	const slash = stripped.indexOf("/");
	return slash > 0 ? stripped.slice(0, slash) : undefined;
}

export function childUsageFromValue(
	value: unknown,
	kind: DelegationKind,
	ids: ChildUsageIds,
): ChildUsage | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const rec = value as PiUsageLike;
	const tokens = tokensFromUsage(rec);
	const reported = piReportedCost(rec);
	const model = ids.model;
	let thinking = ids.thinking;
	if (!thinking && model && model.includes(":")) {
		const colonIdx = model.lastIndexOf(":");
		thinking = model.slice(colonIdx + 1);
	}
	const child: ChildUsage = {
		...tokens,
		kind,
		pending: ids.pending ?? false,
		source: ids.source,
		...(ids.runId ? { runId: ids.runId } : {}),
		...(ids.toolCallId ? { toolCallId: ids.toolCallId } : {}),
		...(ids.agent ? { agent: ids.agent } : {}),
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
	};
	if (typeof rec.turns === "number" && Number.isFinite(rec.turns)) child.turns = rec.turns;
	if (reported !== undefined) child.costUsd = reported;
	return child;
}

function childKey(child: ChildUsage): string | undefined {
	if (child.runId) return `run:${child.runId}`;
	if (child.toolCallId) return `call:${child.toolCallId}`;
	return undefined;
}

export class UsageLedger {
	private readonly pricing: PricingTable;
	private readonly now: () => Date;
	private readonly tasks = new Map<string, TaskUsage>();
	private readonly untasked: RootUsage = emptyRootUsage();
	private readonly seenIds = new Set<string>();
	private pending: UsageEntry[] = [];
	private seq = 0;

	constructor(opts: { pricing: PricingTable; now?: () => Date }) {
		this.pricing = opts.pricing;
		this.now = opts.now ?? (() => new Date());
	}

	private nextSeq(): number {
		this.seq += 1;
		return this.seq;
	}

	private at(): string {
		return this.now().toISOString();
	}

	private ensureTask(taskId: string): TaskUsage {
		let task = this.tasks.get(taskId);
		if (!task) {
			task = emptyTaskUsage();
			this.tasks.set(taskId, task);
		}
		return task;
	}

	private push(entry: UsageEntry): void {
		if (this.seenIds.has(entry.id)) return;
		this.seenIds.add(entry.id);
		this.pending.push(entry);
	}

	private refreshCostUnknown(task: TaskUsage): void {
		const rootUnknown = task.root.turns > 0 && task.root.costUsd === undefined;
		const childUnknown = task.children.some((child) => child.costUsd === undefined);
		task.costUnknown = rootUnknown || childUnknown;
	}

	private applyRootTurn(input: {
		taskId?: string;
		state?: TaskState;
		model?: string;
		provider?: string;
		usage: PiUsageLike;
	}): RootTurnRecord {
		const tokens = tokensFromUsage(input.usage);
		const tokensUnknown = isAllZero(tokens);
		const phase = phaseFor(input.state);
		const tasked = Boolean(input.taskId) && phase !== undefined;
		const costUsd = resolveCost(
			this.pricing,
			input.usage,
			tokens,
			input.provider ?? providerFromModel(input.model),
			input.model,
		);
		const bucket = tasked ? this.ensureTask(input.taskId as string).root : this.untasked;
		const previousTurns = bucket.turns;
		const previousCost = bucket.costUsd;
		bucket.turns += 1;
		if (tokensUnknown) bucket.tokensUnknownTurns += 1;
		addTokens(bucket, tokens);
		if (costUsd === undefined || (previousTurns > 0 && previousCost === undefined)) {
			bucket.costUsd = undefined;
		} else {
			bucket.costUsd = (previousCost ?? 0) + costUsd;
		}
		if (phase) {
			const phaseBucket = bucket.byPhase[phase];
			phaseBucket.turns += 1;
			addTokens(phaseBucket, tokens);
		}
		if (tasked && input.model) this.ensureTask(input.taskId as string).rootModel = input.model;
		if (tasked) this.refreshCostUnknown(this.ensureTask(input.taskId as string));
		return {
			id: "",
			at: this.at(),
			tokens,
			tokensUnknown,
			...(input.taskId && tasked ? { taskId: input.taskId } : {}),
			...(input.model ? { model: input.model } : {}),
			...(input.provider ? { provider: input.provider } : {}),
			...(input.state ? { state: input.state } : {}),
			...(phase ? { phase } : {}),
			...(costUsd !== undefined ? { costUsd } : {}),
		};
	}

	recordRootTurn(input: {
		taskId?: string;
		state?: TaskState;
		model?: string;
		provider?: string;
		usage: PiUsageLike;
		messageId?: string;
	}): RootTurnRecord {
		const record = this.applyRootTurn(input);
		const seq = this.nextSeq();
		const id = `root-turn:${input.messageId ?? record.taskId ?? "untasked"}:${seq}`;
		record.id = id;
		this.push({
			id,
			kind: "root-turn",
			at: record.at,
			...(record.taskId ? { taskId: record.taskId } : {}),
			...(input.state ? { state: input.state } : {}),
			...(input.model ? { model: input.model } : {}),
			...(input.provider ? { provider: input.provider } : {}),
			...(input.messageId ? { messageId: input.messageId } : {}),
			usage: input.usage,
		});
		return record;
	}

	recordInjected(taskId: string, bytes: number): void {
		const task = this.ensureTask(taskId);
		task.root.injectedBytes += bytes;
		const seq = this.nextSeq();
		this.push({
			id: `injected:${taskId}:${seq}`,
			kind: "injected",
			taskId,
			at: this.at(),
			bytes,
		});
	}

	recordReviewLeak(taskId: string, bytes: number): void {
		const task = this.ensureTask(taskId);
		task.root.reviewLeakBytes += bytes;
		const seq = this.nextSeq();
		this.push({
			id: `leak:${taskId}:${seq}`,
			kind: "leak",
			taskId,
			at: this.at(),
			bytes,
		});
	}

	private upsertChild(task: TaskUsage, child: ChildUsage): void {
		const priced = child.costUsd !== undefined
			? child.costUsd
			: resolveCost(
				this.pricing,
				undefined,
				child,
				providerFromModel(child.model),
				child.model,
				child.costUsd,
			);
		const stored: ChildUsage = {
			...child,
			...(priced !== undefined ? { costUsd: priced } : {}),
		};
		const key = childKey(stored);
		if (key) {
			const index = task.children.findIndex((existing) => childKey(existing) === key);
			if (index >= 0) {
				task.children[index] = stored;
				this.refreshCostUnknown(task);
				return;
			}
		}
		task.children.push(stored);
		this.refreshCostUnknown(task);
	}

	recordChild(taskId: string, child: ChildUsage): void {
		const task = this.ensureTask(taskId);
		this.upsertChild(task, child);
		const seq = this.nextSeq();
		const ident = child.runId ?? child.toolCallId ?? String(seq);
		this.push({
			id: `child:${ident}:${seq}`,
			kind: "child",
			taskId,
			at: this.at(),
			child: cloneChild(this.ensureTask(taskId).children.find((c) => childKey(c) === childKey(child)) ?? child),
			...(child.toolCallId ? { toolCallId: child.toolCallId } : {}),
			...(child.runId ? { runId: child.runId } : {}),
		});
	}

	resolvePending(taskId: string, read: (child: ChildUsage) => ChildUsage | undefined): number {
		const task = this.tasks.get(taskId);
		if (!task) return 0;
		let resolved = 0;
		for (let i = 0; i < task.children.length; i++) {
			const child = task.children[i];
			if (!child?.pending) continue;
			const next = read(child);
			if (!next) continue;
			this.upsertChild(task, { ...next, pending: false });
			resolved += 1;
			const seq = this.nextSeq();
			const ident = next.runId ?? next.toolCallId ?? child.runId ?? child.toolCallId ?? String(seq);
			this.push({
				id: `child:${ident}:${seq}`,
				kind: "child",
				taskId,
				at: this.at(),
				child: cloneChild(next),
				...(next.toolCallId ? { toolCallId: next.toolCallId } : {}),
				...(next.runId ? { runId: next.runId } : {}),
			});
		}
		return resolved;
	}

	taskUsage(taskId: string): TaskUsage | undefined {
		const task = this.tasks.get(taskId);
		if (!task) return undefined;
		return task;
	}

	sessionUsage(): { untasked: RootUsage; tasks: string[] } {
		return { untasked: this.untasked, tasks: [...this.tasks.keys()] };
	}

	load(records: UsageEntry[]): void {
		for (const entry of records) {
			if (!entry || typeof entry !== "object" || !entry.id || !entry.kind) continue;
			if (this.seenIds.has(entry.id)) continue;
			this.seenIds.add(entry.id);
			if (entry.kind === "root-turn") {
				this.applyRootTurn({
					...(entry.taskId ? { taskId: entry.taskId } : {}),
					...(entry.state ? { state: entry.state } : {}),
					...(entry.model ? { model: entry.model } : {}),
					...(entry.provider ? { provider: entry.provider } : {}),
					usage: entry.usage ?? {},
				});
			} else if (entry.kind === "injected" && entry.taskId && typeof entry.bytes === "number") {
				this.ensureTask(entry.taskId).root.injectedBytes += entry.bytes;
			} else if (entry.kind === "leak" && entry.taskId && typeof entry.bytes === "number") {
				this.ensureTask(entry.taskId).root.reviewLeakBytes += entry.bytes;
			} else if (entry.kind === "child" && entry.taskId && entry.child) {
				this.upsertChild(this.ensureTask(entry.taskId), entry.child);
			}
		}
	}

	drain(): UsageEntry[] {
		const out = this.pending;
		this.pending = [];
		return out;
	}
}

export interface CumulativeBudgetLimits {
	tokens?: number;
	costUsd?: number;
}

export interface BudgetDimension {
	/** undefined when this dimension is not configured. */
	limit?: number;
	/** Sum of the components whose value is known. */
	known: number;
	/** How many components could not be valued at all. Never folded into `known`. */
	unknownParts: number;
	/** limit - known. undefined when limit is undefined. NEVER clamped: overspend must stay negative. */
	remaining?: number;
}

export interface RoleUsageSummary {
	calls: number;
	tokens: number;
	costUsd: number;
	costUnknownParts: number;
}

export interface TaskBudgetSummary {
	configured: boolean;
	tokens: BudgetDimension;
	costUsd: BudgetDimension;
	/** "root" plus one key per DelegationKind actually seen. Absent roles are absent, not zero-filled. */
	byRole: Record<string, RoleUsageSummary>;
}

function usageTokens(counts: TokenCounts): number {
	return counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
}

/**
 * Summarize a Task without persisting a second accounting structure.
 * Token totals deliberately exclude `reasoning`: providers differ on whether
 * it is already included in `output`, so adding it can double-count usage.
 * Unknown components do not reduce remaining: treating them as debt is
 * reserved for a later budget policy.
 */
export function summarizeTaskBudget(usage: TaskUsage, limits?: CumulativeBudgetLimits): TaskBudgetSummary {
	const rootTokens = usageTokens(usage.root);
	const childTokens = usage.children.reduce((sum, child) => sum + usageTokens(child), 0);
	const tokenKnown = rootTokens + childTokens;
	const tokenUnknown = usage.root.tokensUnknownTurns
		+ usage.children.filter((child) => child.pending || child.source === "unavailable").length;
	const costKnown = (usage.root.costUsd ?? 0)
		+ usage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
	// Root cost is sticky-unknown across all its turns, so it contributes one
	// unknown component at most; unknown parts are not folded into known/remaining.
	// A Root bucket that never took a turn spent nothing: zero is not unknown,
	// so it must not fabricate an unknown component (renderUsage guards the same way).
	const rootCostUnknown = usage.root.turns > 0 && usage.root.costUsd === undefined;
	const costUnknown = (rootCostUnknown ? 1 : 0)
		+ usage.children.filter((child) => child.costUsd === undefined).length;
	const dimension = (known: number, unknownParts: number, limit?: number): BudgetDimension => ({
		...(limit === undefined ? {} : { limit, remaining: limit - known }),
		known,
		unknownParts,
	});
	const byRole: Record<string, RoleUsageSummary> = {
		root: {
			calls: usage.root.turns,
			tokens: rootTokens,
			costUsd: usage.root.costUsd ?? 0,
			costUnknownParts: rootCostUnknown ? 1 : 0,
		},
	};
	for (const child of usage.children) {
		const role = byRole[child.kind] ?? (byRole[child.kind] = {
			calls: 0,
			tokens: 0,
			costUsd: 0,
			costUnknownParts: 0,
		});
		role.calls += 1;
		role.tokens += usageTokens(child);
		role.costUsd += child.costUsd ?? 0;
		if (child.costUsd === undefined) role.costUnknownParts += 1;
	}
	return {
		configured: limits?.tokens !== undefined || limits?.costUsd !== undefined,
		tokens: dimension(tokenKnown, tokenUnknown, limits?.tokens),
		costUsd: dimension(costKnown, costUnknown, limits?.costUsd),
		byRole,
	};
}

export interface SessionUsageSummary {
	/** Session-level usage that belongs to no Task (pre-Task Root turns, unattributable children). */
	unattributed: { turns: number; tokens: number; costUsd: number; costUnknown: boolean };
	tasks: string[];
	/** Whole-session tokens: unattributed + every task's root and children. */
	totalTokens: number;
	/** Whole-session known cost. Unknown components are counted in costUnknownParts, never as 0 spend. */
	totalCostUsd: number;
	costUnknownParts: number;
}

export function summarizeSessionUsage(ledger: UsageLedger): SessionUsageSummary {
	const session = ledger.sessionUsage();
	const unattributed = session.untasked;
	const unattributedTokens = usageTokens(unattributed);
	let totalTokens = unattributedTokens;
	let totalCostUsd = unattributed.costUsd ?? 0;
	// Same rule as summarizeTaskBudget: a bucket with no turns spent nothing,
	// so an empty unattributed bucket is known-zero, not unknown.
	const unattributedCostUnknown = unattributed.turns > 0 && unattributed.costUsd === undefined;
	let costUnknownParts = unattributedCostUnknown ? 1 : 0;
	for (const taskId of session.tasks) {
		const usage = ledger.taskUsage(taskId);
		if (!usage) continue;
		totalTokens += usageTokens(usage.root) + usage.children.reduce((sum, child) => sum + usageTokens(child), 0);
		totalCostUsd += (usage.root.costUsd ?? 0) + usage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
		costUnknownParts += (usage.root.turns > 0 && usage.root.costUsd === undefined ? 1 : 0)
			+ usage.children.filter((child) => child.costUsd === undefined).length;
	}
	return {
		unattributed: {
			turns: unattributed.turns,
			tokens: unattributedTokens,
			costUsd: unattributed.costUsd ?? 0,
			costUnknown: unattributedCostUnknown,
		},
		tasks: session.tasks,
		totalTokens,
		totalCostUsd,
		costUnknownParts,
	};
}

function formatTokens(n: number): string {
	const abs = Math.abs(n);
	if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

function formatBytes(n: number): string {
	if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)} KB`;
	return `${Math.round(n)} B`;
}

function moneySymbol(currency: "USD" | "CNY"): string {
	return currency === "CNY" ? "¥" : "$";
}

function formatMoney(n: number, currency: "USD" | "CNY" = "USD"): string {
	const sym = moneySymbol(currency);
	if (n < 0.10) return `${sym}${n.toFixed(4)}`;
	return `${sym}${n.toFixed(2)}`;
}

function totalTokens(counts: TokenCounts): number {
	return counts.input + counts.output + counts.cacheRead + counts.cacheWrite;
}

export function renderUsage(
	taskUsage: TaskUsage,
	opts: {
		taskId?: string;
		state?: string;
		rounds?: number;
		currency?: "USD" | "CNY";
		rootRates?: PricingRates;
	} = {},
): string {
	const currency = opts.currency ?? "USD";
	const taskId = opts.taskId ?? "unknown";
	const state = opts.state ?? "unknown";
	const rounds = opts.rounds ?? 0;
	const root = taskUsage.root;
	const lines: string[] = [];
	lines.push(`Usage for ${taskId} (${state}, ${rounds} rounds)`);
	let rootCost: string;
	if (root.costUsd !== undefined && !taskUsage.costUnknown) {
		rootCost = `   ${formatMoney(root.costUsd, currency)}`;
	} else if (root.turns > 0 && root.costUsd === undefined) {
		// Unknown is not zero: never render the missing Root cost as $0.
		rootCost = "   cost unknown";
	} else {
		rootCost = "";
	}
	const rootModel = taskUsage.rootModel ?? "";
	lines.push(
		`Root   ${rootModel}   ${root.turns} turns   in ${formatTokens(root.input)} (cache ${formatTokens(root.cacheRead)})  out ${formatTokens(root.output)}${rootCost}`,
	);
	lines.push(
		`       planning ${root.byPhase.planning.turns} turns · executing ${root.byPhase.executing.turns} · reviewing ${root.byPhase.reviewing.turns}`,
	);
	lines.push(`       review leak ${formatBytes(root.reviewLeakBytes)} · injected ${formatBytes(root.injectedBytes)}`);
	for (const child of taskUsage.children) {
		const childCost = child.costUsd !== undefined ? `  ${formatMoney(child.costUsd, currency)}` : "";
		const ident = child.runId ? `   (run ${child.runId})` : child.toolCallId ? `   (call ${child.toolCallId})` : "";
		const pending = child.pending ? " pending" : "";
		lines.push(
			`Child  ${child.kind.padEnd(9)} ${child.model ?? child.agent ?? ""}     in ${formatTokens(child.input)}  out ${formatTokens(child.output)}${childCost}${ident}${pending}`,
		);
	}
	const childCostSum = taskUsage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
	const rootCostVal = root.costUsd;
	if (taskUsage.costUnknown) {
		const unknownCount = (root.costUsd === undefined && root.turns > 0 ? 1 : 0)
			+ taskUsage.children.filter((child) => child.costUsd === undefined).length;
		lines.push(`cost unknown${unknownCount ? ` for ${unknownCount} components` : ""}`);
		if (root.turns > 0 && root.costUsd === undefined) {
			const knownChildren = taskUsage.children.filter((child) => child.costUsd !== undefined);
			if (knownChildren.length > 0) {
				lines.push(`Total ${formatMoney(childCostSum, currency)} excluding Root (Root cost unknown, not included)`);
			} else {
				lines.push("Total unknown excluding Root (Root cost unknown, no known component costs)");
			}
		}
	} else if (rootCostVal !== undefined) {
		const total = rootCostVal + childCostSum;
		const share = total > 0 ? Math.round((rootCostVal / total) * 100) : 0;
		lines.push(`Root share of cost: ${share}%   (cost unknown for 0 components)`);
	}
	const estimateMissing: string[] = [];
	if (!hasUsableRates(opts.rootRates)) estimateMissing.push("缺少 Root 费率");
	const childTokens: TokenCounts = emptyTokenCounts();
	let childUsageComplete = taskUsage.children.length > 0;
	for (const child of taskUsage.children) {
		if (![child.input, child.output, child.cacheRead, child.cacheWrite].every(Number.isFinite)) {
			childUsageComplete = false;
		}
		addTokens(childTokens, child);
		if (child.costUsd === undefined) estimateMissing.push(`缺少子进程费率${child.model ? `（${child.model}）` : ""}`);
	}
	if (!childUsageComplete) estimateMissing.push("缺少子进程用量");
	if (estimateMissing.length > 0) {
		lines.push(`同 token 用量换价估算：不可估算（${estimateMissing.join("、")}）`);
	} else {
		const estimate = tableCost(opts.rootRates, childTokens);
		if (estimate !== undefined) {
			lines.push(`同 token 用量换价估算：${formatMoney(estimate, currency)}（假设子进程用量保持不变、仅替换费率）`);
		} else {
			lines.push("同 token 用量换价估算：不可估算（缺少 Root 费率）");
		}
	}
	return lines.join("\n");
}

export function renderUsageLine(taskUsage: TaskUsage, currency: "USD" | "CNY" = "USD"): string {
	const rootTok = formatTokens(totalTokens(taskUsage.root)).replace(/\.0k$/, "k").replace(/\.0M$/, "M");
	const childTokNum = taskUsage.children.reduce((sum, child) => sum + totalTokens(child), 0);
	const childTok = formatTokens(childTokNum).replace(/\.0k$/, "k").replace(/\.0M$/, "M");
	const compactRoot = formatTokens(taskUsage.root.input + taskUsage.root.output).replace(/\.0k$/, "k");
	const compactChild = formatTokens(
		taskUsage.children.reduce((sum, child) => sum + child.input + child.output, 0),
	).replace(/\.0k$/, "k");
	let line: string;
	if (taskUsage.costUnknown) {
		line = `usage: root ${compactRoot || rootTok} (${taskUsage.root.turns} turns) · children ${compactChild || childTok} · cost unknown`;
		if (taskUsage.root.turns > 0 && taskUsage.root.costUsd === undefined) {
			const knownChildCost = taskUsage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
			line += taskUsage.children.some((child) => child.costUsd !== undefined)
				? ` · total ${formatMoney(knownChildCost, currency)} excluding Root`
				: " · total unknown excluding Root";
		}
	} else {
		const rootCost = taskUsage.root.costUsd !== undefined ? formatMoney(taskUsage.root.costUsd, currency) : "";
		const childCostNum = taskUsage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
		const childCost = formatMoney(childCostNum, currency);
		const total = (taskUsage.root.costUsd ?? 0) + childCostNum;
		const share = total > 0 ? Math.round(((taskUsage.root.costUsd ?? 0) / total) * 100) : 0;
		const rootPart = rootCost ? `${compactRoot}/${rootCost}` : compactRoot;
		const childPart = `${compactChild}/${childCost}`;
		line = `usage: root ${rootPart} (${taskUsage.root.turns} turns) · children ${childPart} · root share ${share}%`;
	}
	if (Buffer.byteLength(line) <= LINE_CAP_BYTES) return line;
	let cut = line;
	while (Buffer.byteLength(cut) > LINE_CAP_BYTES && cut.length > 0) {
		cut = cut.slice(0, -1);
	}
	return cut;
}

/**
 * Whether this session_shutdown reason should append usage.jsonl.
 *
 * `quit` ends the process. `new` / `fork` / `resume` dispose this session and
 * replace it with a different session file, so in-memory children would never
 * meet flushIfTerminal. `reload` keeps the same session file and emits
 * session_start on a new runner that loadSessionUsage-s the persisted entries.
 */
export function shouldFlushUsageOnShutdown(reason: unknown): boolean {
	return reason === "quit" || reason === "new" || reason === "fork" || reason === "resume";
}
