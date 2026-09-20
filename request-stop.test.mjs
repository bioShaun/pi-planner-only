import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(root, ".planner-only-request-fixture-"));
const agent = join(run, "agent"); mkdirSync(agent);
const childProcess = createRequire(import.meta.url)("node:child_process");
const fileSystem = createRequire(import.meta.url)("node:fs");
const originalExec = childProcess.execFileSync;
childProcess.execFileSync = (command, args) => {
	assert.equal(command, "git"); assert.deepEqual(args, ["rev-parse", "HEAD"]); return "fixture-plugin-head\n";
};
syncBuiltinESMExports();
Object.assign(process.env, { PI_CODING_AGENT_DIR: agent, PI_PLANNER_ONLY: "1", PI_PLANNER_ONLY_SEED_PRICING: "0",
	PI_PLANNER_ONLY_QUIESCENCE_MS: "0", PI_PLANNER_ONLY_CANCEL_GRACE_MS: "10", PI_PLANNER_ONLY_REQUIRE_REVIEW: "0" });
delete process.env.PI_SUBAGENT_CHILD;
const { default: plannerOnly } = await import("./index.ts");
const { hashStatus } = await import("./evidence.ts");
const { REQUEST_LIMIT_ENV } = await import("./request-control.ts");
const { SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST, SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE,
	SUBAGENT_DELEGATION_CANCEL_EVENT: CANCEL } = await import("./subagent-delegation-contract.ts");
const fixtures = [];
// Faux pending children have no socket to keep Node alive; this bounded harness
// watchdog also catches a missing cancellation path instead of hanging CI.
// Each writer terminal includes the production 250 ms quiet-sample interval;
// allow the complete expanded scenario matrix to finish within one minute.
const watchdog = setTimeout(() => { throw new Error("request-stop fixture timed out"); }, 30_000);
const worker = { role: "worker", objective: "Inspect fixture", scope: { allowedPaths: ["fixture.txt"] },
	constraints: [], acceptanceCriteria: ["report inspection"], validation: { required: false } };

async function fixture(name, options = {}) {
	for (const key of Object.values(REQUEST_LIMIT_ENV)) delete process.env[key];
	for (const [key, value] of Object.entries(options.limits ?? {})) process.env[REQUEST_LIMIT_ENV[key]] = String(value);
	const cwd = join(run, name); mkdirSync(cwd); writeFileSync(join(cwd, "fixture.txt"), "initial\n");
	const listeners = new Map(), tools = new Map(), handlers = new Map(), commands = new Map(), entries = [], notices = [];
	const f = { name, cwd, tools, handlers, commands, entries, notices, launches: [], cancels: [], aborts: 0, seq: 0, idle: true,
		pending: false, cancelConfirmed: true, reportStatus: "completed", head: "abc1234", onRequest: undefined };
	const events = {
		on(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return () => set.delete(fn); },
		emit(name, value) { for (const fn of [...(listeners.get(name) ?? [])]) fn(value); },
	};
	f.events = events;
	f.respond = (request, status = f.terminalStatus ?? "completed") => events.emit(RESPONSE, {
		requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId, status,
		runId: `fixture-${request.requestId}`, model: "fixture/no-model", agent: request.agent,
		...(f.zeroUse ? { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 0, toolCalls: 0, durationMs: 0 } } : {}),
		...(status === "completed" ? { result: { kind: "structured", value: request.agent === "reviewer"
			? { taskId: request.nodeId, verdict: f.reviewVerdict ?? "pass", summary: "reviewed", evidenceFresh: true, findings: [] }
			: { version: 1, taskId: f.badReport ? "wrong-task" : request.nodeId, status: f.reportStatus, summary: `fixture ${f.reportStatus}`,
				changedFiles: [], validation: [], risks: [], unresolved: f.reportStatus === "failed" ? ["fixture defect"] : [],
				evidence: { cwd, taskId: request.nodeId, gitAvailable: true, baseGitRef: f.head, finalGitRef: f.head,
					gitStatusHash: hashStatus(""), changedPaths: [], generatedAt: new Date().toISOString() } } } } : {}),
	});
	events.on("pi-subagents:runtime-agent-register:v1", request => { request.result = { ok: true, registration: {} }; });
	events.on(REQUEST, request => {
		f.launches.push(request);
		const snapshot = f.state();
		assert.ok(snapshot.claims.some(c => c.key === request.requestId), "durable request claim exists before any child starts");
		if (f.onRequest) f.onRequest(request);
		if (f.expireAfterLaunchMs !== undefined) {
			const realNow = Date.now;
			Date.now = () => realNow() + f.expireAfterLaunchMs;
			try { void handlers.get("before_provider_request")({}, ctx); }
			finally { Date.now = realNow; }
		}
		if (!f.pending) queueMicrotask(() => f.respond(request));
	});
	events.on(CANCEL, cancel => {
		f.cancels.push(cancel);
		assert.ok(f.state().closedReason || options.allowEnvelope, "request closed before cancellation is propagated");
		if (f.cancelConfirmed) queueMicrotask(() => f.respond(cancel, "cancelled"));
	});
	const ctx = { cwd, hasUI: false, abort() { f.aborts++; }, isIdle() { return f.idle; },
		ui: { notify(message) { notices.push(message); }, setStatus() {}, theme: { fg(_, text) { return text; } }, async confirm() { return true; } },
		sessionManager: { getEntries() { return entries; }, getSessionId() { return name; }, getSessionFile() { return join(cwd, "session.jsonl"); } } };
	f.ctx = ctx;
	const pi = { on(name, fn) { handlers.set(name, fn); }, registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand(name, command) { commands.set(name, command); }, getActiveTools() { return ["read", "bash", "write"]; },
		getAllTools() { return [...tools.keys()].map(name => ({ name })); }, setActiveTools() { assert.fail("request closure must not hide child tools"); },
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); }, sendMessage(message) { notices.push(message.content); }, events,
		async exec(_, args) {
			const values = { "rev-parse --git-dir": ".git\n", "rev-parse --show-toplevel": `${cwd}\n`, "rev-parse HEAD": `${f.head}\n`, "status --porcelain=v2 --branch": "" };
			return { stdout: values[args.join(" ")] ?? "", stderr: "", code: 0 };
		} };
	const hash = createHash("sha256").update(JSON.stringify([name, cwd])).digest("hex");
	f.path = join(agent, "planner-only", "requests", hash, "state.json");
	f.state = () => JSON.parse(readFileSync(f.path, "utf8")).current;
	f.task = id => JSON.parse(readFileSync(join(agent, "planner-only", "ledger", `${id}.json`), "utf8")).task;
	f.call = async (name, params = {}, { direct = false, id = `${f.name}-${++f.seq}` } = {}) => {
		if (!direct) {
			const gate = await handlers.get("tool_call")({ toolName: name, toolCallId: id, input: params }, ctx);
			if (gate?.block) throw Object.assign(new Error(gate.reason), { gate });
		}
		return tools.get(name).execute(id, params, undefined, undefined, ctx);
	};
	f.reload = async () => {
		await handlers.get("session_shutdown")({ reason: "reload" }, ctx);
		plannerOnly(pi); await handlers.get("session_start")({}, ctx);
	};
	plannerOnly(pi); await handlers.get("session_start")({}, ctx); fixtures.push(f); return f;
}

try {
	const tools = await fixture("tools");
	for (let i = 0; i < 32; i++) await tools.call("planner_tasks", {}, { direct: i % 2 === 0 });
	assert.equal(tools.state().toolAttempts, 32);
	await assert.rejects(tools.call("planner_tasks"), error => error.gate.terminate === true);
	await assert.rejects(tools.call("git_audit", { operation: "status" }, { direct: true }), /tool-attempt-limit/);
	assert.equal(tools.launches.length, 0); assert.ok(tools.aborts > 0);
	const oldId = tools.state().id;
	await tools.reload();
	assert.equal(tools.state().id, oldId);
	await assert.rejects(tools.call("planner_tasks"), /tool-attempt-limit/);
	await tools.handlers.get("agent_settled")({}, tools.ctx);
	for (const source of ["extension", "rpc", "unknown"]) await tools.handlers.get("input")({ source }, tools.ctx);
	await tools.handlers.get("input")({ source: "interactive", streamingBehavior: "steer" }, tools.ctx);
	assert.equal(tools.state().id, oldId);
	await tools.handlers.get("input")({ source: "interactive" }, tools.ctx);
	assert.notEqual(tools.state().id, oldId); await tools.call("planner_tasks");
	assert.equal(tools.state().toolAttempts, 1);

	for (const vary of [false, true]) {
		const repeat = await fixture(`repeat-${vary}`);
		for (let i = 0; i < 3; i++) await assert.rejects(repeat.call("planner_verdict", { taskId: "T-19000101-999", verdict: "pass", summary: vary ? `different ${i}` : "same" }));
		assert.match(repeat.state().closedReason, /no-progress:contract:planner_verdict:TASK_NOT_FOUND/);
		await assert.rejects(repeat.call("planner_delegate", worker), error => error.gate.terminate === true);
		assert.equal(repeat.launches.length, 0);
	}

	const launches = await fixture("launches");
	const initial = await launches.call("planner_delegate", worker);
	const taskId = initial.details.taskId;
	await launches.call("planner_redelegate", { ...worker, taskId, role: "reviewer" });
	await launches.call("planner_delegate", { ...worker, role: "validator" });
	for (let i = 0; i < 5; i++) await launches.call("planner_delegate", { ...worker, role: "explorer", acceptanceMode: "observation" });
	assert.equal(launches.launches.length, 8);
	await launches.call("planner_delegate", { ...worker, role: "explorer", acceptanceMode: "observation" }, { direct: true });
	assert.equal(launches.launches.length, 8);
	assert.equal(launches.state().closedReason, "child-launch-limit");
	assert.equal(launches.state().claims.length, 8);

	const parallel = await fixture("parallel", { limits: { childLaunches: 1 } });
	const reader = { ...worker, role: "explorer", acceptanceMode: "observation" };
	const results = await Promise.allSettled([parallel.call("planner_delegate", reader), parallel.call("planner_delegate", reader)]);
	assert.equal(results.length, 2); assert.equal(parallel.launches.length, 1); assert.equal(parallel.state().childLaunches, 1);

	// Typed failures across new Tasks and unrelated completion retain the chain.
	const failures = await fixture("failures");
	failures.reportStatus = "failed";
	const a1 = await failures.call("planner_delegate", worker);
	await failures.call("planner_redelegate", { ...worker, taskId: a1.details.taskId });
	failures.reportStatus = "completed";
	const b = await failures.call("planner_delegate", worker);
	await failures.call("planner_verdict", { taskId: b.details.taskId, verdict: "pass", summary: "accepted B" });
	assert.equal(failures.state().failures.filter(f => f.family === "task-quality" && !f.resolved).length, 2);
	failures.reportStatus = "failed";
	await failures.call("planner_delegate", worker);
	assert.equal(failures.state().closedReason, "no-progress:task-quality");
	assert.equal(failures.state().childLaunches, 4);

	const causal = await fixture("causal");
	causal.reportStatus = "failed";
	const c1 = await causal.call("planner_delegate", worker);
	await causal.call("planner_redelegate", { ...worker, taskId: c1.details.taskId });
	await causal.reload();
	causal.reportStatus = "completed";
	await causal.call("planner_redelegate", { ...worker, taskId: c1.details.taskId });
	assert.equal(causal.state().failures.filter(f => !f.resolved).length, 2, "unaccepted completed report is not progress");
	await causal.call("planner_verdict", { taskId: c1.details.taskId, verdict: "pass", summary: "accepted correction" });
	assert.equal(causal.task(c1.details.taskId).state, "completed");
	assert.equal(causal.state().failures.filter(f => !f.resolved).length, 0);
	assert.equal(causal.state().childLaunches, 3);
	assert.ok(causal.state().claims[2].correction);

	const repair = await fixture("repair");
	await assert.rejects(repair.call("planner_delegate", { ...worker, validation: { required: true } }));
	await repair.call("planner_delegate", worker);
	assert.equal(repair.state().repairs, 1);
	assert.equal(repair.state().failures.filter(f => !f.resolved).length, 1);

	const refusalReset = await fixture("refusal-reset");
	for (let i = 0; i < 3; i++) await assert.rejects(refusalReset.call("planner_delegate", { ...worker, validation: { required: true } }));
	await refusalReset.handlers.get("agent_settled")({}, refusalReset.ctx);
	await refusalReset.handlers.get("input")({ source: "interactive" }, refusalReset.ctx);
	await assert.rejects(refusalReset.call("planner_delegate", { ...worker, validation: { required: true } }), error => !error.gate);
	assert.equal(refusalReset.state().failures.length, 1);

	const reviewerCorrection = await fixture("reviewer-correction");
	const reviewed = await reviewerCorrection.call("planner_delegate", worker);
	reviewerCorrection.reviewVerdict = "request_changes";
	await reviewerCorrection.call("planner_redelegate", { ...worker, taskId: reviewed.details.taskId, role: "reviewer" });
	assert.equal(reviewerCorrection.state().failures[0].executionId, reviewed.details.executionId);
	await reviewerCorrection.call("planner_redelegate", { ...worker, taskId: reviewed.details.taskId });
	reviewerCorrection.reviewVerdict = "pass";
	await reviewerCorrection.call("planner_redelegate", { ...worker, taskId: reviewed.details.taskId, role: "reviewer" });
	assert.equal(reviewerCorrection.task(reviewed.details.taskId).state, "completed");
	assert.equal(reviewerCorrection.state().failures.filter(f => !f.resolved).length, 0);

	const blocked = await fixture("typed-blocked");
	blocked.reportStatus = "blocked";
	for (let i = 0; i < 3; i++) await blocked.call("planner_delegate", worker);
	assert.equal(blocked.state().closedReason, "no-progress:environment");
	assert.equal(blocked.launches.length, 3);

	const mixed = await fixture("alternating-families");
	for (const status of ["blocked", "failed", "blocked", "failed", "blocked"]) {
		await mixed.call("planner_tasks");
		mixed.reportStatus = status;
		await mixed.call("planner_delegate", worker);
	}
	assert.equal(mixed.state().closedReason, "no-progress:environment");
	assert.equal(mixed.state().failures.filter(f => f.family === "task-quality").length, 2);

	for (const [name, statuses, family, zeroUse] of [
		["provider-terminals", ["failed", "unavailable_context", "failed"], "transient"],
		["report-terminals", ["structured_output_failed", "acceptance_failed", "structured_output_failed"], "contract:report"],
		["launch-terminals", ["invalid_request", "duplicate_node", "invalid_request"], "contract:delegation:launch"],
		["startup-failed-terminals", ["failed", "failed", "failed"], "contract:delegation:launch", true],
	]) {
		const terminal = await fixture(name);
		terminal.zeroUse = zeroUse;
		for (const status of statuses) {
			terminal.terminalStatus = status;
			const outcome = await terminal.call("planner_delegate", worker);
			assert.equal(outcome.details.termination.terminationConfirmed, true);
			if (zeroUse) assert.equal(outcome.details.termination.reason, "launch_failure");
		}
		assert.equal(terminal.state().closedReason, `no-progress:${family}`);
		assert.ok(terminal.state().failures.every(f => f.family === family));
		await assert.rejects(terminal.call("planner_delegate", worker));
		assert.equal(terminal.launches.length, 3);
	}

	const reportCorrection = await fixture("report-correction");
	reportCorrection.badReport = true;
	const malformed = await reportCorrection.call("planner_delegate", worker);
	assert.equal(malformed.details.state, "changes_requested");
	assert.equal(malformed.details.decision, "report_correction");
	reportCorrection.badReport = false;
	await reportCorrection.call("planner_redelegate", { ...worker, taskId: malformed.details.taskId, instructions: "Correct the report only." });
	assert.equal(reportCorrection.state().childLaunches, 2, "report correction uses the same child allowance");
	assert.equal(reportCorrection.state().failures.filter(f => !f.resolved).length, 1);
	await reportCorrection.call("planner_verdict", { taskId: malformed.details.taskId, verdict: "pass", summary: "accepted corrected report" });
	assert.equal(reportCorrection.state().failures.filter(f => !f.resolved).length, 0);

	const recoveries = await fixture("runaway-recovery", { allowEnvelope: true });
	recoveries.pending = true;
	const boundedWorker = { ...worker, envelope: { maxWallMs: 30 } };
	let runaway = await recoveries.call("planner_delegate", boundedWorker);
	for (let i = 0; i < 2; i++) {
		runaway = await recoveries.call("planner_redelegate", { ...boundedWorker, taskId: runaway.details.taskId,
			recovery: { executionId: runaway.details.executionId, action: "retry_same_plan", reason: `changed wording ${i}`,
				evidenceRefs: [runaway.details.executionId], worktreeDecision: "keep" } });
	}
	assert.equal(recoveries.state().closedReason, "no-progress:budget");
	assert.equal(recoveries.launches.length, 3);
	await assert.rejects(recoveries.call("planner_delegate", worker));
	assert.equal(recoveries.launches.length, 3);

	for (const confirmed of [true, false]) {
		const stop = await fixture(`deadline-${confirmed}`, { limits: { activeMs: 90_000 } });
		stop.pending = true; stop.cancelConfirmed = confirmed;
		stop.expireAfterLaunchMs = 90_001;
		const outcome = await stop.call("planner_delegate", worker);
		assert.equal(stop.state().closedReason, "active-time-limit");
		assert.equal(stop.cancels.length, 1);
		assert.equal(outcome.details.termination.terminationConfirmed, confirmed);
		const stoppedId = stop.state().id;
		if (!confirmed) {
			assert.ok(stop.task(outcome.details.taskId).writerHold);
			stop.ctx.hasUI = true;
			await stop.commands.get("planner-only").handler("request resume", stop.ctx);
			assert.notEqual(stop.state().id, stoppedId);
			assert.ok(stop.task(outcome.details.taskId).writerHold, "request resume cannot release a writer");
			stop.respond(stop.launches[0], "cancelled");
			await new Promise(resolve => setTimeout(resolve, 300));
			assert.equal(stop.task(outcome.details.taskId).writerHold, undefined);
			assert.equal(stop.state().childLaunches, 0, "old terminal does not charge the new request");
		} else assert.equal(stop.task(outcome.details.taskId).writerHold, undefined);
	}

	const held = await fixture("held-reload", { limits: { activeMs: 90_000 } });
	held.pending = true; held.cancelConfirmed = false;
	held.expireAfterLaunchMs = 90_001;
	const heldOutcome = await held.call("planner_delegate", worker);
	await held.reload();
	assert.ok(held.task(heldOutcome.details.taskId).writerHold);
	await assert.rejects(held.call("planner_delegate", worker), /active-time-limit/);
	held.ctx.hasUI = true;
	await held.commands.get("planner-only").handler("request resume", held.ctx);
	await assert.rejects(held.call("planner_delegate", worker), /held|writer|reserved/i);
	assert.equal(held.launches.length, 1);

	const operator = await fixture("operator", { limits: { toolAttempts: 1 } });
	await operator.call("planner_tasks"); await assert.rejects(operator.call("planner_tasks"));
	const closed = operator.state().id;
	await operator.commands.get("planner-only").handler("request resume", operator.ctx);
	assert.equal(operator.state().id, closed, "headless command has no proven operator origin");
	assert.equal(operator.tools.has("request_resume"), false);
	operator.ctx.hasUI = true;
	await operator.commands.get("planner-only").handler("request resume", operator.ctx);
	assert.notEqual(operator.state().id, closed);

	const switched = await fixture("session-switch");
	await switched.call("planner_tasks");
	switched.ctx.sessionManager.getSessionId = () => "different-session";
	switched.ctx.sessionManager.getEntries = () => [];
	await assert.rejects(switched.call("planner_tasks"), /session-boundary-unverified/);
	assert.equal(switched.state().closedReason, "session-switch", "identity change closes the old request even without session_start");

	// A sibling workspace in the same session is first contact for its own
	// namespace. The public entry written for another workspace must not read
	// as THIS namespace's lost directory (an unrecoverable persistence fault);
	// the boundary still closes it until a settled idle interactive input.
	const sibling = await fixture("sibling-workspace");
	await sibling.call("planner_tasks");
	assert.ok(sibling.entries.some(e => e.customType === "planner-only-request" && e.data.workspace === sibling.cwd));
	const siblingCwd = join(run, "sibling-workspace-b"); mkdirSync(siblingCwd);
	const siblingCtx = { ...sibling.ctx, cwd: siblingCwd };
	const siblingPath = join(agent, "planner-only", "requests",
		createHash("sha256").update(JSON.stringify([sibling.name, siblingCwd])).digest("hex"), "state.json");
	const siblingState = () => JSON.parse(readFileSync(siblingPath, "utf8")).current;
	await assert.rejects(sibling.tools.get("planner_tasks").execute("sibling-b-1", {}, undefined, undefined, siblingCtx), /session-boundary-unverified/);
	assert.equal(siblingState().closedReason, "session-boundary-unverified", "another workspace's entry is not this namespace's lost record");
	await sibling.handlers.get("agent_settled")({}, siblingCtx);
	await sibling.handlers.get("input")({ source: "interactive" }, siblingCtx);
	await sibling.tools.get("planner_tasks").execute("sibling-b-2", {}, undefined, undefined, siblingCtx);
	assert.equal(siblingState().closedReason, undefined, "a trusted input opens the sibling namespace");
	// The session's OWN namespace losing its directory remains a durable fault.
	rmSync(dirname(sibling.path), { recursive: true, force: true });
	await sibling.reload();
	await assert.rejects(sibling.call("planner_tasks"), /request-persistence: request record missing/);

	// Inject faults at the real Request disk boundary, preserving the original
	// protected subprocess probes and all production durability checks.
	for (const phase of ["before-commit", "after-commit"]) {
		const fault = await fixture(`fault-${phase}`, { allowEnvelope: true });
		const originalWrite = fileSystem.writeFileSync, originalRename = fileSystem.renameSync;
		let injected = false;
		try {
			if (phase === "before-commit") fileSystem.writeFileSync = (path, body, ...rest) => {
				if (typeof path === "number" && typeof body === "string" && body.startsWith('{"version":1,"sessionId":')) {
					const doc = JSON.parse(body);
					if (doc.sessionId === fault.name && doc.current.childLaunches === 1) { injected = true; throw new Error("injected before claim commit"); }
				}
				return originalWrite(path, body, ...rest);
			};
			else fileSystem.renameSync = (from, to) => {
				const result = originalRename(from, to);
				if (to === fault.path && JSON.parse(readFileSync(to, "utf8")).current.childLaunches === 1) {
					injected = true; throw new Error("injected after claim commit before REQUEST");
				}
				return result;
			};
			syncBuiltinESMExports();
			await fault.call("planner_delegate", worker);
		} finally {
			fileSystem.writeFileSync = originalWrite; fileSystem.renameSync = originalRename; syncBuiltinESMExports();
		}
		assert.ok(injected);
		assert.equal(fault.launches.length, 0);
		assert.equal(fault.state().childLaunches, phase === "before-commit" ? 0 : 1);
		await fault.reload();
		await assert.rejects(fault.call("planner_delegate", worker), /request-persistence/);
		assert.equal(fault.launches.length, 0, "reload must not resend an uncertain claim");
	}
	const unknownSend = await fixture("fault-after-request", { allowEnvelope: true });
	unknownSend.pending = true; unknownSend.cancelConfirmed = false;
	unknownSend.onRequest = () => { throw new Error("listener failed after another listener could start the child"); };
	const unknownOutcome = await unknownSend.call("planner_delegate", worker, { id: "unknown-dispatch" });
	assert.equal(unknownSend.cancels.length, 1);
	assert.equal(unknownSend.state().childLaunches, 1);
	assert.equal(unknownSend.state().claims[0].emittedAt, undefined);
	assert.ok(unknownSend.task(unknownOutcome.details.taskId).writerHold);
	await unknownSend.reload();
	await assert.rejects(unknownSend.call("planner_delegate", worker, { id: "unknown-dispatch" }));
	assert.equal(unknownSend.launches.length, 1);
	console.log("request-stop: PASS (real plugin/tools/transport/ledger; fake Git and child source; no subprocess)");
} finally {
	clearTimeout(watchdog);
	for (const f of fixtures) await f.handlers.get("session_shutdown")({ reason: "exit" }, f.ctx);
	childProcess.execFileSync = originalExec; syncBuiltinESMExports();
	rmSync(run, { recursive: true, force: true });
}
