import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	ROOT_TOOLS,
	QUESTION_TOOLS,
	READ_ONLY_TOOLS,
	decidePolicy,
} from "./policy.ts";
import { GIT_AUDIT_OPERATIONS, classifyCommitDirtyPaths, dirtyPathsOutsideTruth, parseGitStatusKinds, parseGitStatusPaths, resolveGitCommit, runGitAudit } from "./git-audit.ts";
import type { GitAuditRequest, GitRunner } from "./git-audit.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import { MAX_REVIEW_ROUNDS, WORKER_REPORT_VERSION, isFinalTaskState } from "./types.ts";
import type { DriftAcknowledgement, LoadedPluginFingerprint, ReviewFinding, ReviewMode, ReviewVerdict, TaskState } from "./types.ts";
import {
	UsageLedger,
	buildRunRecord,
	summarizeRuns,
	renderRunSummary,
	deriveRootTurnAttribution,
	hasUsableRate,
	loadPricingTable,
	ensurePricingFile,
	lookupRates,
	pricingPath,
	renderUsage,
	renderUsageLine,
	summarizeSessionUsage,
	shouldFlushUsageOnShutdown,
} from "./usage.ts";
import type { PiUsageLike, UsageEntry } from "./usage.ts";
import { oracleSuiteMode } from "./roles.ts";
import {
	evaluateSessionRootBudget,
	formatSessionRootBudgetSoftWarning,
	formatSessionRootBudgetStatus,
	loadFloorConfig,
	loadSessionRootBudgetConfig,
	SESSION_ROOT_BUDGET_ENV_VARS,
	sessionRootBudgetWithEnabled,
} from "./floors.ts";
import { configuredRoleModelSummaries, loadRoleModelPolicy } from "./role-models.ts";
import { ConcurrencyController, loadConcurrencyDefault, saveConcurrencyDefault, parseConcurrencyLimit } from "./concurrency.ts";
import {
	PLANNER_DELEGATE_PARAMETERS,
	cancelInFlightDelegations,
	createHostLauncher,
	renderDelegationOutcome,
	runDelegation,
} from "./delegate.ts";
import type { DelegationOutcome, PlannerDelegateParams } from "./delegate.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const SESSION_ROOT_BUDGET_ON_MARKER = join(AGENT_DIR, "planner-only", "session-root-budget.on");
const CONCURRENCY_CONFIG = join(AGENT_DIR, "planner-only", "concurrency.json");
const STATUS_KEY = "planner-only";
const IS_SUBAGENT = process.env.PI_SUBAGENT_CHILD === "1";
const PLANNER_SAFE_TOOLS = new Set([
	...READ_ONLY_TOOLS,
	...QUESTION_TOOLS,
	...ROOT_TOOLS,
	"planner_delegate",
	"git_commit",
]);

// Keep the policy set and the registered tool surface in sync. git_commit is
// deliberately separate from the read-only git_audit operation table.
ROOT_TOOLS.add("git_commit");

const GIT_TIMEOUT_MS = 15_000;
const VALIDATION_TIMEOUT_MS = 60_000;

const SOURCE_PATH = fileURLToPath(import.meta.url);
const PLUGIN_DIR = dirname(SOURCE_PATH);

export function computeLoadedFingerprint(dir = PLUGIN_DIR): string {
	const hasher = createHash("sha256");
	const files = [
		"concurrency.ts",
		"evidence.ts",
		"floors.ts",
		"git-audit.ts",
		"index.ts",
		"ledger-store.ts",
		"orchestrate.ts",
		"package.json",
		"policy.ts",
		"pricing.defaults.json",
		"report.ts",
		"review.ts",
		"role-models.ts",
		"roles.ts",
		"task.ts",
		"types.ts",
		"usage.ts",
		"workspace-snapshot.ts",
	];
	for (const file of files) {
		const full = join(dir, file);
		try {
			if (existsSync(full)) {
				hasher.update(`${file}\0`);
				hasher.update(readFileSync(full));
			}
		} catch {
			// ignore unreadable
		}
	}
	return hasher.digest("hex");
}

let CURRENT_LOADED_FINGERPRINT = computeLoadedFingerprint();

export function getLoadedPluginFingerprint(): string {
	return CURRENT_LOADED_FINGERPRINT;
}

export function reloadLoadedFingerprint(dir = PLUGIN_DIR): string {
	CURRENT_LOADED_FINGERPRINT = computeLoadedFingerprint(dir);
	return CURRENT_LOADED_FINGERPRINT;
}

export function getDiskHead(cwd = process.cwd()): string {
	try {
		const out = execFileSync("git", ["rev-parse", "HEAD"], { cwd, timeout: 5000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
		return out.trim() || "unknown";
	} catch {
		return "unknown";
	}
}

export function getPackageVersion(dir = PLUGIN_DIR): string {
	try {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version?: string };
		return pkg.version ?? "unknown";
	} catch {
		return "unknown";
	}
}

export function createLoadedPluginFingerprint(
	ctx?: ExtensionContext,
	options: { reload?: boolean; diskHead?: string } = {},
): LoadedPluginFingerprint {
	if (options.reload) {
		reloadLoadedFingerprint();
	}
	const cwd = ctx?.cwd || process.cwd();
	const diskHead = options.diskHead ?? getDiskHead(cwd);
	const sessionFile = (ctx as ExtensionContext & { sessionManager?: { getSessionFile?: () => string } } | undefined)
		?.sessionManager?.getSessionFile?.();
	const sessionFileHint = typeof sessionFile === "string" && sessionFile.trim()
		? sessionFile.split(/[\\/]/).filter(Boolean).at(-1)?.replace(/\.[^.]+$/, "")
		: undefined;
	const contextSessionId = typeof (ctx as any)?.sessionId === "string" && (ctx as any).sessionId.trim()
		? (ctx as any).sessionId.trim()
		: undefined;
	const managerSessionId = (() => {
		const v = (ctx as any)?.sessionManager?.getSessionId?.();
		return typeof v === "string" && v.trim() ? v.trim() : undefined;
	})();
	const sessionId = managerSessionId ?? contextSessionId ?? process.env.PI_SESSION_ID?.trim() ?? sessionFileHint ?? "unknown";
	return {
		version: 1,
		loadedFingerprint: getLoadedPluginFingerprint(),
		sourcePath: SOURCE_PATH,
		packageVersion: getPackageVersion(),
		hostVersion: (ctx as any)?.hostVersion ?? "unknown",
		subagentVersion: "unknown",
		sessionId,
		workspaceId: cwd,
		capabilities: ["planner-only", "concurrency", "shared-identity", "run-convergence", "output-resolver"],
		diskHead,
		loadedAt: new Date().toISOString(),
		recordedAt: new Date().toISOString(),
	};
}

export const PLANNER_PROMPT = `[PLANNER-ONLY MODE]
Root: plan, delegate, inspect read-only, review, and arbitrate.
Do not edit or write files, run a general shell, or implement fixes.

Gather: no live Task starts one planner_delegate; TaskSpec names Worker skills. planner_verdict and git_audit stay allowed; live Tasks allow inspect/Git-read.

One bounded TaskSpec per planner_delegate call (role, objective, scope, constraints, acceptanceCriteria, validation); one ticket per TaskSpec. Do not instruct workers to /code-review; the plugin reviewer is the only review.
The tool returns the canonical taskId in details; pass it as taskId on every later call for that Task.

Every worker returns WorkerReport version ${WORKER_REPORT_VERSION} with taskId, status, summary, changedFiles, validation plus exit codes, evidence, risks, and unresolved items. Top-level status must be exactly completed/partial/blocked/failed; validation status must be exactly passed/failed/not-run.

Verify identity, evidence freshness, inspect relevant files and git with read/grep/git_audit, then record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict.

Roles: explorer → scout, reviewer → builtin reviewer (read/grep/find/ls; context=fresh; bounded packet), validator → oracle (bash, no edits), worker keeps its agent; never pre-compose worker→reviewer as a workflowScript or chain; delegate the reviewer only after the worker returns, in a separate call.

Never trust a worker PASS. Never accept stale evidence; re-delegate validation (bounded oracle: HEAD/status + named tests; full suite only if PI_PLANNER_ONLY_ORACLE=full). Never fix rejected work; delegate a bounded correction. Stop after ${MAX_REVIEW_ROUNDS} review rounds (blocked).
Lifecycle state arrives in delegation results; the operator may override a verdict, you record yours with planner_verdict.`;

function envForcesGuard(): boolean {
	return new Set(["1", "true", "on"]).has(
		(process.env.PI_PLANNER_ONLY || "").trim().toLowerCase(),
	);
}

function envDisablesGuard(): boolean {
	return new Set(["0", "false", "off"]).has(
		(process.env.PI_PLANNER_ONLY || "").trim().toLowerCase(),
	);
}

function isDisabled(): boolean {
	const force = envForcesGuard();
	return !force && (envDisablesGuard() || existsSync(OFF_MARKER));
}

function guardDecisionSource(): "env" | "marker" | "default" {
	if (envForcesGuard() || envDisablesGuard()) return "env";
	if (existsSync(OFF_MARKER)) return "marker";
	return "default";
}

function envForcingValue(): string | undefined {
	return envForcesGuard() || envDisablesGuard() ? (process.env.PI_PLANNER_ONLY ?? "").trim() : undefined;
}

/**
 * Root read ceiling in lines (NX-05/C15): applied to Root `read` calls that
 * name no explicit line range. The single named constant is the ceiling
 * everywhere — apply, notice, and handler wiring.
 */
export const ROOT_READ_CEILING_LINES = 200;

export function applyRootReadCeiling(input: unknown, maxLines: number = ROOT_READ_CEILING_LINES): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) return input;
	const record = input as Record<string, unknown>;
	if (Object.keys(record).some((key) => ["limit", "startLine", "lineStart", "start_line", "offset", "endLine", "lineEnd", "end_line"].includes(key))) return input;
	return { ...record, limit: maxLines };
}

export function rootReadLimitNotice(input: unknown, maxLines: number = ROOT_READ_CEILING_LINES): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	const start = [record.startLine, record.lineStart, record.start_line, record.offset].find((value) => typeof value === "number") as number | undefined;
	const end = [record.endLine, record.lineEnd, record.end_line].find((value) => typeof value === "number") as number | undefined;
	const limit = typeof record.limit === "number" ? record.limit : end !== undefined && start !== undefined ? end - start + 1 : undefined;
	if (limit === undefined || !Number.isFinite(limit) || limit <= maxLines) return undefined;
	return `Planner-only Root read ceiling: requested ${Math.trunc(limit)} lines, maximum is ${maxLines}. Read a bounded slice or delegate an explorer for broader context.`;
}

function updateStatus(ctx: ExtensionContext): void {
	if (IS_SUBAGENT) return;
	ctx.ui.setStatus(
		STATUS_KEY,
		isDisabled()
			? ctx.ui.theme.fg("muted", "planner-only: off")
			: ctx.ui.theme.fg("warning", "planner-only"),
	);
}

export function filterPlannerTools(activeTools: readonly string[]): string[] {
	const allowed = (name: string): boolean => PLANNER_SAFE_TOOLS.has(name);
	return [...new Set(activeTools.filter(allowed))];
}

/**
 * Restore what this extension suppressed. Only suppressed tools that are
 * still registered come back, and tools this extension never touched are
 * left exactly as the session has them. Known limitation (the host exposes
 * no tool-change source): if the operator explicitly disables one of *our*
 * suppressed tools again mid-`on`, off/on cannot tell that apart from our
 * own suppression and re-enables it — recorded here rather than claimed
 * perfect (FR-06 §9.2).
 */
export function restorePlannerTools(
	activeTools: readonly string[],
	suppressedTools: readonly string[],
	registeredTools?: readonly string[],
): string[] {
	const restore = registeredTools
		? suppressedTools.filter((name) => registeredTools.includes(name))
		: suppressedTools;
	return [...new Set([...activeTools, ...restore])];
}

function sameToolOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

export default function plannerOnly(pi: ExtensionAPI): void {
	const floorConfig = loadFloorConfig();
	const sessionRootBudgetBase = loadSessionRootBudgetConfig(process.env, floorConfig);
	function envSessionRootBudgetOverride(): boolean | undefined {
		const raw = process.env[SESSION_ROOT_BUDGET_ENV_VARS.ENABLED];
		if (raw === undefined) return undefined;
		const value = raw.trim();
		if (value === "1") return true;
		if (value === "0") return false;
		return sessionRootBudgetBase.enabled;
	}
	function sessionRootBudgetEnabledNow(): boolean {
		const envOverride = envSessionRootBudgetOverride();
		if (envOverride !== undefined) return envOverride;
		return existsSync(SESSION_ROOT_BUDGET_ON_MARKER);
	}
	function currentSessionRootBudget() {
		return sessionRootBudgetWithEnabled(sessionRootBudgetBase, sessionRootBudgetEnabledNow());
	}
	let sessionRootBudget = currentSessionRootBudget();
	// Foreground children do not load ambient extensions. Background children
	// may; this extension no-ops when PI_SUBAGENT_CHILD=1 so it cannot
	// recurse into a child that loaded it. Workers must retain their
	// configured tool access.
	if (IS_SUBAGENT) return;

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};

	// Most recent host context, kept for the verdict and shutdown paths.
	let latestCtx: ExtensionContext | undefined;
	ensurePricingFile();
	let pricing = loadPricingTable();
	let orchestrator!: PlannerOrchestrator;
	let ledger = new UsageLedger({ pricing, resolveTaskId: (taskId) => orchestrator.store.get(taskId)?.taskId ?? taskId });
	const concurrencyConfig = loadConcurrencyDefault(CONCURRENCY_CONFIG);
	const concurrency = new ConcurrencyController({ savedLimit: concurrencyConfig.limit, saved: concurrencyConfig.source === "saved", enforceWorkspace: true });
	// ADR-0001 — the structured-delegation launcher for planner_delegate.
	// Fallback owner identity when the session id is not yet known.
	const delegationLaunch = createHostLauncher(pi);
	const PROCESS_OWNER_RUN_ID = randomUUID();
	orchestrator = new PlannerOrchestrator({
		concurrency,
		gitRunner,
		ledgerDir: AGENT_DIR,
		getSessionRootUsage: () => ledger.sessionRootSpend(),
		sessionRootBudgetConfig: sessionRootBudget,
		getUsageEntries: () => allSessionEntries,
	});
	let loadedFingerprintInfo = createLoadedPluginFingerprint(latestCtx);
	orchestrator.setLoadedFingerprint(loadedFingerprintInfo);
	const allSessionEntries: UsageEntry[] = [];
	/** Task targets seen in the current Root assistant turn's tool calls. */
	const rootTurnTaskIds = new Set<string>();
	/** Tool calls that contributed to the current Root turn's attribution. */
	const rootTurnToolCallIds = new Set<string>();
	/** Ticket 40: emit soft/hard disclosures once per crossing until spend drops below the level. */
	let sessionRootSoftWarned = false;
	let sessionRootHardWarned = false;
	let usageLogWriteFailed = false;
	const terminalUsageLogged = new Set<string>();
	const openUsageLogged = new Set<string>();

	// Latest model reported by the public `model_select` event. The status
	// command prefers the handler-time ctx.model and falls back to this so a
	// mid-session switch is reflected in the next status render.
	let selectedModel: { provider?: string; id: string } | undefined;

	function rootModelIdentity(model: unknown): { provider?: string; id: string } | undefined {
		if (model === undefined || model === null) return undefined;
		if (typeof model === "string") {
			return model.trim() ? { id: model.trim() } : undefined;
		}
		if (typeof model === "object") {
			const rec = model as { provider?: unknown; id?: unknown };
			const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : undefined;
			if (!id) return undefined;
			const provider = typeof rec.provider === "string" && rec.provider.trim() ? rec.provider.trim() : undefined;
			return { ...(provider ? { provider } : {}), id };
		}
		return undefined;
	}

	function rootRateWarning(ctx: ExtensionContext): string | undefined {
		const identity = rootModelIdentity(ctx.model) ?? selectedModel;
		if (!identity) return undefined;
		if (hasUsableRate(pricing, identity.provider, identity.id)) return undefined;
		const display = identity.provider ? `${identity.provider}/${identity.id}` : identity.id;
		return `[PLANNER-ONLY] Root model ${display} has no rate in ${pricingPath()}. Root cost will be recorded as unknown and excluded from totals. Set PI_PLANNER_ONLY_PRICING to use another file.`;
	}

	const REVIEW_LEAK_TOOLS = new Set(["read", "grep", "find", "ls", "git_audit"]);

	function asRecord(value: unknown): Record<string, unknown> | undefined {
		return value !== null && typeof value === "object" && !Array.isArray(value)
			? value as Record<string, unknown>
			: undefined;
	}

	function contentText(content: unknown): string {
		if (typeof content === "string") return content;
		if (!Array.isArray(content)) return "";
		return content
			.filter((part): part is { type: string; text?: string } =>
				Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text"))
			.map((part) => typeof part.text === "string" ? part.text : "")
			.join("\n");
	}

	function persistSessionEntries(): void {
		const drained = ledger.drain();
		for (const entry of drained) {
			allSessionEntries.push(entry);
		}
		if (typeof pi.appendEntry !== "function") return;
		for (const entry of drained) {
			try {
				pi.appendEntry("planner-only-usage", entry);
			} catch {
				// Session persistence must never break the lifecycle.
			}
		}
	}

	function rootShareWarnThreshold(env: NodeJS.ProcessEnv = process.env): number {
		const raw = env.PI_PLANNER_ONLY_ROOT_SHARE_WARN;
		if (raw !== undefined && raw.trim()) {
			const parsed = Number.parseFloat(raw.trim());
			if (Number.isFinite(parsed) && parsed >= 0) return parsed;
		}
		return 0.6;
	}

	function enrichDecisionText(text: string, taskId?: string): string {
		if (!text.includes("[PLANNER-ONLY REVIEW STATE]")) return text;
		const targetId = taskId ? canonicalTaskId(taskId) : text.match(/\btaskId:\s*(T-\d{8}-\d{3})\b/)?.[1];
		if (!targetId) return text;
		const usage = ledger.taskUsage(targetId);
		let enriched = text;

		if (usage && usage.root.turns > 0 && !enriched.includes("\nusage: ")) {
			const usageLine = renderUsageLine(usage, pricing.currency);
			const evidenceRe = /^evidence: .*$/m;
			if (evidenceRe.test(enriched)) {
				enriched = enriched.replace(evidenceRe, (m) => `${m}\n${usageLine}`);
			} else {
				const reasonRe = /^reason: .*$/m;
				if (reasonRe.test(enriched)) {
					enriched = enriched.replace(reasonRe, `${usageLine}\n$&`);
				}
			}
		}

		if (enriched.includes("decision: review_pending") && usage && usage.root.costUsd !== undefined) {
			const rootCost = usage.root.costUsd;
			const childrenCost = usage.children.reduce((sum, c) => sum + (c.costUsd ?? 0), 0);
			const totalCost = rootCost + childrenCost;
			const threshold = rootShareWarnThreshold();
			const warningLine = "warning: Root is reading the diff itself; consider a fresh reviewer";
			if (totalCost > 0 && (rootCost / totalCost) > threshold && usage.root.reviewLeakBytes > 8192 && !enriched.includes(warningLine)) {
				if (enriched.includes("\n\n[PLANNER-ONLY WORKER REPORT]")) {
					enriched = enriched.replace("\n\n[PLANNER-ONLY WORKER REPORT]", `\n${warningLine}\n\n[PLANNER-ONLY WORKER REPORT]`);
				} else if (enriched.includes("\n\n[PLANNER-ONLY REVIEW RESULT]")) {
					enriched = enriched.replace("\n\n[PLANNER-ONLY REVIEW RESULT]", `\n${warningLine}\n\n[PLANNER-ONLY REVIEW RESULT]`);
				} else {
					enriched = `${enriched.trimEnd()}\n${warningLine}`;
				}
			}
		}

		return enriched;
	}

	function sessionFileOf(ctx: ExtensionContext): string | undefined {
		const manager = (ctx as ExtensionContext & {
			sessionManager?: { getSessionFile?: () => string; getEntries?: () => unknown[] };
		}).sessionManager;
		const file = manager?.getSessionFile?.();
		return typeof file === "string" && file.trim() ? file : undefined;
	}

	function usageLogPath(): string | undefined {
		const override = process.env.PI_PLANNER_ONLY_USAGE_LOG;
		if (override === "0") return undefined;
		if (override && override.trim()) return override;
		return join(AGENT_DIR, "planner-only", "usage.jsonl");
	}

	function canonicalTaskId(taskId: string): string {
		return orchestrator.store.get(taskId)?.taskId ?? taskId;
	}

	function syncUsage(taskId?: string): void {
		if (!taskId) return;
		const targetId = canonicalTaskId(taskId);
		const usage = ledger.taskUsage(targetId);
		const task = orchestrator.store.get(targetId);
		if (usage && task) {
			task.usage = usage;
			orchestrator.store.persist(task);
		}
	}

	async function writeUsageLog(
		taskId: string,
		ctx: ExtensionContext,
		options?: { incomplete?: boolean; unattributed?: boolean },
	): Promise<void> {
		const path = usageLogPath();
		if (!path) return;
		const shutdownSnapshot = Boolean(options?.incomplete || options?.unattributed);
		const targetId = canonicalTaskId(taskId);
		if (shutdownSnapshot && (terminalUsageLogged.has(targetId) || openUsageLogged.has(targetId))) return;
		const task = orchestrator.store.get(targetId);
		const usage = ledger.taskUsage(targetId);
		if (!usage) return;
		if (!task && !options?.unattributed) return;
		const line = {
			...usage,
			taskId: task?.taskId ?? taskId,
			cwd: task?.cwd ?? "",
			...(task ? { state: task.state, rounds: task.reviewRound } : { rounds: 0 }),
			rootModel: usage.rootModel,
			finishedAt: new Date().toISOString(),
			sessionFile: sessionFileOf(ctx),
			...(options?.incomplete ? { incomplete: true } : {}),
			...(options?.unattributed ? { unattributed: true } : {}),
		};
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
			if (task && isFinalTaskState(task.state) && !options?.incomplete) {
				terminalUsageLogged.add(targetId);
			} else if (options?.incomplete || options?.unattributed) {
				openUsageLogged.add(targetId);
			}
		} catch {
			if (!usageLogWriteFailed) {
				usageLogWriteFailed = true;
				if (ctx.hasUI) ctx.ui.notify("Planner-only: failed to write usage log", "warning");
			}
		}
	}

	async function flushIfTerminal(
		taskId: string | undefined,
		before: TaskState | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		if (!taskId) return;
		const after = orchestrator.store.get(taskId);
		if (!after || !isFinalTaskState(after.state)) return;
		if (before === after.state) return;
		persistSessionEntries();
		await writeUsageLog(taskId, ctx);
	}

	async function flushOpenUsageOnShutdown(ctx: ExtensionContext): Promise<void> {
		persistSessionEntries();
		const storeIds = new Set(orchestrator.store.list().map((task) => task.taskId));
		for (const taskId of ledger.sessionUsage().tasks) {
			if (storeIds.has(taskId) || terminalUsageLogged.has(taskId)) continue;
			await writeUsageLog(taskId, ctx, { incomplete: true, unattributed: true });
		}
		const live = orchestrator.store.list().filter((task) => !isFinalTaskState(task.state));
		const active = orchestrator.store.active();
		const ordered = [
			...live.filter((task) => task.taskId !== active?.taskId),
			...(active && live.some((task) => task.taskId === active.taskId) ? [active] : []),
		];
		for (const task of ordered) {
			if (!ledger.taskUsage(task.taskId)) continue;
			await writeUsageLog(task.taskId, ctx, { incomplete: true });
		}
	}

	function recordInjectedText(taskId: string | undefined, text: string): void {
		if (!taskId || !text) return;
		const targetId = canonicalTaskId(taskId);
		ledger.recordInjected(targetId, Buffer.byteLength(text));
		syncUsage(targetId);
	}

	function loadSessionUsage(ctx: ExtensionContext): void {
		const manager = (ctx as ExtensionContext & {
			sessionManager?: { getEntries?: () => unknown[] };
		}).sessionManager;
		const entries = manager?.getEntries?.();
		if (!Array.isArray(entries)) return;
		const records: UsageEntry[] = [];
		for (const entry of entries) {
			const rec = asRecord(entry);
			if (!rec || rec.type !== "custom" || rec.customType !== "planner-only-usage") continue;
			if (rec.data && typeof rec.data === "object") {
				const uEntry = rec.data as UsageEntry;
				const normalized = uEntry.taskId
					? { ...uEntry, taskId: canonicalTaskId(uEntry.taskId) }
					: uEntry;
				records.push(normalized);
				allSessionEntries.push(normalized);
			}
		}
		ledger.load(records);
	}

	let suppressedTools: string[] = [];

	// Do not strip bash/edit/write via setActiveTools. The host applies that
	// change on the next turn, and pi-subagents uses the parent's active tools
	// as the child ceiling in the same turn — so a planner-only schema leaves
	// oracle/worker/delegate with no shell. Root mutation is policy-only.
	const restoreSuppressedTools = (): void => {
		if (suppressedTools.length === 0) return;
		const activeTools = pi.getActiveTools();
		const registered = typeof pi.getAllTools === "function"
			? pi.getAllTools().map((tool) => tool.name)
			: undefined;
		const nextTools = restorePlannerTools(activeTools, suppressedTools, registered);
		suppressedTools = [];
		if (!sameToolOrder(activeTools, nextTools)) pi.setActiveTools(nextTools);
	};

	pi.registerTool({
		name: "git_audit",
		label: "Git Audit",
		description: [
			"Read-only git inspection for reviewing worker evidence.",
			`Operations: ${GIT_AUDIT_OPERATIONS.join(", ")}.`,
			"It never mutates the repository; delegate any git write to a worker subagent.",
		].join(" "),
		promptSnippet: "git_audit: read-only git inspection for reviewing worker evidence",
		promptGuidelines: [
			"Use git_audit to verify worker evidence (status, diff, HEAD, log) before accepting or rejecting a WorkerReport.",
			"git_audit cannot mutate the repository; delegate commits, checkouts, and resets to a worker subagent.",
		],
		parameters: Type.Object({
			operation: Type.Union(GIT_AUDIT_OPERATIONS.map((operation) => Type.Literal(operation)), {
				description: `Audit operation. One of: ${GIT_AUDIT_OPERATIONS.join(", ")}.`,
			}),
			cwd: Type.Optional(
				Type.String({ description: "Directory to inspect. Defaults to the current working directory." }),
			),
			staged: Type.Optional(
				Type.Boolean({ description: "For diff-* operations, inspect staged changes instead of the working tree." }),
			),
			maxEntries: Type.Optional(
				Type.Integer({ minimum: 1, description: "For log, how many commits to show." }),
			),
		}),
		async execute(_toolCallId, params: GitAuditRequest, _signal, _onUpdate, ctx) {
			const outcome = await runGitAudit(gitRunner, params, ctx.cwd || process.cwd());
			return {
				content: [{ type: "text", text: outcome.text }],
				details: { operation: outcome.operation, ok: outcome.ok, code: outcome.code },
			};
		},
	});

	pi.registerTool({
		name: "git_commit",
		label: "Git Commit",
		description: "Policy-governed commit for the truth paths of one completed, validated Task. External dirty paths and failed validation gates are rejected.",
		promptSnippet: "git_commit: commit only the completed Task's attributed truth paths",
		promptGuidelines: [
			"Use only after planner_verdict has completed the Task. The primitive stages and commits attributed truth paths only.",
			"The commit message must cite the Task id; unrelated dirty paths, failed gates, and missing validation evidence are refused.",
		],
		parameters: Type.Object({
			taskId: Type.String({ minLength: 1, description: "Completed Task to commit." }),
			message: Type.Optional(Type.String({ minLength: 1, maxLength: 200, description: "Optional commit summary." })),
			push: Type.Optional(Type.Boolean({ description: "Unsupported unless an explicit push authorization is added." })),
		}),
		async execute(_toolCallId, params: { taskId: string; message?: string; push?: boolean }, _signal, _onUpdate, ctx) {
			if (params.push === true) {
				throw new Error("git_commit refused: push is unsupported; provide an explicit authorized push operation.");
			}
			const task = orchestrator.store.get(params.taskId);
			if (!task) {
				throw new Error(`git_commit refused: unknown Task ${params.taskId}.`);
			}
			if (task.state !== "completed") {
				throw new Error(`git_commit refused: Task ${task.taskId} is ${task.state}; only completed Tasks may be committed.`);
			}
			const repoProbe = await gitRunner(["rev-parse", "--show-toplevel"], task.cwd || ctx.cwd || process.cwd());
			if (repoProbe.code !== 0) {
				throw new Error(`git_commit refused: cannot resolve repository root (${repoProbe.stderr || repoProbe.stdout || "git unavailable"}).`);
			}
			const repoRoot = repoProbe.stdout.trim();
			if (!repoRoot) throw new Error("git_commit refused: repository root is empty.");
			const rawTruth = new Set<string>();
			for (const execution of task.executions) {
				for (const path of [...(execution.truthPaths ?? []), ...(execution.committedPaths ?? [])]) rawTruth.add(path);
			}
			const truthPaths = [...rawTruth].map((path) => {
				const absolute = isAbsolute(path) ? resolve(path) : resolve(task.cwd || repoRoot, path);
				const rel = relative(repoRoot, absolute).replaceAll("\\\\", "/");
				return rel;
			}).filter((path) => path && path !== "." && !path.startsWith("../") && !path.startsWith("/"));
			const plan = resolveGitCommit({ taskId: task.taskId, cwd: repoRoot, truthPaths, message: params.message });
			if (!plan.ok) throw new Error(`git_commit refused: ${plan.error}`);
			const status = await gitRunner(["status", "--porcelain=v2", "--branch"], repoRoot);
			if (status.code !== 0) throw new Error(`git_commit refused: cannot inspect dirty paths (${status.stderr || status.stdout}).`);
			const statusKinds = parseGitStatusKinds(status.stdout);
			const classification = classifyCommitDirtyPaths({
				trackedDirty: statusKinds.tracked,
				untrackedDirty: statusKinds.untracked,
				ignoredDirty: statusKinds.ignored,
				truthPaths: plan.paths,
				scopeAllowedPaths: task.spec?.scope?.allowedPaths ?? [],
			});
			if (classification.blocking.length > 0) {
				throw new Error(`git_commit refused: dirty paths outside Task ${task.taskId} truth paths: ${classification.blocking.join(", ")}`);
			}
			const stagedDiff = await gitRunner(["diff", "--cached", "--name-only", "--no-ext-diff", "--no-textconv"], repoRoot);
			if (stagedDiff.code !== 0) throw new Error(`git_commit refused: cannot inspect staged paths (${stagedDiff.stderr || stagedDiff.stdout}).`);
			const stagedPaths = stagedDiff.stdout.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
			const stagedOutside = dirtyPathsOutsideTruth(stagedPaths, plan.paths);
			if (stagedOutside.length > 0) {
				throw new Error(`git_commit refused: staged changes outside Task ${task.taskId} truth paths: ${stagedOutside.join(", ")}`);
			}
			const beforeHead = await gitRunner(["rev-parse", "HEAD"], repoRoot);
			const missingGates = [
				["typecheck", ["run", "typecheck"]] as const,
				["test", ["test"]] as const,
			];
			for (const [name, command] of missingGates) {
				const gate = await pi.exec("npm", [...command], { cwd: repoRoot, timeout: VALIDATION_TIMEOUT_MS });
				if (gate.code !== 0) {
					throw new Error(`git_commit refused: validation gate ${name} failed (exit ${gate.code}).`);
				}
			}
			const add = await gitRunner(plan.addArgv, repoRoot);
			if (add.code !== 0) throw new Error(`git_commit refused: staging failed (${add.stderr || add.stdout}).`);
			const commit = await gitRunner(plan.commitArgv, repoRoot);
			if (commit.code !== 0) throw new Error(`git_commit refused: commit failed (${commit.stderr || commit.stdout}).`);
			const afterHead = await gitRunner(["rev-parse", "HEAD"], repoRoot);
			let successText = `git_commit: committed Task ${task.taskId} truth paths (${plan.paths.join(", ")} ).\n${commit.stdout.trim()}`;
			if (classification.external.length > 0) {
				successText += `\nexternal findings (not committed, not attributed): ${classification.external.join(", ")}`;
			}
			return {
				content: [{ type: "text", text: successText }],
				details: {
					taskId: task.taskId,
					paths: plan.paths,
					message: plan.message,
					externalPaths: classification.external,
					gateRan: true,
					validationVerified: true,
					commitLineage: { before: beforeHead.stdout.trim() || "unknown", after: afterHead.stdout.trim() || "unknown", truthPaths: plan.paths },
					workerCommitRuns: 0,
				},
			};
		},
	});

	// ADR-0001 — typed Root/child delegation. execute only composes deps,
	// calls the shared runDelegation seam, and renders the outcome; the
	// WorkerReport arrives launcher-validated in details.report. Failure is
	// signalled by throwing (the host marks the tool result accordingly).
	pi.registerTool({
		name: "planner_delegate",
		label: "Planner Delegate",
		description: [
			"Delegate one TaskSpec to a leaf agent through the structured delegation API.",
			"Returns the launcher-validated WorkerReport in details.report; prose output is never parsed.",
			"Root should prefer this tool over subagent for worker, explorer, validator, and reviewer tasks.",
		].join(" "),
		promptSnippet: "planner_delegate: typed TaskSpec delegation with a structured WorkerReport result",
		promptGuidelines: [
			"Prefer planner_delegate over subagent: supply the full TaskSpec fields, not a prose brief.",
			"The child's WorkerReport arrives schema-validated in details.report; a non-completed status is a tool error, not a parse failure.",
			"role=reviewer takes taskId and reviews the Task's latest WorkerReport; the launcher-validated ReviewResult arrives in details.review.",
		],
		parameters: PLANNER_DELEGATE_PARAMETERS,
		async execute(toolCallId, params: PlannerDelegateParams, signal, onUpdate, ctx) {
			latestCtx = ctx;
			let outcome: DelegationOutcome;
			try {
				outcome = await runDelegation(
					{
						store: orchestrator.store,
						gitRunner,
						concurrency,
						usage: ledger,
						launch: delegationLaunch,
						ownerRunId: ctx.sessionManager?.getSessionId?.() || PROCESS_OWNER_RUN_ID,
					},
					params,
					ctx.cwd || process.cwd(),
					{ signal, executionId: toolCallId, onUpdate },
				);
			} catch (error) {
				// Refused/aborted delegations carry the Task id on the error — sync
				// the usage snapshot now so the ledger file sees the G4 row too
				// (message_end attribution never sees this toolCallId).
				const failedTaskId = typeof (error as { taskId?: unknown })?.taskId === "string"
					? (error as { taskId: string }).taskId
					: undefined;
				if (failedTaskId) {
					rootTurnTaskIds.add(canonicalTaskId(failedTaskId));
					syncUsage(failedTaskId);
					persistSessionEntries();
				}
				throw error;
			}
			rootTurnTaskIds.add(outcome.task.taskId);
			return {
				content: [{ type: "text", text: renderDelegationOutcome(outcome) }],
				details: {
					taskId: outcome.task.taskId,
					executionId: outcome.executionId,
					runId: outcome.runId,
					state: outcome.task.state,
					decision: outcome.decision?.action,
					report: outcome.report,
					review: outcome.review,
					usage: outcome.usage,
					warnings: outcome.warnings,
				},
			};
		},
	});

	pi.registerTool({
		name: "planner_verdict",
		label: "Planner Verdict",
		description: [
			"Record Root's review verdict for a planner-only task: pass, request_changes, or blocked.",
			"A pass re-samples the workspace at the acceptance boundary; stale evidence turns it into revalidate.",
		].join(" "),
		promptSnippet: "planner_verdict: record the root review verdict (pass | request_changes | blocked) for a task",
		promptGuidelines: [
			"After verifying the WorkerReport and evidence, record the verdict with planner_verdict; the slash command is the operator's override, not yours.",
			"request_changes should carry findings so the correction guidance names what to fix.",
		],
		parameters: Type.Object({
			verdict: Type.Union(
				[Type.Literal("pass"), Type.Literal("request_changes"), Type.Literal("blocked")],
				{ description: "Root's verdict over the Task." },
			),
			summary: Type.String({
				minLength: 1,
				maxLength: 2000,
				description: "Why this verdict, in one or two sentences.",
			}),
			taskId: Type.Optional(
				Type.String({ description: "Task to judge. Defaults to the active Task." }),
			),
			findings: Type.Optional(
				Type.Array(
					Type.Object({
						severity: Type.Union([
							Type.Literal("blocker"),
							Type.Literal("major"),
							Type.Literal("minor"),
							Type.Literal("info"),
						]),
						category: Type.Union([
							Type.Literal("correctness"),
							Type.Literal("scope"),
							Type.Literal("test"),
							Type.Literal("safety"),
							Type.Literal("regression"),
							Type.Literal("maintainability"),
							Type.Literal("other"),
						]),
						description: Type.String({ maxLength: 500 }),
						requestedChange: Type.Optional(Type.String({ maxLength: 500 })),
					}),
					{ maxItems: 20, description: "Findings behind a request_changes verdict (at most 20)." },
				),
			),
			acknowledgeDrift: Type.Optional(
				Type.Object({
					successorTaskId: Type.Optional(Type.String({ minLength: 1 })),
					commit: Type.Optional(Type.Boolean()),
				}, { description: "Root acknowledgement of verified successor or commit drift." }),
			),
		}),
		async execute(_toolCallId, params: {
			verdict: ReviewVerdict;
			summary: string;
			taskId?: string;
			findings?: ReviewFinding[];
			acknowledgeDrift?: DriftAcknowledgement;
		}, _signal, _onUpdate, _ctx: ExtensionContext) {
			// Ticket 49 — the target resolves through the same ledger-aware lookup the
			// delegation path uses, so a Task beyond the session restore cap can still be
			// addressed by id. An explicit id never falls back to another Task.
			const verdictResolution = params.taskId
				? orchestrator.resolveVerdictTask(params.taskId, _ctx.cwd || process.cwd())
				: undefined;
			const task = params.taskId ? verdictResolution?.task : orchestrator.store.active();
			const missNote = verdictResolution?.note;
			if (!task) {
				throw new Error(
					[
						params.taskId
							? `planner_verdict: unknown task ${params.taskId}.${missNote ? ` ${missNote}.` : ""}`
							: "planner_verdict: no active planner-only task.",
						'Usage: planner_verdict({ verdict: "pass" | "request_changes" | "blocked", summary, taskId?, findings? }).',
					].join(" "),
				);
			}
			latestCtx = _ctx;
			const refusal = orchestrator.rootVerdictRefusal(task, params.verdict);
			if (refusal) {
				orchestrator.recordRootVerdictRefusal(task, params.verdict, refusal);
				throw new Error(`planner_verdict refused (${refusal.kind}, task=${task.taskId}, verdict=${params.verdict}): ${refusal.reason}`);
			}
			try {
				const before = task.state;
				const outcome = await orchestrator.recordRootVerdict(task, params.verdict, params.summary, {
					...(params.findings ? { findings: params.findings } : {}),
					...(params.acknowledgeDrift ? { acknowledgeDrift: params.acknowledgeDrift } : {}),
					source: "root",
				});
				let text = orchestrator.renderDecisionBlock(outcome.task, outcome.decision, outcome.evidence);
				text = enrichDecisionText(text, outcome.task.taskId);
				recordInjectedText(outcome.task.taskId, text);
				persistSessionEntries();
				await flushIfTerminal(outcome.task.taskId, before, _ctx);
				return {
					content: [{
						type: "text",
						text,
					}],
					details: {
						taskId: outcome.task.taskId,
						verdict: params.verdict,
						action: outcome.decision.action,
						state: outcome.task.state,
						round: outcome.task.reviewRound,
					},
				};
			} catch (error) {
				throw new Error(
					`planner_verdict refused (store-error, task=${task.taskId}, verdict=${params.verdict}): ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		loadedFingerprintInfo = createLoadedPluginFingerprint(ctx);
		orchestrator.setLoadedFingerprint(loadedFingerprintInfo);
		if (typeof pi.appendEntry === "function") {
			try {
				pi.appendEntry("planner-only-version", loadedFingerprintInfo);
			} catch {
				// ignore
			}
		}
		updateStatus(ctx);
		loadSessionUsage(ctx);
		orchestrator.restoreFromLedger();
		ledger.canonicalizeTaskIds();
		const rateWarning = rootRateWarning(ctx);
		if (rateWarning) notify(ctx, rateWarning, "warning");
	});

	pi.on("model_select", async (event) => {
		selectedModel = rootModelIdentity(event.model);
	});

	pi.on("session_shutdown", async (event, ctx) => {
		// Restore tools for reload/replace. Usage snapshot is separate: only
		// reasons that tear this session down without a same-file successor.
		restoreSuppressedTools();
		// Best-effort CANCEL for in-flight delegations — not bound to the flush
		// condition below; a dying Root must not leave orphaned children.
		const shutdownHost = ctx ?? latestCtx;
		const cancelled = cancelInFlightDelegations(pi);
		if (cancelled > 0 && shutdownHost) {
			notify(shutdownHost, `Planner-only: cancelled ${cancelled} in-flight delegation(s) on shutdown`, "warning");
		}
		if (!shouldFlushUsageOnShutdown(event?.reason)) return;
		if (!shutdownHost) return;
		await flushOpenUsageOnShutdown(shutdownHost);
	});

	pi.on("before_agent_start", async (event) => {
		if (isDisabled()) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${PLANNER_PROMPT}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		// R02 — the adapter derives the gather phase from the store for this
		// workspace; PolicyInput always carries it (a store read cannot fail in
		// memory, and a failure would read as Idle: fail closed).
		const policyCwd = ctx?.cwd || process.cwd();
		latestCtx = ctx;
		if (!IS_SUBAGENT && !isDisabled() && event.toolName === "read") {
			const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : undefined;
			if (input) Object.assign(input, applyRootReadCeiling(input));
			const readNotice = rootReadLimitNotice(input);
			if (readNotice) {
				if (ctx.hasUI) ctx.ui.notify(readNotice, "warning");
				return { block: true, reason: readNotice };
			}
		}
		if (!IS_SUBAGENT && ["subagent", "bg_wait", "planner_verdict", "git_audit", "planner_delegate"].includes(event.toolName)) {
			rootTurnToolCallIds.add(event.toolCallId);
			const input = asRecord(event.input);
			if ((event.toolName === "planner_verdict" || event.toolName === "planner_delegate") && typeof input?.taskId === "string") {
				rootTurnTaskIds.add(canonicalTaskId(input.taskId));
			} else if (event.toolName === "planner_verdict" || event.toolName === "git_audit") {
				const active = orchestrator.store.activeForCwd(policyCwd);
				if (active) rootTurnTaskIds.add(active.taskId);
			}
		}
		const decision = decidePolicy({
			toolName: event.toolName,
			input: event.input,
			isChild: IS_SUBAGENT,
			disabled: isDisabled(),
			cwd: policyCwd,
			liveTask: Boolean(orchestrator.store.activeForCwd(policyCwd)),
		});
		if (!decision.block) return;
		if (ctx.hasUI) ctx.ui.notify(`Blocked parent tool: ${event.toolName}`, "warning");
		return { block: true, reason: decision.reason };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isDisabled()) return;
		latestCtx = ctx;
		if (REVIEW_LEAK_TOOLS.has(event.toolName)) {
			const active = orchestrator.store.active();
			if (active && (active.state === "reviewing" || active.state === "changes_requested")) {
				ledger.recordReviewLeak(active.taskId, Buffer.byteLength(contentText(event.content)));
				syncUsage(active.taskId);
				persistSessionEntries();
			}
			return;
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (isDisabled()) return;
		latestCtx = ctx;
		const host = ctx ?? ({ hasUI: false, cwd: process.cwd() } as ExtensionContext);
		const message = event.message as {
			role?: string;
			model?: string;
			provider?: string;
			usage?: PiUsageLike;
			id?: string;
		};
		if (message.role === "assistant") {
			const taskIds = [...rootTurnTaskIds];
			const targetedTaskId = taskIds.length === 1 ? taskIds[0] : undefined;
			const targetedTask = targetedTaskId ? orchestrator.store.get(targetedTaskId) : undefined;
			const fallbackTask = taskIds.length === 0 ? orchestrator.store.activeForCwd(host.cwd || process.cwd()) : undefined;
			const attributionTaskId = targetedTaskId ?? fallbackTask?.taskId;
			// L73 — a turn spanning multiple Tasks is attributed to all of them as
			// shared; collapsing onto the most recent delegation target is forbidden.
			// The tasked/shared/untasked derivation is shared with the ledger.
			const attributionTaskIds = taskIds.length > 1 ? taskIds : attributionTaskId ? [attributionTaskId] : [];
			const turnState = targetedTask?.state ?? fallbackTask?.state;
			ledger.recordRootTurn({
				usage: message.usage ?? {},
				...(attributionTaskId ? { taskId: attributionTaskId, ...(turnState ? { state: turnState } : {}) } : {}),
				...(attributionTaskIds.length > 0 ? { taskIds: attributionTaskIds } : {}),
				attribution: deriveRootTurnAttribution(attributionTaskIds.length),
				...(rootTurnToolCallIds.size > 0 ? { toolCallIds: [...rootTurnToolCallIds] } : {}),
				...(message.model ? { model: message.model } : {}),
				...(message.provider ? { provider: message.provider } : {}),
				...(message.id ? { messageId: message.id } : {}),
			});
			if (attributionTaskId) syncUsage(attributionTaskId);
			rootTurnTaskIds.clear();
			rootTurnToolCallIds.clear();
			persistSessionEntries();
			// Ticket 40: soft-cap warning after root accounting (never blocks the turn).
			const rootEval = evaluateSessionRootBudget(ledger.sessionRootSpend(), sessionRootBudget);
			if (rootEval.level === "ok") {
				sessionRootSoftWarned = false;
				sessionRootHardWarned = false;
			} else if (rootEval.level === "soft") {
				sessionRootHardWarned = false;
				if (!sessionRootSoftWarned) {
					sessionRootSoftWarned = true;
					notify(host, formatSessionRootBudgetSoftWarning(rootEval), "warning");
				}
			} else if (rootEval.level === "hard" && !sessionRootHardWarned) {
				// Ticket 08 K1: the launch-time hard-cap gate died with the legacy
				// delegation chain; this disclosure is the only remaining signal.
				sessionRootHardWarned = true;
				sessionRootSoftWarned = true;
				notify(host, formatSessionRootBudgetStatus(rootEval), "warning");
			}
		}
	});

	const noticeKeys = new Set<string>();
	const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" = "info"): void => {
		const key = `${type}:${message}`;
		const repeated = noticeKeys.has(key);
		noticeKeys.add(key);
		const rendered = repeated && (message.split("\n").length === 1 || message.startsWith("Planner-only"))
			? `Planner-only notice repeated: ${message.split("\n", 1)[0]}`
			: message;
		if (ctx.hasUI) {
			ctx.ui.notify(rendered, type);
			return;
		}
		// Headless: there is no UI toast, so the notice must land somewhere
		// readable in the session itself (FR-06 §9.3).
		if (typeof pi.sendMessage === "function") {
			pi.sendMessage({ customType: "planner-only-notice", content: rendered, display: true });
		}
	};

	pi.registerCommand("planner-only", {
		description: "Show, enable, or temporarily disable planner-only mode; inspect task lifecycle; toggle session root budget",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] ?? "status").toLowerCase();
			const store = orchestrator.store;

			if (action === "status") {
				const log = usageLogPath();
				const logStatus = log ? `${log} (enabled)` : "disabled";
				const roleModelPolicy = loadRoleModelPolicy();
				const rootIdentity = rootModelIdentity(ctx.model) ?? selectedModel;
				const actualRootDisplay = rootIdentity
					? rootIdentity.provider ? `${rootIdentity.provider}/${rootIdentity.id}` : rootIdentity.id
					: "未知（宿主未提供 ctx.model）";
				const configuredLines = roleModelPolicy.enabled
					? configuredRoleModelSummaries(roleModelPolicy).map((line) =>
						line.startsWith("root:")
							? `${line}（策略配置值；root 不经委派，此值不改变实际运行的模型）`
							: line,
					)
					: ["无模型成本保证"];
				const lines = [
					`Planner-only mode is ${isDisabled() ? "off" : "on"} (source: ${guardDecisionSource()}).`,
					...configuredLines,
					`实际运行的 root: ${actualRootDisplay}`,
				];
				const configuredRoot = roleModelPolicy.enabled ? roleModelPolicy.roles.root?.model : undefined;
				if (roleModelPolicy.enabled) {
					const workerPolicy = roleModelPolicy.roles.worker;
					const resolvedWorker = workerPolicy?.model ?? "未知";
					const resolvedThinking = workerPolicy?.thinking ?? "未知";
					lines.push(`Delegation model policy: requested=未指定 (thinking: 未指定), resolved=${resolvedWorker} (thinking: ${resolvedThinking}), actual=未知 (thinking: 未知)`);
				}
				if (roleModelPolicy.enabled && configuredRoot && rootIdentity && configuredRoot !== actualRootDisplay) {
					lines.push("root 策略配置与实际运行的模型不一致");
				}
				const versionInfo = orchestrator.getLoadedFingerprint() ?? loadedFingerprintInfo;
				lines.push(
					`Plugin build: loaded=${versionInfo.loadedFingerprint.slice(0, 12)} (package: ${versionInfo.packageVersion}, disk HEAD: ${versionInfo.diskHead.slice(0, 12)})`,
					`Plugin provenance: source=${versionInfo.sourcePath}; host=${versionInfo.hostVersion}; subagents=${versionInfo.subagentVersion}; session=${versionInfo.sessionId}; workspace=${versionInfo.workspaceId}; capabilities=${versionInfo.capabilities.join(",")}`,
				);
				const forcing = envForcingValue();
				if (forcing !== undefined) {
					lines.push(`Environment: PI_PLANNER_ONLY=${forcing} forces planner-only ${envForcesGuard() ? "on" : "off"}.`);
				} else if (existsSync(OFF_MARKER)) {
					lines.push(`Marker: ${OFF_MARKER}`);
				}
				lines.push(`Usage log: ${logStatus}`);
				lines.push(orchestrator.renderConcurrencyStatus());
				lines.push(`Oracle suite: ${oracleSuiteMode()}`);
				const rateWarning = rootRateWarning(ctx);
				if (rateWarning) lines.push(rateWarning);
				const currentCwd = ctx.cwd || process.cwd();
				const active = store.activeForCwd(currentCwd);
				if (active) {
					lines.push("", orchestrator.renderTaskStatus(active));
				} else {
					lines.push("", "无活跃 Task");
				}
				const sessionUsage = summarizeSessionUsage(ledger);
				lines.push(`Session usage: tokens=${sessionUsage.totalTokens}，已知费用 $${sessionUsage.totalCostUsd.toFixed(4)}，未知项 ${sessionUsage.costUnknownParts} 项`);
				if (sessionUsage.unattributed.turns > 0 || sessionUsage.unattributed.costUnknown) {
					lines.push(`Unattributed (会话级，未归入任何 Task): ${sessionUsage.unattributed.turns} turns, tokens=${sessionUsage.unattributed.tokens}, 费用 $${sessionUsage.unattributed.costUsd.toFixed(4)}${sessionUsage.unattributed.costUnknown ? "，费用不可知" : ""}`);
				}
				const sessionRootEval = evaluateSessionRootBudget(ledger.sessionRootSpend(), sessionRootBudget);
				lines.push("", formatSessionRootBudgetStatus(sessionRootEval));
				notify(ctx, lines.join("\n"), rateWarning || sessionRootEval.level !== "ok" ? "warning" : "info");
				return;
			}
			if (action === "concurrency") {
				const requested = parts[1];
				if (requested === undefined) {
					notify(ctx, orchestrator.renderConcurrencyStatus());
					return;
				}
				if (requested.toLowerCase() === "reset" && parts.length === 2) {
					orchestrator.resetConcurrencyLimit();
					notify(ctx, orchestrator.renderConcurrencyStatus());
					return;
				}
				const limit = parseConcurrencyLimit(requested);
				const extra = parts.slice(2);
				if (limit === undefined || extra.some((item) => item !== "--save") || extra.filter((item) => item === "--save").length > 1) {
					notify(ctx, "Invalid concurrency limit. Use a positive safe integer and optional --save.", "warning");
					return;
				}
				const changed = orchestrator.setConcurrencyLimit(limit);
				if (!changed.ok) {
					notify(ctx, changed.error, "warning");
					return;
				}
				if (extra.includes("--save")) {
					const saved = saveConcurrencyDefault(CONCURRENCY_CONFIG, limit);
					if (!saved.ok) {
						notify(ctx, `Concurrency changed for this session, but save failed: ${saved.error}`, "warning");
						return;
					}
					orchestrator.setConcurrencySavedLimit(limit);
				}
				notify(ctx, orchestrator.renderConcurrencyStatus());
				return;
			}
			if (action === "on") {
				await rm(OFF_MARKER, { force: true });
				if (envDisablesGuard()) {
					// The environment overrides the operator: report the truth
					// instead of claiming an enable that did not happen (T04).
					updateStatus(ctx);
					notify(ctx, [
						"Planner-only mode remains off.",
						`Environment: PI_PLANNER_ONLY=${process.env.PI_PLANNER_ONLY} forces planner-only off; clear the variable to enable it.`,
					].join("\n"), "warning");
					return;
				}
				updateStatus(ctx);
				notify(ctx, "Planner-only mode enabled.");
				return;
			}
			if (action === "off") {
				await mkdir(dirname(OFF_MARKER), { recursive: true });
				await writeFile(OFF_MARKER, "Disabled by /planner-only off\n", "utf8");
				restoreSuppressedTools();
				updateStatus(ctx);
				notify(ctx, "Planner-only mode disabled. Run /planner-only on to re-enable it.", "warning");
				return;
			}
			if (action === "budget") {
				const sub = (parts[1] ?? "").toLowerCase();
				const applyLive = () => {
					sessionRootBudget = currentSessionRootBudget();
					orchestrator.setSessionRootBudgetConfig(sessionRootBudget);
					sessionRootSoftWarned = false;
					sessionRootHardWarned = false;
				};
				if (sub === "on") {
					await mkdir(dirname(SESSION_ROOT_BUDGET_ON_MARKER), { recursive: true });
					await writeFile(SESSION_ROOT_BUDGET_ON_MARKER, "Enabled by /planner-only budget on\n", "utf8");
					applyLive();
					if (envSessionRootBudgetOverride() === false) {
						notify(ctx, [
							"Session root budget remains off.",
							`Environment: ${SESSION_ROOT_BUDGET_ENV_VARS.ENABLED}=${process.env[SESSION_ROOT_BUDGET_ENV_VARS.ENABLED]} forces it off; clear the variable to use /planner-only budget on.`,
						].join("\n"), "warning");
						return;
					}
					notify(ctx, [
						"Session root budget enabled (软顶 ×3 警告 / 硬顶 ×5 拒绝新的受控付费委派).",
						formatSessionRootBudgetStatus(evaluateSessionRootBudget(ledger.sessionRootSpend(), sessionRootBudget)),
					].join("\n"));
					return;
				}
				if (sub === "off") {
					await rm(SESSION_ROOT_BUDGET_ON_MARKER, { force: true });
					applyLive();
					if (envSessionRootBudgetOverride() === true) {
						notify(ctx, [
							"Session root budget remains on.",
							`Environment: ${SESSION_ROOT_BUDGET_ENV_VARS.ENABLED}=${process.env[SESSION_ROOT_BUDGET_ENV_VARS.ENABLED]} forces it on; clear the variable to use /planner-only budget off.`,
						].join("\n"), "warning");
						return;
					}
					notify(ctx, [
						"Session root budget disabled. Run /planner-only budget on to re-enable it.",
						formatSessionRootBudgetStatus(evaluateSessionRootBudget(ledger.sessionRootSpend(), sessionRootBudget)),
					].join("\n"), "warning");
					return;
				}
				if (sub) {
					notify(ctx, "Usage: /planner-only budget [on|off]", "warning");
					return;
				}
				notify(ctx, formatSessionRootBudgetStatus(evaluateSessionRootBudget(ledger.sessionRootSpend(), sessionRootBudget)));
				return;
			}
			if (action === "task") {
				const subaction = (parts[1] ?? "").toLowerCase();
				if (subaction === "abandon" || subaction === "reset") {
					const taskId = parts[2];
					if (!taskId) {
						notify(ctx, "Usage: /planner-only task abandon|reset <taskId>", "warning");
						return;
					}
					const target = store.get(taskId);
					if (!target) {
						notify(ctx, `Unknown planner-only task: ${taskId}`, "warning");
						return;
					}
					try {
						const before = target.state;
						store.abandon(target.taskId, `abandoned by operator via /planner-only task ${subaction}`);
						notify(ctx, `Task ${target.taskId} abandoned and marked failed.`);
						persistSessionEntries();
						await flushIfTerminal(target.taskId, before, ctx);
					} catch (error) {
						notify(ctx, error instanceof Error ? error.message : String(error), "warning");
					}
					return;
				}
				const task = parts[1] ? store.get(parts[1]) : store.active();
				if (!task) {
					notify(ctx, "No active planner-only task.", "info");
					return;
				}
				notify(ctx, orchestrator.renderTaskStatus(task));
				return;
			}
			if (action === "review") {
				let rest = parts.slice(1);
				let task = store.active();
				if (rest[0] && store.get(rest[0])) {
					task = store.get(rest[0]);
					rest = rest.slice(1);
				}
				if (!task) {
					notify(ctx, "No active planner-only task.", "info");
					return;
				}
				const sub = (rest[0] ?? "").toLowerCase();
				if (!sub) {
					notify(ctx, [
						`Task: ${task.taskId}`,
						`State: ${task.state}`,
						`Round: ${task.reviewRound}/${MAX_REVIEW_ROUNDS}`,
						`Review mode: ${task.reviewMode}`,
						"Usage: /planner-only review [taskId] [root|fresh|pass|request_changes|blocked] [summary]",
					].join("\n"));
					return;
				}
				if (sub === "root" || sub === "fresh") {
					if (sub === "root" && process.env.PI_PLANNER_ONLY_REQUIRE_REVIEW === "1") {
						notify(ctx, "Strict mode (PI_PLANNER_ONLY_REQUIRE_REVIEW=1) refuses review mode root: accept requires a reviewer ReviewResult and evidence attribution must have > 0 paths. The only way to disable strict mode is to unset PI_PLANNER_ONLY_REQUIRE_REVIEW and restart the session.", "warning");
						return;
					}
					store.setReviewMode(task.taskId, sub as ReviewMode);
					notify(ctx, `Review mode for ${task.taskId} set to ${sub}.`);
					return;
				}
				if (!["pass", "request_changes", "blocked"].includes(sub)) {
					notify(ctx, "Usage: /planner-only review [root|fresh|pass|request_changes|blocked] [summary]", "warning");
					return;
				}
				const verdict = sub as ReviewVerdict;
				const summary = rest.slice(1).join(" ").trim() || `root verdict: ${verdict}`;
				// The operator's override bypasses the §3 step-2 refusals except the
				// terminal-state one, and says so out loud when it does.
				const refusal = orchestrator.rootVerdictRefusal(task, verdict);
				if (refusal) {
					if (refusal.kind === "terminal-state") {
						notify(ctx, refusal.reason, "warning");
						return;
					}
					notify(ctx, `Operator override bypassed refusal: ${refusal.reason}`, "warning");
				}
				const before = task.state;
				const outcome = await orchestrator.recordRootVerdict(task, verdict, summary, { source: "operator" });
				notify(ctx, enrichDecisionText(orchestrator.renderDecisionBlock(outcome.task, outcome.decision, outcome.evidence), outcome.task.taskId));
				persistSessionEntries();
				await flushIfTerminal(outcome.task.taskId, before, ctx);
				return;
			}
			if (action === "usage") {
				const sub = (parts[1] ?? "").trim();
				if (sub.toLowerCase() === "reload") {
					persistSessionEntries();
					ensurePricingFile();
					pricing = loadPricingTable();
					ledger = new UsageLedger({ pricing, resolveTaskId: (taskId) => orchestrator.store.get(taskId)?.taskId ?? taskId });
					ledger.load(allSessionEntries);
					for (const task of store.list()) {
						syncUsage(task.taskId);
					}
					notify(ctx, `Planner-only: reloaded pricing table (${Object.keys(pricing.rates).length} rates, currency: ${pricing.currency}).`);
					return;
				}

				const renderTaskBlock = (tId: string): string | undefined => {
					const targetId = canonicalTaskId(tId);
					const u = ledger.taskUsage(targetId);
					if (!u) return undefined;
					const t = store.get(targetId);
					const rootRates = lookupRates(pricing, undefined, u.rootModel);
					return renderUsage(u, {
						taskId: targetId,
						state: t?.state ?? "unknown (store not persisted)",
						rounds: t?.reviewRound ?? 0,
						currency: pricing.currency,
						rootRates,
					});
				};

				const renderSessionView = (): string => {
					const session = ledger.sessionUsage();
					const lines: string[] = [`Usage for session (${session.tasks.length} task${session.tasks.length === 1 ? "" : "s"}):`];
					for (const tId of session.tasks) {
						const targetId = canonicalTaskId(tId);
						const u = ledger.taskUsage(targetId);
						if (!u) continue;
						const t = store.get(targetId);
						const state = t ? t.state : "unknown";
						lines.push(`${targetId} (${state}): ${renderUsageLine(u, pricing.currency)}`);
					}
					lines.push(`untasked: ${renderUsageLine({ root: session.untasked, children: [], costUnknown: session.untasked.costUsd === undefined && session.untasked.turns > 0 }, pricing.currency)}`);
					lines.push(`shared/ambiguous: ${renderUsageLine({ root: session.shared, children: [], costUnknown: session.shared.costUsd === undefined && session.shared.turns > 0 }, pricing.currency)}`);
					return lines.join("\n");
				};

				if (sub.toLowerCase() === "export") {
					persistSessionEntries();
					const requestedRootSession = parts[2]?.trim() || orchestrator.getLoadedProvenance()?.sessionId || process.env.PI_SESSION_ID?.trim() || "unknown-session";
					const evidence = orchestrator.exportEvidence(requestedRootSession);
					notify(ctx, JSON.stringify(evidence, null, 2));
					return;
				}

				if (sub.toLowerCase() === "record") {
					let taskId: string | undefined;
					for (let index = 2; index < parts.length; index += 1) {
						if (parts[index - 1] === "--arm" || parts[index].startsWith("--")) continue;
						taskId = parts[index].trim();
						if (taskId) break;
					}
					taskId ||= store.active()?.taskId;
					if (!taskId) { notify(ctx, "Planner-only: no active task to record.", "warning"); return; }
					const task = store.get(taskId);
					const usage = task ? ledger.taskUsage(task.taskId) : undefined;
					if (!task || !usage) { notify(ctx, `Unknown planner-only task: ${taskId}`, "warning"); return; }
					const armIndex = parts.indexOf("--arm");
					const record = buildRunRecord({
						runId: `${task.taskId}-${Date.now()}`,
						arm: armIndex >= 0 ? (parts[armIndex + 1] ?? "unspecified") : "unspecified",
						task: {
							taskId: task.taskId,
							objective: task.spec?.objective,
							acceptanceCriteria: task.spec?.acceptanceCriteria ?? [],
							state: task.state,
							reviewRounds: task.reviewRound,
							createdAt: task.createdAt,
							updatedAt: task.updatedAt,
							cwd: task.cwd,
							baseGitRef: task.baseEvidence?.baseGitRef,
							finalGitRef: task.baseEvidence?.finalGitRef,
							gitStatusHash: task.baseEvidence?.gitStatusHash,
						},
						usage,
						provenance: orchestrator.getLoadedFingerprint() ?? loadedFingerprintInfo,
						identityIndex: task.executions.map((execution) => ({
							taskId: task.taskId,
							executionId: execution.executionId,
							...(execution.runId ? { hostRunId: execution.runId } : {}),
							...(execution.reportIndex !== undefined ? { reportRevision: execution.reportIndex + 1 } : {}),
						})),
						pricing: { path: pricingPath(), version: pricing.version, currency: pricing.currency, loadedAt: new Date().toISOString() },
					});
					const dir = join(AGENT_DIR, "planner-only", "runs");
					mkdirSync(dir, { recursive: true });
					const path = join(dir, `${record.runId}.json`);
					writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
					notify(ctx, `Planner-only: wrote run record ${path} (comparable: ${record.comparable}).`);
					return;
				}

				if (sub.toLowerCase() === "summary") {
					const dir = (parts[2] ?? "").trim() || join(AGENT_DIR, "planner-only", "runs");
					if (!existsSync(dir)) { notify(ctx, `Planner-only: no run records at ${dir}.`, "warning"); return; }
					const records = readdirSync(dir).filter((name) => name.endsWith(".json"))
						.map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")));
					notify(ctx, renderRunSummary(summarizeRuns(records)));
					return;
				}

				if (sub.toLowerCase() === "session") {
					notify(ctx, renderSessionView());
					return;
				}

				if (sub) {
					// The operator may name a model-chosen alias; usage is keyed by
					// the store's canonical id.
					const output = renderTaskBlock(store.get(sub)?.taskId ?? sub);
					if (!output) {
						notify(ctx, `Unknown planner-only task: ${sub}`, "warning");
						return;
					}
					notify(ctx, output);
					return;
				}

				const active = store.active();
				if (active) {
					const output = renderTaskBlock(active.taskId);
					if (output) {
						notify(ctx, output);
						return;
					}
				}

				notify(ctx, renderSessionView());
				return;
			}
			notify(ctx, "Usage: /planner-only [status|on|off|budget [on|off]|task [abandon|reset <taskId>]|review|usage] [args]", "warning");
		},
	});
}
