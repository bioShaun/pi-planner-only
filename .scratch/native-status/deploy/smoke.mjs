import assert from "node:assert/strict";
import { createEventBus, DefaultResourceLoader, SettingsManager } from "@earendil-works/pi-coding-agent";

delete process.env.PI_SUBAGENT_CHILD;
process.env.PI_PLANNER_ONLY_MODE = "native";
process.env.PI_CODING_AGENT_DIR = "/project/tmp/native-runtime-path-test";
const bus = createEventBus();
const loader = new DefaultResourceLoader({
  cwd: "/project/tmp/native-runtime-path-test",
  agentDir: "/project/tmp/native-runtime-path-test",
  settingsManager: SettingsManager.inMemory(),
  eventBus: bus,
  additionalExtensionPaths: ["/home/tcuni-claw/.pi/agent/git/github.com/bioShaun/pi-planner-only/index.ts"],
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
console.log("Pi resource loader: installed extension loaded", loaded.extensions.length);
const statuses = [], colors = [];
const ctx = {
  hasUI: true,
  sessionManager: { getSessionId: () => "smoke-session" },
  ui: { setStatus: (_key, value) => statuses.push(value), theme: {
    fg: (_color, text) => text,
    colors: { accent: { kind: "rgb", r: 0, g: 0, b: 255 }, warning: { kind: "rgb", r: 255, g: 200, b: 0 }, error: { kind: "rgb", r: 255, g: 0, b: 0 } },
    style: (text, options) => { colors.push(options.fg); return text; },
  } },
};
bus.on("subagents:rpc:v1:request", (request) => {
  assert.equal(request.method, "cost");
  bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, success: true, data: { version: 1, childTotal: { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, cost: 0.25 } } });
});
await loaded.extensions[0].handlers.get("message_end")[0]({ message: { role: "assistant", usage: { input: 200000, output: 5, cost: { total: 1 } } } }, ctx);
assert.match(statuses.at(-1), /native.*root.*\$1\.000.*child.*≥\$0\.250/);
assert.deepEqual(colors.at(-1), { kind: "rgb", r: 255, g: 0, b: 0 });
console.log("Native status:", statuses.at(-1));
console.log("Native high-context color:", JSON.stringify(colors.at(-1)));
