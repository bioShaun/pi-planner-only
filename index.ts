import { existsSync } from "node:fs";
import { appendFile, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	ROOT_TOOLS,
	ORCHESTRATION_TOOLS,
	READ_ONLY_TOOLS,
	decidePolicy,
} from "./policy.ts";
import { GIT_AUDIT_OPERATIONS, runGitAudit } from "./git-audit.ts";
import type { GitAuditRequest, GitRunner } from "./git-audit.ts";
import { PlannerOrchestrator, compositeWorkflowBlockReason, isDelegationCall } from "./orchestrate.ts";
import type { DelegationRecord } from "./orchestrate.ts";
import { parseSubagentNotify, readChildMeta, tempRootFromAsyncDir } from "./notify.ts";
import { MAX_REVIEW_ROUNDS, WORKER_REPORT_VERSION, isTerminalTaskState } from "./types.ts";
import type { ChildUsage, DelegationKind, ReviewFinding, ReviewMode, ReviewVerdict, TaskState } from "./types.ts";
import {
	UsageLedger,
	childUsageFromValue,
	emptyTaskUsage,
	loadPricingTable,
	lookupRates,
	renderUsage,
	renderUsageLine,
} from "./usage.ts";
import type { PiUsageLike, UsageEntry } from "./usage.ts";

const AGENT_DIR = process.env.PI_CODING_AGENT_DIR
	? resolve(process.env.PI_CODING_AGENT_DIR)
	: join(homedir(), ".pi", "agent");
const OFF_MARKER = join(AGENT_DIR, "planner-only.off");
const STATUS_KEY = "planner-only";
const IS_SUBAGENT = process.env.PI_SUBAGENT_CHILD === "1";
const PLANNER_SAFE_TOOLS = new Set([
	...READ_ONLY_TOOLS,
	...ORCHESTRATION_TOOLS,
	...ROOT_TOOLS,
	"subagent",
]);

const GIT_TIMEOUT_MS = 15_000;

export const PLANNER_PROMPT = `[PLANNER-ONLY MODE]

You are the root orchestrator.

You may:
- plan
- delegate
- inspect using read-only tools
- review
- arbitrate

You may not:
- edit files
- write files
- execute general shell commands
- implement fixes directly

For executable work, create a bounded TaskSpec and delegate it through subagent.
Embed the full TaskSpec JSON in the task prompt so the worker can echo back its
taskId:

  {"taskId":"T-YYYYMMDD-NNN","objective":"...","cwd":"...","role":"worker",
   "scope":{},"constraints":[],"acceptanceCriteria":[],
   "validation":{"required":true,"commands":[]},
   "expectedEvidence":{"changedFiles":true,"tests":true},
   "stopConditions":[]}

Every worker must return a WorkerReport containing:
- version: ${WORKER_REPORT_VERSION}
- taskId
- status: completed | partial | blocked | failed
- concise summary
- changedFiles
- validation entries with type, status, exit codes
- evidence reference
- risks
- unresolved items

Before accepting work:
1. verify WorkerReport task identity
2. verify evidence freshness
3. inspect relevant files and git state with read/grep/find/ls/git_audit
4. evaluate acceptance criteria
5. record PASS, REQUEST_CHANGES, or BLOCKED with planner_verdict

Role in TaskSpec is enforced at launch: explorer/reviewer remap to the builtin reviewer agent (read/grep/find/ls), validator remaps to oracle (bash, no edits), worker keeps its agent. Reviewer children always start with context=fresh and a bounded packet — never a fork of this session.

Do not pre-compose worker→reviewer as a workflowScript, tasks array, or chain.
Each subagent call may carry only one lifecycle invocation: a direct {agent, task}.
Call the reviewer only after the worker returns, in a separate direct call, so it
receives the latest TaskSpec, WorkerReport, and Root Git evidence.

Use git_audit for read-only git inspection. It is the only git access you have.
Never trust a worker that reports its own PASS; inspect the evidence yourself.
Stale evidence must not be accepted: re-delegate validation instead.

Never fix rejected work yourself. Delegate a bounded correction.
Stop automatic correction after ${MAX_REVIEW_ROUNDS} review rounds; the loop
reports blocked and asks the user how to proceed.

Use /planner-only task to inspect lifecycle state. /planner-only review is the operator's override; you record verdicts with planner_verdict.`;

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

const SUBAGENT_NOTIFY_TYPE = "subagent-notify";

function isSubagentNotifyMessage(message: unknown): boolean {
	if (!message || typeof message !== "object") return false;
	const value = message as { role?: unknown; customType?: unknown };
	return value.role === "custom" && value.customType === SUBAGENT_NOTIFY_TYPE;
}

function customMessageText(message: unknown): string {
	if (!message || typeof message !== "object") return "";
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part): part is { type: string; text?: string } =>
			Boolean(part && typeof part === "object" && (part as { type?: string }).type === "text"))
		.map((part) => (typeof part.text === "string" ? part.text : ""))
		.join("\n");
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

export function restorePlannerTools(
	activeTools: readonly string[],
	suppressedTools: readonly string[],
): string[] {
	return [...new Set([...activeTools, ...suppressedTools])];
}

function sameToolOrder(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((name, index) => name === right[index]);
}

export default function plannerOnly(pi: ExtensionAPI): void {
	// Foreground children do not load ambient extensions. Background children
	// may; this extension no-ops when PI_SUBAGENT_CHILD=1 so it cannot
	// recurse into a child that loaded it. Workers must retain their
	// configured tool access.
	if (IS_SUBAGENT) return;

	const gitRunner: GitRunner = async (args, cwd) => {
		const result = await pi.exec("git", [...args], { cwd, timeout: GIT_TIMEOUT_MS });
		return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", code: result.code };
	};

	const orchestrator = new PlannerOrchestrator({ gitRunner });
	let pricing = loadPricingTable();
	let ledger = new UsageLedger({ pricing });
	const allSessionEntries: UsageEntry[] = [];
	let usageLogWriteFailed = false;

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
		const targetId = taskId || text.match(/\btaskId:\s*(T-\d{8}-\d{3})\b/)?.[1];
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
			const warningLine = "warning: Root is reading the diff itself; consider /planner-only review fresh";
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

	function artifactDirsFor(ctx: ExtensionContext, asyncDir?: string): string[] {
		const dirs: string[] = [];
		const sessionFile = sessionFileOf(ctx);
		if (sessionFile) dirs.push(join(dirname(sessionFile), "subagent-artifacts"));
		if (asyncDir) {
			const root = tempRootFromAsyncDir(asyncDir);
			if (root) dirs.push(join(root, "artifacts"));
		}
		dirs.push(join(ctx.cwd || process.cwd(), ".pi", "subagents", "artifacts"));
		return dirs;
	}

	function usageLogPath(): string | undefined {
		const override = process.env.PI_PLANNER_ONLY_USAGE_LOG;
		if (override === "0") return undefined;
		if (override && override.trim()) return override;
		return join(AGENT_DIR, "planner-only", "usage.jsonl");
	}

	function pendingChild(kind: DelegationKind, ids: { runId?: string; agent?: string; toolCallId?: string }): ChildUsage {
		return {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			kind,
			pending: true,
			source: "unavailable",
			...(ids.runId ? { runId: ids.runId } : {}),
			...(ids.agent ? { agent: ids.agent } : {}),
			...(ids.toolCallId ? { toolCallId: ids.toolCallId } : {}),
		};
	}

	function syncUsage(taskId?: string): void {
		if (!taskId) return;
		const usage = ledger.taskUsage(taskId);
		const task = orchestrator.store.get(taskId);
		if (usage && task) task.usage = usage;
	}

	function resolveTaskPending(taskId: string, ctx: ExtensionContext, asyncDir?: string): void {
		ledger.resolvePending(taskId, (child) => {
			if (!child.runId) return undefined;
			const agents = [child.agent].filter((name): name is string => Boolean(name));
			for (const agent of agents) {
				const meta = readChildMeta(artifactDirsFor(ctx, asyncDir), child.runId, agent);
				if (!meta) continue;
				return childUsageFromValue(meta.usage, child.kind, {
					runId: child.runId,
					agent: meta.agent,
					...(meta.model ? { model: meta.model } : {}),
					source: "meta-file",
					pending: false,
				});
			}
			return undefined;
		});
		syncUsage(taskId);
	}

	async function writeUsageLog(taskId: string, ctx: ExtensionContext): Promise<void> {
		const path = usageLogPath();
		if (!path) return;
		const task = orchestrator.store.get(taskId);
		const usage = ledger.taskUsage(taskId);
		if (!task || !usage) return;
		const line = {
			...usage,
			taskId: task.taskId,
			cwd: task.cwd,
			state: task.state,
			rounds: task.reviewRound,
			rootModel: usage.rootModel,
			finishedAt: new Date().toISOString(),
			sessionFile: sessionFileOf(ctx),
		};
		try {
			await mkdir(dirname(path), { recursive: true });
			await appendFile(path, `${JSON.stringify(line)}\n`, "utf8");
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
		asyncDir?: string,
	): Promise<void> {
		if (!taskId) return;
		const after = orchestrator.store.get(taskId);
		if (!after || !isTerminalTaskState(after.state)) return;
		if (before !== undefined && isTerminalTaskState(before)) return;
		resolveTaskPending(taskId, ctx, asyncDir);
		persistSessionEntries();
		await writeUsageLog(taskId, ctx);
	}

	function recordSyncChildren(event: { toolCallId: string; details?: unknown }, delegation: DelegationRecord): void {
		const details = asRecord(event.details);
		const results = details && Array.isArray(details.results) ? details.results : [];
		for (const item of results) {
			const rec = asRecord(item);
			if (!rec) continue;
			const child = childUsageFromValue(rec.usage, delegation.kind, {
				toolCallId: event.toolCallId,
				source: "sync-details",
				pending: false,
				...(typeof rec.agent === "string" ? { agent: rec.agent } : delegation.agent ? { agent: delegation.agent } : {}),
				...(typeof rec.model === "string" ? { model: rec.model } : {}),
			});
			if (child) ledger.recordChild(delegation.taskId, child);
		}
		if (results.length === 0) return;
		syncUsage(delegation.taskId);
	}

	function recordBgWaitChildren(event: { details?: unknown }): void {
		const details = asRecord(event.details);
		const completions = details && Array.isArray(details.completions) ? details.completions : [];
		const pending = orchestrator.listDelegations();
		for (const raw of completions) {
			const completion = asRecord(raw);
			if (!completion) continue;
			const runId = typeof completion.runId === "string" ? completion.runId : undefined;
			if (!runId) continue;
			const found = pending.find((item) => item.record.runId === runId);
			if (!found) continue;
			const results = Array.isArray(completion.results) ? completion.results : [];
			for (const item of results) {
				const rec = asRecord(item);
				const usageValue = rec?.usage ?? rec;
				const child = childUsageFromValue(usageValue, found.record.kind, {
					runId,
					source: "bg-wait",
					pending: false,
					...(typeof completion.agent === "string" ? { agent: completion.agent }
						: found.record.agent ? { agent: found.record.agent } : {}),
					...(typeof rec?.model === "string" ? { model: rec.model } : {}),
				});
				if (child) ledger.recordChild(found.record.taskId, child);
			}
			syncUsage(found.record.taskId);
		}
	}

	function recordAsyncChild(record: DelegationRecord, ctx: ExtensionContext, notifyAgent?: string): void {
		const agent = notifyAgent || record.agent;
		const runId = record.runId;
		if (!runId) {
			ledger.recordChild(record.taskId, pendingChild(record.kind, { agent, toolCallId: undefined }));
			syncUsage(record.taskId);
			return;
		}
		const agents = [...new Set([agent, record.agent].filter((name): name is string => Boolean(name)))];
		for (const name of agents.length ? agents : ["worker"]) {
			const meta = readChildMeta(artifactDirsFor(ctx, record.asyncDir), runId, name);
			if (!meta) continue;
			const child = childUsageFromValue(meta.usage, record.kind, {
				runId,
				agent: meta.agent,
				...(meta.model ? { model: meta.model } : {}),
				source: "meta-file",
				pending: false,
			});
			if (child) {
				ledger.recordChild(record.taskId, child);
				syncUsage(record.taskId);
				return;
			}
		}
		ledger.recordChild(record.taskId, pendingChild(record.kind, { runId, agent: agent || record.agent }));
		syncUsage(record.taskId);
	}

	function recordInjectedText(taskId: string | undefined, text: string): void {
		if (!taskId || !text) return;
		ledger.recordInjected(taskId, Buffer.byteLength(text));
		syncUsage(taskId);
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
				records.push(uEntry);
				allSessionEntries.push(uEntry);
			}
		}
		ledger.load(records);
	}

	let suppressedTools: string[] = [];

	const restrictActiveTools = (): void => {
		if (isDisabled()) return;
		const activeTools = pi.getActiveTools();
		suppressedTools = [...new Set([
			...suppressedTools,
			...activeTools.filter((name) => !PLANNER_SAFE_TOOLS.has(name)),
		])];
		const nextTools = filterPlannerTools(activeTools);
		if (!sameToolOrder(activeTools, nextTools)) pi.setActiveTools(nextTools);
	};

	const restoreSuppressedTools = (): void => {
		if (suppressedTools.length === 0) return;
		const activeTools = pi.getActiveTools();
		const nextTools = restorePlannerTools(activeTools, suppressedTools);
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
		}),
		async execute(_toolCallId, params: {
			verdict: ReviewVerdict;
			summary: string;
			taskId?: string;
			findings?: ReviewFinding[];
		}, _signal, _onUpdate, _ctx: ExtensionContext) {
			const task = params.taskId
				? orchestrator.store.get(params.taskId)
				: orchestrator.store.active();
			if (!task) {
				return {
					content: [{
						type: "text",
						text: [
							params.taskId
								? `planner_verdict: unknown task ${params.taskId}.`
								: "planner_verdict: no active planner-only task.",
							'Usage: planner_verdict({ verdict: "pass" | "request_changes" | "blocked", summary, taskId?, findings? }).',
						].join(" "),
					}],
					details: { refused: "unknown-task" },
					isError: true,
				};
			}
			const refusal = orchestrator.rootVerdictRefusal(task, params.verdict);
			if (refusal) {
				return {
					content: [{ type: "text", text: `planner_verdict refused: ${refusal}` }],
					details: { refused: "lifecycle", taskId: task.taskId, verdict: params.verdict },
					isError: true,
				};
			}
			try {
				const before = task.state;
				const outcome = await orchestrator.recordRootVerdict(task, params.verdict, params.summary, {
					...(params.findings ? { findings: params.findings } : {}),
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
				return {
					content: [{
						type: "text",
						text: `planner_verdict refused: ${error instanceof Error ? error.message : String(error)}`,
					}],
					details: { refused: "store-error", taskId: task.taskId, verdict: params.verdict },
					isError: true,
				};
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		restrictActiveTools();
		updateStatus(ctx);
		loadSessionUsage(ctx);
	});

	pi.on("session_shutdown", async () => {
		// A reload tears down this instance before the replacement session starts.
		// Restore its snapshot so the replacement can capture the complete set.
		restoreSuppressedTools();
	});

	pi.on("before_agent_start", async (event) => {
		if (isDisabled()) return;
		restrictActiveTools();
		return { systemPrompt: `${event.systemPrompt}\n\n${PLANNER_PROMPT}` };
	});

	pi.on("tool_call", async (event, ctx) => {
		const decision = decidePolicy({
			toolName: event.toolName,
			input: event.input,
			isChild: IS_SUBAGENT,
			disabled: isDisabled(),
		});
		if (!decision.block) {
			if (event.toolName === "subagent" && !isDisabled() && isDelegationCall(event.input)) {
				const composite = compositeWorkflowBlockReason(event.input);
				if (composite) {
					if (ctx.hasUI) ctx.ui.notify("Blocked composite subagent workflow", "warning");
					return { block: true, reason: composite };
				}
				await orchestrator.prepareRoleDelegation(event.input);
				const outcome = await orchestrator.beginDelegation(event, ctx.cwd || process.cwd());
				if (outcome.block) {
					if (ctx.hasUI) ctx.ui.notify("Blocked unstructured delegation", "warning");
					return { block: true, reason: outcome.block.reason };
				}
				if (outcome.conflict?.conflict) {
					if (ctx.hasUI) ctx.ui.notify("Blocked concurrent writer for this cwd", "warning");
					return { block: true, reason: outcome.conflict.reason as string };
				}
				for (const warning of outcome.warnings ?? []) {
					if (ctx.hasUI) ctx.ui.notify(warning, "warning");
				}
			}
			return;
		}
		if (ctx.hasUI) ctx.ui.notify(`Blocked parent tool: ${event.toolName}`, "warning");
		return { block: true, reason: decision.reason };
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isDisabled()) return;
		const host = ctx ?? ({ hasUI: false, cwd: process.cwd() } as ExtensionContext);
		if (event.toolName === "bg_wait") {
			recordBgWaitChildren(event);
			persistSessionEntries();
			return;
		}
		if (REVIEW_LEAK_TOOLS.has(event.toolName)) {
			const active = orchestrator.store.active();
			if (active && (active.state === "reviewing" || active.state === "changes_requested")) {
				ledger.recordReviewLeak(active.taskId, Buffer.byteLength(contentText(event.content)));
				syncUsage(active.taskId);
				persistSessionEntries();
			}
			return;
		}
		if (event.toolName !== "subagent") return;
		const delegation = orchestrator.getDelegation(event.toolCallId);
		const before = delegation ? orchestrator.store.get(delegation.taskId)?.state : undefined;
		const result = await orchestrator.handleSubagentResult({
			toolCallId: event.toolCallId,
			toolName: event.toolName,
			input: event.input,
			content: event.content,
			details: event.details,
			isError: event.isError,
		});
		if (delegation) {
			recordSyncChildren(event, delegation);
			let text = result?.content?.[0]?.text ?? "";
			if (text && !text.includes("has started") && !text.includes("failed to launch")) {
				text = enrichDecisionText(text, delegation.taskId);
				if (result?.content?.[0]) {
					result.content[0].text = text;
				}
				recordInjectedText(delegation.taskId, text);
			}
			persistSessionEntries();
			await flushIfTerminal(delegation.taskId, before, host, typeof asRecord(event.details)?.asyncDir === "string" ? asRecord(event.details)?.asyncDir as string : undefined);
		}
		return result;
	});

	pi.on("message_end", async (event, ctx) => {
		if (isDisabled()) return;
		const host = ctx ?? ({ hasUI: false, cwd: process.cwd() } as ExtensionContext);
		const message = event.message as {
			role?: string;
			model?: string;
			provider?: string;
			usage?: PiUsageLike;
			id?: string;
		};
		if (message.role === "assistant") {
			const active = orchestrator.store.active();
			ledger.recordRootTurn({
				usage: message.usage ?? {},
				...(active ? { taskId: active.taskId, state: active.state } : {}),
				...(message.model ? { model: message.model } : {}),
				...(message.provider ? { provider: message.provider } : {}),
				...(message.id ? { messageId: message.id } : {}),
			});
			if (active) syncUsage(active.taskId);
			persistSessionEntries();
		}
		if (!isSubagentNotifyMessage(event.message)) return;
		const snapshot = orchestrator.listDelegations();
		const notifyText = customMessageText(event.message);
		const parsed = parseSubagentNotify(notifyText);
		const beforeByTask = new Map<string, TaskState>();
		for (const item of snapshot) {
			const state = orchestrator.store.get(item.record.taskId)?.state;
			if (state) beforeByTask.set(item.record.taskId, state);
		}
		const outcome = await orchestrator.handleAsyncNotify(notifyText);
		const remaining = new Set(orchestrator.listDelegations().map((item) => item.toolCallId));
		for (const item of snapshot) {
			if (remaining.has(item.toolCallId)) continue;
			recordAsyncChild(item.record, host, parsed?.agent);
			let text = outcome?.content[0]?.text ?? "";
			if (text) {
				text = enrichDecisionText(text, item.record.taskId);
				if (outcome?.content[0]) {
					outcome.content[0].text = text;
				}
				recordInjectedText(item.record.taskId, text);
			}
			persistSessionEntries();
			await flushIfTerminal(item.record.taskId, beforeByTask.get(item.record.taskId), host, item.record.asyncDir);
		}
		if (!outcome) return;
		return { message: { ...event.message, content: outcome.content[0]?.text ?? "" } as typeof event.message };
	});

	pi.on("context", async (event) => {
		if (isDisabled()) return;
		const seen = new Set<string>();
		let changed = false;
		const next = [];
		for (const entry of event.messages) {
			if (!isSubagentNotifyMessage(entry)) {
				next.push(entry);
				continue;
			}
			const text = customMessageText(entry);
			const parsed = parseSubagentNotify(text);
			const runIds = parsed?.runIds ?? [];
			if (runIds.length > 0 && runIds.every((id) => seen.has(id))) {
				next.push(entry);
				continue;
			}
			const outcome = await orchestrator.handleAsyncNotify(text);
			if (!outcome) {
				next.push(entry);
				continue;
			}
			let content = outcome.content[0]?.text ?? "";
			content = enrichDecisionText(content);
			for (const id of runIds) seen.add(id);
			next.push({ ...entry, content } as typeof entry);
			changed = true;
		}
		if (changed) return { messages: next };
	});

	const notify = (ctx: ExtensionContext, message: string, type: "info" | "warning" = "info"): void => {
		if (ctx.hasUI) ctx.ui.notify(message, type);
	};

	pi.registerCommand("planner-only", {
		description: "Show, enable, or temporarily disable planner-only mode; inspect task lifecycle",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const action = (parts[0] ?? "status").toLowerCase();
			const store = orchestrator.store;

			if (action === "status") {
				const log = usageLogPath();
				const logStatus = log ? `${log} (enabled)` : "disabled";
				notify(ctx, [
					`Planner-only mode is ${isDisabled() ? "off" : "on"} (source: ${guardDecisionSource()}).`,
					`Usage log: ${logStatus}`,
				].join("\n"));
				return;
			}
			if (action === "on") {
				await rm(OFF_MARKER, { force: true });
				restrictActiveTools();
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
						store.abandon(taskId, `abandoned by operator via /planner-only task ${subaction}`);
						notify(ctx, `Task ${taskId} abandoned and marked failed.`);
						persistSessionEntries();
						await flushIfTerminal(taskId, before, ctx);
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
					if (isTerminalTaskState(task.state)) {
						notify(ctx, refusal, "warning");
						return;
					}
					notify(ctx, `Operator override bypassed refusal: ${refusal}`, "warning");
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
					pricing = loadPricingTable();
					ledger = new UsageLedger({ pricing });
					ledger.load(allSessionEntries);
					for (const task of store.list()) {
						syncUsage(task.taskId);
					}
					notify(ctx, `Planner-only: reloaded pricing table (${Object.keys(pricing.rates).length} rates, currency: ${pricing.currency}).`);
					return;
				}

				const renderTaskBlock = (tId: string): string | undefined => {
					resolveTaskPending(tId, ctx);
					const u = ledger.taskUsage(tId);
					if (!u) return undefined;
					const t = store.get(tId);
					const rootRates = lookupRates(pricing, undefined, u.rootModel);
					return renderUsage(u, {
						taskId: tId,
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
						resolveTaskPending(tId, ctx);
						const u = ledger.taskUsage(tId);
						if (!u) continue;
						const t = store.get(tId);
						const state = t ? t.state : "unknown";
						lines.push(`${tId} (${state}): ${renderUsageLine(u, pricing.currency)}`);
					}
					lines.push(`untasked: ${renderUsageLine({ root: session.untasked, children: [], costUnknown: session.untasked.costUsd === undefined && session.untasked.turns > 0 }, pricing.currency)}`);
					return lines.join("\n");
				};

				if (sub.toLowerCase() === "session") {
					notify(ctx, renderSessionView());
					return;
				}

				if (sub) {
					const output = renderTaskBlock(sub);
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
			notify(ctx, "Usage: /planner-only [status|on|off|task [abandon|reset <taskId>]|review|usage] [args]", "warning");
		},
	});
}
