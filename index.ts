import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { Type, type TSchema } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	ROOT_TOOLS,
	QUESTION_TOOLS,
	READ_ONLY_TOOLS,
	decidePolicy,
} from "./policy.ts";
import { GIT_AUDIT_OPERATIONS, classifyCommitDirtyPaths, dirtyPathsOutsideTruth, parseGitStatusKinds, parseGitStatusPaths, resolveGitCommit, runGitAudit } from "./git-audit.ts";
import { describeProbeFailures } from "./evidence.ts";
import type { GitAuditRequest, GitRunner } from "./git-audit.ts";
import { PlannerOrchestrator } from "./orchestrate.ts";
import type { PlannerTaskDiagnostics } from "./orchestrate.ts";
import { MAX_REVIEW_ROUNDS, MAX_TASK_DIAGNOSTICS_TEXT_CHARS, WORKER_REPORT_VERSION, isFinalTaskState } from "./types.ts";
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
	loadSessionRootBudgetConfig,
	SESSION_ROOT_BUDGET_ENV_VARS,
	sessionRootBudgetWithEnabled,
} from "./floors.ts";
import { configuredRoleModelSummaries, loadRoleModelPolicy } from "./role-models.ts";
import { enforceDelegationModel, observeDelegationModel, resolveDelegationModel } from "./delegation-model.ts";
import type { ModelRouteObservation } from "./delegation-model.ts";
import { ConcurrencyController, loadConcurrencyDefault, saveConcurrencyDefault, parseConcurrencyLimit } from "./concurrency.ts";
import {
	DelegationRefused,
	PLANNER_DELEGATE_PARAMETERS,
	PLANNER_REDELEGATE_PARAMETERS,
	RESTRICTED_READER_AGENT,
	RESTRICTED_READER_DEFINITION,
	REPORT_ONLY_AGENT,
	REPORT_ONLY_DEFINITION,
	cancelInFlightDelegations,
	createHostLauncher,
	renderDelegationOutcome,
	runDelegation,
	validateRecoveryDecision,
} from "./delegate.ts";
import type { DelegationOutcome, PlannerDelegationParams } from "./delegate.ts";
import { RefusalBreaker, isRefusal } from "./refusal-breaker.ts";
import type { RecoveryDecision } from "./types.ts";
import { normalizeWorkspaceIdentity } from "./task.ts";
import { FileRequestStorage, RequestClosed, RequestController } from "./request-control.ts";
import { acceptedExecution, correctionPredecessor, delegationFailureFamily, requestErrorFamily, reviewFailureFamily, structuralIssues } from "./request-events.ts";
import { loadExecutionDefaults } from "./execution-defaults.ts";

/** P0-B — the only recovery action wired through planner_abort (spec §5, ADR-0003). */
const ABORT_RECOVERY_ACTIONS = new Set(["abort"]);

/** Ticket 06 — total serialization budget for the structured diagnostics payload in details. */
const MAX_TASK_DIAGNOSTICS_DETAILS_BYTES = 64 * 1024;
const MAX_TASK_DIAGNOSTICS_DETAILS_STRING_CHARS = 4000;
const FLOOR_TASK_DIAGNOSTICS_DETAILS_STRING_CHARS = 256;
const MAX_TASK_DIAGNOSTICS_DETAILS_ARRAY_ITEMS = 50;

function cloneCappedDiagnosticsValue(value: unknown, stringCap: number, arrayCap: number, fieldName?: string): { value: unknown; cut: boolean } {
	if (typeof value === "string") {
		if (value.length <= stringCap) return { value, cut: false };
		const suffix = "... [truncated]";
		return {
			value: stringCap <= suffix.length ? value.slice(0, stringCap) : `${value.slice(0, stringCap - suffix.length)}${suffix}`,
			cut: true,
		};
	}
	if (Array.isArray(value)) {
		let cut = value.length > arrayCap;
		const clone: unknown[] = [];
		const items = fieldName === "executions" ? value.slice(-arrayCap) : value.slice(0, arrayCap);
		for (const item of items) {
			const capped = cloneCappedDiagnosticsValue(item, stringCap, arrayCap);
			clone.push(capped.value);
			cut = capped.cut || cut;
		}
		return { value: clone, cut };
	}
	if (value !== null && typeof value === "object") {
		let cut = false;
		const clone: Record<string, unknown> = {};
		for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
			const capped = cloneCappedDiagnosticsValue(field, stringCap, arrayCap, key);
			clone[key] = capped.value;
			cut = capped.cut || cut;
		}
		return { value: clone, cut };
	}
	return { value, cut: false };
}

function synchronizeExecutionTruncationLabel(diagnostics: PlannerTaskDiagnostics): void {
	if (diagnostics.totalExecutions <= diagnostics.executions.length) return;
	const label = `showing the latest ${diagnostics.executions.length} of ${diagnostics.totalExecutions} executions; pass executionId to inspect a specific one`;
	const index = diagnostics.guidance.findIndex((line) => /^showing the latest \d+ of \d+ executions;/.test(line));
	if (index >= 0) diagnostics.guidance[index] = label;
	else diagnostics.guidance.unshift(label);
}

function diagnosticsDetailsBytes(diagnostics: PlannerTaskDiagnostics): number {
	return Buffer.byteLength(JSON.stringify({ diagnostics }), "utf8");
}

/**
 * Ticket 06 — the return boundary's total budget over the structured
 * diagnostics payload. Even individually bounded fields can exceed the
 * aggregate budget through array fan-out, so this creates successively
 * tighter immutable bounded copies until the UTF-8 serialized details fit.
 * A fixed-shape fallback preserves identity and counts under adversarial
 * fan-out. Any cut sets truncated=true so the text and details disclosures
 * stay in sync.
 */
function enforceDiagnosticsDetailsBudget(diagnostics: PlannerTaskDiagnostics): PlannerTaskDiagnostics {
	const attempts = [
		[MAX_TASK_DIAGNOSTICS_DETAILS_STRING_CHARS, MAX_TASK_DIAGNOSTICS_DETAILS_ARRAY_ITEMS],
		[2000, 50], [1000, 50], [500, 50], [FLOOR_TASK_DIAGNOSTICS_DETAILS_STRING_CHARS, 50],
		[FLOOR_TASK_DIAGNOSTICS_DETAILS_STRING_CHARS, 25], [128, 10], [64, 5], [32, 1],
	] as const;
	for (const [stringCap, arrayCap] of attempts) {
		const capped = cloneCappedDiagnosticsValue(diagnostics, stringCap, arrayCap);
		const candidate = capped.value as PlannerTaskDiagnostics;
		candidate.truncated = diagnostics.truncated || capped.cut;
		synchronizeExecutionTruncationLabel(candidate);
		if (diagnosticsDetailsBytes(candidate) < MAX_TASK_DIAGNOSTICS_DETAILS_BYTES) return candidate;
	}

	// Fixed-shape last resort: even adversarial fan-out cannot escape the
	// boundary. Keep identity and counts so the caller can issue a narrow query.
	return {
		taskId: diagnostics.taskId.slice(0, 128),
		state: diagnostics.state.slice(0, 64) as PlannerTaskDiagnostics["state"],
		acceptanceMode: diagnostics.acceptanceMode === "observation" ? "observation" : "worktree",
		reservations: [],
		source: diagnostics.source,
		reports: diagnostics.reports,
		reviews: diagnostics.reviews,
		sessionLog: { status: diagnostics.sessionLog.status },
		...(diagnostics.request ? { request: diagnostics.request } : {}),
		executions: [],
		launchRefusals: [],
		totalExecutions: diagnostics.totalExecutions,
		truncated: true,
		guidance: ["diagnostics exceeded the structured output budget; pass executionId to narrow the query"],
	};
}

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
		"delegation-model.ts",
		"evidence.ts",
		"execution-defaults.ts",
		"floors.ts",
		"git-audit.ts",
		"index.ts",
		"ledger-store.ts",
		"orchestrate.ts",
		"package.json",
		"policy.ts",
		"pricing.defaults.json",
		"refusal-breaker.ts",
		"request-control.ts",
		"request-events.ts",
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
	const sessionId = managerSessionId ?? contextSessionId ?? sessionFileHint ?? process.env.PI_SESSION_ID?.trim() ?? "unknown";
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

Gather: no live Task → planner_delegate; planner_verdict/git_audit stay allowed; live Tasks allow inspect/Git-read.

One bounded TaskSpec per planner_delegate call (full TaskSpec fields); one ticket per TaskSpec. Do not instruct workers to /code-review.
planner_delegate always mints a Task and returns its canonical taskId in details.taskId. Corrections, reviews, and recovery re-enter via planner_redelegate with that exact taskId — unsure, call planner_tasks; never construct one.

Every worker returns WorkerReport version ${WORKER_REPORT_VERSION} — summary, changedFiles, validation plus exit codes, evidence, risks, and unresolved items. Top-level status must be exactly completed/partial/blocked/failed; validation status must be exactly passed/failed/not-run.

Verify identity and evidence freshness (read/grep/git_audit), then record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict — no recovery key; abandon a recovery.required execution via planner_abort.

Roles: explorer → scout, reviewer → builtin reviewer (read/grep/find/ls, context=fresh), validator → oracle (bash, no edits), worker keeps its agent; never pre-compose worker→reviewer as a workflowScript or chain; the reviewer runs via planner_redelegate only after the worker returns, in a separate call.

Never trust a worker PASS. Never accept stale evidence; validation re-runs via bounded oracle: HEAD/status + named tests; full suite only if PI_PLANNER_ONLY_ORACLE=full. Never fix rejected work. Stop after ${MAX_REVIEW_ROUNDS} review rounds (blocked).
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

/** WRC P0-A — parse a non-negative millisecond env override; undefined keeps the spec default. */
function parseNonNegativeMs(raw: string | undefined): number | undefined {
	if (raw === undefined || raw.trim() === "") return undefined;
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
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
	const sessionRootBudgetBase = loadSessionRootBudgetConfig(process.env);
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
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code, killed: result.killed === true };
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
	// PI_PLANNER_ONLY_CANCEL_GRACE_MS exists for tests; the default stays 5 s.
	const delegationLaunch = createHostLauncher(pi, {
		cancelGraceMs: parseNonNegativeMs(process.env.PI_PLANNER_ONLY_CANCEL_GRACE_MS),
	});
	// Ticket 02 — the trusted restricted reader. The name is only supplied to
	// runDelegation once pi-subagents' runtime-agent registry accepted the
	// plugin-owned definition: the declared tool list (read, grep, find, ls —
	// no shell/edit/write) is the capability proof. Registration is retried
	// at every delegation so a pi-subagents that finished loading late still
	// unlocks explorer launches; while it stays unregistered, explorer
	// delegations refuse with READER_CAPABILITY_UNPROVEN.
	let restrictedReaderAgent: string | undefined;
	let reportOnlyAgent: string | undefined;
	const ensureRestrictedReaderAgent = (): void => {
		if (restrictedReaderAgent !== undefined) return;
		try {
			const request: {
				version: number;
				name: string;
				definition: unknown;
				result?: { ok?: boolean; registration?: unknown };
			} = {
				version: 1,
				name: RESTRICTED_READER_AGENT,
				definition: RESTRICTED_READER_DEFINITION,
			};
			pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
			if (request.result?.ok === true && request.result.registration !== undefined) {
				restrictedReaderAgent = RESTRICTED_READER_AGENT;
			}
		} catch {
			// No registry listener (pi-subagents absent or older): explorer
			// delegations refuse with READER_CAPABILITY_UNPROVEN.
		}
	};
	const ensureReportOnlyAgent = (): void => {
		if (reportOnlyAgent !== undefined) return;
		try {
			const request: {
				version: number;
				name: string;
				definition: unknown;
				result?: { ok?: boolean; registration?: unknown };
			} = { version: 1, name: REPORT_ONLY_AGENT, definition: REPORT_ONLY_DEFINITION };
			pi.events.emit("pi-subagents:runtime-agent-register:v1", request);
			if (request.result?.ok === true && request.result.registration !== undefined) {
				reportOnlyAgent = REPORT_ONLY_AGENT;
			}
		} catch {
			// A pending report correction refuses before REQUEST without this proof.
		}
	};
	// WRC P0-A — spec §3 quiescenceWaitMs; env override exists for tests and
	// calibrated hosts, the default stays 10 s (forced-settlement 3–4 s +
	// session-close 5 s upper bound).
	const quiescenceWaitMs = parseNonNegativeMs(process.env.PI_PLANNER_ONLY_QUIESCENCE_MS);
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
	// Ticket 16 — session-scoped repeat-refusal breaker. Only pre-launch
	// refusals count (isRefusal); aborts, terminations, and store errors do not.
	const refusalBreaker = new RefusalBreaker();
	const requests = new Map<string, RequestController>();
	const requestContexts = new Map<string, ExtensionContext>();
	const toolOwners = new Map<string, { request: RequestController; requestId: string; failureFamily?: string }>();
	const rootToolSchemas = new Map<string, TSchema>();
	let sessionBinding: string | undefined;
	const requestKey = (ctx: ExtensionContext): [string, string, string] => {
		const sessionId = ctx.sessionManager?.getSessionId?.() || ctx.sessionManager?.getSessionFile?.() || "unidentified-host";
		const workspace = normalizeWorkspaceIdentity(ctx.cwd || process.cwd());
		return [JSON.stringify([sessionId, workspace]), sessionId, workspace];
	};
	function requestFor(ctx: ExtensionContext): RequestController {
		const [key, sessionId, workspace] = requestKey(ctx);
		requestContexts.set(key, ctx);
		let request = requests.get(key);
		if (!request) {
			const entries = ctx.sessionManager?.getEntries?.() ?? [];
			request = new RequestController({
				sessionId, workspace, storage: new FileRequestStorage(AGENT_DIR, sessionId, workspace),
				// Only an entry for THIS (session, workspace) namespace proves a lost
				// directory. Another workspace's entry in the same session is first
				// contact here, not a missing record.
				previouslyManaged: entries.some(e => e.type === "custom" && e.customType === "planner-only-request"
					&& (e as { data?: { sessionId?: unknown; workspace?: unknown } }).data?.sessionId === sessionId
					&& (e as { data?: { sessionId?: unknown; workspace?: unknown } }).data?.workspace === workspace),
				stopRoot: () => {
					const host = requestContexts.get(key);
					if (typeof host?.abort !== "function") return "unsupported";
					host.abort();
					return "requested";
				},
			});
			requests.set(key, request);
			try { pi.appendEntry("planner-only-request", { sessionId, workspace, requestId: request.requestId }); } catch { /* old host: filesystem namespace still distinguishes absence */ }
		}
		if (sessionBinding !== undefined && sessionBinding !== key) {
			requests.get(sessionBinding)?.close("session-switch");
			request.close("session-boundary-unverified");
		}
		sessionBinding = key;
		return request;
	}
	function recordAcceptance(request: RequestController, taskId: string, requestId = request.requestId): void {
		const task = orchestrator.store.get(taskId);
		const executionId = task && acceptedExecution(task);
		if (executionId) request.accepted(task!.taskId, executionId, requestId);
	}
	// All registered tools, including diagnostics and Git reads, have the same
	// execute gate. Host prechecks of a parallel batch cannot authorize a later
	// direct execute after the request closes.
	const registerRootTool: ExtensionAPI["registerTool"] = (tool) => {
		rootToolSchemas.set(tool.name, tool.parameters);
		pi.registerTool({
			...tool,
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				latestCtx = ctx;
				const request = requestFor(ctx);
				toolOwners.set(toolCallId, { request, requestId: request.requestId });
				const requestId = request.beginTool(toolCallId, tool.name);
				try {
					const issues = structuralIssues(tool.parameters, params);
					request.structure(tool.name, issues);
					const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
					const details = result.details as { ok?: boolean; error?: string } | undefined;
					if (details?.ok === false || typeof details?.error === "string") {
						request.observeFailure({ id: `tool:${toolCallId}`, family: issues.length
							? requestErrorFamily(tool.name, { code: "ARGUMENTS_INVALID" })
							: details?.error ? requestErrorFamily(tool.name, { code: details.error }) : "environment" }, requestId);
					}
					return result;
				} catch (error) {
					if (!(error instanceof RequestClosed)) {
						const candidate = (error as { taskId?: string } | null)?.taskId ?? (params as { taskId?: string } | null)?.taskId;
						const task = typeof candidate === "string" ? orchestrator.store.get(candidate) : undefined;
						request.observeFailure({ id: `tool:${toolCallId}`, family: requestErrorFamily(tool.name, error),
							...(task ? { taskId: task.taskId } : {}) }, requestId);
					}
					throw error;
				} finally { request.endTool(toolCallId, requestId); }
			},
		});
	};

	/**
	 * Every Root tool execute runs through this wrapper: a thrown refusal is
	 * counted against (toolName, canonicalJson(params)); from the second
	 * identical refusal the Repeat/STOP notice is appended onto the same error
	 * (message mutation keeps code/taskId/stack intact); a success clears the
	 * streak. The BLOCK_AT-th identical call never reaches here — the
	 * tool_call hook intercepts it via shouldBlock.
	 */
	async function withRefusalBreaker<T>(
		toolName: string,
		toolCallId: string,
		params: unknown,
		ctx: ExtensionContext | undefined,
		fn: () => Promise<T>,
	): Promise<T> {
		try {
			const result = await fn();
			refusalBreaker.observeSuccess(toolName, params);
			return result;
		} catch (error) {
			if (!isRefusal(error)) throw error;
			const observation = refusalBreaker.observeRefusal(toolName, toolCallId, params, error);
			if (observation.hardStop && ctx?.hasUI) {
				ctx.ui.notify(
					`Planner-only: ${toolName} refused ${observation.count} times with identical arguments; identical repeats are now blocked before execution.`,
					"warning",
				);
			}
			if (observation.notice && error instanceof Error) {
				error.message = `${error.message}\n\n${observation.notice}`;
			}
			throw error;
		}
	}

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

	registerRootTool({
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

	registerRootTool({
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
		async execute(toolCallId, params: { taskId: string; message?: string; push?: boolean }, _signal, _onUpdate, ctx) {
			return withRefusalBreaker("git_commit", toolCallId, params, ctx, async () => {
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
			});
		},
	});

	// ADR-0001/ADR-0002 — typed Root/child delegation, split into two tool
	// surfaces over one execute body: planner_delegate only mints a new Task
	// (its schema has no taskId/recovery keys at all), planner_redelegate only
	// binds an existing Task (taskId required) for correction rounds, reviews,
	// and recovery re-executions. execute composes deps, calls the shared
	// runDelegation seam, and renders the outcome; the WorkerReport arrives
	// launcher-validated in details.report. Failure is signalled by throwing
	// (the host marks the tool result accordingly).
	const registerDelegationTool = (surface: {
		name: "planner_delegate" | "planner_redelegate";
		description: string;
		promptSnippet: string;
		promptGuidelines: string[];
		parameters: typeof PLANNER_DELEGATE_PARAMETERS | typeof PLANNER_REDELEGATE_PARAMETERS;
		/** planner_delegate strips a passthrough taskId/recovery instead of binding; planner_redelegate requires a real taskId. */
		mintOnly: boolean;
	}): void => {
		registerRootTool({
			name: surface.name,
			label: surface.mintOnly ? "Planner Delegate" : "Planner Redelegate",
			description: surface.description,
			promptSnippet: surface.promptSnippet,
			promptGuidelines: surface.promptGuidelines,
			parameters: surface.parameters,
			async execute(toolCallId, params: PlannerDelegationParams, signal, onUpdate, ctx) {
				latestCtx = ctx;
				return withRefusalBreaker(surface.name, toolCallId, params, ctx, async () => {
					const ignoredWarnings: string[] = [];
					let effectiveParams: PlannerDelegationParams = params;
					if (surface.mintOnly) {
						// A non-validating host may still pass taskId/recovery through:
						// ignore them with a success warning — refusing would recreate
						// the replay loop this split exists to end.
						const { taskId, recovery, ...rest } = params;
						if (taskId !== undefined) {
							ignoredWarnings.push(`supplied taskId ${taskId} was ignored: planner_delegate always mints a new Task; use planner_redelegate to bind an existing one`);
						}
						if (recovery !== undefined) {
							ignoredWarnings.push("supplied recovery was ignored: planner_delegate always mints a new Task; recovery re-execution goes through planner_redelegate");
						}
						effectiveParams = rest;
					} else if (typeof params.taskId !== "string" || params.taskId.trim() === "") {
						// Bind-only surface on a non-validating host: never silently
						// mint — that is exactly the failure mode ADR-0002 closes.
						throw new DelegationRefused(
							"TASK_REQUIRED",
							"planner_redelegate refused: taskId is required — pass the canonical id verbatim from a prior planner_delegate result's details.taskId; never construct one",
						);
					}
					if (params.taskId) {
						orchestrator.resolveVerdictTask(params.taskId, ctx.cwd || process.cwd());
					}
					let outcome: DelegationOutcome;
					// Parse once per invocation, before Task allocation, claims,
					// reservations, evidence sampling, or transport launch.
					const executionDefaults = effectiveParams.role === "reviewer"
						? undefined
						: loadExecutionDefaults(process.env);
					const requestControl = requestFor(ctx);
					const requestScope = requestControl.requestId;
					let modelRoute: ModelRouteObservation | undefined;
					const predecessor = correctionPredecessor(
						effectiveParams.taskId ? orchestrator.store.get(effectiveParams.taskId) : undefined, effectiveParams,
					);
					try {
						const route = resolveDelegationModel(effectiveParams.role, ctx.modelRegistry);
						ensureRestrictedReaderAgent();
						ensureReportOnlyAgent();
						outcome = await runDelegation(
							{
								store: orchestrator.store,
								gitRunner,
								concurrency,
								usage: ledger,
								launch: async (outbound, launchSignal, hooks) => {
									const routed = route ? { ...outbound, model: route.model, thinking: route.thinking } : outbound;
									const recordRoute = (terminal: Parameters<typeof observeDelegationModel>[1]) => {
										if (!route) return terminal;
										modelRoute = observeDelegationModel(route, terminal);
										try { pi.appendEntry("planner-only-model-route", { requestId: outbound.requestId, taskId: outbound.nodeId,
											workspace: normalizeWorkspaceIdentity(ctx.cwd || process.cwd()), ...modelRoute }); }
										catch { ignoredWarnings.push("model route session evidence could not be persisted; see this tool result"); }
										return enforceDelegationModel(modelRoute, terminal);
									};
									return delegationLaunch(routed, launchSignal, {
										...hooks,
										beforeDispatch: packet => {
											requestControl.canClaim(packet.requestId, requestScope);
											hooks?.beforeDispatch?.(packet);
											requestControl.claim(packet.requestId, packet.nodeId, toolCallId, predecessor, requestScope);
										},
										onDispatch: packet => { requestControl.emitted(packet.requestId, requestScope); hooks?.onDispatch?.(packet); },
										onLateTerminal: terminal => {
											requestControl.terminal(outbound.requestId, requestScope);
											recordRoute(terminal);
											hooks?.onLateTerminal?.(terminal);
											if (effectiveParams.role === "reviewer") requestControl.finishChild(toolCallId, true, requestScope);
										},
									}).then(terminal => { requestControl.terminal(outbound.requestId, requestScope); return recordRoute(terminal); });
								},
								...(restrictedReaderAgent !== undefined ? { restrictedReaderAgent } : {}),
								...(reportOnlyAgent !== undefined ? { reportOnlyAgent } : {}),
								...(quiescenceWaitMs !== undefined ? { quiescenceWaitMs } : {}),
								ownerRunId: ctx.sessionManager?.getSessionId?.() || PROCESS_OWNER_RUN_ID,
								...(executionDefaults ? { executionDefaults } : {}),
							},
							effectiveParams,
							ctx.cwd || process.cwd(),
							{ signal: signal ? AbortSignal.any([signal, requestControl.signal]) : requestControl.signal,
								executionId: toolCallId, onUpdate, toolName: surface.name, previousExecutionId: predecessor,
								requestId: requestScope,
								requestObservation: () => requestControl.observe(requestScope),
								requestClosure: () => requestControl.closure(requestScope),
								onLateStopConfirmed: () => requestControl.finishChild(toolCallId, true, requestScope) },
						);
					} catch (error) {
						requestControl.finishChild(toolCallId, false, requestScope);
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
					requestControl.finishChild(toolCallId, outcome.termination?.terminationConfirmed ?? true, requestScope);
					const family = delegationFailureFamily(outcome);
					// A review judges the worker's bound report revision. Its own
					// invocation has no Task execution and cannot be a correction's
					// predecessor; attach actionable findings to the judged worker.
					const failedExecution = effectiveParams.role === "reviewer"
						? outcome.review ? outcome.task.executions.find(e => !e.auxiliary && e.reportIndex === outcome.task.reports.length - 1)?.executionId : undefined
						: outcome.executionId;
					if (family) requestControl.observeFailure({ id: `tool:${toolCallId}`, family, taskId: outcome.task.taskId,
						...(failedExecution ? { executionId: failedExecution } : {}) }, requestScope);
					recordAcceptance(requestControl, outcome.task.taskId, requestScope);
					// P0-A — abnormal terminations return instead of throwing; sync the
					// usage snapshot here so the ledger file sees the child's row, same
					// as the former throw path did.
					if (outcome.termination) {
						syncUsage(outcome.task.taskId);
						persistSessionEntries();
					}
					const warnings = [...ignoredWarnings, ...outcome.warnings];
					const execution = outcome.task.executions.find((item) => item.executionId === outcome.executionId);
					const executionTiming = execution ? {
						...(execution.requestId ? { requestId: execution.requestId } : {}),
						...(execution.launchedAt ? { launchedAt: execution.launchedAt } : {}),
						startedAt: execution.startedAt ?? null,
						...(execution.endedAt ? { endedAt: execution.endedAt } : {}),
						...(execution.durationMs !== undefined ? { durationMs: execution.durationMs } : {}),
						...(execution.durationBasis ? { durationBasis: execution.durationBasis } : {}),
						...(execution.requestClosed ? { requestClosed: execution.requestClosed } : {}),
						...(execution.requestClosedAt ? { requestClosedAt: execution.requestClosedAt } : {}),
					} : undefined;
					const executionEnvelope = execution ? {
						original: execution.originalEnvelope ?? execution.envelope,
						effective: execution.envelope,
						envelopeClamped: execution.envelopeClamped ?? false,
						...(execution.requestBudget ? { requestBudget: execution.requestBudget } : {}),
					} : undefined;
					return {
						content: [{ type: "text", text: renderDelegationOutcome({ ...outcome, warnings }, surface.name) }],
						details: {
							taskId: outcome.task.taskId,
							...(modelRoute ? { modelRoute } : {}),
							executionId: outcome.executionId,
							runId: outcome.runId,
							state: outcome.task.state,
							decision: outcome.decision?.action,
							report: outcome.report,
							review: outcome.review,
							usage: outcome.usage,
							request: requestControl.observe(requestScope),
							...(executionTiming ? { executionTiming } : {}),
							...(executionEnvelope ? { executionEnvelope } : {}),
							...(outcome.termination ? { termination: outcome.termination } : {}),
							warnings,
						},
					};
				});
			},
		});
	};

	registerDelegationTool({
		name: "planner_delegate",
		mintOnly: true,
		description: [
			"Delegate one TaskSpec to a leaf agent through the structured delegation API.",
			"Always mints a new Task and returns its canonical taskId in details.taskId; taskId and recovery are not accepted (use planner_redelegate to re-enter an existing Task).",
			"Returns the launcher-validated WorkerReport in details.report; prose output is never parsed.",
			"Root should prefer this tool over subagent for new worker, explorer, and validator tasks.",
		].join(" "),
		promptSnippet: "planner_delegate: mint a Task — typed TaskSpec delegation with a structured WorkerReport result",
		promptGuidelines: [
			"Prefer planner_delegate over subagent: supply the full TaskSpec fields, not a prose brief.",
			"The child's WorkerReport arrives schema-validated in details.report; a non-completed status returns structured details.termination, not a parse failure.",
			"planner_delegate always mints a new Task and returns its canonical taskId in details.taskId; a correction round, a review, or a recovery re-execution of that Task goes through planner_redelegate with that exact taskId.",
			"role=explorer pairs with acceptanceMode='observation' for read-only informational tasks — the intended path in non-Git directories; it never claims code-change verification. A worktree-mode Task in a non-Git directory refuses writer launches with structured diagnostics instead.",
			"Omitting envelope uses the finite execution defaults (10 minutes wall clock, 100000 tokens). An explicit envelope replaces default/token inheritance. Ordinary execution walls are capped at the original Request remainder minus a provisional 60000ms reserve; insufficient remainder refuses launch without consuming a child allowance. A breach cancels the child and requires a recovery decision.",
		],
		parameters: PLANNER_DELEGATE_PARAMETERS,
	});

	registerDelegationTool({
		name: "planner_redelegate",
		mintOnly: false,
		description: [
			"Re-enter an existing Task through the structured delegation API: a correction round after request_changes (worker/explorer/validator), a review of its latest WorkerReport (reviewer), or a recovery re-execution of a blocked Task.",
			"taskId is required — the canonical id verbatim from a prior planner_delegate result's details.taskId; never construct one.",
			"The stored TaskSpec is authoritative; only temporary instructions, envelope, and recovery may supplement this invocation. The launcher-validated ReviewResult arrives in details.review; a WorkerReport arrives in details.report.",
		].join(" "),
		promptSnippet: "planner_redelegate: re-enter an existing Task by canonical taskId — correction, review, recovery",
		promptGuidelines: [
			"planner_redelegate binds an existing Task: pass the canonical taskId from a prior planner_delegate result's details.taskId verbatim. Never construct a taskId.",
			"role=reviewer reviews the bound Task's latest WorkerReport; the launcher-validated ReviewResult arrives in details.review.",
			"Do not repeat objective, cwd, scope, constraints, acceptanceCriteria, validation, or acceptanceMode: the stored TaskSpec is authoritative. instructions apply to this child packet only and do not mutate it.",
			"Omitting envelope uses the finite execution defaults (10 minutes wall clock, 100000 tokens). An explicit envelope replaces default/token inheritance. Ordinary execution walls are capped at the original Request remainder minus a provisional 60000ms reserve; insufficient remainder refuses launch without consuming recovery or correction state. A Task flagged recovery.required re-executes only with a matching recovery decision (retry_same_plan / fix_environment) or is aborted via planner_abort.",
			"recovery.executionId names the abnormal execution's details.executionId — never a child runId; a stray recovery on a Task without a pending requirement is refused (RECOVERY_NOT_APPLICABLE), not ignored.",
		],
		parameters: PLANNER_REDELEGATE_PARAMETERS,
	});

	// Ticket 18 — read-only Task lookup: the answer to "which taskId" exists
	// on the tool surface, so a Root that lost the canonical id (compaction,
	// session resume) can query instead of constructing one. Listing merges
	// the session store with ledger snapshots the restore cap left out —
	// never restoring them, never minting, never launching.
	registerRootTool({
		name: "planner_tasks",
		label: "Planner Tasks",
		description: [
			"List live (non-final) Tasks of the current workspace with their canonical taskId.",
			"With taskId (and optionally executionId) it instead returns structured diagnostics for that Task: execution lifecycle, termination status, capability, evidence and report admission.",
			"Call this whenever you need a taskId for planner_redelegate or planner_verdict and do not have it verbatim from a prior result.",
			"Never construct a taskId.",
		].join(" "),
		promptSnippet: "planner_tasks: list live Tasks, or read diagnostics for one taskId — look up a canonical taskId instead of guessing one",
		promptGuidelines: [
			"If you need a taskId and do not have it verbatim, call planner_tasks; never construct one.",
			"planner_tasks is read-only: it never mints, binds, restores, or mutates a Task, and never launches a child — it answers what happened, why a Task is blocked, and what evidence exists.",
			"recoveryRequired: true marks a blocked Task whose next planner_redelegate must carry a recovery decision — or whose execution is abandoned via planner_abort.",
			"For one Task, pass taskId (verbatim, from a prior result or this listing) and optionally executionId to inspect lifecycle diagnostics without delegating anything.",
		],
		parameters: Type.Object({
			taskId: Type.Optional(
				Type.String({ minLength: 1, description: "Canonical Task id, verbatim from a prior result or this listing. When present, return diagnostics instead of the listing." }),
			),
			executionId: Type.Optional(
				Type.String({ minLength: 1, description: "The execution's details.executionId (a toolCallId) to narrow diagnostics to one execution." }),
			),
		}),
		async execute(_toolCallId, params: { taskId?: string; executionId?: string }, _signal, _onUpdate, ctx) {
			const cwd = ctx.cwd || process.cwd();
			if (params.taskId !== undefined) {
				const sessionFile = sessionFileOf(ctx);
				const result = orchestrator.describeTaskDiagnostics(cwd, params.taskId, params.executionId, {
					...(sessionFile ? { sessionFile, sessionDir: dirname(sessionFile) } : {}),
				});
				if ("error" in result) {
					return {
						content: [{ type: "text", text: result.reason }],
						details: { error: result.error, taskId: params.taskId },
					};
				}
				const requestControl = requestFor(ctx);
				const d = enforceDiagnosticsDetailsBudget({
					...result.diagnostics,
					request: requestControl.observe(requestControl.requestId),
				});
				// The structured payload is bounded before rendering so the text
				// and details disclosures stay in sync.
				const lines = [
					`planner_tasks diagnostics for ${d.taskId} (${d.source}):`,
					`state: ${d.state}${d.stateReason ? ` — ${d.stateReason}` : ""} | acceptanceMode: ${d.acceptanceMode} | reports: ${d.reports} | reviews: ${d.reviews}`,
					...(d.request ? [`request ${d.request.requestId}: deadline=${d.request.requestDeadline ?? "not started"} remainingMs=${d.request.remainingMs ?? "unknown"} observedAt=${d.request.observedAt}${d.request.unavailableReason ? ` (${d.request.unavailableReason})` : ""}`] : []),
					`session log: ${d.sessionLog.status}${d.sessionLog.path ? ` — ${d.sessionLog.path}` : ""}${d.sessionLog.note ? ` (${d.sessionLog.note})` : ""}`,
					...(d.writerHold ? [`writer hold: ${d.writerHold.active ? "active" : "recorded (no live reservation)"} for execution ${d.writerHold.executionId} — ${d.writerHold.reason}`] : []),
					...(d.recovery ? [`recovery.required: ${d.recovery.reason} (execution ${d.recovery.executionId})`] : []),
					...(d.executions.length === 0 && d.totalExecutions === 0 ? ["executions: none recorded"] : []),
					...(d.totalExecutions > d.executions.length
						? [`executions: showing latest ${d.executions.length} of ${d.totalExecutions} — pass executionId to inspect a specific one`]
						: []),
					...d.executions.flatMap((execution) => [
						`execution ${execution.executionId} [${execution.kind}] status=${execution.status ?? "unknown"} capability=${execution.capability} confirmed=${execution.terminationConfirmed}${execution.confirmationBasis ? ` via ${execution.confirmationBasis}` : ""}${execution.endedReason ? ` ended=${execution.endedReason}` : ""}${execution.runId ? ` runId=${execution.runId}` : ""}`,
						`  timing: request=${execution.requestId ?? "unknown"} launched=${execution.launchedAt ?? "unknown"} started=${execution.startedAt ?? "unknown"} ended=${execution.endedAt ?? "unknown"} durationMs=${execution.durationMs ?? "unknown"}${execution.durationBasis ? ` (${execution.durationBasis})` : ""}${execution.requestClosed ? ` | requestClosed=${execution.requestClosed} at ${execution.requestClosedAt ?? "unknown"}` : ""}`,
						...(execution.effectiveEnvelope ? [`  envelope: effective=${JSON.stringify(execution.effectiveEnvelope)} original=${JSON.stringify(execution.originalEnvelope ?? execution.effectiveEnvelope)} clamped=${execution.envelopeClamped}${execution.requestBudget ? ` request=${JSON.stringify(execution.requestBudget)}` : ""}`] : []),
						`  report: received=${execution.reportReceived} accepted=${execution.reportAccepted}${execution.evidenceIncomplete ? " | stop evidence incomplete" : ""}`,
						...(execution.unacceptedReport ? [`  unaccepted report: status=${execution.unacceptedReport.status} reason="${execution.unacceptedReport.reason}"`] : []),
						...(execution.probeFailures?.length ? [`  probe failures: ${describeProbeFailures(execution.probeFailures)}${execution.probeFailuresTruncated ? ` …and ${execution.probeFailuresTruncated} more` : ""}`] : []),
						...execution.guidance.map((item) => `  → ${item}`),
					]),
					...d.launchRefusals.map((refusal) => `launch refusal ${refusal.executionId} [${refusal.kind}] code=${refusal.code}: ${refusal.reason}; original=${JSON.stringify(refusal.originalEnvelope)} request=${JSON.stringify(refusal.requestBudget)}`),
					...d.guidance.map((item) => `→ ${item}`),
					...(d.truncated ? [`… diagnostics truncated; pass executionId to narrow the query`] : []),
				];
				// A fixed total cap bounds the rendered text; truncation is
				// disclosed and a narrower query recovers the detail.
				let text = lines.join("\n");
				if (text.length > MAX_TASK_DIAGNOSTICS_TEXT_CHARS) {
					text = `${text.slice(0, MAX_TASK_DIAGNOSTICS_TEXT_CHARS)}\n… diagnostics output truncated at ${MAX_TASK_DIAGNOSTICS_TEXT_CHARS} chars; pass executionId to narrow the query`;
					d.truncated = true;
				}
				return {
					content: [{ type: "text", text }],
					details: { diagnostics: d },
				};
			}
			const tasks = orchestrator.listLiveTasks(cwd);
			const text = tasks.length === 0
				? `planner_tasks: No live Tasks in ${cwd}. planner_delegate mints a new one.`
				: [
					`planner_tasks: ${tasks.length} live Task(s) in ${cwd}:`,
					...tasks.map((task) =>
						`${task.taskId} | ${task.state} | ${task.role}${task.recoveryRequired ? " | recovery required" : ""} | ${task.objective ?? "(no spec)"}`),
				].join("\n");
			return {
				content: [{ type: "text", text }],
				details: { tasks },
			};
		},
	});

	registerRootTool({
		name: "planner_verdict",
		label: "Planner Verdict",
		description: [
			"Record Root's review verdict for a planner-only task: pass, request_changes, or blocked.",
			"A pass re-samples the workspace at the acceptance boundary; stale evidence turns it into revalidate.",
			"None of the three verdicts carries a recovery decision; abandoning an abnormal execution flagged recovery.required goes through planner_abort.",
		].join(" "),
		promptSnippet: "planner_verdict: record the root review verdict (pass | request_changes | blocked) for a task — no recovery key",
		promptGuidelines: [
			"After verifying the WorkerReport and evidence, record the verdict with planner_verdict; the slash command is the operator's override, not yours.",
			"request_changes should carry findings so the correction guidance names what to fix.",
			"Omit recovery entirely — there is no such key on this tool; pass, request_changes, and blocked are plain verdicts. To abandon an abnormal execution on a Task flagged recovery.required, call planner_abort.",
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
		async execute(toolCallId, params: {
			verdict: ReviewVerdict;
			summary: string;
			taskId?: string;
			findings?: ReviewFinding[];
			acknowledgeDrift?: DriftAcknowledgement;
			recovery?: unknown;
		}, _signal, _onUpdate, ctx: ExtensionContext) {
			return withRefusalBreaker("planner_verdict", toolCallId, params, ctx, async () => {
			// ADR-0003 — a passthrough recovery key on a non-validating host is
			//    stripped and disclosed, never refused: refusing recreated the
			//    replay loop this split exists to end (same shape as the
			//    ADR-0002 taskId strip on planner_delegate).
			const stripWarnings: string[] = [];
			if (params.recovery !== undefined) {
				stripWarnings.push("recovery is not a planner_verdict key and was ignored — to abandon an abnormal execution flagged recovery.required, call planner_abort");
			}
			// Ticket 49 — the target resolves through the same ledger-aware lookup the
			// delegation path uses, so a Task beyond the session restore cap can still be
			// addressed by id. An explicit id never falls back to another Task.
			const verdictResolution = params.taskId
				? orchestrator.resolveVerdictTask(params.taskId, ctx.cwd || process.cwd())
				: undefined;
			const task = params.taskId ? verdictResolution?.task : orchestrator.store.active();
			const missNote = verdictResolution?.note;
			if (!task) {
				throw Object.assign(new Error(
					[
						params.taskId
							? `planner_verdict: unknown task ${params.taskId}.${missNote ? ` ${missNote}.` : ""}`
							: "planner_verdict: no active planner-only task.",
						'Usage: planner_verdict({ verdict: "pass" | "request_changes" | "blocked", summary, taskId?, findings? }).',
					].join(" "),
				), { code: "TASK_NOT_FOUND" });
			}
			latestCtx = ctx;
			const refusal = orchestrator.rootVerdictRefusal(task, params.verdict);
			if (refusal) {
				orchestrator.recordRootVerdictRefusal(task, params.verdict, refusal);
				throw Object.assign(new Error(`planner_verdict refused (${refusal.kind}, task=${task.taskId}, verdict=${params.verdict}): ${refusal.reason}`), { code: `VERDICT_${refusal.kind.toUpperCase().replaceAll("-", "_")}`, taskId: task.taskId });
			}
			try {
				const before = task.state;
				const outcome = await orchestrator.recordRootVerdict(task, params.verdict, params.summary, {
					...(params.findings ? { findings: params.findings } : {}),
					...(params.acknowledgeDrift ? { acknowledgeDrift: params.acknowledgeDrift } : {}),
					source: "root",
				});
				const request = requestFor(ctx);
				const family = reviewFailureFamily(outcome.decision);
				if (family) {
					const execution = task.executions.find(e => !e.auxiliary && e.reportIndex === task.reports.length - 1);
					request.observeFailure({ id: `tool:${toolCallId}`, family, taskId: task.taskId,
						...(execution ? { executionId: execution.executionId } : {}) });
				}
				recordAcceptance(request, outcome.task.taskId);
				let text = orchestrator.renderDecisionBlock(orchestrator.store.require(task.taskId), outcome.decision, outcome.evidence);
				text = enrichDecisionText(text, outcome.task.taskId);
				for (const warning of stripWarnings) text = `${text}\nwarning: ${warning}`;
				recordInjectedText(outcome.task.taskId, text);
				persistSessionEntries();
				await flushIfTerminal(outcome.task.taskId, before, ctx);
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
						warnings: stripWarnings,
					},
				};
			} catch (error) {
				throw Object.assign(new Error(
					`planner_verdict refused (store-error, task=${task.taskId}, verdict=${params.verdict}): ${error instanceof Error ? error.message : String(error)}`,
				), { code: "STORE_ERROR", taskId: task.taskId });
			}
			});
		},
	});

	// ADR-0003 — abandoning an abnormal execution is its own tool surface:
	// planner_verdict has no recovery key at all, so the "verdict plus maybe
	// recovery" combination is inexpressible. planner_abort is the blocked
	// verdict + abort RecoveryDecision as one atomic call — no `action` field
	// exists because the tool's identity is the action.
	registerRootTool({
		name: "planner_abort",
		label: "Planner Abort",
		description: [
			"Abandon a blocked Task's abnormal execution: records a blocked verdict and consumes the recovery.required flag in one call, leaving the Task for operator handling.",
			"Only admissible while the Task flags recovery.required. executionId is the abnormal execution's details.executionId — never a child runId.",
		].join(" "),
		promptSnippet: "planner_abort: abandon a blocked Task's abnormal execution — blocked verdict + consume recovery.required",
		promptGuidelines: [
			"Use planner_abort only on a Task flagged recovery.required when Root decides against re-executing; to keep working, re-enter with planner_redelegate and a retry_same_plan / fix_environment recovery decision instead.",
			"executionId is the abnormal execution's details.executionId (the toolCallId that ran it) — never a child runId.",
			"worktreeDecision=manual releases the persisted writer hold only after the operator resolved the unconfirmed stop; otherwise keep.",
		],
		parameters: Type.Object({
			taskId: Type.String({ minLength: 1, description: "Canonical Task id, verbatim from a prior planner_delegate result's details.taskId." }),
			executionId: Type.String({ minLength: 1, description: "The abnormal execution's details.executionId — not a child runId." }),
			reason: Type.String({ minLength: 1, description: "Concrete basis for abandoning instead of recovering." }),
			worktreeDecision: Type.Union([Type.Literal("keep"), Type.Literal("manual")], {
				description: "keep leaves the workspace reserved; manual releases the writer hold after operator resolution.",
			}),
			evidenceRefs: Type.Optional(Type.Array(Type.String())),
			summary: Type.Optional(Type.String({ maxLength: 2000, description: "Verdict summary; derived from reason when omitted." })),
		}),
		async execute(toolCallId, params: {
			taskId: string;
			executionId: string;
			reason: string;
			worktreeDecision: "keep" | "manual";
			evidenceRefs?: string[];
			summary?: string;
		}, _signal, _onUpdate, ctx: ExtensionContext) {
			return withRefusalBreaker("planner_abort", toolCallId, params, ctx, async () => {
			const abortResolution = orchestrator.resolveVerdictTask(params.taskId, ctx.cwd || process.cwd());
			const task = abortResolution.task;
			if (!task) {
				throw new Error(
					[
						`planner_abort: unknown task ${params.taskId}.${abortResolution.note ? ` ${abortResolution.note}.` : ""}`,
						"Usage: planner_abort({ taskId, executionId, reason, worktreeDecision }) — executionId is details.executionId of the abnormal execution, not a child runId.",
					].join(" "),
				);
			}
			latestCtx = ctx;
			const refusal = orchestrator.rootVerdictRefusal(task, "blocked");
			if (refusal) {
				orchestrator.recordRootVerdictRefusal(task, "blocked", refusal);
				throw new Error(`planner_abort refused (${refusal.kind}, task=${task.taskId}): ${refusal.reason}`);
			}
			const decision: RecoveryDecision = {
				executionId: params.executionId,
				action: "abort",
				reason: params.reason,
				worktreeDecision: params.worktreeDecision,
				...(params.evidenceRefs ? { evidenceRefs: params.evidenceRefs } : {}),
			};
			const recoveryRefusal = validateRecoveryDecision(task, decision, ABORT_RECOVERY_ACTIONS);
			if (recoveryRefusal) {
				orchestrator.store.recordVerdictRefusal(task.taskId, {
					taskId: task.taskId,
					requestedVerdict: "blocked",
					kind: "recovery-invalid",
					reason: recoveryRefusal,
					executionId: params.executionId,
				});
				throw new Error(
					`planner_abort refused (recovery, task=${task.taskId}): ${recoveryRefusal}.`
					+ ` received executionId=${params.executionId}; Task state=${task.state},`
					+ ` recovery.required=${task.recovery?.required === true}, consumedBy=${task.recovery?.consumedBy ?? "none"}.`
					+ " If this Task needs no recovery, record the verdict with planner_verdict or re-enter with planner_redelegate — executionId is details.executionId of the abnormal execution, not a child runId.",
				);
			}
			try {
				const before = task.state;
				const summary = (params.summary ?? `Abandoned abnormal execution ${params.executionId}: ${params.reason}`).slice(0, 2000);
				const outcome = await orchestrator.recordRootVerdict(task, "blocked", summary, { source: "root" });
				orchestrator.store.consumeRecovery(task.taskId, decision, "planner_abort", "abort");
				if (params.worktreeDecision === "manual") orchestrator.resolveWriterHold(task.taskId);
				let text = orchestrator.renderDecisionBlock(orchestrator.store.require(task.taskId), outcome.decision, outcome.evidence);
				text = enrichDecisionText(text, outcome.task.taskId);
				recordInjectedText(outcome.task.taskId, text);
				persistSessionEntries();
				await flushIfTerminal(outcome.task.taskId, before, ctx);
				return {
					content: [{
						type: "text",
						text,
					}],
					details: {
						taskId: outcome.task.taskId,
						verdict: "blocked",
						action: outcome.decision.action,
						state: outcome.task.state,
						round: outcome.task.reviewRound,
						recovery: { action: "abort", consumedBy: "planner_abort" },
					},
				};
			} catch (error) {
				throw Object.assign(new Error(
					`planner_abort refused (store-error, task=${task.taskId}): ${error instanceof Error ? error.message : String(error)}`,
				), { code: "STORE_ERROR", taskId: task.taskId });
			}
			});
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		latestCtx = ctx;
		requestFor(ctx);
		refusalBreaker.reset();
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
		for (const request of requests.values()) {
			if (request.snapshot().claims.some(c => !c.waitSettled)) request.close("session-shutdown");
			request.dispose();
		}
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

	pi.on("input", async (event, ctx) => {
		latestCtx = ctx;
		if (requestFor(ctx).input(event.source, event.streamingBehavior, ctx.isIdle?.() === true)) refusalBreaker.reset();
	});
	pi.on("agent_start", async (_event, ctx) => { requestFor(ctx).rootActive(); });
	pi.on("agent_settled", async (_event, ctx) => { requestFor(ctx).settle(); });
	pi.on("before_provider_request", async (_event, ctx) => { requestFor(ctx).modelCall(); });
	pi.on("before_agent_start", async (event, ctx) => {
		latestCtx = ctx;
		try { requestFor(ctx).activity(); } catch { requestFor(ctx).close(requestFor(ctx).snapshot().closedReason ?? "request-closed"); }
		if (isDisabled()) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${PLANNER_PROMPT}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		// R02 — the adapter derives the gather phase from the store for this
		// workspace; PolicyInput always carries it (a store read cannot fail in
		// memory, and a failure would read as Idle: fail closed).
		const policyCwd = ctx?.cwd || process.cwd();
		latestCtx = ctx;
		const request = requestFor(ctx);
		toolOwners.set(event.toolCallId, { request, requestId: request.requestId });
		try { request.attempt(event.toolCallId, event.toolName); }
		catch (error) { request.endTool(event.toolCallId); return { block: true, terminate: true, reason: error instanceof Error ? error.message : String(error) }; }
		const refuse = (reason: string, family: string) => {
			request.observeFailure({ id: `tool:${event.toolCallId}`, family });
			request.endTool(event.toolCallId);
			return { block: true, reason, ...(request.snapshot().closedReason ? { terminate: true } : {}) };
		};
		if (!IS_SUBAGENT && !isDisabled() && event.toolName === "read") {
			const input = event.input && typeof event.input === "object" ? event.input as Record<string, unknown> : undefined;
			if (input) Object.assign(input, applyRootReadCeiling(input));
			const readNotice = rootReadLimitNotice(input);
			if (readNotice) {
				if (ctx.hasUI) ctx.ui.notify(readNotice, "warning");
				return refuse(readNotice, "contract:read:ceiling");
			}
		}
		// Ticket 16 — an identical call already refused HARD_STOP_AT times is
		// intercepted before it can execute again; attribution never sees it.
		if (!IS_SUBAGENT && ROOT_TOOLS.has(event.toolName)) {
			const breakerBlock = refusalBreaker.shouldBlock(event.toolName, event.input);
			if (breakerBlock.block) {
				if (ctx.hasUI) ctx.ui.notify(`Blocked parent tool: ${event.toolName} (repeated identical refusal)`, "warning");
				return refuse(breakerBlock.reason, "contract:repeated-refusal");
			}
		}
		if (!IS_SUBAGENT && ["subagent", "bg_wait", "planner_verdict", "planner_abort", "git_audit", "planner_delegate", "planner_redelegate", "planner_tasks"].includes(event.toolName)) {
			rootTurnToolCallIds.add(event.toolCallId);
			const input = asRecord(event.input);
			// Only binding surfaces carry a meaningful taskId — planner_delegate
			// ignores a passthrough taskId entirely, so it must not attribute.
			if ((event.toolName === "planner_verdict" || event.toolName === "planner_redelegate" || event.toolName === "planner_abort") && typeof input?.taskId === "string") {
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
		return refuse(decision.reason ?? "planner-only policy refused this tool", `policy:${event.toolName}`);
	});

	pi.on("tool_result", async (event, ctx) => {
		const owner = toolOwners.get(event.toolCallId);
		const request = owner?.request ?? requestFor(ctx);
		if (event.isError) request.observeFailure({ id: `tool:${event.toolCallId}`, family: owner?.failureFamily ?? "unknown-failure" }, owner?.requestId);
		request.endTool(event.toolCallId, owner?.requestId);
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
		// The host can reject unknown tools or malformed arguments before its
		// tool_call hook. Observe the public structured message as a fallback;
		// the normal hook/execute path deduplicates by the same call identity.
		const structured = event.message as { role?: string; content?: unknown; toolCallId?: string; isError?: boolean };
		if (structured.role === "assistant" && Array.isArray(structured.content)) {
			const request = requestFor(ctx);
			for (const block of structured.content) {
				if (block?.type !== "toolCall" || typeof block.id !== "string" || typeof block.name !== "string") continue;
				toolOwners.set(block.id, { request, requestId: request.requestId });
				try {
					request.attempt(block.id, block.name);
					const schema = rootToolSchemas.get(block.name);
					if (schema) {
						const issues = structuralIssues(schema, block.arguments);
						request.structure(block.name, issues);
						if (issues.length) toolOwners.get(block.id)!.failureFamily = requestErrorFamily(block.name, { code: "ARGUMENTS_INVALID" });
					}
				}
				catch { break; }
			}
		} else if (structured.role === "toolResult" && typeof structured.toolCallId === "string") {
			const owner = toolOwners.get(structured.toolCallId);
			if (owner) {
				if (structured.isError) owner.request.observeFailure({ id: `tool:${structured.toolCallId}`, family: owner.failureFamily ?? "unknown-failure" }, owner.requestId);
				owner.request.endTool(structured.toolCallId, owner.requestId);
			}
		}
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
			if (action === "request") {
				const request = requestFor(ctx);
				const operation = parts[1] ?? "status";
				if (operation === "resume" && parts.length === 2) {
					// Command contexts expose no input source. Extensions can ask the
					// host to expand slash commands, so command text alone is not proof
					// of operator intent. Require the public human UI confirmation.
					if (!ctx.hasUI || typeof ctx.ui.confirm !== "function") {
						notify(ctx, "Request resume requires an operator confirmation UI; this host cannot prove command provenance. Admission remains closed.", "warning");
						return;
					}
					if (!ctx.isIdle() || !(await ctx.ui.confirm("Resume planner request?", "Open a fresh request budget. Existing unconfirmed Writer holds remain."))) return;
					if (request.resume(ctx.isIdle())) refusalBreaker.reset();
					else notify(ctx, "Request could not resume: active calls or invalid persisted state must be resolved first.", "warning");
				} else if (operation !== "status" || parts.length > 2) {
					notify(ctx, "Usage: /planner-only request status | /planner-only request resume", "warning");
					return;
				}
				notify(ctx, request.render());
				return;
			}

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
					requestFor(ctx).render(),
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
				recordAcceptance(requestFor(ctx), outcome.task.taskId);
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
