import assert from "node:assert/strict";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT as CANCEL,
	SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST,
	SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE,
	SUBAGENT_DELEGATION_STARTED_EVENT as STARTED,
	SUBAGENT_DELEGATION_UPDATE_EVENT as UPDATE,
} from "./subagent-delegation-contract.ts";
import { ROLE_AGENTS, clipChildText, loadLimits, runDelegation } from "./delegate.ts";
import { fakeBus, noGit, tick, usage } from "./test-helpers.mjs";

const limits = { timeoutMs: 60_000, maxTokens: 1_000, startTimeoutMs: 40, cancelGraceMs: 40 };
const deps = (bus, busy = new Set()) => ({ events: bus, git: noGit, ownerRunId: "owner-1", limits, busy });
const sent = (bus, event) => bus.emitted.filter(([e]) => e === event).map(([, d]) => d);
const respond = (bus, req, over = {}) =>
	bus.emit(RESPONSE, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", agent: req.agent, model: "cheap/model", result: { kind: "text", text: "changed a.ts; tests pass" }, usage: usage(), ...over });

// Completed: request shape, report formatting, lock released, no listeners left.
{
	const bus = fakeBus();
	const busy = new Set();
	bus.on(REQUEST, (req) => respond(bus, req));
	const out = await runDelegation(deps(bus, busy), { role: "worker", task: "  implement X  ", cwd: "/w" });
	const [req] = sent(bus, REQUEST);
	assert.equal(req.agent, "worker");
	assert.equal(req.context, "fresh");
	assert.equal(req.cwd, "/w");
	assert.equal(req.ownerRunId, "owner-1");
	assert.equal(req.timeoutMs, 60_000);
	assert.deepEqual(req.result, { kind: "text" });
	assert.match(req.task, /^implement X\n\n---\nWorking directory: \/w\n/);
	assert.ok(req.task.endsWith(ROLE_AGENTS.worker.closing));
	assert.equal(out.ok, true);
	assert.equal(out.details.status, "completed");
	assert.equal(out.details.model, "cheap/model");
	assert.equal(out.details.usage.cost, 0.0123);
	assert.match(out.text, /^\[worker\/worker\] completed · cheap\/model · 3\.5k tok · \$0\.0123 · 3 turns · 12s/);
	assert.match(out.text, /Child report:\nchanged a\.ts; tests pass/);
	assert.match(out.text, /not a git repository/);
	assert.equal(busy.size, 0);
	assert.equal(bus.totalListeners(), 1); // only the test's own REQUEST responder
}

// Role mapping; reviewer gets no workspace summary; host agent mismatch is flagged.
{
	const bus = fakeBus();
	bus.on(REQUEST, (req) => respond(bus, req, req.agent === "reviewer" ? {} : { agent: "other" }));
	const rev = await runDelegation(deps(bus), { role: "reviewer", task: "review", cwd: "/w" });
	assert.doesNotMatch(rev.text, /Workspace changes|git repository/);
	const exp = await runDelegation(deps(bus), { role: "explorer", task: "find", cwd: "/w" });
	assert.match(exp.text, /WARNING: requested agent scout, host ran other/);
	await runDelegation(deps(bus), { role: "validator", task: "check", cwd: "/w" });
	assert.deepEqual(sent(bus, REQUEST).map((r) => r.agent), ["reviewer", "scout", "oracle"]);
}

// Failed status is not ok and surfaces the error.
{
	const bus = fakeBus();
	bus.on(REQUEST, (req) => respond(bus, req, { status: "timed_out", error: "exceeded 60s", result: undefined }));
	const out = await runDelegation(deps(bus), { role: "worker", task: "t", cwd: "/w" });
	assert.equal(out.ok, false);
	assert.equal(out.details.status, "timed_out");
	assert.match(out.text, /Error: exceeded 60s/);
	assert.match(out.text, /Child report:\n\(empty\)/);
}

// Refusals: bad role, empty task, busy cwd for exclusive roles (reviewer still allowed).
{
	const bus = fakeBus();
	bus.on(REQUEST, (req) => respond(bus, req));
	assert.equal((await runDelegation(deps(bus), { role: "boss", task: "t" })).details.status, "refused");
	assert.equal((await runDelegation(deps(bus), { role: "worker", task: " " })).details.status, "refused");
	const busy = new Set(["/w"]);
	for (const role of ["worker", "explorer", "validator"]) {
		const out = await runDelegation(deps(bus, busy), { role, task: "t", cwd: "/w" });
		assert.equal(out.details.status, "refused", role);
	}
	assert.equal((await runDelegation(deps(bus, busy), { role: "reviewer", task: "t", cwd: "/w" })).ok, true);
	assert.equal(sent(bus, REQUEST).length, 1);
	assert.deepEqual([...busy], ["/w"]);
}

// Token cap: an update over maxTokens emits cancel; the host's cancelled terminal is reported.
{
	const bus = fakeBus();
	const progress = [];
	bus.on(REQUEST, (req) => bus.emit(UPDATE, { requestId: req.requestId, nodeId: req.nodeId, tokens: 1_500, toolCount: 7, currentTool: "bash" }));
	bus.on(CANCEL, (c) => bus.emit(RESPONSE, { requestId: c.requestId, nodeId: c.nodeId, status: "cancelled", agent: "worker", result: { kind: "text", text: "partial" } }));
	const out = await runDelegation(deps(bus), { role: "worker", task: "t", cwd: "/w" }, undefined, (p) => progress.push(p));
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.equal(out.ok, false);
	assert.equal(out.details.status, "cancelled");
	assert.match(out.details.stopReason, /token cap 1000 exceeded \(1500\)/);
	assert.match(out.text, /Stopped: token cap/);
	assert.deepEqual(progress, ["worker: 7 tools · bash · 1.5k tok"]);
}

// Updates for other requests are ignored.
{
	const bus = fakeBus();
	bus.on(REQUEST, (req) => {
		bus.emit(UPDATE, { requestId: "someone-else", tokens: 1_000_000 });
		bus.emit(RESPONSE, { requestId: "someone-else", status: "failed" });
		respond(bus, req);
	});
	const out = await runDelegation(deps(bus), { role: "worker", task: "t", cwd: "/w" });
	assert.equal(out.details.status, "completed");
	assert.equal(sent(bus, CANCEL).length, 0);
}

// Abort after start with no confirmation: stop_unconfirmed, cwd stays held until the late terminal.
{
	const bus = fakeBus();
	const busy = new Set();
	const ac = new AbortController();
	let req;
	bus.on(REQUEST, (r) => {
		req = r;
		bus.emit(STARTED, { requestId: r.requestId, nodeId: r.nodeId });
	});
	const pending = runDelegation(deps(bus, busy), { role: "worker", task: "t", cwd: "/w" }, ac.signal);
	await tick(5);
	ac.abort();
	const out = await pending;
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.equal(out.details.status, "stop_unconfirmed");
	assert.equal(out.details.stopReason, "cancelled by Root");
	assert.deepEqual([...busy], ["/w"]);
	assert.equal(bus.listeners(RESPONSE), 1);
	assert.equal(bus.listeners(UPDATE) + bus.listeners(STARTED), 0);
	respond(bus, req, { status: "cancelled" });
	assert.equal(busy.size, 0);
	assert.equal(bus.listeners(RESPONSE), 0);
}

// Never started: not_started after the start timeout, lock released, nothing left listening.
{
	const bus = fakeBus();
	const busy = new Set();
	const out = await runDelegation(deps(bus, busy), { role: "worker", task: "t", cwd: "/w" });
	assert.equal(out.details.status, "not_started");
	assert.match(out.text, /pi-subagents did not start the child/);
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.equal(busy.size, 0);
	assert.equal(bus.totalListeners(), 0);
}

// Already aborted: nothing is emitted.
{
	const bus = fakeBus();
	const ac = new AbortController();
	ac.abort();
	const out = await runDelegation(deps(bus), { role: "worker", task: "t", cwd: "/w" }, ac.signal);
	assert.equal(out.details.status, "not_started");
	assert.match(out.text, /cancelled by Root before launch/);
	assert.equal(bus.emitted.length, 0);
	assert.equal(bus.totalListeners(), 0);
}

// Clipping keeps the tail, where children put their report.
{
	const text = `${"a".repeat(5_000)}FINAL REPORT`;
	const clipped = clipChildText(text, 1_000);
	assert.ok(clipped.length < 1_100);
	assert.ok(clipped.endsWith("FINAL REPORT"));
	assert.match(clipped, /\[4012 chars omitted\]/);
	assert.equal(clipChildText("short", 1_000), "short");
}

// Limits from env; junk falls back to defaults.
{
	const l = loadLimits({ PI_PLANNER_ONLY_TIMEOUT_MS: "1234", PI_PLANNER_ONLY_MAX_TOKENS: "-5", PI_PLANNER_ONLY_START_TIMEOUT_MS: "x" });
	assert.equal(l.timeoutMs, 1234);
	assert.equal(l.maxTokens, 1_500_000);
	assert.equal(l.startTimeoutMs, 30_000);
}

console.log("delegate.test: ok");
