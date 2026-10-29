import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createLedger } from "./budget-guard-core.mjs";
import { ROLE_AGENTS } from "../../delegate.ts";
import delegationObserver from "./delegation-observer.ts";
import { SUBAGENT_DELEGATION_REQUEST_EVENT, SUBAGENT_DELEGATION_RESPONSE_EVENT } from "../../subagent-delegation-contract.ts";

const runner = process.env.OFFLINE_RUNNER ?? resolve(".scratch/native-lite-lifecycle/run-rpc-arm.mjs");
const guideFixture = resolve(".scratch/native-call-classification/guide-fixture.json");
const managementFixtures = resolve(".scratch/native-call-classification/management-fixtures.json");
const base = "/project/tmp/pi-native-call-classification";
const packageRoot = process.env.PI_SUBAGENTS_DIR ?? "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents";
const { formatSubagentCostReport } = await import(`${packageRoot}/src/slash/subagent-cost.js`);

function workspaceDigest(cwd) {
  const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
  const diff = execFileSync("git", ["diff", "HEAD", "--binary"], { cwd, encoding: "buffer" });
  const names = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, encoding: "buffer" }).toString().split("\0").filter(Boolean).sort();
  const files = names.map(path => ({ path, sha256: createHash("sha256").update(execFileSync("cat", ["--", join(cwd, path)])).digest("hex") }));
  return createHash("sha256").update(JSON.stringify({ tree, diffSha256:createHash("sha256").update(diff).digest("hex"), files })).digest("hex");
}

function roleSpecs(pair) {
  return pair === "S1" ? [{role:"worker",agent:"worker"}] : [{role:"validator",agent:ROLE_AGENTS.validator.agent},{role:"reviewer",agent:"reviewer"}];
}

function liteBridgeMessages(specs, fault) {
  const handlers = new Map();
  const messages = [];
  const pi = { events:{on(name, handler){handlers.set(name,handler);}}, sendMessage(message, options){messages.push({message,options});} };
  delegationObserver(pi);
  specs.forEach((spec,index) => {
    const request = { requestId:"req-"+(index+1), ownerRunId:"root-run", nodeId:"node-"+(index+1), agent:spec.agent,
      task:"read-only report", context:"fresh", cwd:"/offline/checkout", result:{kind:"text"} };
    handlers.get(SUBAGENT_DELEGATION_REQUEST_EVENT)(request);
    const failed = fault === "lite-child-failed" && index === 0;
    handlers.get(SUBAGENT_DELEGATION_RESPONSE_EVENT)({ ...request, runId:"run-"+(index+1), status:failed ? "failed" : "completed",
      ...(failed ? {error:"offline child failed"} : {result:{kind:"text",text:"offline report"}}) });
  });
  return messages.map(item => item.message);
}

const fakePi = `#!/usr/bin/env node
import { appendFileSync, symlinkSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
let buffer = "";
const emit = value => process.stdout.write(JSON.stringify(value) + "\\n");
const sessionId = process.argv[process.argv.indexOf("--session-id") + 1];
const pair = process.cwd().endsWith("S2-native") || process.cwd().endsWith("S2-lite") ? "S2" : "S1";
const mode = process.cwd().endsWith("-lite") ? "lite" : "native";
const roleSpecs = pair === "S1" ? [{role:"worker",agent:"worker"}] : [{role:"validator",agent:"oracle"},{role:"reviewer",agent:"reviewer"}];
const roles = roleSpecs.map(item => item.agent);
const ids = roles.map((_, index) => "run-" + (index + 1));
const requests = roles.map((_, index) => ({ requestId:"req-" + (index + 1), ownerRunId:"root-run", nodeId:"node-" + (index + 1) }));
function finishChildren() {
  if (process.env.FAULT === "no-child") {
    emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"stop", content:[{type:"text",text:"No delegation."}] } });
    emit({ type:"agent_settled" }); return;
  }
  if (process.env.FAULT === "root-abort") {
    emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"aborted", content:[] } });
    emit({ type:"agent_settled" }); return;
  }
  const acceptance = [];
  for (let index = 0; index < roles.length; index++) {
    const reportPath = process.env.REPORT_ROOT + "/child-" + (index + 1) + ".md";
    const body = "report " + roles[index];
    if (process.env.FAULT === "report-symlink" && index === 0) symlinkSync(process.env.OUTSIDE_REPORT, reportPath);
    else writeFileSync(reportPath, body);
    acceptance.push({ role:roleSpecs[index].role, agent:roles[index], runId:ids[index],
      ...(mode === "lite" ? {requestId:requests[index].requestId,ownerRunId:requests[index].ownerRunId,nodeId:requests[index].nodeId} : {}), reportPath,
      reportSha256:createHash("sha256").update(body).digest("hex"), sessionId, attemptId:process.env.PI_NATIVE_LITE_ATTEMPT_ID,
      accepted:true, verdict:"accepted", reviewVerdict:"accepted" });
  }
  if (process.env.FAULT === "report-mutated") writeFileSync(acceptance[0].reportPath,"changed after report hash");
  if (mode === "native") {
    if (process.env.FAULT === "stale-receipt") emit({ type:"message_end", message:{ role:"custom", customType:"subagent-notify", content:"stale", details:{ runs:[{runId:"wrong-run",agent:roles[0],status:"completed",source:"async"}] } } });
    const runs = roles.map((agent,index)=>({runId:ids[index],agent,status:"completed",source:process.env.FAULT === "bad-source" ? "foreground" : "async"}));
    if (process.env.FAULT === "duplicate-receipt") runs.push(runs[0]);
    emit({ type:"message_end", message:{ role:"custom", customType:"subagent-notify", content:"completed", details:{ runs } } });
  } else {
    for (const message of JSON.parse(readFileSync(process.env.LITE_STARTS,"utf8"))) emit({ type:"message_end", message:{role:"custom", ...message} });
    const messages = JSON.parse(readFileSync(process.env.LITE_TERMINALS,"utf8"));
    if (process.env.FAULT === "cross-run") emit({ type:"message_end", message:{role:"custom", ...messages[0], details:{...messages[0].details,ownerRunId:"stale-root"}} });
    for (const message of messages) emit({ type:"message_end", message:{role:"custom", ...message} });
    if (process.env.FAULT === "duplicate-receipt") emit({ type:"message_end", message:{role:"custom", ...messages[0]} });
  }
  appendFileSync(process.env.TRACE, "CHILD_COMPLETED\\n");
  if (process.env.FAULT === "dirty-workspace") writeFileSync(process.cwd()+"/input/brief.md", "mutated candidate content");
  if (process.env.FAULT === "dirty-untracked") writeFileSync(process.cwd()+"/input/notes.tmp", "changed bytes, same untracked path");
  if (process.env.FAULT === "completion-before-old-settled") emit({ type:"agent_settled" });
  if (mode === "native" && process.env.FAULT !== "lite-same-turn-final") emit({ type:"agent_start" });
  if (process.env.FAULT !== "missing-acceptance") {
    if (process.env.FAULT === "wrong-hash") acceptance[0].reportSha256 = "0".repeat(64);
    if (process.env.FAULT === "wrong-path") acceptance[0].reportPath = "/etc/passwd";
    if (process.env.FAULT === "wrong-session") acceptance[0].sessionId = "other-session";
    if (process.env.FAULT === "wrong-run") acceptance[0].runId = "unlaunched-child";
    if (process.env.FAULT === "rejected") acceptance[0].accepted = false;
    if (process.env.FAULT === "wrong-verdict") acceptance[0].reviewVerdict = "rejected";
    emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"stop", content:[{type:"text",text:"\`\`\`root-acceptance\\n"+JSON.stringify({accepted:process.env.FAULT !== "rejected",sessionId,attemptId:process.env.PI_NATIVE_LITE_ATTEMPT_ID,children:acceptance})+"\\n\`\`\`"}] } });
  }
  emit({ type:"agent_settled" });
}
process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split("\\n"); buffer = lines.pop();
  for (const line of lines) {
    if (!line) continue;
    const command = JSON.parse(line);
    appendFileSync(process.env.TRACE, command.id + "\\n");
    if (command.type === "get_state" && process.env.FAULT === "malformed-rpc") { process.stdout.write("not-json\\n"); continue; }
    if (command.type === "get_state") emit({ type:"response", id:command.id, success:true, data:{ model:{provider:"tcuni",id:process.env.FAULT === "state-mismatch" ? "wrong-model" : "gpt-6.1-terra"}, thinkingLevel:"high", sessionId }});
    if (command.id === "p6-task") {
      emit({ type:"response", id:command.id, success:process.env.FAULT !== "task-reject", data:{disposition:"started"} });
      if (process.env.FAULT === "task-reject") continue;
      if (process.env.FAULT === "no-child" || process.env.FAULT === "root-abort") { finishChildren(); continue; }
      if (mode === "native" && ["guide-replay","guide-failed","guide-spoof","guide-duplicate","guide-unassociated","guide-unknown","guide-mixed","guide-reordered","guide-no-child","guide-active","guide-pending","guide-resume","guide-workflow","guide-duplicate-call"].includes(process.env.FAULT)) {
        const guide = JSON.parse(readFileSync(process.env.GUIDE_FIXTURE,"utf8"));
        if (process.env.FAULT === "guide-unknown") guide.call.arguments.action = "unknown";
        if (process.env.FAULT === "guide-mixed") guide.call.arguments.agent = "worker";
        if (process.env.FAULT === "guide-resume") guide.call.arguments = {action:"resume",id:"run-1"};
        if (process.env.FAULT === "guide-workflow") guide.call.arguments = {workflow:"parallel"};
        if (process.env.FAULT === "guide-failed") guide.result.isError = true;
        if (process.env.FAULT === "guide-spoof") guide.result.details = {mode:"single",asyncId:"run-1",runId:"run-1",results:[]};
        if (process.env.FAULT === "guide-unassociated") guide.result.toolCallId = "other";
        if (process.env.FAULT === "guide-reordered") emit({type:"message_end",message:guide.result});
        emit({type:"message_end",message:{role:"assistant",provider:"tcuni",model:"gpt-6.1-terra",stopReason:"toolUse",content:[guide.call]}});
        if (process.env.FAULT === "guide-duplicate-call") emit({type:"message_end",message:{role:"assistant",provider:"tcuni",model:"gpt-6.1-terra",stopReason:"toolUse",content:[guide.call]}});
        if (process.env.FAULT !== "guide-pending") emit({type:"message_end",message:guide.result});
        if (process.env.FAULT === "guide-duplicate") emit({type:"message_end",message:guide.result});
        if (process.env.FAULT === "guide-no-child") { emit({type:"message_end",message:{role:"assistant",provider:"tcuni",model:"gpt-6.1-terra",stopReason:"stop",content:[{type:"text",text:"No child."}]}}); emit({type:"agent_settled"}); continue; }
      }
      if (mode === "native" && ["management-contract","status-spoof"].includes(process.env.FAULT)) {
        for (const item of JSON.parse(readFileSync(process.env.MANAGEMENT_FIXTURES,"utf8"))) {
          if (process.env.FAULT === "status-spoof" && item.action === "status-async") item.details.asyncId = "run-1";
          const id = "query-" + item.action;
          emit({type:"message_end",message:{role:"assistant",provider:"tcuni",model:"gpt-6.1-terra",stopReason:"toolUse",content:[{type:"toolCall",id,name:"subagent",arguments:item.arguments}]}});
          emit({type:"message_end",message:{role:"toolResult",toolName:"subagent",toolCallId:id,isError:false,content:[{type:"text",text:"offline source-bound result"}],details:item.details}});
        }
      }
      if (mode === "native") for (let index=0; index<roles.length; index++) {
        const toolCallId = "tool-" + (index+1);
        const args = {agent:roles[index],task:"read-only report",...(process.env.FAULT === "native-acceptance-missing" ? {} : {acceptance:{level:"none",reason:"read-only report; Root performs evidence acceptance"}})};
        emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"toolUse", content:[{type:"toolCall", id:toolCallId, name:"subagent", arguments:args}] } });
        emit({ type:"message_end", message:{ role:"toolResult", toolName:"subagent", toolCallId, isError:false, details:{mode:process.env.FAULT === "bad-mode" ? "workflow" : "single",runId:ids[index],asyncId:ids[index],results:[]} } });
        if (process.env.FAULT === "duplicate-launch-result") emit({ type:"message_end", message:{ role:"toolResult", toolName:"subagent", toolCallId, isError:false, details:{mode:"single",runId:ids[index],asyncId:ids[index],results:[]} } });
      } else for (let index=0; index<roles.length; index++) {
        const toolCallId = "delegate-"+(index+1);
        emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"toolUse", content:[{type:"toolCall", id:toolCallId, name:"delegate", arguments:{role:roleSpecs[index].role}}] } });
        emit({ type:"message_end", message:{ role:"toolResult", toolName:"delegate", toolCallId, isError:false, details:{status:process.env.FAULT === "lite-tool-failed" ? "failed" : "completed"} } });
      }
      if (mode === "native") {
        if (process.env.FAULT === "management-contract") {
          const item = JSON.parse(readFileSync(process.env.MANAGEMENT_FIXTURES,"utf8")).at(-1);
          emit({type:"message_end",message:{role:"assistant",provider:"tcuni",model:"gpt-6.1-terra",stopReason:"toolUse",content:[{type:"toolCall",id:"query-interleaved",name:"subagent",arguments:item.arguments}]}});
          emit({type:"message_end",message:{role:"toolResult",toolName:"subagent",toolCallId:"query-interleaved",isError:false,content:[{type:"text",text:"offline status"}],details:item.details}});
        }
        emit({ type:"message_end", message:{ role:"assistant", provider:"tcuni", model:"gpt-6.1-terra", stopReason:"stop", content:[{type:"text",text:"Waiting for child report."}] } });
        if (process.env.FAULT !== "completion-before-old-settled") emit({ type:"agent_settled" });
      }
      if (process.env.FAULT === "timeout-active-child" || process.env.FAULT === "guide-active") continue;
      if (process.env.FAULT === "completion-before-old-settled") {
        setTimeout(() => finishChildren(), 120);
        continue;
      }
      setTimeout(finishChildren, 200);
    }
    if (command.id === "p6-child-cost") {
      if (process.env.FAULT === "report-mutated-during-cost") writeFileSync(process.env.REPORT_ROOT+"/child-1.md","mutated while cost query was running");
      emit({ type:"response", id:command.id, success:true });
      const report = process.env.FAULT === "usage-unavailable" ? "Async child usage unavailable: 1.\\n" : process.env.FAULT === "usage-mismatch" ? "Child 1 (wrong-role): ↑1 ↓1 $0.0001\\n" : readFileSync(process.env.COST_REPORT,"utf8");
      emit({ type:"message_end", message:{ role:"custom", customType:"subagent-slash-text-result", content:report } });
      if (process.env.FAULT === "root-activity-after-cost") emit({type:"agent_start"});
    }
  }
});
process.stdin.on("end", () => process.exit(0));
`;

async function fixture({ pair = "S1", mode = "native", attempt = "attempt-a", briefOverride, fault } = {}) {
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "stage-b-"));
  const cwd = join(dir, "worktrees", `${pair}-${mode}`);
  const batchRoot = join(dir, "batch");
  const results = join(batchRoot, "results", attempt, `${pair}-${mode}`);
  await mkdir(join(cwd, "input"), { recursive: true });
  await mkdir(join(batchRoot, "common"), { recursive: true });
  execFileSync("git", ["init", "-q", cwd]);
  const diff = "synthetic immutable S2 diff\n";
  if (pair === "S2") {
    await writeFile(join(batchRoot, "common", "S2-candidate.diff"), diff);
    await writeFile(join(cwd, "input", "S2-candidate.diff"), diff);
  }
  if (fault === "dirty-untracked") await writeFile(join(cwd,"input","notes.tmp"),"initial bytes");
  const reviewerLine = pair === "S2" ? ` S2 reviewer reads only this immutable, precomputed diff artifact: \`${join(batchRoot, "common", "S2-candidate.diff")}\`.` : "";
  const brief = briefOverride ?? `Shared contract: results under \`${batchRoot}/results/${attempt}/<pair>-<mode>/\`, worktree CWD \`${dir}/worktrees/<pair>-<mode>\`.${reviewerLine} Root must wait for each child report, consume its completion, then issue root-acceptance JSON binding accepted=true, sessionId, attemptId and each child's logical role, actual agent, runId, Lite requestId/ownerRunId/nodeId, reportPath, reportSha256, sessionId, attemptId, accepted=true, verdict=accepted, and reviewVerdict=accepted. Native read-only calls must pass supported subagent arguments.acceptance {level:none, reason:"read-only report; Root performs evidence acceptance"}; Native validator work uses agent oracle. Lite workers return plain-text reports because the installed adapter hardcodes acceptance=false and exposes no child acceptance field. Root separately verifies report bytes and evidence. Read-only children return reports; no code or test changes are required.\n`;
  await writeFile(join(cwd, "input", "brief.md"), brief);
  execFileSync("git", ["add", "input/brief.md"], { cwd });
  if (pair === "S2") execFileSync("git", ["add", "input/S2-candidate.diff"], { cwd });
  execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture baseline"], { cwd });
  const pi = join(dir, "fake-pi.mjs");
  await writeFile(pi, fakePi); await chmod(pi, 0o700);
  const ledgerPath = join(dir, "ledger.json");
  await createLedger(ledgerPath, { initialReserveUsd: 4.7, sessionId: "synthetic-history" });
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  const tree = execFileSync("git", ["write-tree"], { cwd, encoding: "utf8" }).trim();
  const manifestPath = join(dir, "manifest.json");
  const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0.0001, turns: 1 };
  const costReportPath = join(dir, "actual-cost-report.txt");
  const outsideReportPath = join(dir,"outside-report.md");
  await writeFile(outsideReportPath,"report worker");
  const costReport = formatSubagentCostReport({ version:1, parent:usage, children:roleSpecs(pair).map((item,index)=>({label:`Child ${index+1} (${item.agent})`,agent:item.agent,runId:`run-${index+1}`,usage})), childTotal:usage, total:usage, unresolvedAsyncChildren:0 });
  await writeFile(costReportPath, costReport);
  const liteMessages = liteBridgeMessages(roleSpecs(pair), fault);
  const liteStartsPath = join(dir,"lite-starts.json");
  const liteTerminalsPath = join(dir,"lite-terminals.json");
  await writeFile(liteStartsPath, JSON.stringify(liteMessages.filter(item=>item.customType === "native-lite-delegation-start")));
  await writeFile(liteTerminalsPath, JSON.stringify(liteMessages.filter(item=>item.customType === "native-lite-delegation-receipt")));
  const manifest = {
    version: 1, pair, mode, attemptId: attempt, batchId: "20261030T120000+0800",
    briefSha256: createHash("sha256").update(brief).digest("hex"), pairedBriefSha256: createHash("sha256").update(brief).digest("hex"),
    gitTree: tree, workspaceSha256: workspaceDigest(cwd), s2DiffSha256: pair === "S2" ? createHash("sha256").update(diff).digest("hex") : undefined,
    ledgerEventsSha256: createHash("sha256").update(JSON.stringify(ledger.events)).digest("hex"),
    ledgerReservedUsd: ledger.reservedUsd, ledgerPrefixCount: ledger.events.length,
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { dir, cwd, batchRoot, results, pi, ledgerPath, manifestPath, brief, tree, pair, mode, costReportPath, outsideReportPath, liteStartsPath, liteTerminalsPath };
}

function launch(f, extra = {}) {
  const trace = join(f.dir, "trace.txt");
  const child = spawn(process.execPath, [runner], { cwd: f.cwd, env: {
    ...process.env, PI_BIN: f.pi, PI_NATIVE_LITE_BATCH_ROOT: f.batchRoot,
    PI_NATIVE_LITE_BATCH_ID: "20261030T120000+0800", PI_NATIVE_LITE_ATTEMPT_ID: "attempt-a",
    PI_NATIVE_LITE_SHARED_LEDGER: f.ledgerPath, PI_NATIVE_LITE_MANIFEST: f.manifestPath,
    PI_NATIVE_LITE_RPC_DEADLINE_MS: extra["FAULT"] === "missing-acceptance" ? "500" : ["timeout-active-child","guide-active"].includes(extra["FAULT"]) ? "800" : "3000", TRACE: trace, REPORT_ROOT: f.results, COST_REPORT:f.costReportPath, OUTSIDE_REPORT:f.outsideReportPath, LITE_STARTS:f.liteStartsPath, LITE_TERMINALS:f.liteTerminalsPath, GUIDE_FIXTURE:guideFixture, MANAGEMENT_FIXTURES:managementFixtures, ...extra,
  }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => stderr += chunk);
  const closed = new Promise(resolveClose => child.once("close", code => resolveClose({ code, stderr, trace })));
  return { child, closed };
}

test("real guide event replay precedes a complete Native child lifecycle", async () => {
  const f = await fixture();
  const result = await launch(f, { FAULT:"guide-replay" }).closed;
  const control = await readFile(join(f.results,"control.jsonl"),"utf8");
  assert.equal(result.code, 0, control);
  const trace = await readFile(result.trace,"utf8");
  assert.ok(trace.indexOf("CHILD_COMPLETED") < trace.indexOf("p6-child-cost"), trace);
});

test("management faults fail closed and retain the first failure", async () => {
  const cases = {"guide-failed":"native-management-failed","guide-spoof":"native-management-failed","status-spoof":"native-management-failed","guide-duplicate":"native-launch-failed","guide-unassociated":"native-launch-failed","guide-reordered":"native-launch-failed","guide-unknown":"native-call-unsupported","guide-mixed":"native-call-unsupported","guide-resume":"native-call-unsupported","guide-workflow":"native-call-unsupported","guide-duplicate-call":"native-launch-policy-rejected","guide-no-child":"no-child-result","guide-active":"arm-timeout"};
  for (const [fault, expected] of Object.entries(cases)) {
    const f = await fixture();
    const result = await launch(f, {FAULT:fault}).closed;
    const control = (await readFile(join(f.results,"control.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
    assert.notEqual(result.code, 0, fault);
    const first = control.find(item => item.event === expected);
    assert.ok(first, fault);
    assert.equal(control.at(-1).failure, first.failure ?? `arm deadline reached after 800 ms`, fault);
    assert.doesNotMatch(await readFile(result.trace,"utf8"), /p6-child-cost/, fault);
  }
});

test("review pending management cannot reach cost or successful terminal", async () => {
  const f = await fixture();
  const result = await launch(f, {FAULT:"guide-pending"}).closed;
  const control = (await readFile(join(f.results,"control.jsonl"),"utf8")).trim().split("\n").map(JSON.parse);
  assert.notEqual(result.code, 0, "pending call must fail closed");
  assert.ok(control.some(item => item.event === "native-call-pending"));
  assert.ok(!control.some(item => item.event === "arm-lifecycle-complete"));
  const trace = await readFile(result.trace,"utf8");
  assert.match(trace, /CHILD_COMPLETED/);
  assert.doesNotMatch(trace, /p6-child-cost/);
});

test("review source-bound management envelopes permit full Native lifecycle", async () => {
  const f = await fixture();
  const result = await launch(f, {FAULT:"management-contract"}).closed;
  const control = await readFile(join(f.results,"control.jsonl"),"utf8");
  assert.equal(result.code, 0, control);
  const trace = await readFile(result.trace,"utf8");
  assert.ok(trace.indexOf("CHILD_COMPLETED") < trace.indexOf("p6-child-cost"), trace);
});

test("review management fixture is bound to the installed handler source", async () => {
  const root = "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src";
  const sources = {"agents/agent-management.js":"cf9489cbe964c3f4a8b820d293221abbb7c7ade85d9a145b78c528238652104b", "runs/background/run-status.js":"693ff5d85699a39adc4000894cfb241a1809fab93bc84b38d07f6389e95ee7c3", "runs/foreground/subagent-executor.js":"6b83c3469b9eb9df6a9f65587fc84bdd8a45369f5077aeb6eaeb2a24bd6cb2e2"};
  for (const [path, hash] of Object.entries(sources)) assert.equal(createHash("sha256").update(await readFile(join(root,path))).digest("hex"), hash, path);
  const fixtures = JSON.parse(await readFile(managementFixtures,"utf8"));
  assert.deepEqual(fixtures.map(item => [item.action,item.details.mode,item.details.results]), [["list","management",[]],["models","management",[]],["status-foreground","management",[]],["status-async","single",[]]]);
  assert.equal(fixtures.at(-1).details.runId, "run-1");
});

test("controller stays open through interim Root settlement, then accepts completed child evidence before cost audit", async () => {
  const f = await fixture();
  const { closed } = launch(f);
  let trace = "";
  for (let attempt = 0; attempt < 100; attempt++) {
    trace = await readFile(join(f.dir, "trace.txt"), "utf8").catch(() => "");
    if (trace.includes("p6-task")) break;
    await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
  }
  await new Promise(resolveDelay => setTimeout(resolveDelay, 80));
  trace = await readFile(join(f.dir, "trace.txt"), "utf8");
  assert.doesNotMatch(trace, /p6-child-cost/, "interim Root settlement must not query cost before child completion");
  const result = await closed;
  trace = await readFile(result.trace, "utf8");
  assert.equal(result.code, 0, result.stderr);
  assert.ok(trace.indexOf("CHILD_COMPLETED") < trace.indexOf("p6-child-cost"), trace);
});

test("Native and Lite S1/S2 process replays accept actual receipt shapes and exact roles", async () => {
  for (const [pair, mode] of [["S1","native"],["S1","lite"],["S2","native"],["S2","lite"]]) {
    const f = await fixture({ pair, mode });
    const { closed } = launch(f);
    const result = await closed;
    const control = await readFile(join(f.results,"control.jsonl"),"utf8").catch(()=>"no control log");
    assert.equal(result.code, 0, `${pair}-${mode}: ${result.stderr}\n${control}`);
    assert.match(await readFile(join(f.results, "subagent-cost.txt"), "utf8"), /Child 1 \(/);
  }
});

test("completion before stale settlement and Lite same-turn completion both wait for a fresh Root acceptance", async () => {
  for (const [pair, mode, fault] of [["S2","native","completion-before-old-settled"],["S1","lite","lite-same-turn-final"]]) {
    const f = await fixture({ pair, mode, fault });
    const { closed } = launch(f, { FAULT:fault });
    const result = await closed;
    assert.equal(result.code, 0, `${fault}: ${result.stderr}`);
    const trace = await readFile(result.trace,"utf8");
    assert.ok(trace.indexOf("CHILD_COMPLETED") < trace.indexOf("p6-child-cost"), trace);
  }
});

test("otherwise-valid frozen brief with old worktree/results paths rejects before fake Pi starts", async () => {
  for (const field of ["worktree CWD", "results under"]) {
    const f = await fixture();
    const brief = field === "worktree CWD"
      ? f.brief.replace(`worktree CWD \`${f.dir}/worktrees/<pair>-<mode>\``, `worktree CWD \`${f.dir}/old-worktrees/<pair>-<mode>\``)
      : f.brief.replace(`results under \`${f.batchRoot}/results/attempt-a/<pair>-<mode>/\``, `results under \`${f.batchRoot}/old-results/attempt-a/<pair>-<mode>/\``);
    await writeFile(join(f.cwd, "input", "brief.md"), brief);
    const manifest = JSON.parse(await readFile(f.manifestPath, "utf8"));
    manifest.briefSha256 = createHash("sha256").update(brief).digest("hex");
    manifest.pairedBriefSha256 = manifest.briefSha256;
    manifest.workspaceSha256 = workspaceDigest(f.cwd);
    await writeFile(f.manifestPath, JSON.stringify(manifest));
    const { closed } = launch(f);
    const result = await closed;
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, field === "worktree CWD" ? /brief cwd contract mismatch/ : /brief results contract mismatch/);
    await assert.rejects(readFile(result.trace));
  }
});

test("report, identity, review, workspace, usage and receipt faults fail closed", async () => {
  const expected = {
    "wrong-hash":"acceptance-rejected", "wrong-path":"acceptance-rejected", "wrong-session":"root-acceptance-rejected", "wrong-run":"acceptance-rejected",
    rejected:"root-acceptance-rejected", "wrong-verdict":"root-acceptance-rejected", "report-mutated":"acceptance-rejected",
    "report-mutated-during-cost":"terminal-evidence-rejected",
    "report-symlink":"acceptance-rejected", "dirty-workspace":"acceptance-rejected", "dirty-untracked":"acceptance-rejected",
    "usage-unavailable":"usage-unavailable", "usage-mismatch":"usage-mismatch", "stale-receipt":"native-receipt-rejected",
    "duplicate-receipt":"native-receipt-rejected", "cross-run":"lite-receipt-rejected", "lite-child-failed":"child-terminal-failure",
    "lite-tool-failed":"lite-tool-result-failed", "missing-acceptance":"arm-timeout", "no-child":"no-child-result",
    "root-abort":"root-terminal-failure", "malformed-rpc":"rpc-malformed", "state-mismatch":"rpc-state-mismatch",
    "task-reject":"task-prompt-rejected", "timeout-active-child":"arm-timeout", "native-acceptance-missing":"native-launch-policy-rejected",
    "bad-mode":"native-launch-failed", "bad-source":"native-receipt-rejected", "duplicate-launch-result":"native-launch-failed",
    "root-activity-after-cost":"root-activity-during-cost-audit",
  };
  for (const [fault, expectedEvent] of Object.entries(expected)) {
    const mode = ["cross-run","lite-child-failed","lite-tool-failed"].includes(fault) ? "lite" : "native";
    const pair = ["bad-mode","bad-source","duplicate-launch-result"].includes(fault) ? "S2" : "S1";
    const f = await fixture({ pair, mode, fault });
    const { closed } = launch(f, { FAULT:fault });
    const result = await closed;
    assert.notEqual(result.code, 0, `${fault} must fail closed`);
    const control = (await readFile(join(f.results,"control.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
    assert.ok(control.some(item=>item.event === expectedEvent), `${fault} lacked causal ${expectedEvent} event`);
    if (!fault.startsWith("usage-") && fault !== "missing-acceptance" && fault !== "timeout-active-child") {
      assert.equal(control.some(item=>item.event === "arm-timeout"), false, `${fault} must reject without timeout`);
    }
    const trace = await readFile(join(f.dir,"trace.txt"),"utf8");
    if (!fault.startsWith("usage-") && fault !== "report-mutated-during-cost" && fault !== "root-activity-after-cost") assert.doesNotMatch(trace,/p6-child-cost/,`${fault} must not query cost`);
  }
});

test("missing/reset ledger history, omitted manifest, and existing outputs reject before fake Pi", async () => {
  for (const fault of ["ledger-reset","manifest-missing","output-overwrite"]) {
    const f = await fixture();
    if (fault === "ledger-reset") {
      const emptyPath = join(f.dir, "empty-ledger.json");
      const empty = await createLedger(emptyPath, { initialReserveUsd:0, sessionId:"synthetic-reset" });
      await writeFile(f.ledgerPath, JSON.stringify(empty));
    }
    if (fault === "output-overwrite") {
      await mkdir(f.results, { recursive:true });
      await writeFile(join(f.results, "session.jsonl"), "preserve me");
    }
    const { closed } = launch(f, fault === "manifest-missing" ? { PI_NATIVE_LITE_MANIFEST:"" } : {});
    const result = await closed;
    assert.notEqual(result.code, 0, `${fault} must reject startup`);
    await assert.rejects(readFile(join(f.dir, "trace.txt")));
  }
});
