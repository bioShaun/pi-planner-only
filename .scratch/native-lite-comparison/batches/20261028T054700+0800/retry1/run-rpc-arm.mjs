import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const armCwd = resolve(process.cwd());
const match = armCwd.match(/\/retry1-worktrees\/(S[12])-(native|lite)$/);
if (!match) throw new Error(`unexpected arm cwd: ${armCwd}`);
const [, pair, mode] = match;
const arm = `${pair}-${mode}`;
const root = process.env.PI_NATIVE_LITE_BATCH_ROOT;
const batchId = process.env.PI_NATIVE_LITE_BATCH_ID;
const attemptId = process.env.PI_NATIVE_LITE_ATTEMPT_ID;
if (!root || !batchId || !/^[0-9T+_-]+$/.test(batchId) || attemptId !== "retry1") throw new Error("batch root, original batch ID, and retry1 attempt ID are required");
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
const ledgerPath = join(root, "budget-ledger.json");
const retryDir = new URL(".", import.meta.url).pathname;
const guardPath = join(retryDir, "budget-guard.ts");
const piSubagents = "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js";
const requiredChildExtensions = join(retryDir, "required-child-extensions-wrapper.mjs");
const pi = process.env.PI_BIN ?? "/home/tcuni-claw/.pi/agent/bin/pi";
const expectedChildren = pair === "S1" ? 1 : 2;
const deadlineMs = Number(process.env.PI_NATIVE_LITE_RPC_DEADLINE_MS ?? 20 * 60 * 1000);
const handshakeTimeoutMs = Number(process.env.PI_NATIVE_LITE_RPC_HANDSHAKE_TIMEOUT_MS ?? 15000);
if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 20 * 60 * 1000) throw new Error("invalid arm deadline override");
if (!Number.isSafeInteger(handshakeTimeoutMs) || handshakeTimeoutMs < 1 || handshakeTimeoutMs > 60000) throw new Error("invalid RPC handshake timeout");

const brief = await readFile(briefPath, "utf8");
const firstLine = brief.split(/\r?\n/, 1)[0];
const resultBase = firstLine.match(/under `([^`]+)\/<pair>-<mode>\//i)?.[1];
const cwdBase = firstLine.match(/worktree CWD `([^`]+)\/<pair>-<mode>`/i)?.[1];
if (!resultBase || !cwdBase) throw new Error("retry1 brief path contract is missing arm-derived worktree and result paths");
if (resolve(join(cwdBase, arm)) !== armCwd) throw new Error(`retry1 brief cwd contract mismatch: expected ${resolve(join(cwdBase, arm))}, actual ${armCwd}`);
if (resolve(join(resultBase, arm)) !== resolve(resultsDir)) throw new Error(`retry1 brief results contract mismatch: expected ${resolve(join(resultBase, arm))}, actual ${resolve(resultsDir)}`);
if (pair === "S2") {
	const reviewerDiffPath = brief.match(/reviewer reads only this immutable, precomputed diff artifact: `([^`]+)`/i)?.[1];
	const expectedReviewerDiffPath = join(root, "retry1-common", "S2-candidate.diff");
	if (!reviewerDiffPath || resolve(reviewerDiffPath) !== resolve(expectedReviewerDiffPath)) {
		throw new Error(`retry1 brief reviewer diff path contract mismatch: expected ${expectedReviewerDiffPath}, actual ${reviewerDiffPath ?? "missing"}`);
	}
	const [reviewerDiff, armDiff] = await Promise.all([
		readFile(expectedReviewerDiffPath),
		readFile(join(armCwd, "input", "S2-candidate.diff")),
	]);
	if (!reviewerDiff.equals(armDiff)) throw new Error("retry1 reviewer diff bytes do not match this arm's input diff");
}

await mkdir(sessionDir, { recursive: true });
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
stderr.on("line", (line) => { void errLog.write(`${line}\n`); });
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
const requestIds = { state: "p6-state", task: "p6-task", cost: "p6-child-cost" };

const send = async (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
const textOf = (message) => (message?.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
const checkChildResults = (details) => {
	for (const result of details?.results ?? []) {
		if (typeof result.agent === "string") childRoles.add(result.agent);
	}
};
const maybeFinish = async () => {
	if (!stateReady || !taskAccepted || !rootFinal || costQuery || costAuditRequested) return;
	costAuditRequested = true;
	costQuery = true;
	await record({ event: "cost-audit-command", command: "/subagent-cost" });
	await send({ id: requestIds.cost, type: "prompt", message: "/subagent-cost" });
};

stdout.on("line", (line) => {
	writeQueued(log, `${line}\n`);
	let event;
	try { event = JSON.parse(line); }
	catch { failure = "non-JSON RPC stdout"; return; }
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
			failure = "Pi state did not match frozen Root model/thinking/session";
			void record({ event: "rpc-state-mismatch", success: event.success, provider: state?.model?.provider, model: state?.model?.id, thinking: state?.thinkingLevel, sessionId: state?.sessionId });
			child.stdin.end();
			return;
		}
		void send({ id: requestIds.task, type: "prompt", message: brief });
		return;
	}
	if (event.type === "response" && event.id === requestIds.task) {
		taskAccepted = event.success === true;
		void record({ event: "task-prompt-accepted", success: event.success, disposition: event.data?.disposition, error: event.error });
		if (!taskAccepted) failure = `Pi rejected task prompt: ${event.error ?? "unknown"}`;
		return;
	}
	if (event.type === "response" && event.id === requestIds.cost) {
		if (!event.success) {
			failure = `subagent cost command failed: ${event.error ?? "unknown"}`;
			child.stdin.end();
		}
		return;
	}
	if (event.type === "extension_ui_request" && ["confirm", "select", "input", "editor"].includes(event.method)) {
		failure = `headless RPC requested unavailable user interaction: ${event.method}`;
		void record({ event: "unsupported-user-interaction", method: event.method });
		void send({ type: "extension_ui_response", id: event.id, cancelled: true });
		return;
	}
	if (event.type === "agent_start") rootFinal = false;
	if (event.type === "message_end") {
		const message = event.message;
		if (message?.role === "assistant") {
			if (message.provider !== "tcuni" || message.model !== rootModel) {
				failure = `Root model drift: ${message.provider ?? "unknown"}/${message.model ?? "unknown"}`;
				void record({ event: "model-drift", provider: message.provider, model: message.model });
			}
			if (message.stopReason === "error" || message.stopReason === "aborted") {
				failure = `Root terminal ${message.stopReason}: ${message.errorMessage ?? "no detail"}`;
			}
			rootFinal = message.stopReason === "stop" && textOf(message).trim().length > 0;
			if (rootFinal) finalText = textOf(message);
			void record({ event: "root-message", model: message.model, stopReason: message.stopReason, finalTextSha256: rootFinal ? createHash("sha256").update(finalText).digest("hex") : undefined });
		}
		if (message?.role === "toolResult") {
			checkChildResults(message.details);
			if (message.toolName === "delegate" && typeof message.details?.role === "string") childRoles.add(message.details.role);
			void record({ event: "tool-result", toolName: message.toolName, isError: message.isError, detailsStatus: message.details?.status, childRoles: [...childRoles] });
		}
		if (message?.role === "custom" && ["subagent-slash-result", "subagent-slash-text-result"].includes(message.customType) && costQuery) {
			const costReport = typeof message.content === "string" ? message.content : "";
			costQuery = false;
			const unresolved = Number(costReport.match(/Async child usage unavailable: (\d+)\./)?.[1] ?? 0);
			const childUsageCount = [...costReport.matchAll(/^Child \d+ \(/gm)].length;
			terminalNoticeCount = childUsageCount;
			writeCostReport(`${costReport}\n`);
			void record({ event: "subagent-cost-report", resultType: message.customType, unresolvedAsyncChildren: unresolved, childUsageCount, noChildUsage: /No subagent child usage found in this session\./i.test(costReport), reportSha256: createHash("sha256").update(costReport).digest("hex") });
			if (/No subagent child usage found in this session\./i.test(costReport)) {
				failure = `subagent-cost report found no child usage; expected ${expectedChildren}`;
				child.stdin.end();
			} else if (unresolved > 0) {
				failure = `subagent-cost report has ${unresolved} unresolved child usage records`;
				child.stdin.end();
			} else if (childUsageCount !== expectedChildren) {
				failure = `expected exactly ${expectedChildren} child usage records, found ${childUsageCount}`;
				child.stdin.end();
			} else if (rootFinal) {
				complete = true;
				void record({ event: "arm-lifecycle-complete", expectedSessionSeen, rootModelSeen, childRoles: [...childRoles], childUsageCount });
				child.stdin.end();
			}
		}
	}
	if (event.type === "agent_settled") {
		void record({ event: "agent-settled", rootFinal });
		if (!costQuery && !complete && !failure && rootFinal) void maybeFinish();
	}
	if (failure && child.stdin.writable) child.stdin.end();
});

child.once("error", (error) => { failure = `Pi spawn failed: ${error.message}`; });
const deadline = setTimeout(() => {
	failure = "20-minute arm deadline reached";
	void record({ event: "arm-timeout" });
	child.kill("SIGTERM");
	setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, 15000).unref();
}, deadlineMs);
handshakeTimer = setTimeout(() => {
	if (stateReady || failure) return;
	failure = "RPC get_state handshake timed out";
	void record({ event: "rpc-state-timeout", handshakeTimeoutMs });
	child.stdin.end();
	setTimeout(() => { if (child.exitCode === null) child.kill("SIGTERM"); }, 5000).unref();
}, handshakeTimeoutMs);
await record({ event: "rpc-state-request", requestId: requestIds.state });
await send({ id: requestIds.state, type: "get_state" });
const exitCode = await new Promise((resolveExit) => child.once("close", resolveExit));
clearTimeout(deadline);
clearTimeout(handshakeTimer);
await record({ event: "pi-process-exit", exitCode, complete, failure, childRoles: [...childRoles], expectedSessionSeen, rootModelSeen, childUsageCount: terminalNoticeCount });
await writes;
await costWrites;
await Promise.all([log.close(), errLog.close(), control.close(), costLog.close()]);
if (exitCode !== 0) process.exitCode = exitCode ?? 1;
else if (!complete || failure) process.exitCode = 1;
