import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { test } from "node:test";
import { tempDir } from "./test-helpers.mjs";

// An outer Pi process can otherwise make a different host report its version.
delete process.env.PI_PACKAGE_DIR;
delete process.env.PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT;
const hostEntry = process.env.PI_HOST_DIR ? pathToFileURL(join(process.env.PI_HOST_DIR, "dist/index.js")).href : import.meta.resolve("@earendil-works/pi-coding-agent");
const installed = JSON.parse(readFileSync(new URL("../package.json", hostEntry), "utf8"));
const { AgentSessionRuntime, createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, VERSION } = await import(hostEntry);
const aiEntry = process.env.PI_HOST_DIR ? pathToFileURL(join(process.env.PI_HOST_DIR, "../pi-ai/dist/index.js")).href : import.meta.resolve("@earendil-works/pi-ai");
const { createAssistantMessageEventStream } = await import(aiEntry);
assert.equal(VERSION, installed.version);
if (!process.env.PI_HOST_DIR) assert.equal(VERSION, "1.4.0");

async function fixture(t, count) {
	const dir = tempDir("native-handoff-runtime-");
	process.env.PI_CODING_AGENT_DIR = dir;
	process.env.PI_PLANNER_ONLY_MODE = "native";
	process.env.PI_PLANNER_ONLY_HANDOFF = "auto";
	process.env.PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS = "1";
	process.env.OPENAI_API_KEY = "offline-fixture";
	delete process.env.PI_SUBAGENT_CHILD;
	const briefs = Array.from({ length: count }, (_, i) => `BRIEF-${i}-UNIQUE Preserve the work and continue the next authorized action. `.repeat(5));
	const progress = "Completed: setup.\nRemaining: work.\nNext: continue.";
	const bus = createEventBus();
	bus.on("subagents:rpc:v1:request", request => {
		if (request.method !== "status") return;
		bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, success: true, data: { fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 }, asyncSnapshot: { kind: "pi-subagents.async-status-snapshot", version: 1, generatedAt: 1, caps: { maxRuns: 20, maxChildrenPerNode: 8, maxDepth: 3, maxStringLength: 160, maxSerializedBytes: 32768 }, runs: [], omitted: { runs: 0, children: 0, byteLimitExceeded: false } } } });
	});
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const modelRuntime = await ModelRuntime.create({ authPath: join(dir, "auth.json"), modelsPath: null, modelsStorePath: join(dir, "models"), allowModelNetwork: false, refreshOnCreate: false });
	modelRuntime.hasConfiguredAuth = () => true;
	modelRuntime.checkAuth = async () => ({ type: "api_key", key: "offline-fixture" });
	const model = modelRuntime.getModels().find(m => m.provider === "openai" && m.api === "openai-responses" && m.reasoning);
	assert.ok(model, "offline host must expose a reasoning model");
	const errors = [], sessions = [];
	const outerDone = Promise.withResolvers();
	const createRuntime = async options => {
		const loader = new DefaultResourceLoader({ cwd: dir, agentDir: dir, settingsManager, eventBus: bus, additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url))], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
		await loader.reload();
		assert.deepEqual(loader.getExtensions().errors, []);
		const { session } = await createAgentSession({ cwd: dir, agentDir: dir, modelRuntime, model, resourceLoader: loader, settingsManager, sessionManager: options.sessionManager });
		const index = sessions.push(session) - 1;
		let calls = 0;
		session.agent.streamFunction = () => {
			const call = calls++ === 0 && index < briefs.length;
			const content = call ? [{ type: "toolCall", id: `handoff-${index}`, name: "handoff", arguments: { brief: briefs[index], progress } }] : [{ type: "text", text: "offline response" }];
			const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage: { input: 200000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 200001, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: call ? "toolUse" : "stop", timestamp: Date.now() };
			const stream = createAssistantMessageEventStream(); stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: message.stopReason, message }); return stream;
		};
		return { session, services: { cwd: dir, agentDir: dir }, diagnostics: [] };
	};
	const first = await createRuntime({ sessionManager: SessionManager.inMemory(dir) });
	const runtime = new AgentSessionRuntime(first.session, first.services, createRuntime);
	const bind = async () => {
		const session = runtime.session;
		const uiContext = { ...session.extensionRunner.getUIContext(), theme: { fg: (_color, text) => text }, notify() {} };
		await session.bindExtensions({ mode: "rpc", uiContext, onError: error => errors.push(error), commandContextActions: { waitForIdle: () => runtime.session.waitForIdle(), newSession: async options => {
			const source = runtime.session.sessionId;
			try { const result = await runtime.newSession(options); if (source === sessions[0].sessionId) outerDone.resolve(); return result; }
			catch (error) { outerDone.reject(error); throw error; }
		} } });
	};
	runtime.setRebindSession(bind);
	await bind();
	runtime.session.setThinkingLevel("high");
	assert.equal(runtime.session.thinkingLevel, "high");
	t.after(() => { runtime.session.dispose(); bus.clear(); rmSync(dir, { recursive: true, force: true }); });
	return { runtime, sessions, briefs, progress, model, errors, outerDone };
}

for (const count of [1, 3]) test(`Pi ${VERSION}: ${count} Native handoff${count === 1 ? "" : "s nested during delivery"}`, { timeout: 15000 }, async t => {
	const { runtime, sessions, briefs, progress, model, errors, outerDone } = await fixture(t, count);
	await runtime.session.prompt("/planner-only handoff");
	await outerDone.promise;
	assert.equal(sessions.length, count + 1);
	assert.deepEqual(errors, []);
	for (let i = 0; i < count; i++) {
		const session = sessions[i + 1];
		const entries = session.sessionManager.getEntries();
		const messages = entries.filter(e => e.type === "message" && e.message.role === "user").map(e => JSON.stringify(e.message.content));
		assert.equal(messages.filter(text => text.includes(briefs[i])).length, 1);
		assert.ok(messages.some(text => text.includes(progress.replaceAll("\n", "\\n"))));
		assert.ok(entries.some(e => e.type === "custom" && e.customType === "planner-only-mode" && e.data.mode === "native"));
		assert.equal(session.model.provider, model.provider);
		assert.equal(session.model.id, model.id);
		assert.equal(session.thinkingLevel, "high");
	}
	const finalEntries = sessions.at(-1).sessionManager.getEntries();
	assert.deepEqual(finalEntries.filter(e => e.type === "custom" && e.customType === "planner-only-handoff-chain").map(e => e.data.count), count === 1 ? [0] : [count - 2, count - 1]);
	assert.equal(finalEntries.filter(e => e.type === "custom_message" && String(e.content).includes("brief was not sent")).length, 0);
	await runtime.session.prompt("/planner-only handoff");
	assert.equal(sessions.length, count + 1, "a later command must request a fresh brief, not resend an old one");
	for (const brief of briefs) {
		const received = sessions.flatMap(s => s.sessionManager.getEntries()).filter(e => e.type === "message" && e.message.role === "user" && JSON.stringify(e.message.content).includes(brief));
		assert.equal(received.length, 1);
	}
});
