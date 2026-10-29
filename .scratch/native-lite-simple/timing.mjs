// Time breakdown from session entry timestamps. All values are seconds.
// A model call is the span from an assistant entry's parent entry to the assistant entry;
// a tool call is charged from the later of the issuing assistant entry and the previous toolResult of the
// same message to its own toolResult, so one message's tool calls tile its tool envelope without double counting.
const ts = (o) => { const v = Date.parse(o?.timestamp ?? ""); return Number.isFinite(v) ? v / 1000 : null; };
const round = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => { const v = [...xs].sort((a, b) => a - b), m = v.length >> 1; return v.length ? (v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2) : null; };

export function parseArgs(p) {
  if (typeof p.arguments !== "string") return p.arguments;
  try { return JSON.parse(p.arguments); } catch { return {}; }
}

export function classifyCall(p) {
  if (p.name === "delegate") return "launch";
  if (p.name === "subagent") return parseArgs(p)?.action != null ? "mgmt" : "launch";
  return "other";
}

function merge(iv) {
  const out = [];
  for (const [a, b] of iv.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out;
}
const len = (iv) => sum(merge(iv).map(([a, b]) => b - a));
const overlap = (x, y) => sum(merge(x).flatMap(([a, b]) => merge(y).map(([c, d]) => Math.max(0, Math.min(b, d) - Math.max(a, c)))));

function modelIntervals(lines) {
  const byId = new Map(lines.filter((o) => o.id).map((o) => [o.id, o]));
  return lines.filter((o) => o.type === "message" && o.message?.role === "assistant").flatMap((o) => {
    const a = ts(byId.get(o.parentId)), b = ts(o);
    return a != null && b != null ? [[a, b]] : [];
  });
}

export function collectTiming({ root, children, wallSec }) {
  if (!root) return { available: false };
  const flags = [], R = root.lines;
  const rootModel = modelIntervals(R);
  const results = new Map(R.filter((o) => o.message?.role === "toolResult").map((o) => [o.message.toolCallId, o]));
  const calls = [], launches = [], envelopes = [];
  let missingResults = 0;
  for (const o of R) {
    if (o.type !== "message" || o.message?.role !== "assistant") continue;
    const at = ts(o), mine = [];
    (o.message.content ?? []).forEach((p, order) => {
      if (p?.type !== "toolCall") return;
      const res = results.get(p.id), resultAt = ts(res);
      if (resultAt == null) missingResults++;
      mine.push({ kind: classifyCall(p), name: p.name, at, resultAt, order, res });
    });
    let prev = at;
    for (const c of mine.filter((c) => c.resultAt != null).sort((a, b) => a.resultAt - b.resultAt || a.order - b.order)) {
      c.segStart = prev;
      prev = Math.max(prev, c.resultAt);
    }
    if (prev > at) envelopes.push(prev - at);
    calls.push(...mine);
    for (const c of mine.filter((c) => c.kind === "launch")) {
      const d = c.res?.message?.details;
      launches.push({ tool: c.name, at, start: c.segStart ?? at, resultAt: c.resultAt, resultIsError: !!c.res?.message?.isError,
        runId: d?.asyncId ?? d?.runId ?? null, reportedDurationSec: d?.usage?.durationMs != null ? d.usage.durationMs / 1000 : null });
    }
  }
  // A launch queued behind earlier results of its message starts at its segment; fall back to the issue time
  // if the child started before that (calls that actually ran concurrently).
  const launchStart = (start, at, childStart) => (start <= childStart ? start : at);
  if (missingResults) flags.push(`toolcalls-without-result:${missingResults}`);
  const kids = children.map((s) => {
    const t = s.lines.map(ts).filter((v) => v != null);
    return { file: s.file, start: Math.min(...t), end: Math.max(...t), modelSec: len(modelIntervals(s.lines)) };
  }).filter((k) => Number.isFinite(k.start)).sort((a, b) => a.start - b.start);

  // Link by run id when the launch result recorded one (Native async), otherwise by time order.
  const used = new Set();
  for (const L of launches) {
    const k = L.runId && kids.find((c) => !used.has(c) && c.file.includes(`/${L.runId}/`));
    if (k) { used.add(k); L.kid = k; L.match = "runId"; }
  }
  for (const L of launches) {
    if (L.kid) continue;
    // A synchronous delegate's child must start before its result arrives; async launches return first.
    const k = kids.find((c) => !used.has(c) && c.start >= L.at && (L.tool !== "delegate" || L.resultAt == null || c.start <= L.resultAt));
    if (k) { used.add(k); L.kid = k; L.match = "time"; } else L.match = "none";
  }
  // A child that runs entirely inside another Root tool call (e.g. code mode calling delegate) is a nested launch of it.
  const nested = new Map();
  for (const k of kids) {
    if (used.has(k)) continue;
    const c = calls.find((c) => c.kind === "other" && c.resultAt != null && c.at <= k.start && c.resultAt >= k.end);
    if (!c) continue;
    used.add(k); c.kind = "launch";
    nested.set(c, [...(nested.get(c) ?? []), k]);
  }
  for (const [c, ks] of nested) ks.forEach((k, i) => launches.push({ tool: `${c.name}(nested)`, at: c.at, start: c.segStart, resultAt: c.resultAt, runId: null,
    resultIsError: false, reportedDurationSec: null, kid: k, match: "contained", nested: true,
    startupSec: k.start - (i ? ks[i - 1].end : launchStart(c.segStart, c.at, k.start)), finishSec: i === ks.length - 1 ? c.resultAt - k.end : null,
    finishVia: i === ks.length - 1 ? "toolResult" : "same-call-continues" }));
  launches.sort((a, b) => a.at - b.at);
  const tool = { launch: [], mgmt: [], other: [] };
  for (const c of calls) if (c.resultAt != null) tool[c.kind].push([c.segStart, c.resultAt]);
  const notifies = R.filter((o) => o.type === "custom_message" && o.customType === "subagent-notify");
  for (const L of launches) {
    const k = L.kid;
    if (!k || L.nested) continue;
    L.startupSec = k.start - launchStart(L.start, L.at, k.start);
    if (L.resultAt != null && L.resultAt >= k.end) { L.finishSec = L.resultAt - k.end; L.finishVia = "toolResult"; continue; }
    const n = notifies.find((o) => ts(o) >= k.end && (!L.runId || JSON.stringify(o.details ?? o.content ?? "").includes(L.runId)));
    L.finishSec = n ? ts(n) - k.end : null;
    L.finishVia = n ? "subagent-notify" : null;
  }
  const unmatchedLaunches = launches.filter((L) => !L.kid).length, unmatchedChildren = kids.filter((k) => !used.has(k)).length;
  if (unmatchedLaunches) flags.push(`launches-without-child:${unmatchedLaunches}`);
  if (unmatchedChildren) flags.push(`children-without-launch:${unmatchedChildren}`);
  if (launches.some((L) => L.kid && L.finishSec == null && L.finishVia !== "same-call-continues")) flags.push("finish-signal-missing");
  if (nested.size) flags.push(`nested-launches:${launches.filter((L) => L.nested).length}`);

  const childIv = kids.map((k) => [k.start, k.end]);
  let maxConcurrent = 0, cur = 0;
  for (const [, d] of kids.flatMap((k) => [[k.start, 1], [k.end, -1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1])) maxConcurrent = Math.max(maxConcurrent, (cur += d));
  const rootTimes = R.map(ts).filter((v) => v != null);
  const firstRoot = Math.min(...rootTimes), lastRoot = Math.max(...rootTimes);
  const firstLaunch = launches.length ? Math.min(...launches.map((L) => L.at)) : null;
  const lastChildEnd = kids.length ? Math.max(...kids.map((k) => k.end)) : null;
  const wall = wallSec ?? lastRoot - firstRoot;
  const turns = rootModel.map(([a, b]) => b - a);
  const childBusy = len(childIv);
  const startups = launches.filter((L) => L.startupSec != null).map((L) => L.startupSec);
  const finishes = launches.filter((L) => L.finishSec != null).map((L) => L.finishSec);
  const t0 = firstRoot;
  const spans = (iv) => sum(iv.map(([a, b]) => Math.max(0, b - a)));
  return {
    available: true, launchCount: launches.length, nestedLaunches: launches.filter((L) => L.nested).length, wallSec: round(wall), wallSource: wallSec != null ? "meta" : "root-session-span",
    rootModelSec: round(sum(turns)), rootTurnSecMedian: round(median(turns)), rootTurnSecMax: round(turns.length ? Math.max(...turns) : null),
    rootDelegateToolSec: round(spans(tool.launch)), rootMgmtToolSec: round(spans(tool.mgmt)), rootOtherToolSec: round(spans(tool.other)),
    rootToolEnvelopeSec: round(sum(envelopes)),
    childModelSec: round(sum(kids.map((k) => k.modelSec))), childBusyWallSec: round(childBusy), maxConcurrentChildren: maxConcurrent,
    childSerial: kids.length ? maxConcurrent <= 1 : null,
    startupSecSum: launches.length ? round(sum(startups)) : null, finishSecSum: launches.length ? round(sum(finishes)) : null,
    planSec: firstLaunch == null ? null : round(firstLaunch - firstRoot),
    execSec: firstLaunch == null || lastChildEnd == null ? null : round(lastChildEnd - firstLaunch),
    reviewSec: firstLaunch == null || lastChildEnd == null ? null : round(lastRoot - lastChildEnd),
    rootIdleWaitSec: round(childBusy - overlap(childIv, rootModel)),
    unattributedSec: round(wall - len([...rootModel, ...tool.mgmt, ...tool.other, ...childIv])),
    launches: launches.map((L) => ({ tool: L.tool, atSec: round(L.at - t0), toolStartSec: round(L.start - t0), runId: L.runId, resultIsError: L.resultIsError, match: L.match,
      child: L.kid?.file ?? null, childStartSec: round(L.kid ? L.kid.start - t0 : null), childEndSec: round(L.kid ? L.kid.end - t0 : null),
      startupSec: round(L.startupSec), finishSec: round(L.finishSec), finishVia: L.finishVia ?? null, reportedDurationSec: L.reportedDurationSec })),
    flags,
  };
}
