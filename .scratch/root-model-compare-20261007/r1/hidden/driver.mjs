// Behavior driver for check_r1.py. Uses only baseline public entry points:
// runDelegation + createCwdLocks (delegate.ts), the delegation event contract, and the plugin's delegate/handoff tools.
// Usage: node --experimental-strip-types driver.mjs <repo>; prints one JSON object {id: {ok, detail}}.
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.argv[2];
const imp = (f) => import(pathToFileURL(join(repo, f)).href);
const results = {};
const IDS = ["explorer_parallel", "explorer_blocks_worker_validator", "worker_blocks_explorer", "validator_blocks_explorer", "reviewer_unaffected", "other_repo_independent", "released_then_worker_runs", "partial_release_still_blocks", "handoff_guard"];
const record = (id, ok, detail) => { results[id] = { ok, detail }; };

let D, H, C;
try {
	D = await imp("delegate.ts");
	H = await imp("test-helpers.mjs");
	C = await imp("subagent-delegation-contract.ts");
	for (const n of ["runDelegation", "createCwdLocks"]) if (typeof D[n] !== "function") throw new Error(`delegate.ts no longer exports ${n} (baseline public entry point)`);
} catch (e) {
	for (const id of IDS) record(id, false, `driver setup failed (public entry changed?): ${e?.message ?? e}`);
	console.log(JSON.stringify(results));
	process.exit(0);
}
const { fakeBus, noGit, usage, tick } = H;
const limits = { timeoutMs: 60_000, maxTokens: 1_000_000, startTimeoutMs: 40, cancelGraceMs: 40 };

function rig() {
	const bus = fakeBus();
	const reqs = [];
	bus.on(C.SUBAGENT_DELEGATION_REQUEST_EVENT, (r) => { reqs.push(r); bus.emit(C.SUBAGENT_DELEGATION_STARTED_EVENT, { requestId: r.requestId, nodeId: r.nodeId }); });
	const locks = D.createCwdLocks();
	const d = { events: bus, git: noGit, ownerRunId: "owner-1", limits, locks };
	async function start(role, cwd) {
		const n = reqs.length;
		const p = D.runDelegation(d, { role, task: "t", cwd });
		let settled = false, out;
		p.then((o) => { settled = true; out = o; }, () => { settled = true; });
		await tick(30);
		const started = reqs.length > n;
		return { role, cwd, p, started, req: started ? reqs.at(-1) : undefined, get settled() { return settled; }, get out() { return out; } };
	}
	async function finish(h) {
		bus.emit(C.SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: h.req.requestId, nodeId: h.req.nodeId, status: "completed", agent: h.req.agent, model: "m/m", result: { kind: "text", text: "done" }, usage: usage() });
		await h.p;
	}
	return { start, finish, locks, reqs };
}
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
const running = (h) => must(h.started, `${h.role}@${h.cwd} was not started (should run)`);
const blocked = (h) => { must(!h.started, `${h.role}@${h.cwd} was started (should be refused)`); must(h.settled, `${h.role}@${h.cwd} neither started nor returned a refusal`); must(h.out && h.out.ok === false, `${h.role}@${h.cwd} refusal outcome has ok!==false`); };

async function t(id, fn) {
	try { await fn(); record(id, true, "ok"); } catch (e) { record(id, false, String(e?.message ?? e)); }
}

await t("explorer_parallel", async () => {
	const r = rig();
	const a = await r.start("explorer", "/w1"); running(a);
	const b = await r.start("explorer", "/w1"); running(b);
	const c = await r.start("explorer", "/w1"); running(c);
	await r.finish(a); await r.finish(b); await r.finish(c);
});
await t("explorer_blocks_worker_validator", async () => {
	const r = rig();
	const a = await r.start("explorer", "/w1"); running(a);
	blocked(await r.start("worker", "/w1"));
	blocked(await r.start("validator", "/w1"));
	const b = await r.start("explorer", "/w1"); running(b);
	blocked(await r.start("worker", "/w1"));
	await r.finish(a); await r.finish(b);
});
await t("worker_blocks_explorer", async () => {
	const r = rig();
	const w = await r.start("worker", "/w1"); running(w);
	blocked(await r.start("explorer", "/w1"));
	blocked(await r.start("worker", "/w1"));
	blocked(await r.start("validator", "/w1"));
	await r.finish(w);
});
await t("validator_blocks_explorer", async () => {
	const r = rig();
	const v = await r.start("validator", "/w1"); running(v);
	blocked(await r.start("explorer", "/w1"));
	blocked(await r.start("worker", "/w1"));
	blocked(await r.start("validator", "/w1"));
	await r.finish(v);
	const e = await r.start("explorer", "/w1"); running(e);
	blocked(await r.start("validator", "/w1"));
	await r.finish(e);
});
await t("reviewer_unaffected", async () => {
	const r = rig();
	const w = await r.start("worker", "/w1"); running(w);
	const rv1 = await r.start("reviewer", "/w1"); running(rv1);
	await r.finish(rv1); await r.finish(w);
	const e = await r.start("explorer", "/w1"); running(e);
	const rv2 = await r.start("reviewer", "/w1"); running(rv2);
	const v = await r.start("reviewer", "/w1"); running(v);
	// a running reviewer must not block a worker once the explorer is gone
	await r.finish(e);
	const w2 = await r.start("worker", "/w1"); running(w2);
	await r.finish(rv2); await r.finish(v); await r.finish(w2);
});
await t("other_repo_independent", async () => {
	const r = rig();
	const e = await r.start("explorer", "/w1"); running(e);
	const w2 = await r.start("worker", "/w2"); running(w2);
	const v3 = await r.start("validator", "/w3"); running(v3);
	blocked(await r.start("worker", "/w1"));
	blocked(await r.start("explorer", "/w2"));
	await r.finish(e); await r.finish(w2); await r.finish(v3);
});
await t("released_then_worker_runs", async () => {
	const r = rig();
	const a = await r.start("explorer", "/w1"); running(a);
	const b = await r.start("explorer", "/w1"); running(b);
	await r.finish(a); await r.finish(b);
	must(r.locks.size === 0, `locks.size=${r.locks.size} after all explorers ended`);
	const w = await r.start("worker", "/w1"); running(w);
	await r.finish(w);
	must(r.locks.size === 0, `locks.size=${r.locks.size} after worker ended`);
	const e = await r.start("explorer", "/w1"); running(e);
	await r.finish(e);
});
await t("partial_release_still_blocks", async () => {
	const r = rig();
	const a = await r.start("explorer", "/w1"); running(a);
	const b = await r.start("explorer", "/w1"); running(b);
	await r.finish(a);
	blocked(await r.start("worker", "/w1"));
	await r.finish(b);
	const w = await r.start("worker", "/w1"); running(w);
	await r.finish(w);
});

// Handoff guard through the plugin's public tools: while any explorer runs, handoff is refused.
await t("handoff_guard", async () => {
	process.env.PI_CODING_AGENT_DIR = join(process.env.TMPDIR ?? ".", "r1-agent-" + process.pid);
	for (const k of ["PI_PLANNER_ONLY", "PI_PLANNER_ONLY_MODE", "PI_PLANNER_ONLY_STRICT", "PI_SUBAGENT_CHILD"]) delete process.env[k];
	const { default: plannerOnly } = await imp("index.ts");
	const tools = new Map(), handlers = new Map(), commands = new Map();
	const events = fakeBus();
	const pi = { events, registerTool: (x) => tools.set(x.name, x), registerCommand: (n, c) => commands.set(n, c), on: (e, h) => handlers.set(e, h), getActiveTools: () => ["read", "bash", "edit", "write"], setActiveTools: () => {}, appendEntry: () => {}, model: { provider: "p", id: "m" }, thinkingLevel: "high", exec: async () => ({ stdout: "", stderr: "not a repo", code: 128 }), sendMessage: () => {}, sendUserMessage: () => {} };
	plannerOnly(pi);
	const ctx = { cwd: "/w", hasUI: true, isIdle: () => true, sessionManager: { getSessionId: () => "s1", getSessionFile: () => "/sessions/s.jsonl", getBranch: () => [] }, model: { provider: "p", id: "m" }, thinkingLevel: "high", modelRegistry: { find: () => undefined }, ui: { setStatus() {}, notify() {}, theme: { fg: (c, s) => s } } };
	const reqs = [];
	events.on(C.SUBAGENT_DELEGATION_REQUEST_EVENT, (q) => reqs.push(q));
	const done = (q) => events.emit(C.SUBAGENT_DELEGATION_RESPONSE_EVENT, { requestId: q.requestId, nodeId: q.nodeId, agent: q.agent, status: "completed", result: { kind: "text", text: "x" }, usage: usage() });
	const del = tools.get("delegate");
	must(del && tools.get("handoff"), "delegate/handoff tools not registered");
	const p1 = del.execute("a", { role: "explorer", task: "t" }, undefined, undefined, ctx);
	const p2 = del.execute("b", { role: "explorer", task: "t" }, undefined, undefined, ctx);
	await tick(30);
	must(reqs.length === 2, `expected 2 explorer requests through the delegate tool, saw ${reqs.length}`);
	await commands.get("planner-only").handler("handoff", ctx);
	const brief = "Continue the parser migration in this repository. Goal: finish the streaming parser. Decisions: preserve the public API and avoid dependencies. Constraints: TypeScript, existing tests, no commits. Relevant files: index.ts and index.test.mjs. Done: analysis and initial implementation. Open: validate edge cases and update tests. Exact next step: inspect parser tests, implement missing cases, then run npm run test:release.";
	const refuse1 = await tools.get("handoff").execute("h1", { brief }, undefined, undefined, ctx);
	must(refuse1.details?.ok === false && /still running/.test(refuse1.content[0].text), `handoff not refused with two explorers running: ${refuse1.content?.[0]?.text}`);
	done(reqs[0]); await p1;
	const refuse2 = await tools.get("handoff").execute("h2", { brief }, undefined, undefined, ctx);
	must(refuse2.details?.ok === false && /still running/.test(refuse2.content[0].text), `handoff not refused with one explorer still running: ${refuse2.content?.[0]?.text}`);
	done(reqs[1]); await p2;
});
console.log(JSON.stringify(results));
process.exit(0);
