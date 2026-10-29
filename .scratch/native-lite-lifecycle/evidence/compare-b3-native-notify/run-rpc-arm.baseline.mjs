import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { readLedger } from "./budget-guard-core.mjs";
import { createStageALifecycle } from "./stage-a-lifecycle.ts";

const armCwd = resolve(process.cwd());
const match = armCwd.match(/\/worktrees\/(S[12])-(native|lite)$/);
if (!match) throw new Error(`unexpected arm cwd: ${armCwd}`);
const [, pair, mode] = match;
const arm = `${pair}-${mode}`;
const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
if (!root || !batchId || !/^[0-9T+_-]+$/.test(batchId) || !attemptId || !/^[A-Za-z0-9_-]+$/.test(attemptId) || attemptId === "retry1") throw new Error("new batch root, batch ID and attempt ID are required");
if (!resolve(root).startsWith("/project/tmp/")) throw new Error("batch root must be external under /project/tmp");
const resultsDir = join(root, "results", attemptId, arm);
const sessionDir = join(resultsDir, "session");
const briefPath = join(armCwd, "input", "brief.md");
const rawPath = join(resultsDir, "session.jsonl");
const stderrPath = join(resultsDir, "session.stderr");
const controlPath = join(resultsDir, "control.jsonl");
const fingerprintPath = join(resultsDir, "request-fingerprints.jsonl");
const costReportPath = join(resultsDir, "subagent-cost.txt");
const sessionId = `nl-${batchId}-${attemptId}-${arm}`.replace(/[^A-Za-z0-9._-]/g, "-");
const rootModel = "gpt-6.1-terra";
const ledgerPath = process.env.PI_NATIVE_LITE_SHARED_LEDGER;
if (!ledgerPath || !resolve(ledgerPath).startsWith("/project/tmp/")) throw new Error("an explicit external shared ledger is required");
const ledger = await readLedger(ledgerPath);
const manifestPath = process.env.PI_NATIVE_LITE_MANIFEST;
if (!manifestPath || !resolve(manifestPath).startsWith("/project/tmp/")) throw new Error("an explicit external frozen manifest is required");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
if (manifest?.version !== 1 || manifest.pair !== pair || manifest.mode !== mode || manifest.attemptId !== attemptId || manifest.batchId !== batchId) throw new Error("frozen manifest arm identity mismatch");
if (!Number.isSafeInteger(manifest.ledgerPrefixCount) || manifest.ledgerPrefixCount < 1 || !/^[a-f0-9]{64}$/.test(manifest.ledgerEventsSha256 ?? "") || !Number.isFinite(manifest.ledgerReservedUsd)) throw new Error("frozen manifest lacks explicit ledger history baseline");
const ledgerPrefix = ledger.events.slice(0, manifest.ledgerPrefixCount);
if (ledgerPrefix.length !== manifest.ledgerPrefixCount || createHash("sha256").update(JSON.stringify(ledgerPrefix)).digest("hex") !== manifest.ledgerEventsSha256
	|| Math.abs(ledgerPrefix.reduce((sum, event) => sum + event.reserveUsd, 0) - manifest.ledgerReservedUsd) > 1e-9
	|| ledger.reservedUsd + 1e-9 < manifest.ledgerReservedUsd) throw new Error("shared ledger is missing or resets frozen historical reservations");
const retryDir = new URL(".", import.meta.url).pathname;
const guardPath = join(retryDir, "budget-guard.ts");
const piSubagents = "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js";
const requiredChildExtensions = join(retryDir, "required-child-extensions-wrapper.mjs");
const pi = process.env.PI_BIN ?? "/home/tcuni-claw/.pi/agent/bin/pi";
const expectedDelegates = pair === "S1"
	? [{ role: "worker", agent: "worker" }]
	: [{ role: "validator", agent: "oracle" }, { role: "reviewer", agent: "reviewer" }];
const expectedChildren = expectedDelegates.length;
const expectedRoles = expectedDelegates.map(item => item.role);
const expectedAgents = expectedDelegates.map(item => item.agent);
const deadlineMs = Number(process.env.PI_NATIVE_LITE_RPC_DEADLINE_MS ?? 20 * 60 * 1000);
const handshakeTimeoutMs = Number(process.env.PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS ?? 15000);
if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20 * 60 * 1000) throw new Error("invalid arm deadline override");
if (!Number.isSafeInteger(handshakeTimeoutMs) || handshakeTimeoutMs < 1 || handshakeTimeoutMs > 60000) throw new Error("invalid RPC handshake timeout");
const lifecycle = createStageALifecycle(pair, deadlineMs);

const brief = await readFile(briefPath, "utf8");
const briefHash = createHash("sha256").update(brief).digest("hex");
if (briefHash !== manifest.briefSha256 || manifest.pairedBriefSha256 !== briefHash) throw new Error("brief hash does not match the frozen arm and paired-arm manifest");
const contractFields = ["root-acceptance", "sessionId", "attemptId", "reportPath", "reportSha256", "reviewVerdict", "Native read-only", "Lite", "plain-text reports"];
if (contractFields.some(field => !brief.includes(field))) throw new Error("shared brief omits the explicit Native/Lite read-only and Root evidence acceptance contract");
const workspaceState = () => {
	const tree = execFileSync("git", ["write-tree"], { cwd: armCwd, encoding: "utf8" }).trim();
	const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd: armCwd, encoding: "buffer" });
	const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: armCwd, encoding: "buffer" }).toString().split("\0").filter(Boolean).sort();
	const files = untracked.map(path => ({ path, sha256: createHash("sha256").update(readFileSync(join(armCwd, path))).digest("hex") }));
	return createHash("sha256").update(JSON.stringify({ tree, diffSha256: createHash("sha256").update(diff).digest("hex"), files })).digest("hex");
};
const initialWorkspace = workspaceState();
if (initialWorkspace !== manifest.workspaceSha256) throw new Error("candidate tree/diff/untracked content does not match frozen manifest");
if (execFileSync("git", ["write-tree"], { cwd: armCwd, encoding: "utf8" }).trim() !== manifest.gitTree) throw new Error("candidate git tree does not match frozen manifest");
const firstLine = brief.split(/\r?\n/, 1)[0];
const resultBase = firstLine.match(/under `([^`]+)\/<pair>-<mode>\//i)?.[1];
const cwdBase = firstLine.match(/worktree CWD `([^`]+)\/<pair>-<mode>`/i)?.[1];
if (!resultBase || !cwdBase) throw new Error("brief path contract is missing arm-derived worktree and result paths");
if (resolve(join(cwdBase, arm)) !== armCwd) throw new Error(`brief cwd contract mismatch: expected ${resolve(join(cwdBase, arm))}, actual ${armCwd}`);
if (resolve(join(resultBase, arm)) !== resolve(resultsDir)) throw new Error(`brief results contract mismatch: expected ${resolve(join(resultBase, arm))}, actual ${resolve(resultsDir)}`);
if (pair === "S2") {
	const reviewerDiffPath = brief.match(/reviewer reads only this immutable, precomputed diff artifact: `([^`]+)`/i)?.[1];
	const expectedReviewerDiffPath = join(root, "common", "S2-candidate.diff");
	if (!reviewerDiffPath || resolve(reviewerDiffPath) !== resolve(expectedReviewerDiffPath)) {
		throw new Error(`brief reviewer diff path contract mismatch: expected ${expectedReviewerDiffPath}, actual ${reviewerDiffPath ?? "missing"}`);
	}
	const [reviewerDiff, armDiff] = await Promise.all([
		readFile(expectedReviewerDiffPath),
		readFile(join(armCwd, "input", "S2-candidate.diff")),
	]);
	if (!reviewerDiff.equals(armDiff) || createHash("sha256").update(reviewerDiff).digest("hex") !== manifest.s2DiffSha256) throw new Error("reviewer diff bytes do not match the frozen S2 manifest and arm input");
}

await mkdir(sessionDir, { recursive: true });
if (!(await realpath(resultsDir)).startsWith("/project/tmp/")) throw new Error("resolved arm results must remain external under /project/tmp");
for (const file of [rawPath, stderrPath, controlPath, fingerprintPath, costReportPath]) {
	try { await stat(file); throw new Error(`refusing to overwrite existing result: ${file}`); }
	catch (error) { if (error.code !== "ENOENT") throw error; }
}
const env = { ...process.env };
for (const key of [
	"PI_OFFLINE", "PI_SUBAGENT_CHILD", "PI_SUBAGENT_PARENT_SESSION", "PI_SUBAGENT_RUNNER_PID", "PI_ASYNC_NATIVE_RUNNER",
	"PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL", "PI_SESSION_ID", "PI_SESSION_FILE", "PI_CODING_AGENT",
	"PI_PACKAGE_DIR", "PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT", "PI_MANAGED_INSTALL_ROOT",
]) delete env[key];
Object.assign(env, {
	PI_NATIVE_LITE_BUDGET_LEDGER: ledgerPath,
	PI_NATIVE_LITE_ATTEMPT_ID: attemptId,
	PI_NATIVE_LITE_FINGERPRINT_LOG: fingerprintPath,
	PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: requiredChildExtensions,
	PI_SUBAGENTS_TEMP_ROOT: join(root, "tmp"),
	PI_PLANNER_ONLY_MODE: mode,
	PI_PLANNER_ONLY_STRICT: mode === "lite" ? "true" : "false",
	PI_PLANNER_ONLY_HANDOFF: "off",
	PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: "150000",
	PI_TELEMETRY: "0",
	TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"),
});

const args = [
	"--approve", "--mode", "rpc", "--session-dir", sessionDir, "--session-id", sessionId,
	"--model", "tcuni/gpt-6.1-terra", "--thinking", "high", "--no-extensions", "--no-mcp",
	"-e", piSubagents, "-e", join(armCwd, "index.ts"), "-e", guardPath,
	"-e", join(new URL(".", import.meta.url).pathname, "request-fingerprint.ts"),
	"-e", join(retryDir, "delegation-observer.ts"),
];
const safeCommand = [pi, ...args, "<RPC prompt from input/brief.md>"].join(" ");
const log = await open(rawPath, "wx", 0o600);
const errLog = await open(stderrPath, "wx", 0o600);
const control = await open(controlPath, "wx", 0o600);
const costLog = await open(costReportPath, "wx", 0o600);
let writes = Promise.resolve();
let costWrites = Promise.resolve();
const writeQueued = (handle, value) => { writes = writes.then(() => handle.write(value)); };
const writeCostReport = (value) => { costWrites = costWrites.then(() => costLog.write(value)); };
const record = (entry) => writeQueued(control, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
await record({ event: "launch", cwd: armCwd, arm, sessionId, command: safeCommand, environment: {
	PI_PLANNER_ONLY_MODE: mode,
	PI_PLANNER_ONLY_STRICT: env.PI_PLANNER_ONLY_STRICT,
	PI_PLANNER_ONLY_HANDOFF: env.PI_PLANNER_ONLY_HANDOFF,
	PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: env.PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS,
	PI_NATIVE_LITE_BUDGET_LEDGER: ledgerPath,
	PI_NATIVE_LITE_ATTEMPT_ID: attemptId,
	PI_NATIVE_LITE_FINGERPRINT_LOG: fingerprintPath,
	PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS: requiredChildExtensions,
	TMPDIR: env.TMPDIR,
} });

const child = spawn(pi, args, { cwd: armCwd, env, stdio: ["pipe", "pipe", "pipe"] });
const stdout = createInterface({ input: child.stdout });
const stderr = createInterface({ input: child.stderr });
let stderrWrites = Promise.resolve();
stderr.on("line", line => { stderrWrites = stderrWrites.then(() => errLog.write(`${line}\n`)); });
let stateReady = false;
let taskAccepted = false;
let rootFinal = false;
let finalText = "";
let costQuery = false;
let costAuditRequested = false;
let complete = false;
let failure;
let expectedSessionSeen = false;
let rootModelSeen = false;
let terminalNoticeCount = 0;
let handshakeTimer;
const childRoles = new Set();
const childRecords = new Map();
const nativeToolCalls = new Map();
const nativeSeenToolCalls = new Set();
const liteLaunches = new Map();
let acceptedChildren;
const requestIds = { state: "p6-state", task: "p6-task", cost: "p6-child-cost" };
const pendingLiteToolCalls = new Map();
const completedLiteToolResults = new Map();

const send = async (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
const textOf = (message) => (message?.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
const completedChildCount = () => lifecycle.snapshot().children.filter(child => child.completed).length;
const fail = async (reason, event = "lifecycle-failure") => {
	if (failure) return;
	failure = reason;
	lifecycle.fail(reason);
	await record({ event, failure });
	if (child.stdin.writable) child.stdin.end();
};
const checkChildResults = (details) => {
	for (const result of details?.results ?? []) {
		if (typeof result.agent === "string") childRoles.add(result.agent);
	}
};
const verifyAcceptedReports = async () => {
	const ids = new Set(childRecords.keys());
	if (ids.size !== expectedChildren || acceptedChildren?.length !== expectedChildren || new Set(acceptedChildren.map(item => item.runId)).size !== expectedChildren) throw new Error("child identity count mismatch");
	if ([...childRecords.values()].map(item => item.agent).sort().join("\0") !== [...expectedAgents].sort().join("\0")) throw new Error("exact child agents do not match the frozen arm");
	if ([...childRecords.values()].map(item => item.role).sort().join("\0") !== [...expectedRoles].sort().join("\0")) throw new Error("exact logical roles do not match the frozen arm");
	if (new Set(acceptedChildren.map(item => resolve(item.reportPath))).size !== expectedChildren) throw new Error("each child must have a distinct report path");
	const realReportPaths = new Set();
	const realResults = await realpath(resultsDir);
	for (const item of acceptedChildren) {
		const childIdentity = childRecords.get(item.runId);
		const liteIdentityMatches = mode !== "lite" || (item.requestId === childIdentity?.requestId
			&& item.ownerRunId === childIdentity?.ownerRunId && item.nodeId === childIdentity?.nodeId);
		if (!childIdentity || item.role !== childIdentity.role || item.agent !== childIdentity.agent || !liteIdentityMatches
			|| typeof item.reportPath !== "string" || item.sessionId !== sessionId || item.attemptId !== attemptId
			|| item.accepted !== true || item.verdict !== "accepted" || item.reviewVerdict !== "accepted") throw new Error("unknown child identity or missing correlated evidence verdict");
		const path = await realpath(item.reportPath);
		if (!path.startsWith(`${realResults}/`)) throw new Error("report outside result directory");
		if (realReportPaths.has(path)) throw new Error("child reports resolve to the same file");
		realReportPaths.add(path);
		const actual = createHash("sha256").update(await readFile(path)).digest("hex");
		if (actual !== item.reportSha256) throw new Error("child report hash mismatch");
	}
	if (workspaceState() !== initialWorkspace) throw new Error("candidate workspace changed");
	if (lifecycle.snapshot().status !== "accepted" || !rootFinal) throw new Error("Root acceptance changed during evidence verification");
};
const maybeFinish = async () => {
	if (!stateReady || !taskAccepted || !rootFinal || costQuery || costAuditRequested || lifecycle.snapshot().status !== "accepted" || completedChildCount() !== expectedChildren) return;
	if (nativeToolCalls.size) {
		await fail(`Native subagent calls remain pending: ${nativeToolCalls.size}`, "native-call-pending");
		return;
	}
	costAuditRequested = true;
	try {
		await verifyAcceptedReports();
	} catch (error) {
		failure = `Root acceptance verification failed: ${error.message}`;
		await record({ event: "acceptance-rejected", failure });
		child.stdin.end();
		return;
	}
	costQuery = true;
	await record({ event: "cost-audit-command", command: "/subagent-cost" });
	await send({ id: requestIds.cost, type: "prompt", message: "/subagent-cost" });
};

const roleForAgent = agent => expectedDelegates.find(item => item.agent === agent)?.role;
const onlyKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
const nativeManagementAction = args => {
	if (!onlyKeys(args, ["action", "options", "id", "agent"])) return false;
	const options = args.options ?? {};
	if (args.action === "guide") return onlyKeys(args, ["action", "options"]) && onlyKeys(options, ["topic"]) && (options.topic === undefined || typeof options.topic === "string");
	if (args.action === "list") return onlyKeys(args, ["action"]);
	if (args.action === "models") return onlyKeys(args, ["action", "agent"]) && (args.agent === undefined || typeof args.agent === "string");
	if (args.action === "status") return onlyKeys(args, ["action", "id", "options"]) && (args.id === undefined || typeof args.id === "string") && onlyKeys(options, ["view", "index"]) && (options.view === undefined || ["fleet", "transcript"].includes(options.view)) && (options.index === undefined || Number.isInteger(options.index));
	return false;
};
const validRootAcceptance = (text) => {
	const match = text.match(/```root-acceptance\s*\n([\s\S]*?)\n```/);
	if (!match) return undefined;
	try {
		const acceptance = JSON.parse(match[1]);
		if (acceptance?.accepted !== true || acceptance.sessionId !== sessionId || acceptance.attemptId !== attemptId
			|| !Array.isArray(acceptance.children) || acceptance.children.length !== expectedChildren
			|| !acceptance.children.every(item => typeof item.runId === "string" && /^[a-f0-9]{64}$/.test(item.reportSha256)
				&& (mode !== "lite" || (typeof item.requestId === "string" && typeof item.ownerRunId === "string" && typeof item.nodeId === "string"))
				&& typeof item.role === "string" && typeof item.agent === "string" && item.accepted === true
				&& item.verdict === "accepted" && item.reviewVerdict === "accepted"
				&& item.sessionId === sessionId && item.attemptId === attemptId)) return undefined;
		return acceptance.children;
	} catch { return undefined; }
};

const finishLiteReceipt = async launch => {
	if (!launch.receipt) return;
	if (launch.receipt.status !== "completed") {
		lifecycle.liteReceipt(launch.receipt);
		await fail(`Lite child ${launch.receipt.status}: ${launch.receipt.error ?? launch.role}`, "child-terminal-failure");
		return;
	}
	if (!launch.toolResult) return;
	if (!lifecycle.liteReceipt(launch.receipt)) {
		await fail("invalid or duplicate Lite terminal receipt", "receipt-rejected");
		return;
	}
	childRecords.set(launch.receipt.runId, { role: launch.role, agent: launch.agent, requestId: launch.requestId,
		ownerRunId: launch.identity.ownerRunId, nodeId: launch.identity.nodeId });
	childRoles.add(launch.agent);
	pendingLiteToolCalls.delete(launch.toolCallId);
	completedLiteToolResults.delete(launch.toolCallId);
};

const handleLine = async (line) => {
	writeQueued(log, `${line}\n`);
	if (failure) return;
	let event;
	try { event = JSON.parse(line); }
	catch { await fail("non-JSON RPC stdout", "rpc-malformed"); return; }
	if (event.type === "response" && event.id === requestIds.state) {
		clearTimeout(handshakeTimer);
		const state = event.data;
		stateReady = event.success === true
			&& state?.model?.provider === "tcuni"
			&& state?.model?.id === rootModel
			&& state?.thinkingLevel === "high"
			&& state?.sessionId === sessionId;
		expectedSessionSeen = state?.sessionId === sessionId;
		rootModelSeen = state?.model?.provider === "tcuni" && state?.model?.id === rootModel;
		void record({ event: "root-state", success: event.success, provider: state?.model?.provider, model: state?.model?.id, thinking: state?.thinkingLevel, sessionId: state?.sessionId });
		if (!stateReady) {
			await fail("Pi state did not match frozen Root model/thinking/session", "rpc-state-mismatch");
			return;
		}
		void send({ id: requestIds.task, type: "prompt", message: brief });
		return;
	}
	if (event.type === "response" && event.id === requestIds.task) {
		taskAccepted = event.success === true;
		void record({ event: "task-prompt-accepted", success: event.success, disposition: event.data?.disposition, error: event.error });
		if (!taskAccepted) await fail(`Pi rejected task prompt: ${event.error ?? "unknown"}`, "task-prompt-rejected");
		return;
	}
	if (event.type === "response" && event.id === requestIds.cost) {
		if (!event.success) {
			await fail(`subagent cost command failed: ${event.error ?? "unknown"}`, "usage-query-failed");
		}
		return;
	}
	if (event.type === "extension_ui_request" && ["confirm", "select", "input", "editor"].includes(event.method)) {
		await fail(`headless RPC requested unavailable user interaction: ${event.method}`, "unsupported-user-interaction");
		void send({ type: "extension_ui_response", id: event.id, cancelled: true });
		return;
	}
	if (event.type === "agent_start") {
		if (costAuditRequested) {
			await fail("Root activity occurred after final acceptance during cost audit", "root-activity-during-cost-audit");
			return;
		}
		lifecycle.activity();
		rootFinal = false;
		acceptedChildren = undefined;
	}
	if (event.type === "message_end") {
		const message = event.message;
		if (message?.role === "assistant" && !costAuditRequested) {
			for (const part of message.content ?? []) {
				if (part.type !== "toolCall" || typeof part.id !== "string") continue;
				let args = part.arguments;
				if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = undefined; } }
				if (mode === "native" && part.name === "subagent") {
					if (nativeSeenToolCalls.has(part.id)) { await fail("duplicate Native subagent tool call", "native-launch-policy-rejected"); return; }
					nativeSeenToolCalls.add(part.id);
					if (nativeManagementAction(args)) {
						nativeToolCalls.set(part.id, { kind: "management", action: args.action });
						continue;
					}
					if (args?.action !== undefined || args?.workflow !== undefined || args?.chain !== undefined || args?.tasks !== undefined || args?.async === false) {
						const action = typeof args?.action === "string" ? args.action.slice(0, 80) : "none";
						const shape = args && typeof args === "object" ? Object.keys(args).sort().join(",").slice(0, 200) : "invalid";
						await fail(`Unsupported Native subagent call: action=${action}, keys=${shape}`, "native-call-unsupported");
						return;
					}
					const agent = args?.agent;
					const role = roleForAgent(agent);
					const configuredAcceptance = args?.options?.acceptance ?? args?.acceptance;
					if (!role || configuredAcceptance?.level !== "none"
						|| configuredAcceptance?.reason !== "read-only report; Root performs evidence acceptance") {
						await fail("Native subagent call has unsupported role or missing explicit read-only acceptance options", "native-launch-policy-rejected");
						return;
					}
					nativeToolCalls.set(part.id, { kind: "launch", role, agent, acceptance: configuredAcceptance });
				} else if (mode === "lite" && part.name === "delegate") {
					if (typeof args?.role !== "string" || !expectedRoles.includes(args.role) || pendingLiteToolCalls.has(part.id)) {
						await fail("invalid or duplicate Lite delegate tool call", "lite-launch-rejected");
						return;
					}
					pendingLiteToolCalls.set(part.id, { role: args.role });
				}
			}
			if (message.provider !== "tcuni" || message.model !== rootModel) {
				await fail(`Root model drift: ${message.provider ?? "unknown"}/${message.model ?? "unknown"}`, "model-drift");
				return;
			}
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				await fail(`Root terminal ${message.stopReason}: ${message.errorMessage ?? "no detail"}`, "root-terminal-failure");
				return;
			}
			rootFinal = message.stopReason === "stop" && textOf(message).trim().length > 0;
			if (rootFinal) {
				finalText = textOf(message);
				if (completedChildCount() === expectedChildren) {
					acceptedChildren = validRootAcceptance(finalText);
					if (!acceptedChildren || !lifecycle.rootResponse(true)) {
						lifecycle.rootResponse(false);
						await fail("Root did not provide valid post-completion acceptance", "root-acceptance-rejected");
						return;
					}
				}
			}
			void record({ event: "root-message", model: message.model, stopReason: message.stopReason, finalTextSha256: rootFinal ? createHash("sha256").update(finalText).digest("hex") : undefined });
		}
		if (message?.role === "toolResult") {
			if (message.toolName === "subagent") {
				const pending = nativeToolCalls.get(message.toolCallId);
				const details = message.details;
				if (pending?.kind === "management") {
					nativeToolCalls.delete(message.toolCallId);
					const statusDetails = pending.action === "status" && details?.mode === "single" && (details.runId === undefined || typeof details.runId === "string");
					if (message.isError || details?.asyncId !== undefined || !(details?.mode === "management" && details.runId === undefined || statusDetails) || !Array.isArray(details.results) || details.results.length !== 0) {
						await fail(`Native management ${pending.action} failed or returned launch-shaped data`, "native-management-failed");
						return;
					}
					void record({ event: "native-management-result", action: pending.action, toolCallId: message.toolCallId });
					return;
				}
				if (!pending || message.isError || details?.mode !== "single" || typeof details.asyncId !== "string"
					|| details.runId !== details.asyncId || (details.results?.length ?? 0) !== 0) {
					await fail("Native subagent tool result was failed, non-async, extra, or uncorrelated", "native-launch-failed");
					return;
				}
				nativeToolCalls.delete(message.toolCallId);
				const launch = {
					channel: "native-async", role: pending.role, agent: pending.agent, runId: details.asyncId, mode: details.mode,
					identity: { requestId: message.toolCallId, ownerRunId: sessionId, nodeId: details.asyncId },
				};
				if (!lifecycle.launch(launch)) {
					await fail("Native child count, role, or launch identity exceeds the frozen arm", "native-launch-rejected");
					return;
				}
				childRecords.set(details.asyncId, { role: pending.role, agent: pending.agent, requestId: message.toolCallId,
					ownerRunId: sessionId, nodeId: details.asyncId, toolCallId: message.toolCallId });
				childRoles.add(pending.agent);
			} else if (message.toolName === "delegate") {
				const pending = pendingLiteToolCalls.get(message.toolCallId);
				if (!pending || message.isError || message.details?.status !== "completed") {
					const status = message.details?.status ?? (message.isError ? "error" : "missing");
					await fail(`Lite delegate tool result ${status} for uncorrelated call ${message.toolCallId ?? "missing-id"}`, "lite-tool-result-failed");
					return;
				}
				completedLiteToolResults.set(message.toolCallId, true);
				const launch = [...liteLaunches.values()].find(item => item.toolCallId === message.toolCallId);
				if (launch) {
					launch.toolResult = true;
					await finishLiteReceipt(launch);
				}
			}
			void record({ event: "tool-result", toolName: message.toolName, isError: message.isError, detailsStatus: message.details?.status, childRoles: [...childRoles] });
		}
		if (message?.role === "custom" && message.customType === "subagent-notify") {
			const runs = message.details?.runs;
			if (!Array.isArray(runs) || runs.length === 0) {
				await fail("Native completion notice has no runs", "native-receipt-rejected");
				return;
			}
			const before = completedChildCount();
			lifecycle.nativeNotice(message);
			const snapshot = lifecycle.snapshot();
			if (snapshot.failure) { await fail(snapshot.failure, "native-receipt-rejected"); return; }
			for (const run of runs) {
				const child = childRecords.get(run.runId);
				if (!child || run.source !== "async" || run.agent !== child.agent || run.status !== "completed") {
					await fail("Native completion receipt is stale, mismatched, failed, or duplicated", "native-receipt-rejected");
					return;
				}
				child.completed = true;
			}
			if (completedChildCount() - before !== runs.length) { await fail("Native completion notice did not complete each correlated run exactly once", "native-receipt-rejected"); return; }
		}
		if (message?.role === "custom" && message.customType === "native-lite-delegation-start") {
			const receipt = message.details;
			const role = roleForAgent(receipt?.agent);
			const pending = [...pendingLiteToolCalls.entries()].find(([, call]) => call.role === role && !call.started);
			if (!receipt || !role || !pending || typeof receipt.requestId !== "string" || typeof receipt.ownerRunId !== "string"
				|| typeof receipt.nodeId !== "string" || liteLaunches.has(receipt.requestId)) {
				await fail("invalid, duplicate, or uncorrelated Lite request-start receipt", "lite-launch-rejected");
				return;
			}
			const [toolCallId] = pending;
			pendingLiteToolCalls.get(toolCallId).started = true;
			const launch = { channel: "lite-foreground", role, agent: receipt.agent,
				identity: { requestId: receipt.requestId, ownerRunId: receipt.ownerRunId, nodeId: receipt.nodeId } };
			if (!lifecycle.launch(launch)) { await fail("Lite child count, role, or identity exceeds the frozen arm", "lite-launch-rejected"); return; }
			liteLaunches.set(receipt.requestId, { ...launch, requestId: receipt.requestId, toolCallId, toolResult: completedLiteToolResults.has(toolCallId) });
		}
		if (message?.role === "custom" && message.customType === "native-lite-delegation-receipt") {
			const receipt = message.details;
			const launch = receipt && liteLaunches.get(receipt.requestId);
			if (!launch || receipt.ownerRunId !== launch.identity.ownerRunId || receipt.nodeId !== launch.identity.nodeId || receipt.agent !== launch.agent
				|| typeof receipt.status !== "string" || typeof receipt.runId !== "string" || (launch.receipt && launch.receipt.runId !== receipt.runId)) {
				await fail("invalid, stale, cross-run, or duplicate Lite terminal receipt", "lite-receipt-rejected");
				return;
			}
			launch.receipt = receipt;
			await finishLiteReceipt(launch);
		}
		if (message?.role === "custom" && ["subagent-slash-result", "subagent-slash-text-result"].includes(message.customType) && costQuery) {
			const costReport = typeof message.content === "string" ? message.content : "";
			costQuery = false;
			const unresolved = Number(costReport.match(/Async child usage unavailable: (\d+)\./)?.[1] ?? 0);
			const usageAgents = [...costReport.matchAll(/^Child \d+ \(([^)]+)\):/gm)].map(match => match[1]).sort();
			const childUsageCount = usageAgents.length;
			terminalNoticeCount = childUsageCount;
			writeCostReport(`${costReport}\n`);
			void record({ event: "subagent-cost-report", resultType: message.customType, unresolvedAsyncChildren: unresolved, childUsageCount, usageAgents, noChildUsage: /No subagent child usage found in this session\./i.test(costReport), reportSha256: createHash("sha256").update(costReport).digest("hex") });
			if (/No subagent child usage found in this session\./i.test(costReport)) {
				await fail(`subagent-cost report found no child usage; expected ${expectedChildren}`, "usage-unavailable");
			} else if (unresolved > 0) {
				await fail(`subagent-cost report has ${unresolved} unresolved child usage records`, "usage-unavailable");
		} else if (childUsageCount !== expectedChildren || usageAgents.join("\0") !== [...expectedAgents].sort().join("\0")) {
				await fail(`subagent-cost child count/agents mismatch: expected ${expectedAgents.join(",")}, got ${usageAgents.join(",")}`, "usage-mismatch");
			} else if (workspaceState() !== initialWorkspace) {
				await fail("candidate workspace changed before usage audit", "candidate-workspace-drift");
			} else if (nativeToolCalls.size || !lifecycle.costAudit(true) || !lifecycle.exit()) {
				await fail("lifecycle was invalidated before terminal cost audit", "lifecycle-invalidated-before-exit");
			} else {
				complete = true;
				void record({ event: "arm-lifecycle-complete", expectedSessionSeen, rootModelSeen, childRoles: [...childRoles], childUsageCount });
				child.stdin.end();
			}
		}
	}
	if (event.type === "agent_settled") {
		if (costAuditRequested) {
			void record({ event: "agent-settled", rootFinal, costQuery: true, lifecycleStatus: lifecycle.snapshot().status });
			return;
		}
		const before = lifecycle.snapshot();
		const status = lifecycle.rootSettled();
		void record({ event: "agent-settled", rootFinal, lifecycleStatus: status, completedChildren: completedChildCount() });
		if (rootFinal && completedChildCount() === 0 && before.children.length === 0 && nativeToolCalls.size === 0 && pendingLiteToolCalls.size === 0) {
			await fail("Root settled without launching a child", "no-child-result");
			return;
		}
		if (lifecycle.snapshot().rootTurnSettled && !lifecycle.snapshot().accepted) lifecycle.accept(true);
		if (lifecycle.snapshot().failure) { await fail(lifecycle.snapshot().failure, "lifecycle-failure"); return; }
		if (mode === "lite" && pendingLiteToolCalls.size > 0 && [...pendingLiteToolCalls.values()].some(call => !call.started)) {
			await fail("Lite delegate completed without a correlated request-start receipt", "lite-launch-receipt-missing");
			return;
		}
		if (mode === "lite" && [...liteLaunches.values()].some(launch => launch.toolResult && !launch.receipt)) {
			await fail("Lite delegate completed without a correlated terminal receipt", "lite-terminal-receipt-missing");
			return;
		}
		if (!costQuery && !complete && !failure && lifecycle.snapshot().status === "accepted") await maybeFinish();
	}
	if (failure && child.stdin.writable) child.stdin.end();
};
let eventQueue = Promise.resolve();
stdout.on("line", (line) => {
	eventQueue = eventQueue.then(() => handleLine(line)).catch(async error => {
		failure = `RPC event processing failed: ${error.message}`;
		await record({ event: "rpc-processing-failed", failure });
		if (child.stdin.writable) child.stdin.end();
	});
});

child.once("error", error => { void fail(`Pi spawn failed: ${error.message}`, "pi-spawn-failed"); });
const onSignal = signal => {
	failure = `controller received ${signal}`;
	lifecycle.fail(failure);
	void record({ event: "controller-signal", signal, failure });
	child.kill("SIGTERM");
	setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 5000).unref();
};
process.once("SIGINT", onSignal);
process.once("SIGTERM", onSignal);
const deadline = setTimeout(() => {
	failure = `arm deadline reached after ${deadlineMs} ms`;
	lifecycle.timeout();
	void record({ event: "arm-timeout", deadlineMs });
	child.kill("SIGTERM");
	setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 15000).unref();
}, deadlineMs);
handshakeTimer = setTimeout(() => {
	if (stateReady || failure) return;
	void fail("RPC get_state handshake timed out", "rpc-state-timeout");
	child.stdin.end();
	setTimeout(() => { if (child.exitCode === null) child.kill("SIGTERM"); }, 5000).unref();
}, handshakeTimeoutMs);
await record({ event: "rpc-state-request", requestId: requestIds.state });
await send({ id: requestIds.state, type: "get_state" });
const exitCode = await new Promise((resolveExit) => child.once("close", resolveExit));
clearTimeout(deadline);
clearTimeout(handshakeTimer);
process.off("SIGINT", onSignal);
process.off("SIGTERM", onSignal);
await eventQueue;
await stderrWrites;
if (complete) {
	try {
		if (!lifecycle.exit()) throw new Error("lifecycle is no longer terminally accepted");
		await verifyAcceptedReports();
	} catch (error) {
		complete = false;
		failure = `terminal evidence revalidation failed: ${error.message}`;
		lifecycle.fail(failure);
		await record({ event: "terminal-evidence-rejected", failure });
	}
}
if (workspaceState() !== initialWorkspace) {
	failure = "candidate tree/diff/untracked content changed before Pi process close";
	complete = false;
	await record({ event: "terminal-workspace-drift", failure });
}
await record({ event: "pi-process-exit", exitCode, complete, failure, childRoles: [...childRoles], expectedSessionSeen, rootModelSeen, childUsageCount: terminalNoticeCount });
await writes;
await costWrites;
await Promise.all([log.close(), errLog.close(), control.close(), costLog.close()]);
if (exitCode !== 0) process.exitCode = exitCode ?? 1;
else if (!complete || failure) process.exitCode = 1;
