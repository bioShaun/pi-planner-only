import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import monitor, { initializeCostState } from "./cost-monitor.mjs";

test("replaying the same observed message and entry is idempotent", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-replay-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const messageEvent = {message};
  const turnEvent = {message};
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:"entry",message}]}};
  try {
    await handlers.message_end(messageEvent,ctx);
    await handlers.turn_end(turnEvent,ctx);
    await handlers.message_end(messageEvent,ctx);
    await handlers.turn_end(turnEvent,ctx);
    const state = JSON.parse(await readFile(join(dir,"observations.json"),"utf8"));
    assert.equal(state.records.length,1);
    assert.equal(state.records[0].entryId,"entry");
    await assert.rejects(readFile(join(dir,"stop.json")), {code:"ENOENT"});
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("new event wrappers replaying the same message and entry are idempotent", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-wrapper-replay-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:"entry",message}]}};
  try {
    await handlers.message_end({message},ctx);
    await handlers.turn_end({message},ctx);
    await handlers.message_end({message},ctx);
    await handlers.turn_end({message},ctx);
    const state = JSON.parse(await readFile(join(dir,"observations.json"),"utf8"));
    assert.equal(state.records.length,1);
    assert.equal(state.records[0].entryId,"entry");
    await assert.rejects(readFile(join(dir,"stop.json")), {code:"ENOENT"});
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("new wrappers replaying an unbound message do not create a fault", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-unbound-replay-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:"entry",message}]}};
  try {
    await handlers.message_end({message},ctx);
    await handlers.message_end({message},ctx);
    await handlers.turn_end({message},ctx);
    const state = JSON.parse(await readFile(join(dir,"observations.json"),"utf8"));
    assert.equal(state.records.length,1);
    assert.equal(state.records[0].entryId,"entry");
    await assert.rejects(readFile(join(dir,"stop.json")), {code:"ENOENT"});
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("an unresolved message replay blocks another provider request", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-replay-pending-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  const oldExit = process.exit;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:"entry",message}]}};
  try {
    await handlers.message_end({message},ctx);
    await handlers.turn_end({message},ctx);
    await handlers.message_end({message},ctx);
    process.exit = code => { throw new Error(`exit ${code}`); };
    await assert.rejects(handlers.before_provider_request({},ctx), /exit 74/);
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8"));
    assert.match(stop.reason,/ambiguous/);
  } finally {
    process.exit = oldExit;
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("a replayed message with a different entry identity fails closed", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-message-entry-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  let entryId = "entry1";
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:entryId,message}]}};
  try {
    await handlers.message_end({message},ctx);
    await handlers.turn_end({message},ctx);
    await handlers.message_end({message},ctx);
    entryId = "entry2";
    await handlers.turn_end({message},ctx);
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8"));
    assert.match(stop.reason,/conflict|ambiguous/);
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("reusing a message object in another session fails closed", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-session-conflict-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const context = id => ({sessionManager:{getSessionId:() => id}});
  try {
    await handlers.message_end({message},context("one"));
    await handlers.message_end({message},context("two"));
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8").catch(() => "null"));
    assert.ok(stop, "cross-session identity conflict must persist a stop");
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("a replayed event whose content changes fails closed", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-conflict-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const event = {message:{role:"assistant",usage:{cost:{total:0.2}},content:[]}};
  const ctx = {sessionManager:{getSessionId:() => "session"}};
  try {
    await handlers.message_end(event,ctx);
    event.message.usage.cost.total = 0.3;
    await handlers.message_end(event,ctx);
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8").catch(() => "null"));
    assert.ok(stop, "conflicting event identity must persist a stop");
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("a replayed turn event with a different entry identity fails closed", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-entry-conflict-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const handlers = {};
  monitor({on(name, handler) { handlers[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const event = {message};
  let entryId = "entry1";
  const ctx = {sessionManager:{getSessionId:() => "session",getEntries:() => [{type:"message",id:entryId,message}]}};
  try {
    await handlers.message_end({message},ctx);
    await handlers.turn_end(event,ctx);
    entryId = "entry2";
    await handlers.turn_end(event,ctx);
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8").catch(() => "null"));
    assert.ok(stop, "conflicting entry identity must persist a stop");
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});

test("an unbound parent permits a child request but another instance cannot claim it", async () => {
  const dir = await mkdtemp("/project/tmp/pi-cost-unbound-");
  initializeCostState(dir);
  const old = process.env.PI_NATIVE_LITE_COST_STATE_DIR;
  process.env.PI_NATIVE_LITE_COST_STATE_DIR = dir;
  const first = {};
  const reloaded = {};
  monitor({on(name, handler) { first[name] = handler; }});
  monitor({on(name, handler) { reloaded[name] = handler; }});
  const message = {role:"assistant",usage:{cost:{total:0.2}},content:[]};
  const context = id => ({sessionManager:{getSessionId:() => id}});
  try {
    await first.message_end({message},context("parent"));
    await first.before_provider_request({},context("child"));
    await reloaded.message_end({message},context("parent"));
    const stop = JSON.parse(await readFile(join(dir,"stop.json"),"utf8"));
    assert.match(stop.reason,/unbound/);
    const state = JSON.parse(await readFile(join(dir,"observations.json"),"utf8"));
    assert.equal(state.records.length,1);
    assert.equal(state.records[0].costUsd,0.2);
  } finally {
    if (old === undefined) delete process.env.PI_NATIVE_LITE_COST_STATE_DIR;
    else process.env.PI_NATIVE_LITE_COST_STATE_DIR = old;
  }
});
