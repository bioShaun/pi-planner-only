import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT as CANCEL,
	SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST,
	SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE,
	SUBAGENT_DELEGATION_STARTED_EVENT as STARTED,
	SUBAGENT_DELEGATION_UPDATE_EVENT as UPDATE,
} from "./subagent-delegation-contract.ts";
import { ROLE_AGENTS, buildTaskText, clipChildText, formatTokens, loadLimits, runDelegation, summarizeTranscript } from "./delegate.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { fakeBus, noGit, tempDir, tick, usage } from "./test-helpers.mjs";

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
	assert.match(req.task, /^implement X\n\n---\nWorking directory: \/w\nTime limit: 1 minutes wall clock/);
	assert.ok(req.task.endsWith(ROLE_AGENTS.worker.closing));
	assert.equal(out.ok, true);
	assert.equal(out.details.status, "completed");
	assert.equal(out.details.model, "cheap/model");
	assert.equal(out.details.usage.cost, 0.0123);
	assert.match(out.text, /^\[worker\/worker\] completed · cheap\/model · 3\.5k tok · \$0\.0123 · 3 turns · 12s/);
	assert.match(out.text, /Child report:\nchanged a\.ts; tests pass/);
	assert.match(out.text, /Workspace changes: \/w is not a git work tree .* pass that repository as cwd next time\./);
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

// Workspace summary: "not a work tree" and "work tree without commits" read differently.
{
	const noCommits = async (args) => {
		const a = args.slice(args.indexOf("core.fsmonitor=false") + 1);
		if (args[0] === "--version") return { stdout: "git version 2.43.0", code: 0 };
		if (a[0] === "rev-parse" && a[1] === "--is-inside-work-tree") return { stdout: "true\n", code: 0 };
		return { stdout: "", stderr: "fatal: bad revision HEAD", code: 128 };
	};
	const texts = [];
	for (const git of [noGit, noCommits]) {
		const bus = fakeBus();
		bus.on(REQUEST, (req) => respond(bus, req));
		texts.push((await runDelegation({ ...deps(bus), git }, { role: "worker", task: "t", cwd: "/w" })).text);
	}
	assert.match(texts[0], /pass that repository as cwd/);
	assert.doesNotMatch(texts[1], /pass that repository as cwd/);
	assert.match(texts[1], /Workspace changes: not a git repository \(or no commits\)/);
}

// Timed out with a runId: the default-layout artifact is read; missing artifacts are reported, not thrown.
{
	const dir = tempDir("ppo-artifacts-");
	try {
		const sessionFile = join(dir, "2026-09-24T07-17-07_root.jsonl");
		const artifacts = join(dir, "subagent-artifacts");
		mkdirSync(artifacts);
		const output = join(artifacts, "run-42_worker_0_output.md");
		writeFileSync(output, "Subagent timed out.\n\nRecovery summary:\n- currentTool: edit\n");
		const transcript = join(artifacts, "run-42_worker_0_transcript.jsonl");
		writeFileSync(transcript, [
			JSON.stringify({ recordType: "tool_start", ts: 1_000, toolCallId: "c1", toolName: "bash", argsPreview: "npm run test:release" }),
			JSON.stringify({ recordType: "tool_end", ts: 6_000, toolCallId: "c1", toolName: "bash", isError: false }),
			JSON.stringify({ recordType: "message", role: "toolResult", ts: 6_100, toolCallId: "c1", toolName: "bash", isError: false, text: "all 4 suites pass" }),
		].join("\n"));
		const run = async () => {
			const bus = fakeBus();
			bus.on(REQUEST, (req) => respond(bus, req, { status: "timed_out", error: "Subagent timed out after 600000ms.", runId: "run-42", result: undefined }));
			return runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
		};
		const found = await run();
		assert.equal(found.ok, false);
		assert.match(found.text, /Run id: run-42/);
		assert.match(found.text, /Child report:\nSubagent timed out\.\n\nRecovery summary:\n- currentTool: edit/);
		assert.ok(found.text.includes(`Transcript: ${join(artifacts, "run-42_worker_0_transcript.jsonl")}`));
		assert.doesNotMatch(found.text, /\(empty\)/);
		// The transcript tail sits after the child report and before the workspace summary.
		const tailAt = found.text.indexOf("Transcript tail");
		assert.ok(tailAt > found.text.indexOf("Child report:"));
		assert.ok(tailAt < found.text.indexOf("Workspace changes"));
		assert.match(found.text, /result: all 4 suites pass/);

		// Without the transcript file the output artifact still reaches Root, with no tail and no throw.
		rmSync(transcript);
		const noTail = await run();
		assert.equal(noTail.ok, false);
		assert.match(noTail.text, /Child report:\nSubagent timed out/);
		assert.doesNotMatch(noTail.text, /Transcript tail/);

		rmSync(output);
		const missing = await run();
		assert.match(missing.text, /artifacts not found at the default location \(pi-subagents artifactDir may be temp\/project\); runId=run-42/);
		assert.match(missing.text, /Child report:\n\(empty\)/);

		// A runId that is not a plain name never becomes a path.
		writeFileSync(join(dir, "escape_worker_0_output.md"), "LEAKED");
		{
			const bus = fakeBus();
			bus.on(REQUEST, (req) => respond(bus, req, { status: "failed", runId: "../escape", result: undefined }));
			const out = await runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
			assert.doesNotMatch(out.text, /LEAKED/);
			assert.match(out.text, /artifacts not found at the default location/);
		}

		// The last progress update supplies runId, the tool in flight, and recent output
		// when the terminal has no runId and no artifact exists.
		{
			const bus = fakeBus();
			bus.on(REQUEST, (req) => {
				const id = { requestId: req.requestId, nodeId: req.nodeId };
				bus.emit(UPDATE, { ...id, runId: "run-7", currentTool: "read", recentOutput: "old" });
				bus.emit(UPDATE, { ...id, currentTool: "edit", currentToolArgs: "main.nf\n  line two", recentOutputLines: ["planning the edit", "calling edit"] });
				respond(bus, req, { status: "timed_out", result: undefined });
			});
			const out = await runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
			assert.match(out.text, /Run id: run-7\nLast activity: edit main\.nf line two\n/);
			assert.match(out.text, /runId=run-7/);
			assert.match(out.text, /Child report:\n\(recent output from the last progress update\)\nplanning the edit\ncalling edit/);
		}
		// F4: a timeout kills bash, so the last update has no currentTool. The newest
		// ended tool (recentTools) is reported; with no recentTools the previous tool is kept.
		for (const [final, want] of [
			[{ recentTools: [{ tool: "read", args: "a" }, { tool: "bash", args: "sleep 10" }] }, /Last activity: bash sleep 10\n/],
			[{}, /Last activity: bash for i in 1 2\n/],
		]) {
			const bus = fakeBus();
			bus.on(REQUEST, (req) => {
				const id = { requestId: req.requestId, nodeId: req.nodeId };
				bus.emit(UPDATE, { ...id, runId: "run-9", currentTool: "bash", currentToolArgs: "for i in 1 2" });
				bus.emit(UPDATE, { ...id, toolCount: 3, ...final });
				respond(bus, req, { status: "timed_out", result: undefined });
			});
			const out = await runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
			assert.match(out.text, want);
		}
		// With the artifact present, the artifact text wins over recent output; completed runs ignore both.
		writeFileSync(join(artifacts, "run-7_worker_0_output.md"), "ARTIFACT TEXT");
		writeFileSync(join(artifacts, "run-7_worker_0_transcript.jsonl"), `${JSON.stringify({ recordType: "tool_start", ts: 1_000, toolCallId: "c7", toolName: "bash", argsPreview: "run7cmd" })}\n`);
		for (const status of ["timed_out", "completed"]) {
			const bus = fakeBus();
			bus.on(REQUEST, (req) => {
				bus.emit(UPDATE, { requestId: req.requestId, nodeId: req.nodeId, runId: "run-7", currentTool: "bash", recentOutput: "recent" });
				respond(bus, req, status === "completed" ? {} : { status, result: undefined });
			});
			const out = await runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
			if (status === "completed") {
				assert.doesNotMatch(out.text, /Run id|Last activity|ARTIFACT/);
				assert.doesNotMatch(out.text, /Transcript tail/);
			} else {
				assert.match(out.text, /Child report:\nARTIFACT TEXT/);
				assert.match(out.text, /Transcript tail/);
				assert.match(out.text, /Last activity: bash/);
				assert.doesNotMatch(out.text, /recent output from the last progress update/);
			}
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

// Transcript tail: slow tools, offsets/durations, running tools, errors, clipping, malformed lines.
{
	const t0 = 1_790_000_000_000;
	const recs = [
		{ recordType: "tool_start", ts: t0, toolCallId: "c1", toolName: "bash", argsPreview: 'find / -name "read_kallisto_h5.R" 2>/dev/null' },
		{ recordType: "tool_end", ts: t0 + 61_000, toolCallId: "c1", toolName: "bash", isError: false },
		{ recordType: "message", role: "toolResult", ts: t0 + 61_100, toolCallId: "c1", toolName: "bash", isError: false, text: `head\n\n${"x".repeat(400)}\n tail line` },
		"{malformed json",
		{ recordType: "tool_start", ts: t0 + 62_000, toolCallId: "c2", toolName: "bash", argsPayload: JSON.stringify({ command: "npm run\n test:release" }) },
		{ recordType: "tool_end", ts: t0 + 65_000, toolCallId: "c2", toolName: "bash", isError: true },
		{ recordType: "message", role: "toolResult", ts: t0 + 65_100, toolCallId: "c2", toolName: "bash", isError: true, text: "FAIL contract.test.mjs" },
		// No tool_end: still running when the transcript stopped.
		{ recordType: "tool_start", ts: t0 + 70_000, toolCallId: "c3", toolName: "read", argsPayload: JSON.stringify({ path: "/home/x/file.ts" }) },
		{ recordType: "message", role: "assistant", ts: t0 + 71_000, message: { content: [{ type: "text", text: "final words ".repeat(100) }] } },
	];
	const s = summarizeTranscript(recs.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n"));
	assert.ok(s);
	assert.match(s, /^Transcript tail \(child did not finish; newest last\):$/m);
	// Slow tool: >=60s, longest first, duration and args shown.
	assert.match(s, /Slow tools \(>=60s\):\n- bash 61s: find \/ -name/);
	// Offsets from the first record, duration = tool_end - tool_start, error marked, args from payload.
	assert.match(s, /\[\+00:00\] bash 61s: find \/ -name/);
	assert.match(s, /\[\+01:02\] bash 3s ERROR: npm run test:release/);
	// Long result clipped with " … "; short results verbatim.
	assert.match(s, /result: head \| x/);
	assert.ok(s.includes(" … "));
	assert.match(s, /result: FAIL contract\.test\.mjs/);
	// A tool_start without tool_end is measured to the last record ts; payload path used as preview.
	assert.match(s, /\[\+01:10\] read running when stopped, 1s: \/home\/x\/file\.ts/);
	// Last assistant text, capped at 500 chars.
	const lastLine = s.split("\n").find((l) => l.startsWith("Last assistant text:"));
	assert.ok(lastLine.startsWith("Last assistant text: final words "));
	assert.ok(lastLine.length <= "Last assistant text: ".length + 500);

	// >12 calls: only the newest 12 entries remain.
	const many = [];
	for (let i = 0; i < 15; i++) {
		const ts = 1_000_000 + i * 1_000;
		many.push({ recordType: "tool_start", ts, toolCallId: `c${i}`, toolName: "bash", argsPreview: `check ${i} done` });
		many.push({ recordType: "tool_end", ts: ts + 400, toolCallId: `c${i}`, toolName: "bash", isError: false });
		many.push({ recordType: "message", role: "toolResult", ts: ts + 500, toolCallId: `c${i}`, toolName: "bash", isError: false, text: `out-${i}` });
	}
	const twelve = summarizeTranscript(many.map((r) => JSON.stringify(r)).join("\n"));
	assert.equal((twelve.match(/^- \[\+/gm) ?? []).length, 12);
	assert.doesNotMatch(twelve, /check [0-2] done/);
	assert.match(twelve, /check 3 done/);
	assert.match(twelve, /check 14 done/);

	// argsPayload beats the pre-clipped argsPreview; ANSI colour codes are stripped from results.
	const both = summarizeTranscript([
		{ recordType: "tool_start", ts: 1, toolCallId: "p", toolName: "bash", argsPreview: "cd /repo && mkdir -p /x/ol...", argsPayload: JSON.stringify({ command: "cd /repo && mkdir -p /x/old_script && git show HEAD:a.R" }) },
		{ recordType: "tool_end", ts: 2, toolCallId: "p", toolName: "bash", isError: false },
		{ recordType: "message", role: "toolResult", ts: 3, toolCallId: "p", toolName: "bash", text: "\u001b[?25l\u001b]0;title\u0007\u001b[31mERROR: no java\u001b(B\u001b[m" },
	].map((r) => JSON.stringify(r)).join("\n"));
	assert.match(both, /bash 0s: cd \/repo && mkdir -p \/x\/old_script && git show HEAD:a\.R/);
	assert.match(both, /result: ERROR: no java$/m);
	assert.ok(!both.includes("\u001b"), "no escape characters");

	// Slow model turns: a long gap with no tool running (om09-style 8-minute thinking turn), and one still open at the stop.
	const thinking = summarizeTranscript([
		{ recordType: "tool_start", ts: 0, toolCallId: "a", toolName: "read", argsPayload: JSON.stringify({ path: "git.ts" }) },
		{ recordType: "tool_end", ts: 1_000, toolCallId: "a", toolName: "read" },
		{ recordType: "tool_start", ts: 502_000, toolCallId: "b", toolName: "bash", argsPayload: JSON.stringify({ command: "grep -n summarizeWork git.ts" }) },
		{ recordType: "tool_start", ts: 502_100, toolCallId: "c", toolName: "bash", argsPayload: JSON.stringify({ command: "parallel call" }) },
		{ recordType: "tool_end", ts: 503_000, toolCallId: "b", toolName: "bash" },
		{ recordType: "tool_end", ts: 504_000, toolCallId: "c", toolName: "bash" },
		{ recordType: "message", role: "assistant", ts: 600_000, message: { content: [] } },
	].map((r) => JSON.stringify(r)).join("\n"));
	assert.match(thinking, /Slow model turns \(>=60s with no tool running\):\n- \[\+00:01\] 8m21s, then bash: grep -n summarizeWork git\.ts\n- \[\+08:24\] 1m36s, still in this turn when stopped/);
	assert.doesNotMatch(thinking, /then bash: parallel call/, "a parallel start is not a model turn");

	// Empty or unparseable input -> undefined, never a throw.
	assert.equal(summarizeTranscript(""), undefined);
	assert.equal(summarizeTranscript("not json\n{\"broken\": \n\ngarbage"), undefined);
}

// Time budget in the task text follows PI_PLANNER_ONLY_TIMEOUT_MS.
{
	assert.match(buildTaskText("worker", "t", "/w", loadLimits({}).timeoutMs), /\nTime limit: 10 minutes wall clock, then you are stopped/);
	assert.match(buildTaskText("worker", "t", "/w", loadLimits({ PI_PLANNER_ONLY_TIMEOUT_MS: "300000" }).timeoutMs), /\nTime limit: 5 minutes wall clock/);
	assert.match(buildTaskText("worker", "t", "/w", 1_000), /Time limit: 1 minutes/);
	// Pacing (om09 run4: required checks passed, then `find /` ate the budget before the report).
	const pacing = buildTaskText("worker", "t", "/w");
	assert.match(pacing, /Write your report as soon as the required checks pass/);
	assert.match(pacing, /Never search the whole filesystem \(e\.g\. `find \/`\); wrap commands that may be slow in `timeout 60`/);
	assert.ok(pacing.indexOf("Time limit:") < pacing.indexOf("Write your report as soon"), "pacing follows the budget line");
}

// Token units: k/M/B, ~3 significant digits, no trailing zeros, no "1000k".
{
	const cases = [[0, "0"], [950, "950"], [1_500, "1.5k"], [3_500, "3.5k"], [65_436, "65.4k"], [806_400, "806k"],
		[999_999, "1M"], [1_356_600, "1.36M"], [4_166_000, "4.17M"], [2_100_000_000, "2.1B"], [Number.NaN, "0"]];
	for (const [n, want] of cases) assert.equal(formatTokens(n), want, `formatTokens(${n})`);
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

// Whole config from env; every default lives in DEFAULT_CONFIG.
{
	assert.deepEqual(loadConfig({}), DEFAULT_CONFIG);
	const c = loadConfig({
		PI_PLANNER_ONLY: " On ",
		PI_PLANNER_ONLY_STRICT: "true",
		PI_PLANNER_ONLY_HANDOFF: " Confirm ",
		PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: "300000",
		PI_PLANNER_ONLY_TIMEOUT_MS: "1234",
	});
	assert.equal(c.enabled, true);
	assert.equal(c.strict, true);
	assert.equal(c.handoffMode, "confirm");
	assert.equal(c.contextWarnTokens, 300_000);
	assert.equal(c.limits.timeoutMs, 1234);
	assert.equal(loadConfig({ PI_PLANNER_ONLY: "off" }).enabled, false);
	assert.equal(loadConfig({ PI_PLANNER_ONLY: "maybe" }).enabled, undefined);
	assert.equal(loadConfig({ PI_PLANNER_ONLY_STRICT: "yes" }).strict, false);
	assert.equal(loadConfig({ PI_PLANNER_ONLY_HANDOFF: "bogus" }).handoffMode, "auto");
	assert.equal(loadConfig({ PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS: "0" }).contextWarnTokens, 150_000);
}

console.log("delegate.test: ok");
