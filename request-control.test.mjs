import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_REQUEST_LIMITS, FileRequestStorage, RequestController, loadRequestLimits } from "./request-control.ts";

const root = dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(join(root, ".planner-only-request-unit-"));
const controllers = [];
const limits = { ...DEFAULT_REQUEST_LIMITS };
class MemoryStorage {
	initialized = false;
	raw;
	fail = false;
	load() { return { initialized: this.initialized, raw: this.raw }; }
	commit(expected, next) {
		if (this.fail) throw new Error("injected write failure");
		assert.equal(this.raw, expected, "stale controller cannot overwrite a newer record");
		this.raw = next; this.initialized = true;
	}
}
function make(storage = new MemoryStorage(), options = {}) {
	const request = new RequestController({ sessionId: "session", workspace: root, storage, limits: () => limits, ...options });
	controllers.push(request); return request;
}
function tool(r, id) { const scope = r.beginTool(id, "planner_tasks"); r.endTool(id, scope); }
function child(r, executionId, taskId = "A", parent) {
	r.claim(`dispatch-${executionId}`, taskId, executionId, parent);
	r.emitted(`dispatch-${executionId}`, r.requestId);
	r.terminal(`dispatch-${executionId}`, r.requestId);
	r.finishChild(executionId, true, r.requestId);
}

try {
	assert.deepEqual(loadRequestLimits({}), DEFAULT_REQUEST_LIMITS);
	for (const value of ["0", "-1", "", "Infinity", "NaN", "1.1"]) {
		assert.throws(() => loadRequestLimits({ PI_PLANNER_ONLY_REQUEST_CHILD_LAUNCHES: value }), /positive finite/);
	}
	const tools = make();
	for (let i = 1; i <= 32; i++) {
		tools.attempt(`t${i}`, "planner_tasks"); // hook + direct execute are one attempt
		tool(tools, `t${i}`);
	}
	assert.equal(tools.snapshot().toolAttempts, 32);
	assert.throws(() => tools.beginTool("t33", "planner_tasks"), /tool-attempt-limit/);
	assert.equal(tools.signal.aborted, true);

	const race = make();
	const claims = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => Promise.resolve().then(() => race.claim(`c${i}`, `T${i}`, `e${i}`))));
	assert.equal(claims.filter(r => r.status === "fulfilled").length, 8);
	assert.equal(race.snapshot().childLaunches, 8);
	assert.match(race.snapshot().closedReason, /child-launch-limit/);

	const store = new MemoryStorage();
	let request = make(store);
	tool(request, "durable-tool"); child(request, "durable-child");
	const originalId = request.requestId;
	request = make(store);
	assert.equal(request.requestId, originalId);
	assert.equal(request.snapshot().toolAttempts, 1);
	assert.equal(request.snapshot().childLaunches, 1);
	assert.throws(() => request.claim("dispatch-durable-child", "A", "durable-child"), /dispatch-replay/);
	request.close("test-close");
	request = make(store);
	assert.throws(() => tool(request, "after-reload"), /test-close/);
	assert.equal(request.input("interactive"), false, "reload is not settlement");
	request.settle();
	assert.equal(request.input("interactive", undefined, false), false, "input arriving during a live host call is not a new request");
	for (const source of ["extension", "rpc", "unknown"]) assert.equal(request.input(source), false);
	assert.equal(request.input("interactive", "steer"), false);
	assert.equal(request.input("interactive", "followUp"), false);
	assert.equal(request.input("interactive"), true);
	assert.notEqual(request.requestId, originalId);
	assert.equal(request.snapshot().toolAttempts, 0);
	assert.equal(request.snapshot().childLaunches, 0);
	request.beginTool("running", "planner_tasks");
	assert.equal(request.resume(true), false, "operator cannot reset an executing call");
	request.endTool("running");
	assert.equal(request.resume(false), false);
	assert.equal(request.resume(true), true);

	let now = 1000, callback, rootAborts = 0;
	const timedStore = new MemoryStorage();
	const timed = make(timedStore, { now: () => now, setTimer: fn => { callback = fn; return { unref() {} }; }, clearTimer() {}, stopRoot: () => { rootAborts++; return "requested"; } });
	assert.deepEqual(timed.observe(), {
		requestId: timed.requestId,
		requestDeadline: null,
		remainingMs: null,
		observedAt: "1970-01-01T00:00:01.000Z",
		unavailableReason: "request-not-started",
	});
	tool(timed, "start");
	assert.equal(timed.snapshot().deadline, 901000);
	assert.equal(timed.observe().remainingMs, 900000);
	now = 901000; callback();
	assert.equal(timed.snapshot().closedReason, "active-time-limit");
	assert.equal(timed.snapshot().rootStop, "requested");
	timed.modelCall(); assert.equal(timed.snapshot().rootStop, "requested", "another call never proves stop");
	timed.settle(); assert.equal(timed.snapshot().rootStop, "confirmed");
	const priorAborts = rootAborts;
	timed.rootActive();
	assert.equal(rootAborts, priorAborts + 1, "a queued run with a new abort signal receives a new stop request");
	assert.equal(timed.snapshot().rootStop, "requested", "old settlement is not proof that a new run stopped");
	timed.settle();
	const restoredTime = make(timedStore, { now: () => now });
	assert.equal(restoredTime.snapshot().deadline, 901000);
	assert.equal(restoredTime.observe().remainingMs, 0, "restored Request keeps its original deadline");
	const closedTimingId = restoredTime.requestId;
	const closedTiming = restoredTime.closure(closedTimingId);
	assert.equal(closedTiming.requestId, closedTimingId);
	assert.equal(closedTiming.requestClosed, "active-time-limit");
	assert.equal(closedTiming.requestClosedAt, "1970-01-01T00:15:01.000Z");
	restoredTime.settle();
	assert.equal(restoredTime.input("interactive"), true);
	assert.notEqual(restoredTime.requestId, closedTimingId);
	assert.equal(restoredTime.observe(closedTimingId).requestId, closedTimingId, "history lookup stays bound to the original Request");
	assert.equal(restoredTime.observe(closedTimingId).remainingMs, 0, "re-entry cannot refresh an earlier Request deadline");
	assert.equal(restoredTime.closure(closedTimingId).requestClosed, "active-time-limit", "cross-Request closure lookup does not use the new Request");

	let passiveNow = 5_000;
	const passive = make(new MemoryStorage(), { now: () => passiveNow, setTimer: () => ({ unref() {} }), clearTimer() {} });
	tool(passive, "passive-start");
	passiveNow += limits.activeMs + 1;
	assert.equal(passive.observe().remainingMs, 0);
	assert.equal(passive.snapshot().closedReason, undefined, "remaining-time observation is side-effect-free after the deadline");

	const brokenStorage = new MemoryStorage();
	const broken = make(brokenStorage);
	brokenStorage.fail = true;
	assert.throws(() => broken.claim("cannot-persist", "A", "e1"), /request-persistence/);
	assert.ok(broken.snapshot().closedReason);
	assert.ok(broken.signal.aborted);
	assert.equal(broken.resume(true), false);

	// Real filesystem: truncated/missing state, interrupted atomic writes and
	// competing owners never look like a new installation.
	const disk = new FileRequestStorage(scratch, "session", root);
	const diskController = make(disk);
	tool(diskController, "disk");
	const diskBody = readFileSync(join(disk.directory, "state.json"), "utf8");
	unlinkSync(join(disk.directory, "state.json"));
	assert.match(make(disk).snapshot().closedReason, /missing/);
	writeFileSync(join(disk.directory, "state.json"), "{truncated");
	assert.match(make(disk).snapshot().closedReason, /request-persistence/);
	writeFileSync(join(disk.directory, "state.json"), diskBody);
	writeFileSync(join(disk.directory, "pending"), "interrupted");
	assert.match(make(disk).snapshot().closedReason, /interrupted/);
	unlinkSync(join(disk.directory, "pending"));
	const rival = make(disk);
	tool(diskController, "owner-one");
	assert.throws(() => tool(rival, "owner-two"), /request-persistence/);
	assert.equal(make(disk).snapshot().closedReason, undefined, "a stale observer cannot poison the current owner's record");
	const absent = new FileRequestStorage(scratch, "lost-session", root);
	assert.match(make(absent, { sessionId: "lost-session", previouslyManaged: true }).snapshot().closedReason, /missing/);

	// Every family survives interleaving, unrelated success, new IDs and reload.
	const failureStore = new MemoryStorage();
	let failures = make(failureStore);
	child(failures, "a1"); failures.observeFailure({ id: "f1", family: "task-quality", taskId: "A", executionId: "a1" });
	child(failures, "a2", "A", "a1"); failures.observeFailure({ id: "f2", family: "task-quality", taskId: "A", executionId: "a2" });
	child(failures, "b1", "B"); failures.accepted("B", "b1");
	failures.observeFailure({ id: "environment", family: "environment", taskId: "B" });
	failures = make(failureStore);
	failures.observeFailure({ id: "f3", family: "task-quality", taskId: "A", executionId: "a3" });
	assert.equal(failures.snapshot().closedReason, "no-progress:task-quality");

	const causalStore = new MemoryStorage();
	let causal = make(causalStore);
	causal.observeFailure({ id: "other-family", family: "environment", taskId: "A", executionId: "e1" });
	child(causal, "e1"); causal.observeFailure({ id: "e1-fail", family: "task-quality", taskId: "A", executionId: "e1" });
	child(causal, "e2", "A", "e1"); causal.observeFailure({ id: "e2-fail", family: "task-quality", taskId: "A", executionId: "e2" });
	causal.observeFailure({ id: "other-task", family: "environment", taskId: "B", executionId: "b0" });
	causal.observeFailure({ id: "unbound", family: "contract" });
	causal = make(causalStore);
	child(causal, "e3", "A", "e2"); causal.accepted("A", "e3");
	assert.deepEqual(causal.snapshot().failures.filter(f => f.resolved).map(f => f.id), ["e1-fail", "e2-fail"]);
	assert.deepEqual(causal.snapshot().failures.filter(f => !f.resolved).map(f => f.id), ["other-family", "other-task", "unbound"]);
	assert.equal(causal.snapshot().childLaunches, 3);
	causal.observeFailure({ id: "edge-less", family: "task-quality", taskId: "A", executionId: "e0" });
	causal.accepted("A", "e3");
	assert.equal(causal.snapshot().failures.find(f => f.id === "edge-less").resolved, false);

	const repair = make();
	repair.observeFailure({ id: "bad", family: "contract" });
	repair.structure("delegate", ["/objective", "/validation"]);
	repair.structure("delegate", ["/objective", "/validation"]);
	assert.equal(repair.snapshot().repairs, 0);
	repair.structure("delegate", ["/validation"]);
	repair.structure("delegate", []);
	assert.equal(repair.snapshot().repairs, 2);
	assert.equal(repair.snapshot().failures[0].resolved, false);
	repair.structure("delegate", ["/validation"]);
	assert.throws(() => repair.structure("delegate", []), /structural-repair-limit/);

	// Uncertain dispatch survives restart and cannot be resent; a late old
	// terminal cannot change a new request's counters or admission.
	const unknownStore = new MemoryStorage();
	let unknown = make(unknownStore);
	unknown.claim("unknown-send", "A", "old");
	const oldScope = unknown.requestId;
	unknown = make(unknownStore);
	assert.equal(unknown.snapshot().childLaunches, 1);
	assert.equal(unknown.snapshot().closedReason, "restored-unsettled-calls");
	assert.equal(unknown.resume(true), false, "operator confirmation cannot override a pending invocation");
	assert.equal(unknown.requestId, oldScope);
	unknown.finishChild("old", false, oldScope); // the waiter returned, but child stop is still unconfirmed
	assert.equal(unknown.resume(true), true);
	assert.match(unknown.render(), /Prior requests' unresolved child stops: pending=0, unconfirmed=1/);
	const nextScope = unknown.requestId;
	unknown.terminal("unknown-send", oldScope);
	unknown.finishChild("old", true, oldScope);
	assert.match(unknown.render(), /Prior requests' unresolved child stops: pending=0, unconfirmed=0/);
	assert.equal(unknown.requestId, nextScope);
	assert.equal(unknown.snapshot().childLaunches, 0);
	assert.equal(unknown.snapshot().closedReason, undefined);
	console.log("request-control: PASS (limits, durable faults, races, lifecycle, causal failures, repairs)");
} finally {
	for (const controller of controllers) controller.dispose();
	rmSync(scratch, { recursive: true, force: true });
}
