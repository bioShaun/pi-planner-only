import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";

test("installed Pi exposes persisted assistant entry identity at turn_end", async () => {
  const base = "/project/tmp/pi-native-lite-cost-order";
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "fixture-"));
  const extension = join(dir, "probe.mjs");
  const output = join(dir, "order.jsonl");
  await writeFile(extension, `import {appendFileSync} from "node:fs"; export default pi => pi.on("turn_end", (event, ctx) => { if(event.message.role === "assistant") appendFileSync(${JSON.stringify(output)},JSON.stringify({message:event.message,entries:ctx.sessionManager.getEntries()})+"\\n"); });`);
  const runtime = await ModelRuntime.create({authPath:join(dir,"auth.json"),modelsPath:null,modelsStorePath:join(dir,"models"),allowModelNetwork:false,refreshOnCreate:false});
  const model = runtime.getModels()[0];
  assert.ok(model);
  const settingsManager = SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
  const loader = new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager,eventBus:createEventBus(),additionalExtensionPaths:[extension],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const manager = SessionManager.inMemory(dir);
  const {session} = await createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager,sessionManager:manager});
  await session.bindExtensions({mode:"rpc"});
  session.agent.streamFunction = () => {
    const message = {role:"assistant",content:[{type:"text",text:"offline"}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0.1,cacheRead:0,cacheWrite:0,total:0.1}},stopReason:"stop",timestamp:1};
    const stream = createAssistantMessageEventStream();
    stream.push({type:"start",partial:message});
    stream.push({type:"done",reason:"stop",message});
    return stream;
  };
  try {
    await session._startRun({messageType:"user",prompt:"offline"});
    await session._startRun({messageType:"user",prompt:"offline again"});
    const observations = (await readFile(output,"utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(observations.length, 2);
    const ids = observations.map(observed => {
      const entries = observed.entries.filter(item => item.type === "message" && item.message?.role === "assistant");
      const entry = entries.at(-1);
      assert.ok(entry?.id, "turn_end must see the persisted assistant entry identity");
      assert.deepEqual(entry.message, observed.message);
      return entry.id;
    });
    assert.notEqual(ids[0], ids[1], "identical messages from separate turns have distinct entries");
  } finally { session.dispose(); }
});

test("installed Pi swallows before-provider hook exceptions before a local provider stub", async () => {
  const base = "/project/tmp/pi-native-lite-cost-order";
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "hook-"));
  const extension = join(dir, "probe.mjs");
  await writeFile(extension, `export default pi => pi.on("before_provider_request", () => { throw new Error("offline stop probe"); });`);
  const runtime = await ModelRuntime.create({authPath:join(dir,"auth.json"),modelsPath:null,modelsStorePath:join(dir,"models"),allowModelNetwork:false,refreshOnCreate:false});
  const model = runtime.getModels()[0];
  assert.ok(model);
  const settingsManager = SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false}});
  const loader = new DefaultResourceLoader({cwd:dir,agentDir:dir,settingsManager,eventBus:createEventBus(),additionalExtensionPaths:[extension],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  let calls = 0;
  runtime.streamSimple = (_model, _context, options) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      await options.onPayload({model:model.id}, model);
      calls++;
      const message = {role:"assistant",content:[{type:"text",text:"offline"}],api:model.api,provider:model.provider,model:model.id,usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0.1,cacheRead:0,cacheWrite:0,total:0.1}},stopReason:"stop",timestamp:1};
      stream.push({type:"start",partial:message});
      stream.push({type:"done",reason:"stop",message});
    })().catch(error => stream.error(error));
    return stream;
  };
  const {session} = await createAgentSession({cwd:dir,agentDir:dir,modelRuntime:runtime,model,resourceLoader:loader,settingsManager,sessionManager:SessionManager.inMemory(dir)});
  const errors = [];
  await session.bindExtensions({mode:"rpc",onError:error => errors.push(error)});
  try {
    await session._startRun({messageType:"user",prompt:"offline"});
    assert.equal(calls, 1, "an exception alone does not block the provider stub");
    assert.ok(errors.some(error => String(error.error).includes("offline stop probe")));
  } finally { session.dispose(); }
});
