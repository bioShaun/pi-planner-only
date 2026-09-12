/**
 * Pure usage ledger: Root/child token counts, cost resolution, and rendering.
 * No Pi host imports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AcceptanceEvidenceMatrixOptions, EvidenceMatrixEntry } from "./acceptance.ts";
import { buildAcceptanceEvidenceMatrix } from "./acceptance.ts";
import type {
	ChildProvenance,
	ChildUsage,
	DelegationKind,
	RootUsage,
	TaskState,
	TaskUsage,
	TokenCounts,
	UsagePhase,
	LoadedPluginFingerprint,
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
	taskIds?: string[];
	attribution?: RootTurnAttribution;
	toolCallIds?: string[];
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
	/** All candidate Tasks observed in this turn; more than one is explicitly shared. */
	taskIds?: string[];
	/** Attribution is explicit so a shared turn is never silently assigned to one Task. */
	attribution?: RootTurnAttribution;
	/** Tool calls that caused the Root turn to be attributable. */
	toolCallIds?: string[];
	at: string;
	model?: string;
	provider?: string;
	state?: TaskState;
	tokens: TokenCounts;
	costUsd?: number;
	tokensUnknown: boolean;
	phase?: UsagePhase;
}

export interface ChildUsageIds extends ChildProvenance {
	runId?: string;
	toolCallId?: string;
	agent?: string;
	model?: string;
	thinking?: string;
	source: ChildUsage["source"];
	pending?: boolean;
	observedInSessionId?: string;
}

export type RootTurnAttribution = "tasked" | "shared" | "untasked";

/**
 * L73 — turn attribution from candidate Tasks: a turn spanning more than one
 * Task is shared (never collapsed onto the most recent target), exactly one
 * candidate is tasked, none is untasked. `taskedAllowed=false` forces the
 * untasked bucket for a single candidate — the ledger additionally requires a
 * known lifecycle phase. The message handler and `applyRootTurn` must derive
 * this identically, so both call this one function.
 */
export function deriveRootTurnAttribution(candidates: number, taskedAllowed = true): RootTurnAttribution {
	return candidates > 1 ? "shared" : candidates === 1 && taskedAllowed ? "tasked" : "untasked";
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

/**
 * RT-05 one-off repair: the two child runs that genuinely belong to T-004.
 * Keep this allow-list deliberately narrow so a repair cannot accidentally
 * turn an unrelated run into T-004 usage again.
 */
export const T004_REPAIR_TASK_ID = "T-20260912-004";
export const T004_REPAIR_ALLOWED_RUN_IDS = Object.freeze(["7110bd1b", "143426ad"] as const);

export interface T004RepairOptions {
	taskId?: string;
	allowedRunIds?: readonly string[];
	sessionHint?: string;
}

export interface T004RepairMovedChild {
	runId?: string;
	sessionHint: string;
	child: Record<string, unknown>;
}

export interface T004UsageRepairResult {
	records: unknown[];
	moved: T004RepairMovedChild[];
	removedFromTask: number;
}

function repairRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function repairText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sessionHintFromPath(value: string): string | undefined {
	const parts = value.replaceAll("\\", "/").split("/").filter(Boolean);
	if (parts.length === 0) return undefined;
	const leaf = parts.at(-1) as string;
	if (/\\.(?:jsonl?|log)$/i.test(leaf) && parts.length > 1) return parts.at(-2);
	return leaf.replace(/\\.(?:jsonl?|log)$/i, "");
}

function repairSessionHint(
	child: Record<string, unknown>,
	record: Record<string, unknown>,
	options: T004RepairOptions,
): string {
	for (const value of [child.sessionHint, child.sessionId, child.sourceSessionId, record.sessionHint, record.sessionId, options.sessionHint]) {
		const text = repairText(value);
		if (text) return text;
	}
	for (const value of [child.transcriptPath, child.sessionFile, child.sourceDir, record.sessionFile, record.sourceDir]) {
		const path = repairText(value);
		const hint = path ? sessionHintFromPath(path) : undefined;
		if (hint) return hint;
	}
	return `foreign:${options.taskId ?? T004_REPAIR_TASK_ID}`;
}

/**
 * Move foreign T-004 children to standalone unattributed audit snapshots.
 * The function is idempotent by runId: repeated historical snapshots do not
 * manufacture additional unattributed records for the same execution.
 */
export function repairT004UsageRecords(
	input: readonly unknown[],
	options: T004RepairOptions = {},
): T004UsageRepairResult {
	const taskId = options.taskId ?? T004_REPAIR_TASK_ID;
	const allowed = new Set(options.allowedRunIds ?? T004_REPAIR_ALLOWED_RUN_IDS);
	const output: unknown[] = [];
	const moved: T004RepairMovedChild[] = [];
	const movedRunIds = new Set<string>();
	let removedFromTask = 0;

	for (const value of input) {
		const record = repairRecord(value);
		if (!record || record.taskId !== taskId) {
			output.push(value);
			continue;
		}
		const children = Array.isArray(record.children) ? record.children : [];
		const kept: unknown[] = [];
		for (const rawChild of children) {
			const child = repairRecord(rawChild);
			const runId = child ? repairText(child.runId) : undefined;
			if (!child || !runId || allowed.has(runId)) {
				kept.push(rawChild);
				continue;
			}
			removedFromTask += 1;
			if (movedRunIds.has(runId)) continue;
			movedRunIds.add(runId);
			const sessionHint = repairSessionHint(child, record, options);
			const auditedChild = { ...child, sessionHint };
			moved.push({ runId, sessionHint, child: auditedChild });
		}
		output.push({ ...record, children: kept });
	}

	for (const item of moved) {
		output.push({
			root: emptyRootUsage(),
			children: [item.child],
			costUnknown: item.child.costUsd === undefined,
			taskId: "unattributed",
			unattributed: true,
			sourceTaskId: taskId,
			sessionHint: item.sessionHint,
		});
	}
	return { records: output, moved, removedFromTask };
}

/** Apply the same allow-list to a persisted LedgerSnapshotStore envelope. */
export function repairT004LedgerSnapshot(
	value: unknown,
	options: T004RepairOptions = {},
): { snapshot: unknown; moved: T004RepairMovedChild[]; removedFromTask: number } {
	const envelope = repairRecord(value);
	const task = envelope ? repairRecord(envelope.task) : undefined;
	const usage = task ? repairRecord(task.usage) : undefined;
	if (!task || task.taskId !== (options.taskId ?? T004_REPAIR_TASK_ID) || !usage) {
		return { snapshot: value, moved: [], removedFromTask: 0 };
	}
	const transformed = repairT004UsageRecords([{ ...usage, taskId: task.taskId }], options);
	const repairedUsage = repairRecord(transformed.records[0]);
	return {
		snapshot: repairedUsage ? { ...envelope, task: { ...task, usage: repairedUsage } } : value,
		moved: transformed.moved,
		removedFromTask: transformed.removedFromTask,
	};
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
	const full = modelIdForPricing(model);
	const slash = full.indexOf("/");
	const inferredProvider = slash > 0 ? full.slice(0, slash) : undefined;
	const bare = slash > 0 ? full.slice(slash + 1) : full;
	const last = full.includes("/") ? full.slice(full.lastIndexOf("/") + 1) : full;
	const resolvedProvider = provider?.trim() || inferredProvider;
	const keys: string[] = [];
	const push = (key: string) => {
		if (key && !keys.includes(key)) keys.push(key);
	};
	if (resolvedProvider && bare) push(`${resolvedProvider}/${bare}`);
	push(full);
	push(bare);
	if (last !== bare) push(last);
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

export type DelegationRateKind = "paid" | "free" | "unknown";

/**
 * Classify a delegation model's price from the pricing table: "free" when all
 * four rates are finite and zero, "paid" when usable and any rate is positive,
 * "unknown" when the table has no usable entry (callers treat unknown as paid).
 */
export function delegationRateKind(pricing: PricingTable, provider: string | undefined, model: string | undefined): DelegationRateKind {
	const rates = lookupRates(pricing, provider, model);
	if (!hasUsableRates(rates)) return "unknown";
	return rates.input === 0 && rates.output === 0 && rates.cacheRead === 0 && rates.cacheWrite === 0 ? "free" : "paid";
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

export function bundledPricingPath(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "pricing.defaults.json");
}

export function ensurePricingFile(env: NodeJS.ProcessEnv = process.env): void {
	if (env.PI_PLANNER_ONLY_PRICING?.trim()) return;
	const seedFlag = (env.PI_PLANNER_ONLY_SEED_PRICING ?? "").trim().toLowerCase();
	if (seedFlag === "0" || seedFlag === "false" || seedFlag === "off") return;
	const dest = pricingPath(env);
	const bundledRaw = readFileSync(bundledPricingPath(), "utf8");
	if (!existsSync(dest)) {
		mkdirSync(dirname(dest), { recursive: true });
		writeFileSync(dest, bundledRaw.endsWith("\n") ? bundledRaw : `${bundledRaw}\n`, "utf8");
		return;
	}
	let userParsed: Record<string, unknown>;
	try {
		userParsed = JSON.parse(readFileSync(dest, "utf8")) as Record<string, unknown>;
	} catch {
		return;
	}
	const bundled = JSON.parse(bundledRaw) as Record<string, unknown>;
	const userRates = userParsed.rates && typeof userParsed.rates === "object" && !Array.isArray(userParsed.rates)
		? userParsed.rates as Record<string, unknown>
		: {};
	const bundledRates = bundled.rates && typeof bundled.rates === "object" && !Array.isArray(bundled.rates)
		? bundled.rates as Record<string, unknown>
		: {};
	let added = false;
	const merged = { ...userRates };
	for (const [key, value] of Object.entries(bundledRates)) {
		if (key.startsWith("_")) continue;
		if (!(key in userRates)) {
			merged[key] = value;
			added = true;
		}
	}
	if (!added) return;
	userParsed.rates = merged;
	writeFileSync(dest, `${JSON.stringify(userParsed, null, 2)}\n`, "utf8");
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
		...(ids.sessionHint ? { sessionHint: ids.sessionHint } : {}),
		...(ids.sourceSessionId ? { sourceSessionId: ids.sourceSessionId } : {}),
		...(ids.transcriptPath ? { transcriptPath: ids.transcriptPath } : {}),
		...(ids.observedInSessionId ? { observedInSessionId: ids.observedInSessionId } : {}),
		...(ids.ownerRootSessionId ? { ownerRootSessionId: ids.ownerRootSessionId } : {}),
		...(ids.taskId ? { taskId: ids.taskId } : {}),
		...(ids.executionId ? { executionId: ids.executionId } : {}),
		...(ids.unknownReason ? { unknownReason: ids.unknownReason } : {}),
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
	private readonly resolveTaskId?: (taskId: string) => string;
	private readonly tasks = new Map<string, TaskUsage>();
	private readonly untasked: RootUsage = emptyRootUsage();
	private readonly shared: RootUsage = emptyRootUsage();
	private readonly seenIds = new Set<string>();
	private pending: UsageEntry[] = [];
	private seq = 0;

	constructor(opts: { pricing: PricingTable; now?: () => Date; resolveTaskId?: (taskId: string) => string }) {
		this.pricing = opts.pricing;
		this.now = opts.now ?? (() => new Date());
		this.resolveTaskId = opts.resolveTaskId;
	}

	private canonicalTaskId(taskId: string): string {
		return this.resolveTaskId?.(taskId) ?? taskId;
	}

	private nextSeq(): number {
		this.seq += 1;
		return this.seq;
	}

	private at(): string {
		return this.now().toISOString();
	}

	private ensureTask(taskId: string): TaskUsage {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		let task = this.tasks.get(canonicalTaskId);
		if (!task) {
			task = emptyTaskUsage();
			this.tasks.set(canonicalTaskId, task);
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
		taskIds?: readonly string[];
		attribution?: RootTurnAttribution;
		toolCallIds?: readonly string[];
		state?: TaskState;
		model?: string;
		provider?: string;
		usage: PiUsageLike;
	}): RootTurnRecord {
		const tokens = tokensFromUsage(input.usage);
		const tokensUnknown = isAllZero(tokens);
		const phase = phaseFor(input.state);
		const candidates = [...new Set((input.taskIds ?? (input.taskId ? [input.taskId] : [])).map((id) => this.canonicalTaskId(id)).filter(Boolean))];
		const attribution = input.attribution ?? deriveRootTurnAttribution(candidates.length, phase !== undefined);
		const tasked = attribution === "tasked" && candidates.length === 1;
		const canonicalTaskId = tasked ? candidates[0] : undefined;
		const costUsd = resolveCost(
			this.pricing,
			input.usage,
			tokens,
			input.provider ?? providerFromModel(input.model),
			input.model,
		);
		const bucket = attribution === "shared" ? this.shared : tasked ? this.ensureTask(canonicalTaskId as string).root : this.untasked;
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
		if (tasked && input.model) this.ensureTask(canonicalTaskId as string).rootModel = input.model;
		if (tasked) this.refreshCostUnknown(this.ensureTask(canonicalTaskId as string));
		return {
			id: "",
			at: this.at(),
			tokens,
			tokensUnknown,
			...(canonicalTaskId ? { taskId: canonicalTaskId } : {}),
			...(candidates.length > 0 ? { taskIds: candidates } : {}),
			attribution,
			...(input.toolCallIds?.length ? { toolCallIds: [...input.toolCallIds] } : {}),
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
		taskIds?: readonly string[];
		attribution?: RootTurnAttribution;
		toolCallIds?: readonly string[];
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
			...(record.taskIds ? { taskIds: record.taskIds } : {}),
			attribution: record.attribution,
			...(record.toolCallIds ? { toolCallIds: record.toolCallIds } : {}),
			...(input.state ? { state: input.state } : {}),
			...(input.model ? { model: input.model } : {}),
			...(input.provider ? { provider: input.provider } : {}),
			...(input.messageId ? { messageId: input.messageId } : {}),
			usage: input.usage,
		});
		return record;
	}

	recordInjected(taskId: string, bytes: number): void {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		const task = this.ensureTask(canonicalTaskId);
		task.root.injectedBytes += bytes;
		const seq = this.nextSeq();
		this.push({
			id: `injected:${canonicalTaskId}:${seq}`,
			kind: "injected",
			taskId: canonicalTaskId,
			at: this.at(),
			bytes,
		});
	}

	recordReviewLeak(taskId: string, bytes: number): void {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		const task = this.ensureTask(canonicalTaskId);
		task.root.reviewLeakBytes += bytes;
		const seq = this.nextSeq();
		this.push({
			id: `leak:${canonicalTaskId}:${seq}`,
			kind: "leak",
			taskId: canonicalTaskId,
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
				const existing = task.children[index];
				// Do not overwrite an already resolved child with a pending one
				if (!existing.pending && stored.pending) {
					return;
				}
				// If existing has positive turns/usage and incoming has 0, keep existing
				if (!existing.pending && !stored.pending && (existing.turns ?? 0) > (stored.turns ?? 0)) {
					return;
				}
				task.children[index] = {
					...existing,
					...stored,
					...(existing.ownerRootSessionId && !stored.ownerRootSessionId ? { ownerRootSessionId: existing.ownerRootSessionId } : {}),
					...(existing.sessionHint && !stored.sessionHint ? { sessionHint: existing.sessionHint } : {}),
					...(existing.observedInSessionId && !stored.observedInSessionId ? { observedInSessionId: existing.observedInSessionId } : {}),
					...(existing.unknownReason && !stored.unknownReason ? { unknownReason: existing.unknownReason } : {}),
				};
				this.refreshCostUnknown(task);
				return;
			}
		}
		task.children.push(stored);
		this.refreshCostUnknown(task);
	}

	recordChild(taskId: string, child: ChildUsage): void {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		const task = this.ensureTask(canonicalTaskId);
		this.upsertChild(task, child);
		const seq = this.nextSeq();
		const ident = child.runId ?? child.toolCallId ?? String(seq);
		this.push({
			id: `child:${ident}:${seq}`,
			kind: "child",
			taskId: canonicalTaskId,
			at: this.at(),
			child: cloneChild(this.ensureTask(canonicalTaskId).children.find((c) => childKey(c) === childKey(child)) ?? child),
			...(child.toolCallId ? { toolCallId: child.toolCallId } : {}),
			...(child.runId ? { runId: child.runId } : {}),
		});
	}

	resolvePending(taskId: string, read: (child: ChildUsage) => ChildUsage | undefined): number {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		const task = this.tasks.get(canonicalTaskId);
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
				taskId: canonicalTaskId,
				at: this.at(),
				child: cloneChild(next),
				...(next.toolCallId ? { toolCallId: next.toolCallId } : {}),
				...(next.runId ? { runId: next.runId } : {}),
			});
		}
		return resolved;
	}

	taskUsage(taskId: string): TaskUsage | undefined {
		const canonicalTaskId = this.canonicalTaskId(taskId);
		const task = this.tasks.get(canonicalTaskId);
		if (!task) return undefined;
		return task;
	}

	sessionUsage(): { untasked: RootUsage; shared: RootUsage; tasks: string[] } {
		return { untasked: this.untasked, shared: this.shared, tasks: [...this.tasks.keys()] };
	}

	canonicalizeTaskIds(): void {
		for (const [taskId, usage] of [...this.tasks]) {
			const canonicalTaskId = this.canonicalTaskId(taskId);
			if (canonicalTaskId === taskId) continue;
			if (!this.tasks.has(canonicalTaskId)) this.tasks.set(canonicalTaskId, usage);
			this.tasks.delete(taskId);
		}
	}

	/**
	 * Ticket 40 — session-level root cumulative spend (untasked + every Task root).
	 * Child spend is excluded: those are gated by Task cumulativeBudget.
	 */
	sessionRootSpend(): {
		turns: number;
		tokens: number;
		costUsd: number | undefined;
		costUnknown: boolean;
		currency: PricingTable["currency"];
		untaskedTurns: number;
		untaskedTokens: number;
		untaskedCostUsd: number | undefined;
		sharedTurns: number;
		sharedTokens: number;
		sharedCostUsd: number | undefined;
	} {
		const untaskedTokens = usageTokens(this.untasked);
		const sharedTokens = usageTokens(this.shared);
		let turns = this.untasked.turns + this.shared.turns;
		let tokens = untaskedTokens + sharedTokens;
		let costUnknown = (this.untasked.turns > 0 && this.untasked.costUsd === undefined)
			|| (this.shared.turns > 0 && this.shared.costUsd === undefined);
		let costUsd: number | undefined = costUnknown ? undefined : (this.untasked.costUsd ?? 0) + (this.shared.costUsd ?? 0);
		for (const task of this.tasks.values()) {
			const root = task.root;
			turns += root.turns;
			tokens += usageTokens(root);
			const rootUnknown = root.turns > 0 && root.costUsd === undefined;
			if (rootUnknown || costUnknown) {
				costUnknown = true;
				costUsd = undefined;
			} else {
				costUsd = (costUsd ?? 0) + (root.costUsd ?? 0);
			}
		}
		return {
			turns,
			tokens,
			costUsd,
			costUnknown,
			currency: this.pricing.currency,
			untaskedTurns: this.untasked.turns,
			untaskedTokens,
			untaskedCostUsd: this.untasked.costUsd,
			sharedTurns: this.shared.turns,
			sharedTokens,
			sharedCostUsd: this.shared.costUsd,
		};
	}

	load(records: UsageEntry[]): void {
		for (const entry of records) {
			if (!entry || typeof entry !== "object" || !entry.id || !entry.kind) continue;
			if (this.seenIds.has(entry.id)) continue;
			this.seenIds.add(entry.id);
			if (entry.kind === "root-turn") {
				this.applyRootTurn({
					...(entry.taskId ? { taskId: entry.taskId } : {}),
					...(entry.taskIds ? { taskIds: entry.taskIds } : {}),
					...(entry.attribution ? { attribution: entry.attribution } : {}),
					...(entry.toolCallIds ? { toolCallIds: entry.toolCallIds } : {}),
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
	/**
	 * The part of `known` that is estimated debt rather than observed spend
	 * (ticket 15). Always <= known. Disclosed separately so an operator is never
	 * shown an estimate dressed up as a measurement.
	 */
	debt: number;
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
 *
 * Ticket 15: a component whose value is unknown is charged its recorded debt
 * (the budget granted at launch) instead of zero, and the debt is also reported
 * separately in `debt`. Charging zero let a child that burned real money leave
 * the gate reading a full balance. Debt is counted ONLY while the real value is
 * absent, so a resolved child's stale debt field can never double-count.
 */
export function summarizeTaskBudget(usage: TaskUsage, limits?: CumulativeBudgetLimits): TaskBudgetSummary {
	const rootTokens = usageTokens(usage.root);
	const childTokens = usage.children.reduce((sum, child) => sum + usageTokens(child), 0);
	const unresolved = (child: ChildUsage): boolean => child.pending || child.source === "unavailable";
	const tokenDebt = usage.children.reduce((sum, child) => sum + (unresolved(child) ? (child.tokensDebt ?? 0) : 0), 0);
	const tokenKnown = rootTokens + childTokens + tokenDebt;
	const tokenUnknown = usage.root.tokensUnknownTurns
		+ usage.children.filter(unresolved).length;
	const costDebt = usage.children.reduce(
		(sum, child) => sum + (child.costUsd === undefined ? (child.costDebtUsd ?? 0) : 0),
		0,
	);
	const costKnown = (usage.root.costUsd ?? 0)
		+ usage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0)
		+ costDebt;
	// Root cost is sticky-unknown across all its turns, so it contributes one
	// unknown component at most; unknown parts are not folded into known/remaining.
	// A Root bucket that never took a turn spent nothing: zero is not unknown,
	// so it must not fabricate an unknown component (renderUsage guards the same way).
	const rootCostUnknown = usage.root.turns > 0 && usage.root.costUsd === undefined;
	const costUnknown = (rootCostUnknown ? 1 : 0)
		+ usage.children.filter((child) => child.costUsd === undefined).length;
	const dimension = (known: number, unknownParts: number, debt: number, limit?: number): BudgetDimension => ({
		...(limit === undefined ? {} : { limit, remaining: limit - known }),
		known,
		unknownParts,
		debt,
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
		// Ticket 15: the per-role figures carry the same debt the dimensions do.
		// Leaving debt out here made the roles sum to less than 已用, which reads
		// as an accounting bug rather than as an estimate.
		role.tokens += usageTokens(child) + (unresolved(child) ? (child.tokensDebt ?? 0) : 0);
		role.costUsd += child.costUsd ?? (child.costDebtUsd ?? 0);
		if (child.costUsd === undefined) role.costUnknownParts += 1;
	}
	return {
		configured: limits?.tokens !== undefined || limits?.costUsd !== undefined,
		tokens: dimension(tokenKnown, tokenUnknown, tokenDebt, limits?.tokens),
		costUsd: dimension(costKnown, costUnknown, costDebt, limits?.costUsd),
		byRole,
	};
}

export interface SessionUsageSummary {
	/** Session-level usage that belongs to no Task (pre-Task Root turns, unattributable children). */
	unattributed: { turns: number; tokens: number; costUsd: number; costUnknown: boolean };
	shared: { turns: number; tokens: number; costUsd: number; costUnknown: boolean };
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
	const shared = session.shared;
	const sharedTokens = usageTokens(shared);
	let totalTokens = unattributedTokens + sharedTokens;
	let totalCostUsd = (unattributed.costUsd ?? 0) + (shared.costUsd ?? 0);
	// Same rule as summarizeTaskBudget: a bucket with no turns spent nothing.
	const unattributedCostUnknown = unattributed.turns > 0 && unattributed.costUsd === undefined;
	const sharedCostUnknown = shared.turns > 0 && shared.costUsd === undefined;
	let costUnknownParts = (unattributedCostUnknown ? 1 : 0) + (sharedCostUnknown ? 1 : 0);
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
		shared: {
			turns: shared.turns,
			tokens: sharedTokens,
			costUsd: shared.costUsd ?? 0,
			costUnknown: sharedCostUnknown,
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

export interface RunRecordTaskFacts {
	taskId: string; objective?: string; acceptanceCriteria: string[]; state: string; reviewRounds: number;
	createdAt?: string; updatedAt?: string; cwd: string; baseGitRef?: string; finalGitRef?: string; gitStatusHash?: string;
}
export interface RunRecordPricingSource { path: string; version?: number; currency: "USD" | "CNY"; loadedAt: string; }
export interface RunRecordIdentityLink {
	taskId: string;
	executionId: string;
	hostRunId?: string;
	reportRevision?: number;
	childSessionFile?: string;
}
export interface RunRecord {
	version: 1; runId: string; recordedAt: string; arm: string; task: RunRecordTaskFacts;
	provenance?: LoadedPluginFingerprint;
	identityIndex?: RunRecordIdentityLink[];
	models: { root?: string; children: Array<{ kind: DelegationKind; agent?: string; model?: string; thinking?: string }> };
	pricing: RunRecordPricingSource; cache: { cacheRead: number; cacheWrite: number };
	tokens: TokenCounts & { total: number; turns: number };
	cost: { rootUsd?: number; childrenUsd: number; totalUsd?: number; debtUsd: number; unknownParts: number };
	outcome: { state: string; completed: boolean }; durationMs?: number; comparable: boolean; incomparableReasons: string[];
}

export function buildRunRecord(input: {
	runId: string;
	arm: string;
	task: RunRecordTaskFacts;
	usage: TaskUsage;
	pricing: RunRecordPricingSource;
	provenance?: LoadedPluginFingerprint;
	identityIndex?: readonly RunRecordIdentityLink[];
	now?: () => Date;
}): RunRecord {
	const { usage } = input;
	const unresolved = (child: ChildUsage) => child.pending || child.source === "unavailable";
	const rootUnknown = usage.root.turns > 0 && usage.root.costUsd === undefined;
	const childUnknown = usage.children.filter((child) => child.costUsd === undefined && !(unresolved(child) && child.costDebtUsd !== undefined));
	const debtUsd = usage.children.reduce((sum, child) => sum + (child.costUsd === undefined ? (child.costDebtUsd ?? 0) : 0), 0);
	const childrenUsd = usage.children.reduce((sum, child) => sum + (child.costUsd ?? 0), 0);
	const tokens = { input: usage.root.input + usage.children.reduce((s, c) => s + c.input, 0), output: usage.root.output + usage.children.reduce((s, c) => s + c.output, 0), cacheRead: usage.root.cacheRead + usage.children.reduce((s, c) => s + c.cacheRead, 0), cacheWrite: usage.root.cacheWrite + usage.children.reduce((s, c) => s + c.cacheWrite, 0), turns: usage.root.turns + usage.children.reduce((s, c) => s + (c.turns ?? 0), 0), total: 0 };
	tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
	const reasons: string[] = [];
	if (rootUnknown || childUnknown.length > 0) reasons.push(`${(rootUnknown ? 1 : 0) + childUnknown.length} cost component(s) have no resolvable rate`);
	if (usage.root.tokensUnknownTurns > 0) reasons.push(`${usage.root.tokensUnknownTurns} root turn(s) reported no token counts`);
	if (debtUsd > 0) reasons.push(`$${debtUsd} of the total is estimated debt, not observed spend`);
	const started = input.task.createdAt ? Date.parse(input.task.createdAt) : Number.NaN;
	const ended = input.task.updatedAt ? Date.parse(input.task.updatedAt) : Number.NaN;
	const durationMs = Number.isFinite(started) && Number.isFinite(ended) && ended >= started ? ended - started : undefined;
	if (durationMs === undefined) reasons.push("run duration is not derivable from the Task timestamps");
	if (!input.task.baseGitRef) reasons.push("no baseline git ref: the starting repo state is unidentified");
	return {
		version: 1,
		runId: input.runId,
		recordedAt: (input.now?.() ?? new Date()).toISOString(),
		arm: input.arm,
		task: input.task,
		...(input.provenance ? { provenance: input.provenance } : {}),
		...(input.identityIndex ? { identityIndex: input.identityIndex.map((link) => ({ ...link })) } : {}),
		models: { root: usage.rootModel, children: usage.children.map(({ kind, agent, model, thinking }) => ({ kind, agent, model, thinking })) }, pricing: input.pricing, cache: { cacheRead: tokens.cacheRead, cacheWrite: tokens.cacheWrite }, tokens, cost: { rootUsd: usage.root.costUsd, childrenUsd, totalUsd: reasons.length === 0 ? (usage.root.costUsd ?? 0) + childrenUsd : undefined, debtUsd, unknownParts: (rootUnknown ? 1 : 0) + childUnknown.length }, outcome: { state: input.task.state, completed: input.task.state === "completed" }, durationMs, comparable: reasons.length === 0, incomparableReasons: reasons };
}

export interface RunSummary { runs: number; comparable: number; incomparable: number; completed: number; passRate: number; totalSpendUsd: number; costPerSuccessUsd?: number; avgReviewRounds: number; avgDurationMs?: number; incomparableReasons: Record<string, number>; }
export function summarizeRuns(records: readonly RunRecord[]): RunSummary {
	const comparable = records.filter((r) => r.comparable); const completed = records.filter((r) => r.outcome.completed); const successes = comparable.filter((r) => r.outcome.completed); const durations = records.flatMap((r) => r.durationMs === undefined ? [] : [r.durationMs]); const reasons: Record<string, number> = {};
	for (const r of records) for (const reason of r.incomparableReasons) reasons[reason] = (reasons[reason] ?? 0) + 1;
	const spend = comparable.reduce((sum, r) => sum + (r.cost.totalUsd ?? 0), 0);
	return { runs: records.length, comparable: comparable.length, incomparable: records.length - comparable.length, completed: completed.length, passRate: records.length === 0 ? 0 : completed.length / records.length, totalSpendUsd: spend, costPerSuccessUsd: successes.length === 0 ? undefined : spend / successes.length, avgReviewRounds: records.length === 0 ? 0 : records.reduce((s, r) => s + r.task.reviewRounds, 0) / records.length, avgDurationMs: durations.length === 0 ? undefined : durations.reduce((s, d) => s + d, 0) / durations.length, incomparableReasons: reasons };
}
export function renderRunSummary(summary: RunSummary): string {
	const cost = summary.costPerSuccessUsd === undefined ? "无可比成功样本" : `$${summary.costPerSuccessUsd.toFixed(4)}`;
	return [`费用对照汇总: ${summary.runs} runs`, `通过率: ${(summary.passRate * 100).toFixed(2)}% (${summary.completed}/${summary.runs})`, `成功完成成本: ${cost}`, `总支出: $${summary.totalSpendUsd.toFixed(4)}`, `平均返工: ${summary.avgReviewRounds.toFixed(2)} 轮`, `平均耗时: ${summary.avgDurationMs === undefined ? "不可得" : `${summary.avgDurationMs.toFixed(0)} ms`}`, `可比: ${summary.comparable}，不可比: ${summary.incomparable}`, ...Object.entries(summary.incomparableReasons).map(([reason, count]) => `不可比原因: ${reason} (${count})`)].join("\n");
}

export interface SessionEvidenceExportOptions {
	rootSessionId: string;
	tasks?: readonly unknown[];
	runRecords?: readonly unknown[];
	delegations?: readonly unknown[];
	usageEntries?: readonly unknown[];
	/** Optional frozen event fixtures, accepted by the offline regression harness. */
	fixtures?: unknown;
	/** Optional explicit C/B evidence statuses; omitted entries remain unproven. */
	acceptance?: AcceptanceEvidenceMatrixOptions;
	sourceFingerprint?: string;
}

export interface SessionEvidenceBreakdown {
	superseded: number;
	committed: number;
	envelopeRepairs: number;
	budgetIntercepts: number;
	foreignChildSpend: { count: number; tokens: number; costUsd: number; unknownCost: boolean };
}

export interface SessionEvidenceExport {
	version: 1;
	rootSessionId: string;
	generatedAt: string;
	linkage: Array<Record<string, unknown>>;
	statuses: {
		processExit: Record<string, number>;
		ingestion: Record<string, number>;
		workerReport: Record<string, number>;
		reviewResult: Record<string, number>;
		task: Record<string, number>;
		rootVerdict: Record<string, number>;
		/** Typed refusal kinds of recorded verdict refusals (issue 04). */
		refusalKind: Record<string, number>;
		category: Record<string, number>;
	};
	findings: { items: Array<Record<string, unknown>>; total: number; duplicateNotifications: number; new: number; historical: number };
	interceptions: { total: number; runs: number; processFailures: number; providerErrors: number };
	usage: {
		tokens: TokenCounts;
		bySource: { root: TokenCounts; children: TokenCounts; unattributed: TokenCounts };
		cost: {
			calculatedUsd: number;
			reportedUsd: number;
			unknownUsd: boolean;
			unknownParts: number;
			unattributedUsd: number;
		};
		modelRates: Record<string, PricingRates>;
		breakdown: SessionEvidenceBreakdown;
		/** Mutually exclusive accounting buckets for root/child event export. */
		buckets: {
			tasked: { tokens: number; costUsd: number; unknownCost: boolean; count: number };
			untaskedShared: { tokens: number; costUsd: number; unknownCost: boolean; count: number };
			foreign: { tokens: number; costUsd: number; unknownCost: boolean; count: number };
			unknown: { tokens: number; costUsd: number; unknownCost: boolean; count: number };
		};
	};
	breakdown: SessionEvidenceBreakdown;
	requirements: Array<{ id: string; status: "implemented" | "unit-verified" | "handler-verified" | "host-verified" | "unproven"; evidence: string[]; downgradedFrom?: string }>;
	evidenceMatrix: EvidenceMatrixEntry[];
	analysis: string[];
	unattributed: Array<Record<string, unknown>>;
}

function emptyExportBreakdown(): SessionEvidenceBreakdown {
	return { superseded: 0, committed: 0, envelopeRepairs: 0, budgetIntercepts: 0, foreignChildSpend: { count: 0, tokens: 0, costUsd: 0, unknownCost: false } };
}

function exportUsageTokens(value: unknown): number {
	const record = exportRecord(value);
	if (!record) return 0;
	return ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, key) => sum + (exportNumber(record[key]) ?? 0), 0);
}

function isBudgetIntercept(value: Record<string, unknown>): boolean {
	return value.budgetIntercepted === true
		|| /budget|intercept/i.test(exportString(value.terminalErrorClass) ?? "")
		|| /budget|intercept/i.test(exportString(exportRecord(value.lastError)?.code) ?? "");
}

function addForeignChildSpend(target: SessionEvidenceBreakdown["foreignChildSpend"], value: unknown): void {
	const record = exportRecord(value);
	if (!record) return;
	const children = Array.isArray(record.children) ? record.children : [record];
	for (const child of children) {
		const item = exportRecord(child);
		if (!item) continue;
		target.count += 1;
		target.tokens += exportUsageTokens(item);
		const cost = exportNumber(item.costUsd) ?? exportNumber(item.calculatedCostUsd);
		if (cost === undefined) target.unknownCost = true;
		else target.costUsd += cost;
	}
}
function exportRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function exportString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function exportNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function incrementExport(target: Record<string, number>, value: unknown): void {
	const key = exportString(value) ?? "unknown";
	target[key] = (target[key] ?? 0) + 1;
}

function addExportTokens(target: TokenCounts, source: unknown): void {
	const record = exportRecord(source);
	if (!record) return;
	for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) {
		target[key] += exportNumber(record[key]) ?? 0;
	}
}

function exportTaskUsage(usage: unknown, result: SessionEvidenceExport["usage"], unattributed: boolean): void {
	const record = exportRecord(usage);
	if (!record) return;
	const root = exportRecord(record.root);
	const children = Array.isArray(record.children) ? record.children : [];
	if (root) {
		addExportTokens(result.tokens, root);
		addExportTokens(unattributed ? result.bySource.unattributed : result.bySource.root, root);
		const cost = exportNumber(root.costUsd);
		const calculated = exportNumber(root.calculatedCostUsd);
		if (calculated !== undefined) result.cost.calculatedUsd += calculated;
		else if (cost !== undefined) result.cost.reportedUsd += cost;
		if (unattributed && calculated !== undefined) result.cost.unattributedUsd += calculated;
		if (unattributed && cost !== undefined) result.cost.unattributedUsd += cost;
		else if ((exportNumber(root.turns) ?? 0) > 0 && calculated === undefined && cost === undefined) result.cost.unknownParts += 1;
	}
	for (const child of children) {
		addExportTokens(result.tokens, child);
		addExportTokens(unattributed ? result.bySource.unattributed : result.bySource.children, child);
		const item = exportRecord(child);
		if (!item) continue;
		const cost = exportNumber(item.costUsd);
		const calculated = exportNumber(item.calculatedCostUsd);
		if (calculated !== undefined) result.cost.calculatedUsd += calculated;
		else if (cost !== undefined) result.cost.reportedUsd += cost;
		if (unattributed && calculated !== undefined) result.cost.unattributedUsd += calculated;
		if (unattributed && cost !== undefined) result.cost.unattributedUsd += cost;
		else if ((exportNumber(item.turns) ?? 0) > 0 || item.pending === true) result.cost.unknownParts += 1;
	}
}

function usageIdentity(value: unknown): string | undefined {
	const record = exportRecord(value);
	if (!record) return undefined;
	const child = exportRecord(record.child) ?? record;
	const runId = exportString(child.runId) ?? exportString(record.runId);
	if (runId) return `run:${runId}`;
	const toolCallId = exportString(child.toolCallId) ?? exportString(record.toolCallId);
	if (toolCallId) return `call:${toolCallId}`;
	return exportString(record.id);
}

function childUsageBucket(value: unknown, rootSessionId: string, selectedTaskIds: Set<string>): "tasked" | "untaskedShared" | "foreign" | "unknown" {
	const record = exportRecord(value);
	const child = exportRecord(record?.child) ?? record;
	const taskId = exportString(record?.taskId) ?? exportString(child?.taskId);
	const owner = exportString(child?.ownerRootSessionId) ?? exportString(record?.ownerRootSessionId);
	const observed = exportString(child?.observedInSessionId) ?? exportString(record?.observedInSessionId);
	if (record?.kind === "root-turn" && (record.attribution === "untasked" || record.attribution === "shared")) return "untaskedShared";
	if (owner && owner !== rootSessionId) return "foreign";
	if (observed && observed !== rootSessionId && !owner) return "foreign";
	if (taskId && selectedTaskIds.has(taskId)) return "tasked";
	if (taskId === "unattributed" || record?.attribution === "shared" || child?.unknownReason) return record?.attribution === "shared" ? "untaskedShared" : child?.unknownReason ? "unknown" : "untaskedShared";
	return taskId ? "foreign" : "unknown";
}

function addBucketUsage(target: SessionEvidenceExport["usage"]["buckets"][keyof SessionEvidenceExport["usage"]["buckets"]], value: unknown): void {
	const record = exportRecord(value);
	if (!record) return;
	const child = exportRecord(record.child) ?? record;
	target.count += 1;
	target.tokens += exportUsageTokens(child);
	const cost = knownExportCost(record, child);
	if (cost === undefined) target.unknownCost = true;
	else target.costUsd += cost;
}

/** Known-cost conservation (C03): every priced source counts, including the
 * host-reported usage.cost.total that loose event rows carry instead of a
 * resolved costUsd. Unknown costs stay unknown — never zero-filled as priced. */
function knownExportCost(record: Record<string, unknown>, child: Record<string, unknown>): number | undefined {
	const childUsage = exportRecord(child.usage);
	const recordUsage = exportRecord(record.usage);
	return exportNumber(child.costUsd)
		?? exportNumber(child.calculatedCostUsd)
		?? piReportedCost(child as PiUsageLike)
		?? (childUsage ? piReportedCost(childUsage as PiUsageLike) : undefined)
		?? exportNumber(record.costUsd)
		?? exportNumber(record.calculatedCostUsd)
		?? (recordUsage ? piReportedCost(recordUsage as PiUsageLike) : undefined);
}

function emptyExportTokens(): TokenCounts {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * Produce a bounded, machine-readable evidence view for one Root session.
 * Inputs are deliberately structural so this exporter can consume restored
 * records from older plugin versions as well as live Task/RunRecord objects.
 */
export function exportSessionEvidence(options: SessionEvidenceExportOptions): SessionEvidenceExport {
	const rootSessionId = options.rootSessionId.trim();
	const tasks = (options.tasks ?? []).map(exportRecord).filter((task): task is Record<string, unknown> => Boolean(task));
	const delegationRuns = (options.delegations ?? []).map(exportRecord).filter((entry): entry is Record<string, unknown> => Boolean(entry)).map((entry) => {
		const record = exportRecord(entry.record) ?? entry;
		return {
			...record,
			rootSessionId: exportString(record.rootSessionId) ?? rootSessionId,
			...(entry.toolCallId && !record.toolCallId ? { toolCallId: entry.toolCallId } : {}),
		};
	});
	const allRuns = [...(options.runRecords ?? []), ...delegationRuns].map(exportRecord).filter((run): run is Record<string, unknown> => Boolean(run));
	const runs = allRuns.filter((run) => {
		const session = exportString(run.rootSessionId) ?? exportString(run.sessionId) ?? exportString(exportRecord(run.loadedProvenance)?.sessionId);
		return !rootSessionId || session === rootSessionId;
	});
	const runTaskIds = new Set(runs.map((run) => exportString(run.taskId)).filter((id): id is string => Boolean(id)));
	const selectedTasks = tasks.filter((task) => {
		const taskRoot = exportString(task.rootSessionId) ?? exportString(task.sessionId);
		return taskRoot === rootSessionId || runTaskIds.has(exportString(task.taskId) ?? "");
	});
	const selectedTaskIds = new Set(selectedTasks.map((task) => exportString(task.taskId)).filter((id): id is string => Boolean(id)));
	const linkage: Array<Record<string, unknown>> = [];
	const statusKinds = ["processExit", "ingestion", "workerReport", "reviewResult", "task", "rootVerdict", "refusalKind", "category"] as const;
	const statuses = Object.fromEntries(statusKinds.map((kind) => [kind, {}])) as SessionEvidenceExport["statuses"];
	const unattributed: Array<Record<string, unknown>> = [];
	for (const task of selectedTasks) {
		const taskId = exportString(task.taskId) ?? "unknown";
		const reports = Array.isArray(task.reports) ? task.reports : [];
		const reviews = Array.isArray(task.reviews) ? task.reviews : [];
		incrementExport(statuses.task, task.state);
		for (const report of reports) incrementExport(statuses.workerReport, exportRecord(report)?.status);
		for (const review of reviews) {
			const reviewRecord = exportRecord(review);
			incrementExport(statuses.reviewResult, reviewRecord?.verdict);
			const refusalKind = exportString(reviewRecord?.refusalKind);
			if (refusalKind) incrementExport(statuses.refusalKind, refusalKind);
		}
		const rootReview = [...reviews].reverse().map(exportRecord).find((review) => review?.source === "root" || review?.source === "operator");
		if (rootReview?.verdict !== undefined) incrementExport(statuses.rootVerdict, rootReview.verdict);
	}
	const findings = new Map<string, Record<string, unknown>>();
	let duplicateNotifications = 0;
	for (const task of selectedTasks) {
		const taskId = exportString(task.taskId) ?? "unknown";
		const taskFindings = Array.isArray(task.findings) ? task.findings : [];
		for (const raw of taskFindings) {
			const finding = exportRecord(raw);
			if (!finding) continue;
			const executionId = exportString(finding.executionId) ?? "unknown-execution";
			const identity = exportString(finding.id) ?? exportString(finding.kind) ?? JSON.stringify({ paths: finding.paths, note: finding.note });
			const key = `${taskId}\u0000${executionId}\u0000${identity}`;
			const existing = findings.get(key);
			if (existing) {
				existing.duplicateNotifications = (exportNumber(existing.duplicateNotifications) ?? 0) + 1;
				duplicateNotifications += 1;
				continue;
			}
			findings.set(key, { ...finding, taskId, executionId, identity, duplicateNotifications: 0 });
		}
	}
	for (const run of runs) {
		const taskId = exportString(run.taskId);
		if (taskId && !selectedTaskIds.has(taskId)) {
			unattributed.push({ type: "run", reason: "task-not-in-root-session", runId: run.runId, taskId, workspaceId: run.workspaceId });
			continue;
		}
		const executionId = exportString(run.executionId) ?? "unknown-execution";
		const task = selectedTasks.find((candidate) => exportString(candidate.taskId) === taskId);
		const executions = task && Array.isArray(task.executions) ? task.executions : [];
		const execution = executions.map(exportRecord).find((candidate) => exportString(candidate?.executionId) === executionId);
		const reportIndex = exportNumber(run.reportRevision) ?? (exportNumber(execution?.reportIndex) !== undefined ? (exportNumber(execution?.reportIndex) as number) + 1 : undefined);
		const report = task ? (Array.isArray(task.reports) ? exportRecord(task.reports[reportIndex === undefined ? -1 : reportIndex - 1]) : undefined) : undefined;
		const review = task && Array.isArray(task.reviews) ? exportRecord(task.reviews.at(-1)) : undefined;
		const identity = Array.isArray(run.identityIndex) ? exportRecord(run.identityIndex.find((item) => exportString(exportRecord(item)?.executionId) === executionId)) : undefined;
		const childSessionFile = exportString(identity?.childSessionFile) ?? exportString(run.childSessionFile) ?? exportString(execution?.childSessionFile);
		const reviewResultVerdict = review?.verdict ?? "unknown";
		const rootReview = task && Array.isArray(task.reviews)
			? task.reviews.map(exportRecord).reverse().find((candidate) => candidate?.source === "root" || candidate?.source === "operator")
			: undefined;
		const statusCategory = run.executionState === "launch-failed"
			? "host-error"
			: run.terminalErrorClass === "provider-error" || run.terminalErrorClass === "process-error"
				? "host-error"
				: run.terminalErrorClass === "missing-report" || run.ingestionState === "report-invalid" || run.ingestionState === "unavailable"
					? "ingestion-error"
					: exportRecord(run.lastError)?.code === "CONCURRENCY_REFUSED" || exportRecord(run.lastError)?.code === "LIFECYCLE_REFUSAL"
						? "lifecycle-refusal"
						: rootReview?.verdict === "pass" && task?.state === "completed" ? "accepted" : "pending";
		linkage.push({
			rootSessionId,
			...(exportString(identity?.toolCallId) || exportString(run.toolCallId) || executionId ? { toolCallId: exportString(identity?.toolCallId) ?? exportString(run.toolCallId) ?? executionId } : {}),
			...(run.runId ? { hostRunId: run.runId } : {}),
			...(childSessionFile ? { childSessionFile } : {}),
			...(taskId ? { taskId } : {}),
			executionId,
			...(reportIndex !== undefined ? { reportRevision: reportIndex } : {}),
			...(run.loadedProvenance ? { loadedFingerprint: exportRecord(run.loadedProvenance)?.loadedFingerprint } : {}),
			...(options.sourceFingerprint ? { sourceFingerprint: options.sourceFingerprint } : {}),
			workerReportStatus: report?.status ?? "unknown",
			reviewResultVerdict,
			taskState: task?.state ?? "unknown",
			rootVerdict: rootReview?.verdict ?? "unknown",
			statusCategory,
			retryable: Boolean(run.nextAction && run.ingestionState !== "recorded"),
			...(run.nextAction ? { nextAction: run.nextAction } : {}),
			...(run.terminalReason ? { terminalReason: run.terminalReason } : {}),
			processExitCode: run.exitCode ?? run.processExitCode ?? exportRecord(run.terminal)?.exitCode ?? "unknown",
			ingestionState: run.ingestionState ?? "unknown",
		});
		incrementExport(statuses.category, statusCategory);
		incrementExport(statuses.ingestion, run.ingestionState);
		const exitCode = exportNumber(run.exitCode) ?? exportNumber(run.processExitCode) ?? exportNumber(exportRecord(run.terminal)?.exitCode);
		incrementExport(statuses.processExit, exitCode === undefined ? "unknown" : String(exitCode));
	}
	const fixture = exportRecord(options.fixtures);
	let interceptionTotal = 0;
	let interceptionRuns = 0;
	let processFailures = 0;
	let providerErrors = 0;
	if (fixture) {
		const e02 = exportRecord(fixture.e02) ?? exportRecord(fixture.E02_FIXTURE);
		const e02Runs = Array.isArray(e02?.runs) ? e02.runs.map(exportRecord).filter((run): run is Record<string, unknown> => Boolean(run)) : [];
		interceptionRuns = e02Runs.length;
		interceptionTotal = e02Runs.reduce((sum, run) => sum + (exportNumber(run.count) ?? (Array.isArray(run.interceptedLines) ? run.interceptedLines.length : 0)), 0);
		const e03 = exportRecord(fixture.e03) ?? exportRecord(fixture.E03_FIXTURE);
		const e03Runs = Array.isArray(e03?.runs) ? e03.runs.map(exportRecord).filter((run): run is Record<string, unknown> => Boolean(run)) : [];
		processFailures = e03Runs.filter((run) => exportNumber(run.exitCode) !== undefined && exportNumber(run.exitCode) !== 0).length;
		providerErrors = e03Runs.filter((run) => /403|permission_error|usage limit/i.test(exportString(run.error) ?? "")).length;
		if (e03Runs.length > 0) statuses.processExit["1"] = (statuses.processExit["1"] ?? 0) + processFailures;
	}
	const usageBreakdown = emptyExportBreakdown();
	const usageResult: SessionEvidenceExport["usage"] = {
		tokens: emptyExportTokens(), bySource: { root: emptyExportTokens(), children: emptyExportTokens(), unattributed: emptyExportTokens() },
		cost: { calculatedUsd: 0, reportedUsd: 0, unknownUsd: false, unknownParts: 0, unattributedUsd: 0 }, modelRates: {},
		breakdown: usageBreakdown,
		buckets: {
			tasked: { tokens: 0, costUsd: 0, unknownCost: false, count: 0 },
			untaskedShared: { tokens: 0, costUsd: 0, unknownCost: false, count: 0 },
			foreign: { tokens: 0, costUsd: 0, unknownCost: false, count: 0 },
			unknown: { tokens: 0, costUsd: 0, unknownCost: false, count: 0 },
		},
	};
	for (const run of runs) {
		const rates = exportRecord(exportRecord(run.pricing)?.rates);
		if (!rates) continue;
		for (const [model, value] of Object.entries(rates)) {
			const rate = exportRecord(value);
			if (rate && ["input", "output", "cacheRead", "cacheWrite"].every((key) => exportNumber(rate[key]) !== undefined)) {
				usageResult.modelRates[model] = rate as unknown as PricingRates;
			}
		}
	}
	const seenUsage = new Set<string>();
	for (const task of selectedTasks) {
		exportTaskUsage(task.usage, usageResult, false);
		const usage = exportRecord(task.usage);
		if (usage?.root) addBucketUsage(usageResult.buckets.tasked, usage.root);
		for (const child of Array.isArray(usage?.children) ? usage.children : []) {
			addBucketUsage(usageResult.buckets.tasked, child);
			const identity = usageIdentity(child);
			if (identity) seenUsage.add(identity);
		}
	}
	for (const entry of options.usageEntries ?? []) {
		const value = exportRecord(entry);
		if (!value) continue;
		const identity = usageIdentity(value);
		if (identity && seenUsage.has(identity)) continue;
		if (identity) seenUsage.add(identity);
		const taskId = exportString(value.taskId);
		if (taskId && selectedTaskIds.has(taskId) && !value.child) continue;
		const entryUsage = value.child
			? { children: [value.child] }
			: value.kind === "root-turn"
				? { root: value.usage }
				: value.usage;
		const bucket = childUsageBucket(value, rootSessionId, selectedTaskIds);
		const target = usageResult.buckets[bucket];
		addBucketUsage(target, value.child ?? value.usage ?? value);
		if (taskId && selectedTaskIds.has(taskId)) {
			exportTaskUsage(entryUsage, usageResult, false);
		} else {
			exportTaskUsage(entryUsage, usageResult, true);
			if (bucket === "foreign") addForeignChildSpend(usageBreakdown.foreignChildSpend, value.child ?? value.usage);
			unattributed.push({ type: "usage", taskId: taskId ?? "unknown", runId: value.runId, reason: bucket === "unknown" ? "no trusted provenance" : "outside selected Task" });
		}
	}
	for (const run of runs) {
		if (isBudgetIntercept(run)) usageBreakdown.budgetIntercepts += 1;
		const taskId = exportString(run.taskId);
		if (!taskId || selectedTaskIds.has(taskId)) continue;
		const identity = usageIdentity(run);
		if (identity && seenUsage.has(identity)) continue;
		if (identity) seenUsage.add(identity);
		const bucket = childUsageBucket(run, rootSessionId, selectedTaskIds);
		addBucketUsage(usageResult.buckets[bucket], run.usage ?? run);
		if (run.usage !== undefined) addForeignChildSpend(usageBreakdown.foreignChildSpend, run.usage);
		else {
			const tokens = exportRecord(run.tokens);
			const tokenCount = exportNumber(tokens?.total) ?? ["input", "output", "cacheRead", "cacheWrite"].reduce((sum, key) => sum + (exportNumber(tokens?.[key]) ?? 0), 0);
			usageBreakdown.foreignChildSpend.count += 1;
			usageBreakdown.foreignChildSpend.tokens += tokenCount;
			const cost = exportNumber(exportRecord(run.cost)?.childrenUsd);
			if (cost === undefined) usageBreakdown.foreignChildSpend.unknownCost = true;
			else usageBreakdown.foreignChildSpend.costUsd += cost;
		}
	}
	for (const task of selectedTasks) {
		if (task.completionKind === "superseded" || task.state === "closed-superseded") usageBreakdown.superseded += 1;
		if (task.completionKind === "committed") usageBreakdown.committed += 1;
		usageBreakdown.envelopeRepairs += exportNumber(task.reportCorrections) ?? 0;
		for (const report of Array.isArray(task.reports) ? task.reports : []) {
			const item = exportRecord(report);
			usageBreakdown.envelopeRepairs += Array.isArray(item?.repairs) ? item.repairs.length : item?.normalized === true ? 1 : 0;
		}
	}
	usageResult.breakdown = usageBreakdown;
	const evidenceMatrix = buildAcceptanceEvidenceMatrix({
		...options.acceptance,
		rootSessionId,
		...(options.acceptance?.runIds ? {} : {
			runIds: runs.map((run) => exportString(run.runId)).filter((id): id is string => Boolean(id)),
		}),
	});
	usageResult.cost.unknownUsd = usageResult.cost.unknownParts > 0;
	const e01 = fixture && (exportRecord(fixture.e01) ?? exportRecord(fixture.E01_FIXTURE));
	const e01New = Array.isArray(e01?.newFindings) ? e01.newFindings.length : 0;
	const e01Historical = Array.isArray(e01?.historicalFindings) ? e01.historicalFindings.length : 0;
	const e04 = fixture && (exportRecord(fixture.e04) ?? exportRecord(fixture.E04_FIXTURE));
	const analysis: string[] = [];
	if (e01) analysis.push(`E01: ${e01New} new finding(s); ${e01Historical} historical event(s) kept separate.`);
	if (interceptionRuns > 0) analysis.push(`E02: ${interceptionTotal} tool interception(s) across ${interceptionRuns} run(s); process exits are reported separately.`);
	if (e04) {
		const cross = exportRecord(e04.crossWorkspace);
		const premature = Array.isArray(e04.prematureLaunchReceipts) ? e04.prematureLaunchReceipts.length : 0;
		if (cross) {
			analysis.push(`E04: cross-workspace run ${exportString(cross.runId) ?? "unknown"} is unattributed (${exportString(cross.foreignWorkspace) ?? "foreign workspace"}); its ${exportString(cross.executionState) ?? "unknown"}/${exportString(cross.ingestionState) ?? "unknown"} state is not merged into Task statistics.`);
			unattributed.push({ type: "cross-workspace-run", ...cross });
		}
		if (premature > 0) analysis.push(`E04: ${premature} launch receipt(s) precede final output; launch is not treated as a report-invalid terminal state.`);
		const mixed = exportRecord(e04.mixedLedgerCounts);
		if (mixed) {
			analysis.push(`E04: mixed ledger snapshot (${exportNumber(mixed.totalTasks) ?? 0} tasks) is historical context, not this session's completion population.`);
			unattributed.push({ type: "mixed-ledger-snapshot", reason: "outside root session scope", ...mixed });
		}
	}
	return {
		version: 1,
		rootSessionId,
		generatedAt: new Date().toISOString(),
		linkage,
		statuses,
		findings: { items: [...findings.values()], total: findings.size, duplicateNotifications, new: e01New, historical: e01Historical },
		interceptions: { total: interceptionTotal, runs: interceptionRuns, processFailures, providerErrors },
		usage: usageResult,
		breakdown: usageBreakdown,
		requirements: [
			{ id: "RS-05", status: linkage.length > 0 ? "implemented" : "unproven", evidence: linkage.length > 0 ? ["root-scoped Task/RunRecord linkage"] : ["no persisted execution linkage supplied"] },
			{ id: "A19", status: fixture ? "unit-verified" : "unproven", evidence: fixture ? [`${e01New} new findings`, `${interceptionTotal} interceptions/${interceptionRuns} runs`, `${processFailures} process failures`] : [] },
			{ id: "A20", status: e04 ? "unit-verified" : "unproven", evidence: e04 ? ["cross-workspace and premature launch records retained as analysis/unattributed"] : [] },
			{ id: "A21", status: "unproven", evidence: ["requires production host event and payload receipt"] },
			...evidenceMatrix,
		],
		analysis,
		unattributed,
		evidenceMatrix,
	};
}
