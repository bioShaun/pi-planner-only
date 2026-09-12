#!/usr/bin/env node
/**
 * Freeze desensitized representative-event fixtures from the 2026-09-12
 * 01:31:47 (M) and 08:11:28 (N) session snapshots (issue 01, spec batch 0).
 *
 * One-shot generator for a frozen artifact: reads the runtime evidence files
 * read-only, derives the fixture JSON committed under
 * tests/fixtures/nx-followups/session-013147-mn.json, and never writes outside
 * this repository. Re-running after the runtime files changed produces a
 * different hash — compare `provenance.sourceSnapshots` against
 * docs/runtime-session-013147-2026-09-12-evidence.md §2.1 before trusting a
 * regenerated fixture.
 *
 * Desensitization: run ids, task ids, execution ids, model ids, usage numbers
 * and cost estimates are kept (they are already published in the evidence
 * docs); host prompts (`task`), acceptance payloads, extension manifests and
 * skills lists are dropped; the home directory prefix is replaced with
 * `<home>`; no transcript, preview or report text is copied.
 *
 * Usage: node scripts/freeze-mn-fixtures.mjs [--session-dir <dir>] [--out <path>]
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
	const index = args.indexOf(name);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const sessionDir = argValue("--session-dir", `${process.env.HOME}/.pi/agent/sessions/--public-pi-pi-planner-only--`);
const artifactsDir = join(sessionDir, "subagent-artifacts");
const outPath = argValue("--out", join(repoRoot, "tests/fixtures/nx-followups/session-013147-mn.json"));

const HOME = process.env.HOME ?? "/home/UNKNOWN";
const desensitizePath = (value) => typeof value === "string" ? value.split(HOME).join("<home>") : value;

const M_FILE = join(sessionDir, "2026-09-12T01-31-47-662Z_01a0933d-fa4e-726c-983c-4f4e039fec2e.jsonl");
const N_FILE = join(sessionDir, "2026-09-12T08-11-28-374Z_01a094ab-e4f5-74d0-a6bb-642b20714178.jsonl");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const rows = (path) => readFileSync(path, "utf8").split("\n")
	.filter((line) => line.trim())
	.map((line, index) => ({ line: index + 1, record: JSON.parse(line) }));

const M = rows(M_FILE);
const N = rows(N_FILE);

const textOf = (record) => {
	const content = record.message?.content ?? [];
	if (typeof content === "string") return content;
	return Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text ?? "").join("\n") : "";
};

// --- M: the 13 in-session runs (launch receipts, evidence.md §4.2) ---
const mInSessionRuns = [];
for (const { record } of M) {
	const message = record.message ?? {};
	if (message.role !== "toolResult" || message.toolName !== "subagent") continue;
	const hit = /Async delegation for task (\S+) has started/.exec(textOf(record));
	const runId = message.details?.runId;
	if (hit && runId) mInSessionRuns.push({ runId, taskId: hit[1], executionId: message.toolCallId });
}
if (mInSessionRuns.length !== 13) throw new Error(`expected 13 M launch receipts, found ${mInSessionRuns.length}`);
const mRunIds = new Set(mInSessionRuns.map((run) => run.runId));

// Host agent per run from the meta file names in the shared artifacts dir.
const metaFileNames = readdirSync(artifactsDir).filter((name) => /_meta\.json$/.test(name));
const agentOfRun = (runId) => metaFileNames.find((name) => name.startsWith(`${runId}_`))?.replace(/^.*_([a-z]+)(?:_0)?_meta\.json$/, "$1");
for (const run of mInSessionRuns) run.hostAgent = agentOfRun(run.runId) ?? "unknown";

// --- M: child usage events (three-source ingestion), T-023 backfill, verdicts ---
const usageEventOf = ({ record }) => {
	const data = record.data;
	if (record.customType !== "planner-only-usage" || data?.kind !== "child") return undefined;
	return {
		id: data.id,
		taskId: data.taskId,
		runId: data.runId,
		at: record.timestamp,
		child: {
			input: data.child?.input, output: data.child?.output,
			cacheRead: data.child?.cacheRead, cacheWrite: data.child?.cacheWrite,
			kind: data.child?.kind, agent: data.child?.agent,
			pending: data.child?.pending, source: data.child?.source,
			turns: data.child?.turns, outcome: data.child?.outcome,
			...(data.child?.costUsd !== undefined ? { costUsd: data.child.costUsd } : {}),
		},
	};
};

const mChildEvents = M.map(usageEventOf).filter(Boolean);
const mInSessionChildEvents = mChildEvents.filter((event) => mRunIds.has(event.runId));
const t023BackfillEvents = mChildEvents.filter((event) => event.taskId === "T-20260912-023");

// --- N: the 133 historical-meta child events (spec C01 replay reference) ---
const nChildEvents = N.map(usageEventOf).filter(Boolean);
if (nChildEvents.length !== 133) throw new Error(`expected 133 N child events, found ${nChildEvents.length}`);

// --- untasked root-turn events observed under the new build (M:L765/768, N:L6/9/14) ---
// Persisted root-turn entries carry no attribution field; the untasked bucket
// is marked by the `root-turn:untasked:` id prefix (evidence §9.4).
const untaskedRootTurns = [];
for (const [path, source] of [[M_FILE, "M"], [N_FILE, "N"]]) {
	for (const { line, record } of rows(path)) {
		const data = record.data;
		if (record.customType !== "planner-only-usage" || data?.kind !== "root-turn") continue;
		if (!String(data.id ?? "").startsWith("root-turn:untasked:")) continue;
		untaskedRootTurns.push({
			source, line, id: data.id, at: data.at ?? record.timestamp,
			...(data.model ? { model: data.model } : {}),
			usage: {
				input: data.usage?.input, output: data.usage?.output,
				cacheRead: data.usage?.cacheRead, cacheWrite: data.usage?.cacheWrite,
				...(typeof data.usage?.cost?.total === "number" ? { costTotal: data.usage.cost.total } : {}),
			},
		});
	}
}

// --- the 9 planner_verdict requests and what actually happened (evidence §7.1) ---
const verdictRequests = [];
{
	const calls = new Map();
	for (const { record } of M) {
		const message = record.message ?? {};
		if (message.role === "toolCall" || (message.role === "assistant" && Array.isArray(message.content))) {
			for (const part of Array.isArray(message.content) ? message.content : []) {
				if (part?.type === "toolCall" && part.name === "planner_verdict") {
					calls.set(part.id, { arguments: part.arguments ?? {} });
				}
			}
		}
		if (message.role === "toolResult" && message.toolName === "planner_verdict") {
			const call = calls.get(message.toolCallId);
			if (!call) continue;
			const details = message.details ?? {};
			verdictRequests.push({
				line: null,
				taskId: call.arguments.taskId,
				requested: call.arguments.verdict,
				details: {
					...(details.action !== undefined ? { action: details.action } : {}),
					...(details.state !== undefined ? { state: details.state } : {}),
					...(details.refused !== undefined ? { refused: details.refused } : {}),
					...(details.refusalKind !== undefined ? { refusalKind: details.refusalKind } : {}),
				},
			});
		}
	}
}
if (verdictRequests.length !== 9) throw new Error(`expected 9 planner_verdict results, found ${verdictRequests.length}`);

// --- the meta files covered by the evidence snapshot, desensitized ---
// The live artifacts dir keeps growing; the evidence mother set is exactly the
// 133 runIds in N's child events (13 M runs + 120 foreign). Select by that
// set so the fixture stays pinned to the documented snapshot.
const META_KEEP_KEYS = ["runId", "agent", "exitCode", "model", "thinking", "usage", "stopReason", "sourceSessionId", "sessionId", "ownerRootSessionId", "taskId", "executionId", "transcriptPath", "childSessionFile", "sourceDir", "timestamp"];
const nRunIds = new Set(nChildEvents.map((event) => event.runId));
if (nRunIds.size !== 133) throw new Error(`expected 133 distinct N child runIds, found ${nRunIds.size}`);
const liveMetas = new Map();
for (const name of metaFileNames.sort()) {
	const runId = /^(.*)_([a-z]+)(?:_0)?_meta\.json$/.exec(name)?.[1];
	if (runId && !liveMetas.has(runId)) liveMetas.set(runId, name);
}
const historicalMeta = [];
for (const runId of [...nRunIds].sort()) {
	const name = liveMetas.get(runId);
	if (!name) throw new Error(`meta file for snapshot run ${runId} no longer exists in the live artifacts dir`);
	const raw = JSON.parse(readFileSync(join(artifactsDir, name), "utf8"));
	if (!raw || raw.runId === undefined || raw.agent === undefined) continue;
	const record = {};
	for (const key of META_KEEP_KEYS) {
		if (raw[key] === undefined) continue;
		record[key] = key === "transcriptPath" || key === "childSessionFile" || key === "sourceDir"
			? desensitizePath(raw[key])
			: raw[key];
	}
	record.metaPath = name;
	record.usage = { input: raw.usage?.input, output: raw.usage?.output, cacheRead: raw.usage?.cacheRead, cacheWrite: raw.usage?.cacheWrite, ...(raw.usage?.turns !== undefined ? { turns: raw.usage.turns } : {}) };
	historicalMeta.push(record);
}
if (historicalMeta.length !== 133) throw new Error(`expected 133 meta files, found ${historicalMeta.length}`);

// --- T-004 keep set and the wrong-Task run, by documented prefix ---
const keepByPrefix = (prefix) => {
	const found = historicalMeta.find((meta) => meta.runId.startsWith(prefix));
	if (!found) throw new Error(`keep-set run ${prefix} not found among the 133 metas`);
	return found.runId;
};
const t004KeepRunIds = [keepByPrefix("7110bd1b"), keepByPrefix("143426ad")];
const wrongTaskRunIds = [keepByPrefix("f032477d")];

// --- M/N session identity and provenance entries ---
const provenanceOf = (path) => {
	for (const { record } of rows(path)) {
		if (record.customType === "planner-only-version" && record.data) {
			return {
				loadedFingerprint: record.data.loadedFingerprint ?? record.data.fingerprint,
				diskHead: record.data.diskHead,
				packageVersion: record.data.packageVersion,
			};
		}
	}
	return {};
};

const fixture = {
	version: 1,
	provenance: {
		derivedFrom: "docs/runtime-session-013147-2026-09-12-evidence.md (M/N snapshots, §2.1 hashes)",
		sourceSnapshots: {
			M: { path: desensitizePath(M_FILE), sha256: sha256(M_FILE) },
			N: { path: desensitizePath(N_FILE), sha256: sha256(N_FILE) },
		},
		desensitization: "run/task/execution/model ids and usage numbers kept (published in evidence docs); prompts, acceptance payloads, extension manifests, skills dropped; home prefix replaced with <home>; no transcript or report text",
		frozenAt: new Date().toISOString(),
	},
	sessions: {
		M: {
			rootSessionId: "01a0933d-fa4e-726c-983c-4f4e039fec2e",
			stem: "2026-09-12T01-31-47-662Z_01a0933d-fa4e-726c-983c-4f4e039fec2e",
			...provenanceOf(M_FILE),
		},
		N: {
			rootSessionId: "01a094ab-e4f5-74d0-a6bb-642b20714178",
			stem: "2026-09-12T08-11-28-374Z_01a094ab-e4f5-74d0-a6bb-642b20714178",
			...provenanceOf(N_FILE),
		},
	},
	// N replay input: 0 launches + 133 historical metas (C01). The shared
	// artifacts mother set, of which 13 belong to M and 120 are foreign.
	historicalMeta,
	// M's 13 in-session runs with their launch bindings (C02 identification).
	mInSessionRuns,
	// M's in-session child usage events: bg-wait / sync-details / meta-file
	// ingestion of the same runs (C03 three-source dedup).
	mInSessionChildEvents,
	// T-023's 121 backfilled children: 120 foreign + the 1 in-session
	// wrong-Task run (C02 repair replay).
	t023BackfillEvents,
	// T-004's two original runs that a repair must keep, and the run that was
	// wrongly bound to T-023 instead of T-022.
	t004KeepRunIds,
	wrongTaskRunIds,
	// New-build untasked root turns with positive evidence but no persistence
	// row in usage.jsonl at snapshot time (C03 untasked bucket).
	untaskedRootTurns,
	// The 9 planner_verdict requests with the applied outcome (C08 9/8/1 recompute).
	verdictRequests,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(fixture, null, "\t")}\n`, "utf8");

const counts = {
	historicalMeta: historicalMeta.length,
	mInSessionRuns: mInSessionRuns.length,
	mInSessionChildEvents: mInSessionChildEvents.length,
	t023BackfillEvents: t023BackfillEvents.length,
	untaskedRootTurns: untaskedRootTurns.length,
	verdictRequests: verdictRequests.length,
};
console.log(`frozen fixture written: ${outPath}`);
console.log(JSON.stringify(counts));
