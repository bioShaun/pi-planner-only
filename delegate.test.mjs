import assert from "node:assert/strict";
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	SUBAGENT_DELEGATION_CANCEL_EVENT as CANCEL,
	SUBAGENT_DELEGATION_REQUEST_EVENT as REQUEST,
	SUBAGENT_DELEGATION_RESPONSE_EVENT as RESPONSE,
	SUBAGENT_DELEGATION_STARTED_EVENT as STARTED,
	SUBAGENT_DELEGATION_UPDATE_EVENT as UPDATE,
} from "./subagent-delegation-contract.ts";
import { CHILD_REPORT_TARGET_CHARS, MAX_CHILD_TEXT_CHARS, ROLE_AGENTS, buildTaskText, clipChildText, createCwdLocks, loadLimits, matchesIdentity, newRunIdentity, resolveLockKey, runDelegation, summarizeTranscript } from "./delegate.ts";
import { formatTokens } from "./format.ts";
import { DEFAULT_CONFIG, loadConfig } from "./config.ts";
import { artifactsDir, loadArtifactDir, resolveArtifacts, tempArtifactsDir } from "./subagent-artifacts.ts";
import { fakeBus, noGit, tempDir, tick, usage } from "./test-helpers.mjs";

const limits = { timeoutMs: 60_000, maxTokens: 1_000, startTimeoutMs: 40, cancelGraceMs: 40 };
const deps = (bus, locks = createCwdLocks(), extra = {}) => ({ events: bus, git: noGit, ownerRunId: "owner-1", limits, locks, ...extra });
const sent = (bus, event) => bus.emitted.filter(([e]) => e === event).map(([, d]) => d);
const respond = (bus, req, over = {}) =>
	bus.emit(RESPONSE, { requestId: req.requestId, nodeId: req.nodeId, status: "completed", agent: req.agent, model: "cheap/model", result: { kind: "text", text: "changed a.ts; tests pass" }, usage: usage(), ...over });

// Completed: request shape, report formatting, lock released, no listeners left.
{
	const bus = fakeBus();
	const locks = createCwdLocks();
	bus.on(REQUEST, (req) => respond(bus, req));
	const out = await runDelegation(deps(bus, locks), { role: "worker", task: "  implement X  ", cwd: "/w" });
	const [req] = sent(bus, REQUEST);
	assert.equal(req.agent, "worker");
	assert.equal(req.context, "fresh");
	assert.equal(req.cwd, "/w");
	assert.equal(req.ownerRunId, "owner-1");
	assert.equal(req.timeoutMs, 60_000);
	assert.equal(req.intercomBridge.mode, "off");
	assert.deepEqual(req.result, { kind: "text" });
	assert.ok(req.task.startsWith(`implement X\n\n---\nWorking directory: /w\nHome directory: ${homedir()} (\`~\` in paths means this directory)\nTime limit: 1 minutes wall clock`));
	assert.ok(req.task.endsWith(ROLE_AGENTS.worker.closing));
	assert.equal(out.ok, true);
	assert.equal(out.details.status, "completed");
	assert.equal(out.details.model, "cheap/model");
	assert.equal(out.details.usage.cost, 0.0123);
	assert.match(out.text, /^\[worker\/worker\] completed · cheap\/model · 3\.5k tok · \$0\.0123 · 3 turns · 12s/);
	assert.match(out.text, /Child report:\nchanged a\.ts; tests pass/);
	assert.match(out.text, /Workspace changes: \/w is not a git work tree .* pass that repository as cwd next time\./);
	assert.equal(locks.size, 0);
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
	assert.match(ROLE_AGENTS.explorer.closing, /writing the report\/output file the runtime names is allowed/);
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

// Timed out with a runId: the artifact located by the adapter is read; missing artifacts are reported, not thrown.
{
	const dir = tempDir("ppo-artifacts-");
	try {
		const sessionFile = join(dir, "2026-09-24T07-17-07_root.jsonl");
		const artifacts = artifactsDir(sessionFile, "/w", "session");
		assert.equal(artifacts, join(dir, "subagent-artifacts"));
		mkdirSync(artifacts);
		const { outputPath: output, transcriptPath: transcript } = resolveArtifacts({ runId: "run-42", agent: "worker", sessionFile, cwd: "/w" });
		assert.equal(output, join(artifacts, "run-42_worker_0_output.md"));
		writeFileSync(output, "Subagent timed out.\n\nRecovery summary:\n- currentTool: edit\n");
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
		assert.ok(found.text.includes(`Transcript: ${transcript}`));
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
		assert.ok(missing.text.includes(`artifacts not found (artifactDir=session, expected ${output}); runId=run-42`));
		assert.match(missing.text, /Child report:\n\(empty\)/);

		// A runId that is not a plain name never becomes a path.
		writeFileSync(join(dir, "escape_worker_0_output.md"), "LEAKED");
		{
			const bus = fakeBus();
			bus.on(REQUEST, (req) => respond(bus, req, { status: "failed", runId: "../escape", result: undefined }));
			const out = await runDelegation({ ...deps(bus), sessionFile }, { role: "worker", task: "t", cwd: "/w" });
			assert.doesNotMatch(out.text, /LEAKED/);
			assert.match(out.text, /artifacts not found \(artifactDir=session\); runId=\.\.\/escape/);
		}

		// artifactDir=project reads from <cwd>/.pi/subagents/artifacts; artifactDir=temp from the pi-subagents temp root.
		const project = join(dir, "project");
		const tempRoot = join(dir, "temp-root");
		const env = { ...process.env, PI_SUBAGENTS_TEMP_ROOT: tempRoot };
		assert.equal(tempArtifactsDir(env), join(tempRoot, "artifacts"));
		assert.equal(artifactsDir(sessionFile, project, "project"), join(project, ".pi", "subagents", "artifacts"));
		assert.equal(artifactsDir(undefined, project, "session", env), join(tempRoot, "artifacts"));
		for (const artifactDir of ["project", "temp"]) {
			const paths = resolveArtifacts({ runId: "run-42", agent: "worker", sessionFile, cwd: project, artifactDir, env });
			mkdirSync(dirname(paths.outputPath), { recursive: true });
			writeFileSync(paths.outputPath, `${artifactDir.toUpperCase()} ARTIFACT`);
			const prev = process.env.PI_SUBAGENTS_TEMP_ROOT;
			process.env.PI_SUBAGENTS_TEMP_ROOT = tempRoot;
			try {
				const bus = fakeBus();
				bus.on(REQUEST, (req) => respond(bus, req, { status: "timed_out", runId: "run-42", result: undefined }));
				const out = await runDelegation({ ...deps(bus), sessionFile, artifactDir }, { role: "worker", task: "t", cwd: project });
				assert.match(out.text, new RegExp(`Child report:\\n${artifactDir.toUpperCase()} ARTIFACT`));
				assert.ok(out.text.includes(`Transcript: ${paths.transcriptPath}`));
			} finally {
				if (prev === undefined) delete process.env.PI_SUBAGENTS_TEMP_ROOT;
				else process.env.PI_SUBAGENTS_TEMP_ROOT = prev;
			}
		}

		// loadArtifactDir reads pi-subagents' config.json under the agent dir; absent, invalid or malformed -> "session".
		const agentDir = join(dir, "agent");
		const configPath = join(agentDir, "extensions", "subagent", "config.json");
		mkdirSync(dirname(configPath), { recursive: true });
		const agentEnv = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
		assert.equal(loadArtifactDir(agentEnv), "session");
		writeFileSync(configPath, JSON.stringify({ artifactDir: "temp" }));
		assert.equal(loadArtifactDir(agentEnv), "temp");
		writeFileSync(configPath, JSON.stringify({ artifactDir: "elsewhere" }));
		assert.equal(loadArtifactDir(agentEnv), "session");
		writeFileSync(configPath, "{not json");
		assert.equal(loadArtifactDir(agentEnv), "session");
		assert.equal(loadArtifactDir({ ...process.env, HOME: dir, PI_CODING_AGENT_DIR: "~/agent" }), "session");

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
	assert.ok(pacing.includes(`Keep the final report under ${CHILD_REPORT_TARGET_CHARS.toLocaleString("en-US")} characters: conclusions and file:line first; quote only the key lines of long command output.`));
	assert.ok(pacing.indexOf("Time limit:") < pacing.indexOf("Write your report as soon"), "pacing follows the budget line");
}

// Home directory in the task text: a reviewer has no shell and guessed /root for `~` paths.
{
	assert.ok(buildTaskText("reviewer", "t", "/w").includes(`\nHome directory: ${homedir()} (\`~\` in paths means this directory)\n`));
	const text = buildTaskText("reviewer", "read ~/.pi/x", "/w", 60_000, "/home/alice");
	assert.match(text, /\nWorking directory: \/w\nHome directory: \/home\/alice \(`~` in paths means this directory\)\nTime limit: 1 minutes/);
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
	const locks = createCwdLocks();
	locks.tryAcquire("/w");
	for (const role of ["worker", "explorer", "validator"]) {
		const out = await runDelegation(deps(bus, locks), { role, task: "t", cwd: "/w" });
		assert.equal(out.details.status, "refused", role);
	}
	assert.equal((await runDelegation(deps(bus, locks), { role: "reviewer", task: "t", cwd: "/w" })).ok, true);
	assert.equal(sent(bus, REQUEST).length, 1);
	assert.deepEqual(locks.held(), ["/w"]);
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
	const locks = createCwdLocks();
	const ac = new AbortController();
	let req;
	bus.on(REQUEST, (r) => {
		req = r;
		bus.emit(STARTED, { requestId: r.requestId, nodeId: r.nodeId });
	});
	const pending = runDelegation(deps(bus, locks), { role: "worker", task: "t", cwd: "/w" }, ac.signal);
	await tick(5);
	ac.abort();
	const out = await pending;
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.equal(out.details.status, "stop_unconfirmed");
	assert.equal(out.details.stopReason, "cancelled by Root");
	assert.deepEqual(locks.held(), ["/w"]);
	assert.equal(bus.listeners(RESPONSE), 1);
	assert.equal(bus.listeners(UPDATE) + bus.listeners(STARTED), 0);
	respond(bus, req, { status: "cancelled" });
	assert.equal(locks.size, 0);
	assert.equal(bus.listeners(RESPONSE), 0);
}

// Never started: not_started after the start timeout, lock released, nothing left listening.
{
	const bus = fakeBus();
	const locks = createCwdLocks();
	const out = await runDelegation(deps(bus, locks), { role: "worker", task: "t", cwd: "/w" });
	assert.equal(out.details.status, "not_started");
	assert.match(out.text, /pi-subagents did not start the child/);
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.equal(locks.size, 0);
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

// Clipping prioritizes the report's conclusion-first head while retaining the tail.
{
	const text = `${"a".repeat(5_000)}FINAL REPORT`;
	const clipped = clipChildText(text, 1_000);
	assert.ok(clipped.length < 1_100);
	assert.ok(clipped.endsWith("FINAL REPORT"));
	assert.match(clipped, /\[4012 chars omitted\]/);
	assert.equal(clipChildText("short", 1_000), "short");
	const longText = `${"b".repeat(10_000)}`;
	const defaultClipped = clipChildText(longText);
	assert.ok(defaultClipped.startsWith("b".repeat(MAX_CHILD_TEXT_CHARS * 0.6)));
}

// CwdLocks: second acquire of a held cwd fails; release is idempotent; handoff guard sees size.
{
	const locks = createCwdLocks();
	const release = locks.tryAcquire("/a");
	assert.equal(typeof release, "function");
	assert.equal(locks.tryAcquire("/a"), null);
	assert.equal(locks.isHeld("/a"), true);
	assert.equal(typeof locks.tryAcquire("/b"), "function");
	assert.deepEqual(locks.held(), ["/a", "/b"]);
	assert.equal(locks.size, 2);
	release();
	release();
	assert.equal(locks.isHeld("/a"), false);
	assert.equal(locks.size, 1);
}

// Run identity: ownerRunId passed through, requestId a full uuid, nodeId `<role>-<8 chars>`; events match by requestId (+ nodeId when sent).
{
	const ids = ["11111111-aaaa-4bbb-8ccc-dddddddddddd", "22222222-eeee-4fff-8000-111111111111"];
	const id = newRunIdentity("explorer", "owner-9", () => ids.shift());
	assert.deepEqual(id, { ownerRunId: "owner-9", requestId: "11111111-aaaa-4bbb-8ccc-dddddddddddd", nodeId: "explorer-22222222" });
	const real = newRunIdentity("worker", "o");
	assert.match(real.requestId, /^[0-9a-f-]{36}$/);
	assert.match(real.nodeId, /^worker-[0-9a-f]{8}$/);
	assert.equal(matchesIdentity(id, { requestId: id.requestId }), true);
	assert.equal(matchesIdentity(id, { requestId: id.requestId, nodeId: id.nodeId }), true);
	assert.equal(matchesIdentity(id, { requestId: id.requestId, nodeId: "other" }), false);
	assert.equal(matchesIdentity(id, { requestId: "x" }), false);
	assert.equal(matchesIdentity(id, undefined), false);
}

// Injected timers: start timeout and cancel grace run on the fake clock, and are cleared on settle.
{
	const scheduled = [];
	const cleared = [];
	const timers = {
		setTimeout: (fn, ms) => { const h = { fn, ms }; scheduled.push(h); return h; },
		clearTimeout: (h) => cleared.push(h),
	};
	const bus = fakeBus();
	const locks = createCwdLocks();
	const pending = runDelegation(deps(bus, locks, { timers, limits: { ...limits, startTimeoutMs: 99_000, cancelGraceMs: 77_000 } }), { role: "worker", task: "t", cwd: "/w" });
	await tick(5);
	assert.deepEqual(scheduled.map((h) => h.ms), [99_000]);
	assert.deepEqual(locks.held(), ["/w"]);
	scheduled[0].fn();
	assert.equal(sent(bus, CANCEL).length, 1);
	assert.deepEqual(scheduled.map((h) => h.ms), [99_000, 77_000]);
	scheduled[1].fn();
	const out = await pending;
	assert.equal(out.details.status, "not_started");
	assert.equal(cleared.length, 2);
	assert.equal(locks.size, 0);
	assert.equal(bus.totalListeners(), 0);
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

// Lock key: git toplevel realpath, so /repo and /repo/src share one lock; symlink spellings too.
// Outside a repo, the realpath cwd is used; a realpath failure falls back to the resolved cwd.
{
	const repo = tempDir("ppo-lock-repo-");
	const sub = join(repo, "src");
	mkdirSync(sub, { recursive: true });
	const other = tempDir("ppo-lock-other-");
	const link = join(tempDir("ppo-lock-linkdir-"), "repo-link");
	symlinkSync(repo, link);
	const repoGit = async (args) => {
		if (args[0] === "--version") return { stdout: "git version 2.43.0", stderr: "", code: 0 };
		if (args.includes("--show-toplevel")) return { stdout: `${repo}\n`, stderr: "", code: 0 };
		return { stdout: "", stderr: "", code: 0 };
	};
	const plainGit = async (args) => {
		if (args[0] === "--version") return { stdout: "git version 2.43.0", stderr: "", code: 0 };
		return { stdout: "", stderr: "not a repo", code: 128 };
	};
	try {
		assert.equal(await resolveLockKey(repoGit, sub), realpathSync(repo));
		assert.equal(await resolveLockKey(repoGit, link), realpathSync(repo));
		assert.equal(await resolveLockKey(plainGit, sub), realpathSync(sub));
		assert.equal(await resolveLockKey(async () => { throw new Error("git exploded"); }, sub), sub);

		// /repo busy => /repo/src and the symlink spelling are refused; the refusal names the lock key.
		const bus = fakeBus();
		bus.on(REQUEST, (req) => respond(bus, req));
		const locks = createCwdLocks();
		const repoDeps = { events: bus, git: repoGit, ownerRunId: "owner-1", limits, locks };
		const held = locks.tryAcquire(realpathSync(repo));
		assert.ok(held);
		const subRefused = await runDelegation(repoDeps, { role: "worker", task: "t", cwd: sub });
		assert.equal(subRefused.details.status, "refused");
		assert.match(subRefused.text, new RegExp(`still running in repository ${realpathSync(repo).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
		const linkRefused = await runDelegation(repoDeps, { role: "explorer", task: "t", cwd: link });
		assert.equal(linkRefused.details.status, "refused");
		held();
		// Two different repositories run in parallel: the first stays in flight
		// (deferred response) while the second completes.
		const bus2 = fakeBus();
		let firstReq;
		bus2.on(REQUEST, (req) => { if (req.cwd === repo) firstReq = req; else respond(bus2, req); });
		const locks2 = createCwdLocks();
		const first = runDelegation({ events: bus2, git: repoGit, ownerRunId: "owner-1", limits, locks: locks2 }, { role: "worker", task: "t", cwd: repo });
		await tick(5);
		const second = await runDelegation({ events: bus2, git: async (args) => (args[0] === "--version" ? { stdout: "git version 2.43.0", stderr: "", code: 0 } : (args.includes("--show-toplevel") ? { stdout: `${other}\n`, stderr: "", code: 0 } : { stdout: "", stderr: "", code: 0 })), ownerRunId: "owner-1", limits, locks: locks2 }, { role: "worker", task: "t", cwd: other });
		assert.equal(second.ok, true);
		respond(bus2, firstReq);
		assert.equal((await first).ok, true);
		// Outside a repo the realpath cwd is the lock identity: a second
		// delegation in the same dir is refused while the first is in flight.
		const bus3 = fakeBus();
		let pendingReq;
		bus3.on(REQUEST, (req) => { pendingReq = req; });
		const locks3 = createCwdLocks();
		const plainDeps = { events: bus3, git: plainGit, ownerRunId: "owner-1", limits, locks: locks3 };
		const running = runDelegation(plainDeps, { role: "worker", task: "t", cwd: sub });
		await tick(5);
		const again = await runDelegation(plainDeps, { role: "worker", task: "t", cwd: sub });
		assert.equal(again.details.status, "refused");
		respond(bus3, pendingReq);
		await running;
	} finally {
		rmSync(repo, { recursive: true, force: true });
		rmSync(other, { recursive: true, force: true });
		rmSync(dirname(link), { recursive: true, force: true });
	}
}

console.log("delegate.test: ok");
