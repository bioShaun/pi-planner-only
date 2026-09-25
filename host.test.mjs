import assert from "node:assert/strict";
import { fakeBus } from "./test-helpers.mjs";
import { HostShapeError, createHostAdapter, hostEventBus, rootUsageOf } from "./host.ts";

try {
	// Event bus: a host without on/emit is rejected at construction, not at the first delegation.
	for (const bad of [undefined, {}, { on() {} }, { emit() {} }, { on: 1, emit: 2 }]) {
		assert.throws(() => hostEventBus(bad), HostShapeError);
		assert.throws(() => createHostAdapter({ events: bad }), /host events bus lacks on\/emit/);
	}
	const bus = fakeBus();
	const events = hostEventBus(bus);
	const seen = [];
	const off = events.on("x", (data) => seen.push(data));
	events.emit("x", 1);
	off();
	events.emit("x", 2);
	assert.deepEqual(seen, [1]);
	assert.deepEqual(bus.emitted, [["x", 1], ["x", 2]]);

	// Session identity: typed accessors with a UUID fallback when the host has none.
	const host = createHostAdapter({ events: bus, sendMessage: () => { throw new Error("boom"); } });
	const full = { sessionManager: { getSessionId: () => "s-1", getSessionFile: () => "/s/a.jsonl" }, getContextUsage: () => ({ tokens: 42 }) };
	assert.equal(host.sessionId(full), "s-1");
	assert.equal(host.sessionFile(full), "/s/a.jsonl");
	assert.equal(host.contextTokens(full), 42);
	for (const bare of [{}, { sessionManager: {} }, { sessionManager: { getSessionId: () => "", getSessionFile: () => undefined } }]) {
		assert.match(host.sessionId(bare), /^[0-9a-f-]{36}$/);
		assert.equal(host.sessionFile(bare), undefined);
		assert.equal(host.contextTokens(bare), undefined);
	}
	for (const tokens of [0, -1, NaN, Infinity, "5", undefined]) {
		assert.equal(host.contextTokens({ getContextUsage: () => ({ tokens }) }), undefined, `tokens=${String(tokens)}`);
	}
	assert.equal(host.contextTokens({ getContextUsage: () => undefined }), undefined);

	// sendMessage: a throwing or missing host method never reaches the handler.
	assert.doesNotThrow(() => host.sendMessage({ customType: "t", content: "c", display: true }));
	assert.doesNotThrow(() => createHostAdapter({ events: bus }).sendMessage({ customType: "t", content: "c", display: true }));
	const sent = [];
	createHostAdapter({ events: bus, sendMessage: (...args) => sent.push(args) }).sendMessage({ customType: "t", content: "c", display: true }, { deliverAs: "nextTurn" });
	assert.equal(sent.length, 1);
	assert.equal(sent[0][1].deliverAs, "nextTurn");

	// rootUsageOf: assistant usage only, missing fields count as zero.
	assert.equal(rootUsageOf(undefined), undefined);
	assert.equal(rootUsageOf({ role: "user" }), undefined);
	assert.equal(rootUsageOf({ role: "assistant" }), undefined);
	assert.deepEqual(rootUsageOf({ role: "assistant", usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 1, cost: { total: 0.5 } } }), { tokens: 116, context: 111, cost: 0.5 });
	assert.deepEqual(rootUsageOf({ role: "assistant", usage: { input: "x", cost: null } }), { tokens: 0, context: 0, cost: 0 });

	console.log("host.test: ok");
} catch (error) {
	console.error("host.test: FAIL");
	console.error(error);
	process.exit(1);
}
