import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const run = mkdtempSync(join(root, ".planner-only-p1-fixture-"));
const agentDir = join(run, "agent");
mkdirSync(agentDir);

// index.ts fingerprints Git at import time. Replace that single subprocess
// boundary before import; the fixture itself uses only in-process events.
const childProcess = createRequire(import.meta.url)("node:child_process");
const originalExecFileSync = childProcess.execFileSync;
childProcess.execFileSync = (command, args) => {
	assert.equal(command, "git");
	assert.deepEqual(args, ["rev-parse", "HEAD"]);
	return "p1-fixture-head\n";
};
syncBuiltinESMExports();

Object.assign(process.env, {
	PI_CODING_AGENT_DIR: agentDir,
	PI_PLANNER_ONLY: "1",
	PI_PLANNER_ONLY_SEED_PRICING: "0",
	PI_PLANNER_ONLY_QUIESCENCE_MS: "0",
	PI_PLANNER_ONLY_CANCEL_GRACE_MS: "10",
	PI_PLANNER_ONLY_REQUIRE_REVIEW: "0",
});
delete process.env.PI_SUBAGENT_CHILD;

const { default: plannerOnly } = await import("./index.ts");
const { hashStatus } = await import("./evidence.ts");
const { REQUEST_LIMIT_ENV } = await import("./request-control.ts");
const {
	SUBAGENT_DELEGATION_CANCEL_EVENT: CANCEL,
	SUBAGENT_DELEGATION_REQUEST_EVENT: REQUEST,
	SUBAGENT_DELEGATION_RESPONSE_EVENT: RESPONSE,
} = await import("./subagent-delegation-contract.ts");
const {
	EXECUTION_DEFAULT_ENV_VARS,
} = await import("./execution-defaults.ts");

const { resolveDelegationModel } = await import("./delegation-model.ts");
const fixtures = [];
const watchdog = setTimeout(() => { throw new Error("p1 delegation fixture timed out"); }, 20_000);
const definition = {
	role: "worker",
	objective: "Preserve this stored objective",
	cwd: undefined,
	scope: { allowedPaths: ["fixture.txt"] },
	constraints: ["stored constraint"],
	acceptanceCriteria: ["stored acceptance"],
	validation: { required: true, commands: ["node --check fixture.js"] },
};

function clearConfig() {
	for (const key of Object.keys(process.env)) if (/^PI_PLANNER_ONLY_(ROLE_MODELS|MODEL_|THINKING_)/.test(key)) delete process.env[key];
	for (const key of Object.values(REQUEST_LIMIT_ENV)) delete process.env[key];
	for (const key of Object.values(EXECUTION_DEFAULT_ENV_VARS)) delete process.env[key];
}

function ledgerFiles() {
	const dir = join(agentDir, "planner-only", "ledger");
	return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

async function fixture(name, options = {}) {
	clearConfig();
	for (const [key, value] of Object.entries(options.requestLimits ?? {})) {
		process.env[REQUEST_LIMIT_ENV[key]] = String(value);
	}
	for (const [key, value] of Object.entries(options.executionDefaults ?? {})) {
		process.env[EXECUTION_DEFAULT_ENV_VARS[key]] = String(value);
	}
	Object.assign(process.env, options.routeEnv ?? {});
	const cwd = join(run, name);
	mkdirSync(cwd);
	writeFileSync(join(cwd, "fixture.txt"), "fixture\n");
	const listeners = new Map();
	const tools = new Map();
	const handlers = new Map();
	const entries = [];
	const f = { name, cwd, tools, handlers, entries, launches: [], cancels: [], pending: options.pending === true, sequence: 0 };
	const events = {
		on(event, fn) {
			const set = listeners.get(event) ?? new Set();
			set.add(fn);
			listeners.set(event, set);
			return () => set.delete(fn);
		},
		emit(event, value) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(value);
		},
	};
	f.respond = (request, status = "completed") => events.emit(RESPONSE, {
		requestId: request.requestId,
		ownerRunId: request.ownerRunId,
		nodeId: request.nodeId,
		status,
		runId: `run-${request.requestId}`,
		model: options.actualModel ?? "fixture/model",
		...(options.actualThinking ? { thinking: options.actualThinking } : {}),
		agent: request.agent,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, turns: 1, toolCalls: 0, durationMs: 1 },
		...(status === "completed" ? {
			result: { kind: "structured", value: request.agent === "reviewer"
				? { taskId: request.nodeId, verdict: "pass", summary: "reviewed stored spec", evidenceFresh: true, findings: [] }
				: { version: 1, taskId: request.nodeId, status: "completed", summary: "completed",
					changedFiles: [], validation: [], risks: [], unresolved: [],
					evidence: { cwd: request.cwd, taskId: request.nodeId, gitAvailable: true,
						baseGitRef: "abc1234", finalGitRef: "abc1234", gitStatusHash: hashStatus(""), changedPaths: [] } } },
		} : {}),
	});
	events.on("pi-subagents:runtime-agent-register:v1", request => { request.result = { ok: true, registration: {} }; });
	events.on(REQUEST, request => {
		f.launches.push(request);
		if (!f.pending) queueMicrotask(() => f.respond(request));
	});
	events.on(CANCEL, cancel => {
		f.cancels.push(cancel);
		queueMicrotask(() => f.respond(cancel, "cancelled"));
	});
	const ctx = {
		cwd,
		hasUI: false,
		...(options.models ? { modelRegistry: { getAvailable: () => options.models } } : {}),
		abort() {},
		isIdle() { return true; },
		ui: { notify() {}, setStatus() {}, theme: { fg(_kind, text) { return text; } }, async confirm() { return true; } },
		sessionManager: {
			getEntries() { return entries; },
			getSessionId() { return name; },
			getSessionFile() { return join(cwd, "session.jsonl"); },
		},
	};
	f.ctx = ctx;
	const pi = {
		on(event, fn) { handlers.set(event, fn); },
		registerTool(tool) { tools.set(tool.name, tool); },
		registerCommand() {},
		getActiveTools() { return ["read", "bash", "write"]; },
		getAllTools() { return [...tools.keys()].map((toolName) => ({ name: toolName })); },
		setActiveTools() {},
		appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
		sendMessage() {},
		events,
		async exec(_command, args, execOptions = {}) {
			const workdir = execOptions.cwd ?? cwd;
			const values = {
				"rev-parse --git-dir": ".git\n",
				"rev-parse --show-toplevel": `${workdir}\n`,
				"rev-parse HEAD": "abc1234\n",
				"status --porcelain=v2 --branch": "",
			};
			return { stdout: values[args.join(" ")] ?? "", stderr: "", code: 0 };
		},
	};
	f.call = (toolName, params, callCtx = ctx) => tools.get(toolName).execute(`${name}-${++f.sequence}`, params, undefined, undefined, callCtx);
	f.task = taskId => JSON.parse(readFileSync(join(agentDir, "planner-only", "ledger", `${taskId}.json`), "utf8")).task;
	plannerOnly(pi);
	await handlers.get("session_start")({}, ctx);
	fixtures.push(f);
	return f;
}

try {
	const bound = await fixture("stored-spec");
	const schemaKeys = Object.keys(bound.tools.get("planner_redelegate").parameters.properties).sort();
	assert.deepEqual(schemaKeys, ["envelope", "instructions", "recovery", "role", "taskId"]);
	const created = await bound.call("planner_delegate", { ...definition, cwd: bound.cwd });
	const taskId = created.details.taskId;
	assert.deepEqual(bound.task(taskId).executions[0].envelope,
		{ maxTokens: 100_000, maxWallMs: 600_000, source: "default" });
	const storedBefore = structuredClone(bound.task(taskId).spec);
	const rebound = await bound.call("planner_redelegate", {
		taskId,
		role: "worker",
		instructions: "temporary child-only note",
		objective: "forged objective",
		cwd: join(run, "forged-cwd"),
		scope: { allowedPaths: ["forged.txt"] },
		constraints: ["forged constraint"],
		acceptanceCriteria: ["forged acceptance"],
		validation: { required: false },
	});
	const reboundPacket = JSON.parse(bound.launches.at(-1).task);
	assert.deepEqual(reboundPacket.spec, storedBefore, "minimal rebind uses the complete stored TaskSpec");
	assert.equal(reboundPacket.instructions, "temporary child-only note");
	assert.match(rebound.details.warnings.join("\n"), /objective, cwd, scope, constraints, acceptanceCriteria, validation/);
	assert.deepEqual(bound.task(taskId).spec, storedBefore, "rebind cannot mutate the stored TaskSpec or role");
	assert.equal(bound.launches.at(-1).agent, "worker", "invocation role still selects routing");
	await assert.rejects(bound.call("planner_redelegate", { taskId, role: "worker", acceptanceMode: "observation" }),
		error => error?.code === "ACCEPTANCE_MODE_IMMUTABLE");

	const foreign = await fixture("foreign-host");
	await assert.rejects(foreign.call("planner_redelegate", { taskId, role: "worker", cwd: bound.cwd }),
		error => error?.code === "TASK_FOREIGN_WORKSPACE");
	assert.equal(foreign.launches.length, 0, "caller cwd cannot bypass host-context workspace admission");

	const review = await bound.call("planner_redelegate", { taskId, role: "reviewer", envelope: { maxWallMs: 1 } });
	assert.equal(review.details.review.taskId, taskId);
	assert.match(review.details.warnings.join("\n"), /ignored envelope for role=reviewer/);
	assert.equal(bound.launches.at(-1).agent, "reviewer");
	assert.match(bound.launches.at(-1).task, /Preserve this stored objective/);
	assert.doesNotMatch(bound.launches.at(-1).task, /forged objective/);
	assert.equal(bound.task(taskId).executions.length, 2, "reviewer does not add an execution envelope record");

	const observation = await fixture("observation");
	const observed = await observation.call("planner_delegate", {
		...definition,
		role: "explorer",
		acceptanceMode: "observation",
		validation: { required: false },
	});
	await observation.call("planner_redelegate", { taskId: observed.details.taskId, role: "explorer" });
	assert.equal(observation.task(observed.details.taskId).spec.role, "explorer");
	await assert.rejects(observation.call("planner_redelegate", { taskId: observed.details.taskId, role: "reviewer" }),
		error => error?.code === "OBSERVATION_EXPLORER_ONLY");

	const defaults = await fixture("operator-default", {
		pending: true,
		executionDefaults: { MAX_TOKENS: 100_000, MAX_WALL_MS: 15 },
		requestLimits: { activeMs: 2_000 },
	});
	const runaway = await defaults.call("planner_delegate", definition);
	assert.equal(runaway.details.termination.reason, "worker_runaway");
	assert.equal(runaway.details.termination.anomaly.source, "operator-config");
	assert.equal(defaults.cancels.length, 1);
	assert.deepEqual(defaults.task(runaway.details.taskId).executions[0].envelope,
		{ maxTokens: 100_000, maxWallMs: 15, source: "operator-config" });

	defaults.pending = false;
	process.env[EXECUTION_DEFAULT_ENV_VARS.MAX_TOKENS] = "2";
	process.env[EXECUTION_DEFAULT_ENV_VARS.MAX_WALL_MS] = "3";
	const explicit = await defaults.call("planner_delegate", { ...definition, envelope: { maxTokens: 7 } });
	assert.deepEqual(defaults.task(explicit.details.taskId).executions[0].envelope,
		{ maxTokens: 7, source: "delegation-param" }, "explicit envelope replaces configured defaults without raising it");

	const invalid = await fixture("invalid-config");
	const beforeInvalid = ledgerFiles().length;
	process.env[EXECUTION_DEFAULT_ENV_VARS.MAX_TOKENS] = " ";
	await assert.rejects(invalid.call("planner_delegate", definition), error => error?.code === "EXECUTION_DEFAULTS_INVALID");
	assert.equal(invalid.launches.length, 0);
	assert.equal(ledgerFiles().length, beforeInvalid, "invalid config creates no Task or execution record");
	delete process.env[EXECUTION_DEFAULT_ENV_VARS.MAX_TOKENS];
	await assert.rejects(invalid.call("planner_delegate", { ...definition, envelope: { maxTokens: 1e20 } }),
		error => error?.code === "ENVELOPE_INVALID");
	assert.equal(ledgerFiles().length, beforeInvalid, "an unsafe explicit integer cannot create an unrestorable ledger");

	const longWall = await fixture("large-wall-config", { executionDefaults: { MAX_WALL_MS: 2_147_483_648 } });
	const originalTimer = globalThis.setTimeout;
	const delays = [];
	globalThis.setTimeout = (fn, ms, ...args) => { delays.push(ms); return originalTimer(fn, ms, ...args); };
	try {
		const result = await longWall.call("planner_delegate", definition);
		assert.equal(longWall.task(result.details.taskId).executions[0].envelope.maxWallMs, 2_147_483_648);
		assert.equal(longWall.cancels.length, 0);
		assert.ok(delays.includes(2_147_483_647), "long bounds use supported Node timer slices");
		assert.ok(delays.every(ms => ms <= 2_147_483_647), "no delay can overflow Node into a 1ms loop");
	} finally { globalThis.setTimeout = originalTimer; }

	const requestFirst = await fixture("request-first", {
		pending: true,
		// Leave time for the real ledger fsync before dispatch; still prove
		// the Request deadline cancels well before the execution envelope.
		executionDefaults: { MAX_TOKENS: 100_000, MAX_WALL_MS: 10_000 },
		requestLimits: { activeMs: 1_000 },
	});
	const cutoff = await requestFirst.call("planner_delegate", definition);
	assert.equal(cutoff.details.termination.reason, "operator_cancel", "earlier Request deadline wins over execution default");
	assert.equal(requestFirst.cancels.length, 1);
	assert.equal(requestFirst.task(cutoff.details.taskId).executions[0].envelope.source, "operator-config");

	const routeEnv = {
		PI_PLANNER_ONLY_ROLE_MODELS: "1",
		PI_PLANNER_ONLY_MODEL_WORKER: "fixture/worker",
		PI_PLANNER_ONLY_THINKING_WORKER: "low",
		PI_PLANNER_ONLY_MODEL_REVIEWER: "fixture/worker",
		PI_PLANNER_ONLY_THINKING_REVIEWER: "low",
	};
	assert.throws(() => resolveDelegationModel("worker", { getAll: () => ["fixture/worker"] }, routeEnv),
		e => e?.code === "MODEL_ROUTE_UNAVAILABLE", "catalog-only registry is not proof of available credentials");
	for (const [requested, available] of [
		["fixture/foo-bar", "fixture/foobar"],
		["fixture/model-20260919", "fixture/model-20260920"],
		["fixture/Model", "fixture/model"],
	]) {
		const policy = { ...routeEnv, PI_PLANNER_ONLY_MODEL_WORKER: requested };
		assert.throws(() => resolveDelegationModel("worker", { getAvailable: () => [available] }, policy),
			e => e?.code === "MODEL_ROUTE_UNAVAILABLE", "an alias collision is not an available model");
		const selected = resolveDelegationModel("worker", { getAvailable: () => [available] },
			{ ...policy, PI_PLANNER_ONLY_MODEL_WORKER_FALLBACK: available });
		assert.equal(selected.model, available);
		assert.equal(selected.source, "role-policy-fallback");
	}
	const routed = await fixture("routed", { routeEnv, models: [{ provider: "fixture", id: "worker" }], actualModel: "fixture/worker:low" });
	const routedResult = await routed.call("planner_delegate", { ...definition, model: "forged/model", thinking: "high" });
	assert.equal(routed.launches[0].model, "fixture/worker");
	assert.equal(routed.launches[0].thinking, "low");
	assert.equal(routedResult.details.modelRoute.status, "matched");
	assert.equal(routed.entries.filter(e => e.customType === "planner-only-model-route").length, 1);
	const routedReview = await routed.call("planner_redelegate", { taskId: routedResult.details.taskId, role: "reviewer" });
	assert.equal(routedReview.details.modelRoute.status, "matched");
	assert.equal(routedReview.details.review.verdict, "pass");

	const unavailable = await fixture("route-unavailable", { routeEnv, models: ["fixture/work-er"] });
	const beforeUnavailable = ledgerFiles().length;
	await assert.rejects(unavailable.call("planner_delegate", definition), e => e?.code === "MODEL_ROUTE_UNAVAILABLE");
	assert.equal(unavailable.launches.length, 0);
	assert.equal(ledgerFiles().length, beforeUnavailable);
	const unverified = await fixture("route-no-registry", { routeEnv });
	await assert.rejects(unverified.call("planner_delegate", definition), e => e?.code === "MODEL_ROUTE_UNAVAILABLE");
	assert.equal(unverified.launches.length, 0);

	const fallback = await fixture("route-fallback", {
		routeEnv: { ...routeEnv, PI_PLANNER_ONLY_MODEL_WORKER_FALLBACK: "fixture/available" },
		models: ["fixture/available"], actualModel: "fixture/available", actualThinking: "low",
	});
	const fallbackResult = await fallback.call("planner_delegate", definition);
	assert.equal(fallback.launches[0].model, "fixture/available");
	assert.equal(fallbackResult.details.modelRoute.expected.source, "role-policy-fallback");
	assert.equal(fallbackResult.details.modelRoute.expected.requestedModel, "fixture/worker");

	for (const [name, actualModel, actualThinking, expectedStatus] of [
		["wrong-model", "fixture/other", "low", "mismatched"],
		["missing-thinking", "fixture/worker", undefined, "unknown"],
		["conflicting-thinking", "fixture/worker:low", "high", "mismatched"],
	]) {
		const f = await fixture(name, { routeEnv, models: ["fixture/worker"], actualModel, actualThinking });
		const result = await f.call("planner_delegate", definition);
		assert.equal(result.details.modelRoute.status, expectedStatus);
		assert.equal(result.details.termination.reportAccepted, false);
		const execution = f.task(result.details.taskId).executions[0];
		assert.ok(execution.unacceptedReport, "unverified completion stays diagnostic");
		assert.equal(result.details.modelRoute.terminalStatus, "completed");
	}

	console.log("p1-delegation: PASS (real plugin/tools/transport/ledger; fake Git and child source; no subprocess)");
} finally {
	clearTimeout(watchdog);
	for (const f of fixtures) await f.handlers.get("session_shutdown")({ reason: "exit" }, f.ctx);
	childProcess.execFileSync = originalExecFileSync;
	syncBuiltinESMExports();
	rmSync(run, { recursive: true, force: true });
}
