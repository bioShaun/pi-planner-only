import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { tempDir } from "./test-helpers.mjs";
import {
	SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST,
	SUBAGENT_DELEGATION_STARTED_EVENT as STARTED,
	SUBAGENT_DELEGATION_UPDATE_EVENT as UPDATE,
	SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE,
	SUBAGENT_DELEGATION_CANCEL_EVENT as CANCEL,
} from "./subagent-delegation-contract.ts";

const hostPackage = "@earendil-works/pi-coding-agent";
const hostEntry = process.env.PI_HOST_DIR
	? pathToFileURL(join(process.env.PI_HOST_DIR, "dist/index.js")).href
	: import.meta.resolve(hostPackage);
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const installed = JSON.parse(readFileSync(new URL("../package.json", hostEntry), "utf8"));

// The release suite must exercise the same host version the plugin declares.
assert.equal(installed.version, "1.4.0", "host runtime tests require the target Pi 1.4.0 installation");
assert.equal(manifest.devDependencies[hostPackage], installed.version);
assert.equal(manifest.peerDependencies[hostPackage], installed.version);
assert.equal(manifest["pi-planner-only"].piHost, installed.version);
assert.equal(manifest.engines.node, installed.engines.node);

console.log(`host-runtime.test: host declarations and installed types aligned at ${installed.version}`);

// Isolate operator settings and credentials before importing the actual host.
const sandbox = tempDir("ppo-host-runtime-");
process.env.PI_CODING_AGENT_DIR = sandbox;
process.env.PI_PLANNER_ONLY = "1";
process.env.PI_PLANNER_ONLY_MODE = "lite";
process.env.PI_PLANNER_ONLY_STRICT = "1";
process.env.PI_PLANNER_ONLY_CANCEL_GRACE_MS = "10";
delete process.env.PI_SUBAGENT_CHILD;
after(() => rmSync(sandbox, { recursive: true, force: true }));

const { createAgentSession, createEventBus, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, VERSION } = await import(hostEntry);
const { createAssistantMessageEventStream } = await import("@earendil-works/pi-ai");
assert.equal(VERSION, installed.version);
const modelRuntime = await ModelRuntime.create({
	authPath: join(sandbox, "auth.json"), modelsPath: null,
	modelsStorePath: join(sandbox, "models"), allowModelNetwork: false, refreshOnCreate: false,
});
const model = modelRuntime.getModels()[0];
assert.ok(model, "host must provide a static model for the offline response fixture");
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function terminal(bus, request, status = "completed") {
	bus.emit(RESPONSE, { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, agent: request.agent, status, result: { kind: "text", text: status } });
}

async function fixture(t, calls) {
	const cwd = tempDir("ppo-host-work-");
	const bus = createEventBus();
	const pendingRequests = new Map();
	bus.on(REQUEST, (request) => pendingRequests.set(request.requestId, request));
	bus.on(RESPONSE, (response) => pendingRequests.delete(response.requestId));
	const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
	const loader = new DefaultResourceLoader({
		cwd, agentDir: sandbox, settingsManager, eventBus: bus,
		additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
		noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, [], "real host loader must accept the plugin");
	const { session } = await createAgentSession({
		cwd, agentDir: sandbox, modelRuntime, model, resourceLoader: loader,
		settingsManager, sessionManager: SessionManager.inMemory(cwd),
	});
	const errors = [];
	await session.bindExtensions({ mode: "rpc", onError: (error) => errors.push(error) });
	const delegate = session.agent.state.tools.find((tool) => tool.name === "delegate");
	assert.ok(delegate, "plugin must expose delegate through the real host");
	assert.equal(delegate.executionMode, undefined, "delegate must inherit host default scheduling");
	let responses = 0;
	// The provider and structured-delegation peer are controlled fixtures.
	// Extension loading, tool dispatch, abort and the event bus are the real host.
	session.agent.streamFunction = () => {
		const content = responses++ === 0
			? calls.map((role, index) => ({ type: "toolCall", id: `call-${index}`, name: "delegate", arguments: { role, task: "host contract probe", cwd } }))
			: [{ type: "text", text: "done" }];
		const message = { role: "assistant", content, api: model.api, provider: model.provider, model: model.id, usage, stopReason: responses === 1 ? "toolUse" : "stop", timestamp: Date.now() };
		const stream = createAssistantMessageEventStream();
		stream.push({ type: "start", partial: message });
		stream.push({ type: "done", reason: message.stopReason, message });
		return stream;
	};
	const events = [];
	session.agent.subscribe((event) => { events.push(event); });
	t.after(async () => {
		session.agent.abort();
		for (const request of pendingRequests.values()) terminal(bus, request, "cancelled");
		await session.agent.waitForIdle();
		session.dispose();
		bus.clear();
		rmSync(cwd, { recursive: true, force: true });
		assert.deepEqual(errors, [], "extension event handlers must remain compatible");
	});
	t.signal.addEventListener("abort", () => session.agent.abort(), { once: true });
	return { session, bus, cwd, delegate, events };
}

await test("independent delegate calls overlap on Pi 1.4.0 and results preserve source order", { timeout: 15_000 }, async (t) => {
	const { session, bus, events } = await fixture(t, ["explorer", "explorer"]);
	const requests = [];
	const firstEnded = Promise.withResolvers();
	session.agent.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.toolCallId === "call-1") firstEnded.resolve();
	});
	bus.on(REQUEST, (request) => {
		requests.push(request);
		bus.emit(STARTED, request);
		if (requests.length === 2) terminal(bus, request);
	});
	bus.on(CANCEL, (identity) => terminal(bus, requests.find((request) => request.requestId === identity.requestId), "cancelled"));

	const running = session.agent.prompt("run the two independent calls");
	await firstEnded.promise; // Sequential dispatch cannot reach this signal.
	assert.equal(requests.length, 2);
	terminal(bus, requests[0]);
	await running;

	const ended = events.filter((event) => event.type === "tool_execution_end");
	assert.deepEqual(ended.map((event) => event.toolCallId), ["call-1", "call-0"]);
	assert.ok(ended.every((event) => event.result.details.status === "completed"));
	const results = events.filter((event) => event.type === "message_end" && event.message.role === "toolResult");
	assert.deepEqual(results.map((event) => event.message.toolCallId), ["call-0", "call-1"]);
	assert.equal(events.at(-1).type, "agent_end");
});

await test("a parallel worker/validator batch refuses the conflicting writer", { timeout: 15_000 }, async (t) => {
	const { session, bus, events } = await fixture(t, ["worker", "validator"]);
	const requests = [];
	const refused = Promise.withResolvers();
	const started = Promise.withResolvers();
	session.agent.subscribe((event) => {
		if (event.type === "tool_execution_end" && event.result.details.status === "refused") refused.resolve();
	});
	bus.on(REQUEST, (request) => { requests.push(request); bus.emit(STARTED, request); started.resolve(); });
	bus.on(CANCEL, (identity) => terminal(bus, requests.find((request) => request.requestId === identity.requestId), "cancelled"));

	const running = session.agent.prompt("dispatch conflicting writers");
	await Promise.all([refused.promise, started.promise]);
	assert.equal(requests.length, 1, "the conflicting call must not launch a child");
	terminal(bus, requests[0]);
	await running;
	const statuses = events.filter((event) => event.type === "tool_execution_end").map((event) => event.result.details.status);
	assert.deepEqual(statuses.sort(), ["completed", "refused"]);
});

await test("progress crosses the host tool boundary and confirmed cancellation releases the lock", { timeout: 15_000 }, async (t) => {
	const { session, bus, cwd, delegate, events } = await fixture(t, ["worker"]);
	const started = Promise.withResolvers();
	let request;
	bus.on(REQUEST, (next) => {
		bus.emit(STARTED, next);
		if (!request) { request = next; started.resolve(); }
		else terminal(bus, next);
	});
	bus.on(CANCEL, () => terminal(bus, request, "cancelled"));
	const running = session.agent.prompt("report progress then cancel");
	await started.promise;
	const progress = Promise.withResolvers();
	session.agent.subscribe((event) => {
		if (event.type === "tool_execution_update") progress.resolve(event);
	});
	bus.emit(UPDATE, { ...request, tokens: 21, toolCount: 1, currentTool: "read" });
	const update = await progress.promise;
	assert.equal(update.toolCallId, "call-0");
	assert.equal(update.partialResult.content[0].type, "text");
	await session.abort();
	await running;
	const ended = events.filter((event) => event.type === "tool_execution_end");
	assert.equal(ended.length, 1);
	assert.equal(ended[0].result.details.status, "cancelled");
	const next = await delegate.execute("after-cancel", { role: "worker", task: "new delegation", cwd });
	assert.equal(next.details.status, "completed");
});

await test("host abort reaches delegate and keeps the repository locked until a late terminal", { timeout: 15_000 }, async (t) => {
	const { session, bus, cwd, delegate, events } = await fixture(t, ["worker"]);
	const started = Promise.withResolvers();
	const cancelled = Promise.withResolvers();
	const nextStarted = Promise.withResolvers();
	let request;
	bus.on(REQUEST, (next) => {
		bus.emit(STARTED, next);
		if (!request) { request = next; started.resolve(); }
		else nextStarted.resolve(next);
	});
	bus.on(CANCEL, (identity) => cancelled.resolve(identity));

	const running = session.agent.prompt("start then abort");
	await started.promise;
	const aborting = session.abort();
	const identity = await cancelled.promise;
	assert.equal(identity.requestId, request.requestId);
	assert.equal(identity.ownerRunId, request.ownerRunId);
	await running; // Exercises the real cancellation grace timer, not a sleep.
	await aborting;

	const ended = events.filter((event) => event.type === "tool_execution_end");
	assert.equal(ended.length, 1);
	assert.equal(ended[0].result.details.status, "stop_unconfirmed");
	const blocked = await delegate.execute("blocked", { role: "worker", task: "conflicting writer", cwd });
	assert.equal(blocked.details.status, "refused");
	terminal(bus, request, "cancelled");
	const nextRun = delegate.execute("after-terminal", { role: "worker", task: "new delegation", cwd });
	const nextRequest = await nextStarted.promise;
	terminal(bus, request, "cancelled"); // A duplicate terminal must not release the new owner's lock.
	const stillBlocked = await delegate.execute("duplicate-terminal", { role: "worker", task: "conflicting writer", cwd });
	assert.equal(stillBlocked.details.status, "refused");
	terminal(bus, nextRequest);
	assert.equal((await nextRun).details.status, "completed");
});

await test("agent_end does not imply idle until asynchronous host listeners settle", { timeout: 15_000 }, async (t) => {
	const { session, bus } = await fixture(t, ["reviewer"]);
	bus.on(REQUEST, (request) => { bus.emit(STARTED, request); terminal(bus, request); });
	const terminalSeen = Promise.withResolvers();
	const releaseListener = Promise.withResolvers();
	t.after(() => releaseListener.resolve());
	t.signal.addEventListener("abort", () => releaseListener.resolve(), { once: true });
	session.agent.subscribe(async (event) => {
		if (event.type === "agent_end") {
			terminalSeen.resolve();
			await releaseListener.promise;
		}
	});
	const running = session.agent.prompt("finish with an asynchronous terminal listener");
	await terminalSeen.promise;
	assert.equal(session.agent.state.isStreaming, true);
	releaseListener.resolve();
	await running;
	await session.agent.waitForIdle();
	assert.equal(session.agent.state.isStreaming, false);
});
