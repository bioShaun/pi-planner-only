import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const base = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(base, "request-host-run-"));
const agentDir = join(run, "agent"); mkdirSync(agentDir);
const tmpDir = join(run, "runtime-tmp"); mkdirSync(tmpDir);
Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir, TMPDIR: tmpDir, PI_OFFLINE: "1",
  PI_PLANNER_ONLY: "1", PI_PLANNER_ONLY_SEED_PRICING: "0", PI_PLANNER_ONLY_REQUIRE_REVIEW: "0" });
for (const key of Object.keys(process.env)) if (key.startsWith("PI_PLANNER_ONLY_REQUEST_")) delete process.env[key];
delete process.env.PI_SUBAGENT_CHILD;
const cp = createRequire(import.meta.url)("node:child_process");
const originalExec = cp.execFileSync;
cp.execFileSync = (command, args) => { assert.equal(command, "git"); assert.deepEqual(args, ["rev-parse", "HEAD"]); return "fixture-build\n"; };
syncBuiltinESMExports();
const host = process.env.PI_REQUEST_HOST_ROOT ?? "/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent";
const load = path => import(pathToFileURL(join(host, path)).href);
const { createAgentSession } = await load("dist/core/sdk.js");
const { ModelRuntime } = await load("dist/core/model-runtime.js");
const { SessionManager } = await load("dist/core/session-manager.js");
const { SettingsManager } = await load("dist/core/settings-manager.js");
const { createExtensionRuntime, loadExtensionFromFactory } = await load("dist/core/extensions/loader.js");
const { createEventBus } = await load("dist/core/event-bus.js");
const { fauxProvider, fauxAssistantMessage, fauxToolCall } = await load("node_modules/@earendil-works/pi-ai/dist/providers/faux.js");
const { default: plannerOnly } = await import("../../index.ts");
const { hashStatus } = await import("../../evidence.ts");
const { SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST, SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE } = await import("../../subagent-delegation-contract.ts");
writeFileSync(join(run, "fixture.txt"), "fixture\n");
const trace = [], launches = [];
const faux = fauxProvider({ provider: "request-host-probe" });
const runtime = await ModelRuntime.create({ authPath: join(run, "auth.json"), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
runtime.registerNativeProvider(faux.provider);
const extensionRuntime = createExtensionRuntime();
let queued = false, session;
const extension = await loadExtensionFromFactory(pi => {
  plannerOnly({ ...pi, exec: async (command, args) => {
    assert.equal(command, "git");
    const values = { "rev-parse --git-dir": ".git\n", "rev-parse --show-toplevel": `${run}\n`, "rev-parse HEAD": "abc1234\n", "status --porcelain=v2 --branch": "" };
    return { stdout: values[args.join(" ")] ?? "", stderr: "", code: 0 };
  } });
  pi.events.on(REQUEST, request => {
    launches.push(request);
    queueMicrotask(() => pi.events.emit(RESPONSE, { requestId: request.requestId, ownerRunId: request.ownerRunId,
      nodeId: request.nodeId, status: "completed", runId: `faux-${request.requestId}`, agent: request.agent, model: "fixture/no-model",
      result: { kind: "structured", value: { version: 1, taskId: request.nodeId, status: "completed", summary: "fixture read",
        changedFiles: [], validation: [], risks: [], unresolved: [], evidence: { cwd: run, taskId: request.nodeId,
          baseGitRef: "abc1234", finalGitRef: "abc1234", gitStatusHash: hashStatus(""), changedPaths: [] } } } }));
  });
  for (const name of ["input", "agent_start", "agent_end", "agent_settled", "tool_call", "tool_result", "before_provider_request"]) {
    pi.on(name, (event, ctx) => {
      trace.push({ event: name, source: event.source, streamingBehavior: event.streamingBehavior, toolCallId: event.toolCallId,
        toolName: event.toolName, modelCalls: faux.state.callCount, idle: ctx.isIdle() });
      if (name === "tool_call" && event.toolCallId === "bad-3" && !queued) {
        queued = true;
        pi.sendMessage({ customType: "request-probe-queue", content: "continue automatically", display: false }, { deliverAs: "followUp" });
      }
    });
  }
}, run, createEventBus(), extensionRuntime);
const resourceLoader = {
  getExtensions: () => ({ extensions: [extension], errors: [], runtime: extensionRuntime }),
  getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () => "Bounded deterministic request integration probe.", getSystemPromptSource: () => undefined,
  getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [], extendResources() {}, async reload() {},
};
({ session } = await createAgentSession({ cwd: run, agentDir, model: faux.getModel(), modelRuntime: runtime,
  sessionManager: SessionManager.inMemory(run), settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
  resourceLoader, tools: ["planner_verdict", "planner_delegate", "planner_tasks"], thinkingLevel: "off" }));
const readState = () => {
  const hash = createHash("sha256").update(JSON.stringify([session.sessionId, run])).digest("hex");
  return JSON.parse(readFileSync(join(agentDir, "planner-only", "requests", hash, "state.json"), "utf8")).current;
};
const bad = i => fauxAssistantMessage([fauxToolCall("planner_verdict", { taskId: "T-19000101-999", verdict: "pass", summary: `wording ${i}` }, { id: `bad-${i}` })]);
const delegate = id => fauxAssistantMessage([fauxToolCall("planner_delegate", { role: "worker", objective: "Inspect fixture", scope: { allowedPaths: ["fixture.txt"] },
  constraints: [], acceptanceCriteria: ["report inspection"], validation: { required: false } }, { id })]);
const watchdog = setTimeout(() => { throw new Error("request host probe timed out"); }, 15_000);
try {
  await session.bindExtensions({ mode: "json" });
  faux.setResponses([bad(1), bad(2), bad(3), delegate("queued"), fauxAssistantMessage("done")]);
  await session.prompt("first independent input", { source: "interactive" });
  const stopped = readState();
  assert.match(stopped.closedReason, /no-progress/);
  assert.equal(launches.length, 0);
  assert.equal(stopped.failures.length, 3);
  assert.ok(trace.some(e => e.event === "agent_settled"));
  const modelCallsAtFirstSettlement = faux.state.callCount;
  const modelCallsAtClosure = trace.find(e => e.event === "tool_result" && e.toolCallId === "bad-3").modelCalls;
  const extraModelCallsAfterClose = modelCallsAtFirstSettlement - modelCallsAtClosure;
  assert.equal(extraModelCallsAfterClose, 1, "queued follow-up can make another model call despite durable admission closure");
  faux.setResponses([delegate("extension-attempt"), fauxAssistantMessage("extension done")]);
  await session.sendUserMessage("automatic extension follow-up");
  assert.equal(readState().id, stopped.id);
  assert.equal(launches.length, 0);
  // Text injected by an extension cannot invoke the command in default mode.
  faux.setResponses([fauxAssistantMessage("command text received")]);
  await session.sendUserMessage("/planner-only request resume");
  assert.equal(readState().id, stopped.id);
  // Even explicit command expansion lacks a human UI and cannot reset.
  await session.sendUserMessage("/planner-only request resume", { expandPromptTemplates: true });
  assert.equal(readState().id, stopped.id);
  faux.setResponses([delegate("fresh-interactive"), fauxAssistantMessage("inspection done")]);
  await session.prompt("next independent interactive input", { source: "interactive" });
  assert.notEqual(readState().id, stopped.id);
  assert.equal(launches.length, 1);
  const resumed = readState();
  faux.setResponses([1, 2, 3].map(i => fauxAssistantMessage([fauxToolCall("never_registered", {}, { id: `unknown-${i}` })])));
  await session.prompt("another independent input", { source: "interactive" });
  const unknown = readState();
  assert.match(unknown.closedReason, /no-progress/);
  assert.equal(unknown.toolAttempts, 3, "unknown tools rejected before tool_call still count");
  assert.equal(launches.length, 1);
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("planner_tasks", { taskId: {}, executionId: {} }, { id: "schema-two" })]),
    fauxAssistantMessage([fauxToolCall("planner_tasks", { taskId: {} }, { id: "schema-one" })]),
    fauxAssistantMessage([fauxToolCall("planner_tasks", {}, { id: "schema-fixed" })]),
    fauxAssistantMessage("parameters repaired"),
  ]);
  await session.prompt("repair arguments on an independent request", { source: "interactive" });
  const repaired = readState();
  assert.equal(repaired.repairs, 2, "host pre-hook validation does not bypass structural repair accounting");
  assert.equal(repaired.failures.length, 2, "successful repair does not erase existing failures");
  assert.ok(repaired.failures.every(f => f.family === "contract:planner_tasks:arguments"));
  assert.equal(repaired.closedReason, undefined);
  assert.equal(repaired.toolAttempts, 3);
  assert.equal(launches.length, 1);
  const result = { status: "PASS", host, hostVersion: JSON.parse(readFileSync(join(host, "package.json"), "utf8")).version,
    modelCallsAtClosure, modelCallsAtFirstSettlement, extraModelCallsAfterClose, modelCallsTotal: faux.state.callCount, stopped, next: resumed, unknown, repaired, trace,
    scope: "Real SDK/ExtensionRunner and real plugin; faux provider, fake Git and launcher events; no subprocess/network/paid model; SDK retry disabled.",
    limitations: "No real CLI/TUI or pi-subagents 0.69.0 runtime acceptance; no provider billing or all-mode Root stop guarantee.", run };
  writeFileSync(join(run, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ status: result.status, hostVersion: result.hostVersion, extraModelCallsAfterClose, modelCallsTotal: result.modelCallsTotal, launches: launches.length, run }));
} finally {
  clearTimeout(watchdog); await session.abort(); session.dispose();
  writeFileSync(join(run, "trace.json"), JSON.stringify(trace, null, 2));
  cp.execFileSync = originalExec; syncBuiltinESMExports();
}
