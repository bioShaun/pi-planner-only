import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { resolveRequiredChildExtensions } from "/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/src/shared/required-child-extensions.js";
import { registerRequiredChildExtensions } from "./required-child-extensions-wrapper.mjs";
import { initializeCostState } from "./cost-monitor.mjs";

if (process.argv.includes("--fixture")) {
  const dir = process.env.COST_STOP_FIXTURE;
  const registration = registerRequiredChildExtensions({sessionId:"fixture-parent",extensions:[],requireForAllRunners:true});
  const extensions = resolveRequiredChildExtensions("fixture-parent").map(item => item.path);
  const runtime = await ModelRuntime.create({authPath:join(dir,"auth.json"),modelsPath:null,modelsStorePath:join(dir,"models"),allowModelNetwork:false,refreshOnCreate:false});
  const model = runtime.getModels()[0];
  const settingsManager = SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
  const loader = new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager,eventBus:createEventBus(),additionalExtensionPaths:extensions,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  if (loader.getExtensions().errors.length) throw new Error(JSON.stringify(loader.getExtensions().errors));
  let nextCost = 0.1;
  let calls = 0;
  runtime.streamSimple = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      await options.onPayload({model:model.id},model);
      await writeFile(join(dir,"provider-called"),"called");
      await writeFile(join(dir,"provider-count"),String(++calls));
      const message = {role:"assistant",content:[{type:"text",text:"offline"}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:nextCost,cacheRead:0,cacheWrite:0,total:nextCost}},stopReason:"stop",timestamp:1};
      stream.push({type:"start",partial:message});
      stream.push({type:"done",reason:"stop",message});
    })().catch(error => stream.error(error));
    return stream;
  };
  const {session} = await createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager,sessionManager:SessionManager.inMemory(dir)});
  await session.bindExtensions({mode:"rpc"});
  if (["cumulative", "concurrent"].includes(process.env.COST_SCENARIO)) nextCost = 0.7;
  if (process.env.COST_SCENARIO === "invalid-cost") nextCost = -1;
  await session._startRun({messageType:"user",prompt:"offline"});
  if (process.env.COST_SCENARIO === "invalid-cost") await session._startRun({messageType:"user",prompt:"must be blocked"});
  if (process.env.COST_SCENARIO === "identical") await session._startRun({messageType:"user",prompt:"again"});
  if (process.env.COST_SCENARIO === "cumulative") {
    nextCost = 0.55;
    const {session:second} = await createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager,sessionManager:SessionManager.inMemory(dir)});
    await second.bindExtensions({mode:"rpc"});
    await second._startRun({messageType:"user",prompt:"offline again"});
    second.dispose();
  }
  session.dispose();
  registration.dispose();
} else {
  test("uninitialized monitor directory prevents the host reaching its provider stub", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"uninitialized-"));
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    await assert.rejects(readFile(join(dir,"provider-called")),{code:"ENOENT"});
    assert.notEqual(code,0,stderr);
  });
  test("corrupt observations prevent the host reaching its provider stub", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"corrupt-"));
    initializeCostState(dir);
    await writeFile(join(dir,"observations.json"),"{invalid");
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    await assert.rejects(readFile(join(dir,"provider-called")),{code:"ENOENT"});
    assert.notEqual(code,0,stderr);
    assert.match(await readFile(join(dir,"stop.json"),"utf8"),/invalid/);
  });
  test("identical assistant messages bind distinct entry identities without recounting", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"identity-"));
    initializeCostState(dir);
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,COST_SCENARIO:"identical",PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    assert.equal(code,0,stderr);
    const state = JSON.parse(await readFile(join(dir,"observations.json"),"utf8").catch(() => "null"));
    assert.ok(state, "monitor must persist observations");
    assert.equal(state.records.length,2);
    assert.equal(state.records.reduce((sum, record) => sum + record.costUsd, 0),0.2);
    assert.ok(state.records.every(record => record.entryId));
    assert.notEqual(state.records[0].entryId,state.records[1].entryId);
  });
  test("invalid assistant cost records a fault and blocks the next provider call", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"invalid-cost-"));
    initializeCostState(dir);
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,COST_SCENARIO:"invalid-cost",PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    assert.equal(await readFile(join(dir,"provider-count"),"utf8"),"1", "second request must not reach provider");
    assert.notEqual(code,0,stderr);
    assert.ok((await readFile(join(dir,"stop.json"),"utf8")).includes("invalid"));
  });
  test("a persisted cost stop prevents the real host from reaching its provider stub", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"stop-"));
    await writeFile(join(dir,"stop.json"),JSON.stringify({reason:"threshold",observedUsd:1.25}));
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    let called = false;
    try { await readFile(join(dir,"provider-called")); called = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.equal(called,false,"stop marker must prevent provider stub invocation");
    assert.notEqual(code,0,stderr);
  });
  test("missing cost monitor state prevents the real host from reaching its provider stub", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"missing-state-"));
    const env = {...process.env,COST_STOP_FIXTURE:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")};
    delete env.PI_NATIVE_LITE_COST_STATE_DIR;
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env,stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    let called = false;
    try { await readFile(join(dir,"provider-called")); called = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.equal(called,false,"missing monitor state must prevent provider stub invocation");
    assert.notEqual(code,0,stderr);
  });
  test("real host two-session cumulative assistant usage persists a stop at threshold", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"cumulative-"));
    initializeCostState(dir);
    const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,COST_SCENARIO:"cumulative",PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
    let stderr = "";
    child.stderr.on("data", chunk => stderr += chunk);
    const code = await new Promise(resolve => child.once("close",resolve));
    assert.equal(code,0,stderr);
    let stopped = false;
    try { await readFile(join(dir,"stop.json")); stopped = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.ok(stopped,"reported cumulative cost at threshold must persist the stop");
  });
  test("concurrent real host sessions cannot lose aggregate usage", async () => {
    const base = "/project/tmp/pi-native-lite-cost-order";
    await mkdir(base,{recursive:true});
    const dir = await mkdtemp(join(base,"concurrent-"));
    initializeCostState(dir);
    const launch = () => {
      const child = spawn(process.execPath,["--experimental-strip-types",fileURLToPath(import.meta.url),"--fixture"],{env:{...process.env,COST_STOP_FIXTURE:dir,COST_SCENARIO:"concurrent",PI_NATIVE_LITE_COST_STATE_DIR:dir,PI_NATIVE_LITE_FINGERPRINT_LOG:join(dir,"fingerprints.jsonl")},stdio:["ignore","ignore","pipe"]});
      let stderr = "";
      child.stderr.on("data", chunk => stderr += chunk);
      return new Promise(resolve => child.once("close",code => resolve({code,stderr})));
    };
    const results = await Promise.all([launch(),launch()]);
    for (const result of results) assert.equal(result.code,0,result.stderr);
    let stopped = false;
    try { await readFile(join(dir,"stop.json")); stopped = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
    assert.ok(stopped,"concurrent completed costs of 0.7 each must persist a stop");
  });
}
