// Ticket 05 — real CLI (pi -p) + installed pi-subagents launcher acceptance
// for P0 Request admission. Run from an ordinary terminal, never a sandboxed
// agent executor. Usage: node run-cli.mjs <natural|deadline>
//
//   natural  — representative natural-language task under DEFAULT limits.
//              No env knob touches the Request. Records whether a normal task
//              fits the approved defaults and what the 0.69.0 transport shows
//              (REQUEST/terminal correlation, usage, model identity).
//   deadline — environment-forced closure: PI_PLANNER_ONLY_REQUEST_ACTIVE_MS
//              is lowered so the absolute deadline fires while a real child
//              is still running. This is programmatic forcing (not a faux
//              provider): the Root model, the launcher and the child are real.
//              Records CANCEL on the real transport, the child terminal after
//              closure, and whether any REQUEST/model call follows closure.
//
// Everything (agent dir, workspace, temp root, logs) lives under a fresh run
// directory; /tmp is never used. A passive observer extension
// (probe-events.ts) records launcher contract events and public host hooks.
import { execSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scenario = process.argv[2];
if (!["natural", "deadline"].includes(scenario)) {
	console.error("usage: node run-cli.mjs <natural|deadline>");
	process.exit(2);
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(HERE, "../../..");
const LAUNCHER = path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-subagents");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const RUN_DIR = path.join(HERE, `cli-run-${scenario}-${stamp}`);
const AGENT_DIR = path.join(RUN_DIR, "agent");
const WORKSPACE_DIR = path.join(RUN_DIR, "workspace");
const TMP_ROOT = fs.mkdtempSync(`/project/tmp/pi-planner-only-cli-${scenario}-`);
for (const d of [RUN_DIR, AGENT_DIR, WORKSPACE_DIR]) fs.mkdirSync(d, { recursive: true });
const write = (name, body) => fs.writeFileSync(path.join(RUN_DIR, name), typeof body === "string" ? body : JSON.stringify(body, null, 2) + "\n");
const sha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");

// ---- fixed versions and fingerprints --------------------------------------
const versions = {
	scenario,
	startedAt: new Date().toISOString(),
	node: process.version,
	piBinary: execSync("which pi", { encoding: "utf8" }).trim(),
	piVersion: execSync("pi --version", { encoding: "utf8" }).trim(),
	hostPackage: JSON.parse(fs.readFileSync(path.join(os.homedir(), ".nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version,
	launcherPackage: JSON.parse(fs.readFileSync(path.join(LAUNCHER, "package.json"), "utf8")).version,
	localPeerPackage: (() => { try { return JSON.parse(fs.readFileSync(path.join(REPO_DIR, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8")).version; } catch { return null; } })(),
	pluginVersion: JSON.parse(fs.readFileSync(path.join(REPO_DIR, "package.json"), "utf8")).version,
	pluginHead: execSync("git rev-parse HEAD", { cwd: REPO_DIR, encoding: "utf8" }).trim(),
	pluginSourceSha256: Object.fromEntries(["index.ts", "request-control.ts", "request-events.ts", "delegate.ts", "task.ts"].map((f) => [f, sha(path.join(REPO_DIR, f))])),
	launcherIndexSha256: sha(path.join(LAUNCHER, "index.ts")),
	tmpRoot: TMP_ROOT,
};
write("versions.json", versions);

// ---- workspace -------------------------------------------------------------
if (scenario === "natural") {
	fs.writeFileSync(path.join(WORKSPACE_DIR, "fixture.txt"), "The quick brown fox jumps over the lazy dog today.\n");
} else {
	execSync("git init -q", { cwd: WORKSPACE_DIR });
	execSync("git config user.name acceptance-runner && git config user.email acceptance-runner@invalid", { cwd: WORKSPACE_DIR });
	fs.writeFileSync(path.join(WORKSPACE_DIR, "hello.txt"), "hello\n");
	execSync("git add hello.txt && git commit -q -m 'initial commit'", { cwd: WORKSPACE_DIR });
}

// ---- isolated agent directory: one real provider, no ambient config ---------
const sourceModels = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi/agent/models.json"), "utf8"));
fs.writeFileSync(path.join(AGENT_DIR, "models.json"), JSON.stringify({ providers: { "tcuni-luna": sourceModels.providers["tcuni-luna"] } }, null, 2) + "\n");
fs.writeFileSync(path.join(AGENT_DIR, "models-store.json"), "{}\n");
fs.writeFileSync(path.join(AGENT_DIR, "auth.json"), "{}\n");
fs.writeFileSync(path.join(AGENT_DIR, "settings.json"), JSON.stringify({}, null, 2) + "\n");

const env = {
	...process.env,
	PI_CODING_AGENT_DIR: AGENT_DIR,
	TMPDIR: TMP_ROOT, TMP: TMP_ROOT, TEMP: TMP_ROOT,
	PI_PLANNER_ONLY_SEED_PRICING: "0",
	PI_PLANNER_ONLY_QUIESCENCE_MS: "0",
	P0_CLI_EVENT_LOG: path.join(RUN_DIR, "events.jsonl"),
};
delete env.PI_SUBAGENT_CHILD;
for (const key of Object.keys(env)) if (key.startsWith("PI_PLANNER_ONLY_REQUEST_")) delete env[key];
if (scenario === "deadline") env.PI_PLANNER_ONLY_REQUEST_ACTIVE_MS = "45000";

const prompt = scenario === "natural"
	? "Read fixture.txt in the current workspace and report its word count. Make no changes."
	: "Call planner_delegate with role='worker', objective='Run the shell command: sleep 90 ; then create done.txt containing the single word done', validation={required:false}, envelope={maxTokens:50000, maxWallMs:300000}. When it completes, call planner_verdict with the taskId, verdict='pass', summary='done'.";
write("prompt.txt", prompt + "\n");
write("env-knobs.json", Object.fromEntries(Object.entries(env).filter(([k]) => k.startsWith("PI_PLANNER_ONLY") || k === "PI_CODING_AGENT_DIR" || k === "TMPDIR")));

// ---- slot preflight (recorded before the heavy command) ---------------------
fs.writeFileSync(path.join(RUN_DIR, "slot-audit.txt"), spawnSync("slot", ["audit"], { encoding: "utf8" }).stdout ?? "");
fs.writeFileSync(path.join(RUN_DIR, "slot-status.txt"), spawnSync("slot", ["status"], { encoding: "utf8" }).stdout ?? "");

// ---- run ---------------------------------------------------------------------
const args = [
	"cpu", "-L", `p0-cli-${scenario}`, "--",
	"timeout", "900",
	"pi", "-p", "--mode", "json", "--no-extensions", "--no-skills", "--no-prompt-templates",
	"-e", path.join(LAUNCHER, "index.ts"),
	"-e", path.join(REPO_DIR, "index.ts"),
	"-e", path.join(HERE, "probe-events.ts"),
	"--provider", "tcuni-luna", "--model", "gpt-5.6-luna",
	...(scenario === "deadline" ? ["--thinking", "low"] : []),
	prompt,
];
write("command.txt", ["slot", ...args.map((a) => (a === prompt ? "<prompt.txt>" : a))].join(" ") + "\n");
const started = Date.now();
const result = spawnSync("slot", args, { cwd: WORKSPACE_DIR, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const finished = Date.now();
fs.writeFileSync(path.join(RUN_DIR, "stdout.jsonl"), result.stdout ?? "");
fs.writeFileSync(path.join(RUN_DIR, "stderr.txt"), result.stderr ?? "");
write("exit.json", { status: result.status, signal: result.signal, error: result.error ? { code: result.error.code, message: result.error.message } : null, durationMs: finished - started });

// ---- evidence extraction -------------------------------------------------------
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const requestsDir = path.join(AGENT_DIR, "planner-only", "requests");
const requestStates = fs.existsSync(requestsDir)
	? fs.readdirSync(requestsDir).map((h) => ({ namespace: h, ...readJson(path.join(requestsDir, h, "state.json")) }))
	: [];
write("request-state.json", requestStates);
const ledgerDir = path.join(AGENT_DIR, "planner-only", "ledger");
const ledgers = fs.existsSync(ledgerDir) ? fs.readdirSync(ledgerDir).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(ledgerDir, f))) : [];
write("ledger.json", ledgers);
const usageLog = path.join(AGENT_DIR, "planner-only", "usage.jsonl");
if (fs.existsSync(usageLog)) fs.copyFileSync(usageLog, path.join(RUN_DIR, "usage.jsonl"));

const events = fs.existsSync(env.P0_CLI_EVENT_LOG)
	? fs.readFileSync(env.P0_CLI_EVENT_LOG, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
	: [];
const launcher = events.filter((e) => e.kind === "launcher");
const requestsSent = launcher.filter((e) => e.event.endsWith(":request"));
const responses = launcher.filter((e) => e.event.endsWith(":response"));
const cancels = launcher.filter((e) => e.event.endsWith(":cancel"));
const modelCalls = events.filter((e) => e.kind === "host" && e.hook === "before_provider_request");
const toolCalls = events.filter((e) => e.kind === "host" && e.hook === "tool_call");
const toolResults = events.filter((e) => e.kind === "host" && e.hook === "tool_result");

// Root closure instant: the plugin persists closure before cancellation, so
// the first CANCEL (deadline scenario) or the request record itself marks it.
const current = requestStates[0]?.current;
const closedReason = current?.closedReason;
const closureAt = cancels[0]?.t ?? null;
const correlation = requestsSent.map((r) => {
	const terminal = responses.find((x) => x.requestId === r.requestId);
	const cancel = cancels.find((x) => x.requestId === r.requestId);
	const claim = current?.claims?.find((c) => c.key === r.requestId) ?? requestStates[0]?.history?.flatMap((h) => h.claims).find((c) => c.key === r.requestId);
	return {
		requestId: r.requestId, nodeId: r.nodeId, agent: r.agent, requestAt: r.t,
		terminalStatus: terminal?.status ?? null, terminalAt: terminal?.t ?? null, terminalModel: terminal?.model ?? null, terminalUsage: terminal?.usage ?? null,
		cancelAt: cancel?.t ?? null, cancelReason: cancel?.reason ?? null,
		claim: claim ? { committedAt: claim.committedAt, emittedAt: claim.emittedAt ?? null, terminalAt: claim.terminalAt ?? null, stop: claim.stop, waitSettled: claim.waitSettled } : null,
	};
});
const summary = {
	scenario, exit: readJson(path.join(RUN_DIR, "exit.json")),
	limits: current?.limits ?? null,
	request: current ? { id: current.id, closedReason: closedReason ?? null, rootStop: current.rootStop, settled: current.settled, toolAttempts: current.toolAttempts, childLaunches: current.childLaunches, repairs: current.repairs, modelCallsObserved: current.modelCallsObserved, failures: current.failures, claims: current.claims.length, historyRequests: requestStates[0]?.history?.length ?? 0 } : null,
	transport: { requestsObserved: requestsSent.length, terminalsObserved: responses.length, cancelsObserved: cancels.length, correlation },
	rootModelCalls: modelCalls.length,
	rootModelCallsAfterClosure: closureAt === null ? null : modelCalls.filter((e) => e.t > closureAt).length,
	requestsAfterClosure: closureAt === null ? null : requestsSent.filter((e) => e.t > closureAt).length,
	toolCallsAfterClosure: closureAt === null ? null : toolCalls.filter((e) => e.t > closureAt).map((e) => e.toolName),
	toolCalls: toolCalls.map((e) => e.toolName),
	toolResultErrors: toolResults.filter((e) => e.isError).length,
	agentSettledObserved: events.some((e) => e.kind === "host" && e.hook === "agent_settled"),
	ledgerTasks: ledgers.map((l) => ({ taskId: l.task?.taskId, state: l.task?.state, executions: l.task?.executions?.length, children: l.task?.usage?.children?.map((c) => ({ model: c.model, outcome: c.outcome, input: c.usage?.input, output: c.usage?.output })) })),
	stdoutEvents: (result.stdout ?? "").split("\n").filter(Boolean).length,
	workspaceAfter: fs.readdirSync(WORKSPACE_DIR).filter((f) => f !== ".git"),
};
write("summary.json", summary);
console.log(JSON.stringify(summary, null, 2));
console.log(`\nRun directory: ${RUN_DIR}`);
