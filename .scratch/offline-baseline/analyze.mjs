// Read-only analysis of Pi session-format v3 logs. Emits JSON to stdout.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const textOf = (message) => typeof message?.content === "string"
  ? message.content
  : (message?.content ?? []).filter((part) => part.type === "text").map((part) => part.text).join("\n");
const fields = ["input", "output", "cacheRead", "cacheWrite"];
const tokens = (usage) => fields.every((key) => Number.isFinite(usage?.[key]))
  ? fields.reduce((sum, key) => sum + usage[key], 0) : null;
const sumKnown = (values) => ({
  known: values.filter(Number.isFinite).length,
  unknown: values.filter((value) => !Number.isFinite(value)).length,
  sum: values.filter(Number.isFinite).reduce((sum, value) => sum + value, 0),
});
const counts = (values) => values.reduce((out, value) => {
  out[value] = (out[value] ?? 0) + 1;
  return out;
}, {});

export function unionMs(intervals) {
  let total = 0, end = -Infinity;
  for (const [start, stop] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop < start) {
      throw new RangeError("Invalid observed interval");
    }
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}

async function load(path, readText) {
  const raw = await readText(path);
  const events = raw.trimEnd().split("\n").map((line, index) => ({
    ...JSON.parse(line), line: index + 1,
  }));
  return { path, sha256: sha256(raw), events };
}

function usageSummary(messages) {
  return {
    messages: messages.length,
    tokens: sumKnown(messages.map((message) => tokens(message.usage))),
    cost: sumKnown(messages.map((message) => message.usage?.cost?.total ?? null)),
    components: Object.fromEntries(fields.map((key) => [
      key, sumKnown(messages.map((message) => message.usage?.[key] ?? null)),
    ])),
  };
}

function configuration(events) {
  return {
    hostVersion: null,
    pluginVersion: null,
    subagentsVersion: null,
    // Session "version" is the serialization format, not the host version.
    sessionFormat: events[0].version,
    modelChanges: events.filter((e) => e.type === "model_change").map((e) => ({
      line: e.line, provider: e.provider, model: e.modelId,
    })),
    thinkingChanges: events.filter((e) => e.type === "thinking_level_change").map((e) => ({
      line: e.line, thinking: e.thinkingLevel,
    })),
    modes: events.filter((e) => e.type === "custom" && e.customType === "planner-only-mode")
      .map((e) => ({ line: e.line, data: e.data })),
    systemSnapshots: events.filter((e) => e.message?.role === "system").map((e) => ({
      line: e.line,
      sha256: sha256(JSON.stringify({
        content: e.message.content, sections: e.message.sections,
        tools: e.message.toolsAdded,
      })),
    })),
    observedModels: [...new Set(events.filter((e) => e.message?.role === "assistant")
      .map((e) => `${e.message.provider}/${e.message.model}:${e.message.thinkingLevel ?? "unknown"}`))],
  };
}

export function analyzeRoot(source) {
  const { events } = source;
  const calls = [];
  for (const event of events) {
    if (event.message?.role !== "assistant") continue;
    for (const part of event.message.content ?? []) {
      if (part.type !== "toolCall" || part.name !== "delegate") continue;
      const results = events.filter((e) => e.message?.role === "toolResult"
        && e.message.toolName === "delegate" && e.message.toolCallId === part.id);
      const result = results.length === 1 ? results[0] : null;
      const details = result?.message.details;
      const usage = details?.usage;
      calls.push({
        id: part.id, callLine: event.line, resultLines: results.map((e) => e.line),
        callTime: event.timestamp, resultTime: result?.timestamp ?? null,
        role: part.arguments.role, cwd: part.arguments.cwd ?? events[0].cwd,
        taskSha256: sha256(part.arguments.task),
        status: details?.status ?? "unknown", model: details?.model ?? null,
        usage: usage ?? null, tokens: tokens(usage), cost: usage?.cost ?? null,
        durationMs: usage?.durationMs ?? null,
        envelopeMs: result ? Date.parse(result.timestamp) - Date.parse(event.timestamp) : null,
        child: null,
      });
    }
  }
  const episodes = [];
  const users = events.filter((e) => e.message?.role === "user");
  for (let index = 0; index < users.length; index++) {
    const user = users[index];
    const nextLine = users[index + 1]?.line ?? Infinity;
    const segment = events.filter((e) => e.line > user.line && e.line < nextLine);
    const lastMessage = segment.filter((e) => e.message).at(-1);
    const terminal = lastMessage?.message.role === "assistant"
      && lastMessage.message.stopReason === "stop" ? lastMessage : null;
    episodes.push({
      userLine: user.line, endLine: terminal?.line ?? null,
      start: user.timestamp, end: terminal?.timestamp ?? null,
      wallMs: terminal ? Date.parse(terminal.timestamp) - Date.parse(user.timestamp) : null,
      status: terminal ? "response_finished" : "censored",
    });
  }
  const batches = [...new Set(calls.map((call) => call.callLine))].map((line) => {
    const batch = calls.filter((call) => call.callLine === line);
    return {
      callLine: line, callTime: batch[0].callTime, calls: batch.map((call) => call.id),
      end: batch.every((call) => call.resultTime)
        ? Math.max(...batch.map((call) => Date.parse(call.resultTime))) : null,
    };
  });
  const gaps = [];
  for (let index = 1; index < batches.length; index++) {
    const previous = batches[index - 1], next = batches[index];
    const unresolved = calls.some((call) => call.callLine < next.callLine
      && (!call.resultTime || Date.parse(call.resultTime) > Date.parse(next.callTime)));
    const userBetween = users.some((user) => user.line > previous.callLine && user.line < next.callLine);
    if (previous.end !== null && !unresolved && !userBetween) {
      gaps.push({
        fromCallLine: previous.callLine, toCallLine: next.callLine,
        start: new Date(previous.end).toISOString(), end: next.callTime,
        ms: Date.parse(next.callTime) - previous.end,
      });
    }
  }
  const envelopes = calls.filter((call) => call.resultTime)
    .map((call) => [Date.parse(call.callTime), Date.parse(call.resultTime)]);
  return {
    file: source.path, sha256: source.sha256, sessionId: events[0].id,
    cwd: events[0].cwd, lines: events.length, configuration: configuration(events),
    rootUsage: usageSummary(events.filter((e) => e.message?.role === "assistant").map((e) => e.message)),
    calls, episodes, gaps, batches,
    summary: {
      calls: calls.length, roles: counts(calls.map((call) => call.role)),
      statuses: counts(calls.map((call) => call.status)),
      childTokens: sumKnown(calls.map((call) => call.tokens)),
      childCost: sumKnown(calls.map((call) => call.cost)),
      roleDurationMs: Object.fromEntries([...new Set(calls.map((call) => call.role))]
        .map((role) => [role, sumKnown(calls.filter((call) => call.role === role).map((call) => call.durationMs))])),
      delegateEnvelopeUnionMs: unionMs(envelopes),
      delegateEnvelopeSumMs: envelopes.reduce((sum, [start, end]) => sum + end - start, 0),
      responseWallMs: sumKnown(episodes.map((episode) => episode.wallMs)),
      handoffGapMs: sumKnown(gaps.map((gap) => gap.ms)),
    },
  };
}

export async function analyzeDirectory(directory, readText = (path) => readFile(path, "utf8")) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => entry.name).sort();
  const sessions = [];
  for (const file of files) {
    const source = await load(join(directory, file), readText);
    const root = analyzeRoot(source);
    const childDirectory = file.slice(0, -6);
    const childSources = [];
    if (entries.some((entry) => entry.isDirectory() && entry.name === childDirectory)) {
      const runIds = (await readdir(join(directory, childDirectory))).sort();
      for (const runId of runIds) {
        const runDirectory = join(directory, childDirectory, runId);
        const runs = (await readdir(runDirectory)).filter((name) => /^run-\d+$/.test(name)).sort();
        for (const run of runs) {
          childSources.push(await load(join(runDirectory, run, "session.jsonl"), readText));
        }
      }
    }
    const usedChildren = new Set();
    for (const call of root.calls) {
      if (call.status === "refused") continue;
      const original = source.events.find((e) => e.line === call.callLine).message.content
        .find((part) => part.type === "toolCall" && part.id === call.id);
      // The host trims the task before appending its working-directory footer.
      const prefix = `Task: ${original.arguments.task.trim()}\n\n---\nWorking directory:`;
      const candidates = childSources.filter((child) => {
        const firstUser = child.events.find((e) => e.message?.role === "user");
        const start = Date.parse(child.events[0].timestamp);
        return child.events[0].cwd === call.cwd && textOf(firstUser?.message).startsWith(prefix)
          && start >= Date.parse(call.callTime)
          && (call.resultTime === null || start <= Date.parse(call.resultTime));
      });
      call.childCandidates = candidates.map((child) => child.path);
      if (candidates.length !== 1 || usedChildren.has(candidates[0].path)) continue;
      const child = candidates[0];
      usedChildren.add(child.path);
      const messages = child.events.filter((e) => e.message?.role === "assistant").map((e) => e.message);
      const childUsage = usageSummary(messages);
      call.child = {
        file: child.path, sha256: child.sha256, sessionId: child.events[0].id,
        configuration: configuration(child.events),
        start: child.events[0].timestamp, lastEvent: child.events.at(-1).timestamp,
        usage: childUsage,
        tokenDelta: call.tokens !== null && childUsage.tokens.unknown === 0
          ? childUsage.tokens.sum - call.tokens : null,
        costDelta: call.cost !== null && childUsage.cost.unknown === 0
          ? childUsage.cost.sum - call.cost : null,
      };
    }
    root.unpairedChildFiles = childSources.filter((child) => !usedChildren.has(child.path))
      .map((child) => ({ file: child.path, sha256: child.sha256 }));
    // Candidate successors only: task meaning and rework require manual review.
    root.failureSuccessors = root.calls.filter((call) => call.status !== "completed").map((call) => ({
      callLine: call.callLine, status: call.status,
      nextCalls: root.calls.filter((next) => next.callLine > call.callLine
        && call.resultTime !== null && Date.parse(next.callTime) >= Date.parse(call.resultTime))
        .filter((next, index, all) => next.callLine === all[0].callLine)
        .map((next) => ({ callLine: next.callLine, id: next.id, role: next.role,
          sameTask: next.taskSha256 === call.taskSha256, tokens: next.tokens, cost: next.cost })),
    }));
    sessions.push(root);
  }
  return {
    schemaVersion: 1, sourceDirectory: directory,
    scope: "All top-level JSONL files; nested children are joined, never counted as roots.",
    costMeaning: "Logged usage.cost, not invoice-verified actual billing; null means unknown.",
    sessions,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new TypeError("usage: node analyze.mjs <session-directory>");
  console.log(JSON.stringify(await analyzeDirectory(resolve(directory)), null, 2));
}
