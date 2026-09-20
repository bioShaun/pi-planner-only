// Pure aggregation. Never count child UPDATE snapshots as additional usage.
export function summarize(events) {
 const root = events.filter(e => e.kind === "host" && e.hook === "message_end" && e.usage);
 const sent = events.filter(e => e.kind === "launcher" && e.event === "request");
 const terminals = events.filter(e => e.kind === "launcher" && e.event === "response");
 const unique = new Map();
 for (const e of terminals) unique.set(JSON.stringify([e.requestId, e.ownerRunId, e.nodeId]), e);
 const children = [...unique.values()];
 const sum = rows => Object.fromEntries(["input", "output", "cacheRead", "cacheWrite"].map(k =>
  [k, rows.every(e => Number.isFinite(e.usage?.[k])) ? rows.reduce((n, e) => n + e.usage[k], 0) : null]));
 const closed = e => e.requests?.some(r => r.closedReason);
 const after = events.filter(closed);
 const incomplete = sent.some(s => !children.some(t => t.requestId === s.requestId && t.ownerRunId === s.ownerRunId && t.nodeId === s.nodeId && t.usage));
 return { root: sum(root), child: sum(children), rootMessages: root.length, childClaims: sent.length,
  failedAttempts: children.filter(e => e.status !== "completed").length,
  rootUsageIncomplete: events.filter(e => e.hook === "before_provider_request").length > root.length
   || events.some(e => e.hook === "message_end" && (e.answer !== undefined || e.model !== undefined) && !e.usage)
   || root.some(e => ["input", "output", "cacheRead", "cacheWrite"].some(k => !Number.isFinite(e.usage[k]))),
  childUsageIncomplete: incomplete, actualRootModels: [...new Set(root.map(e => `${e.provider}/${e.model}`))],
  actualChildModels: [...new Set(children.map(e => `${e.model ?? "unknown"}:${e.thinking ?? "unknown"}`))],
  // Zero API cost in custom models is not trustworthy pricing.
  monetaryCost: null, priceStatus: "unverified; no cost-savings claim",
  closureObserved: after.length > 0,
  afterClosure: after.length ? { modelHooks: after.filter(e => e.hook === "before_provider_request").length,
   toolCalls: after.filter(e => e.hook === "tool_call").length,
   requests: after.filter(e => e.kind === "launcher" && e.event === "request").length } : null,
  finalAnswer: events.filter(e => typeof e.answer === "string" && e.answer.trim()).at(-1)?.answer ?? "" };
}

// Quality failures must remain measured rows, including malformed edited JSON.
export function assessQuality({ name, expected, answer, changed, fileText }) {
 if (!answer.trim().endsWith(expected)) return false;
 if (name !== 'edit') return changed === '';
 try { return JSON.stringify(JSON.parse(fileText)) === '{"enabled":true}' && changed === 'M value.json'; }
 catch { return false; }
}
