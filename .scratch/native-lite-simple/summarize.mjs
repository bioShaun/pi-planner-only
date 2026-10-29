#!/usr/bin/env node
// Usage: node summarize.mjs BATCH_DIR                 -> writes and prints BATCH_DIR/results.md
//        node summarize.mjs --budget BATCH_DIR MAX_USD -> prints reported total; exit 3 if above MAX_USD
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);

function loadRuns(batch) {
  const dir = join(batch, "runs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().map((name) => {
    const run = readJson(join(dir, name, "run.json"));
    const meta = run?.meta ?? readJson(join(dir, name, "meta.json")) ?? { mode: name.split("-")[0], rep: name.split("-")[1] };
    return { name, run, meta };
  });
}

const totalCost = (runs) => runs.reduce((a, r) => a + (r.run?.usage?.total?.cost ?? 0), 0);

function row({ run, meta }) {
  const u = run?.usage, t = u?.timing?.available ? u.timing : {};
  const missing = u?.childUsage === "missing";
  const launches = t.launchCount ?? u?.launches;
  return {
    mode: meta.mode, rep: Number(meta.rep), valid: !!run?.valid,
    rootModelSec: t.rootModelSec, rootTurnSecMedian: t.rootTurnSecMedian, rootTurnSecMax: t.rootTurnSecMax,
    rootDelegateToolSec: t.rootDelegateToolSec, rootMgmtToolSec: t.rootMgmtToolSec, rootOtherToolSec: t.rootOtherToolSec,
    rootToolEnvelopeSec: t.rootToolEnvelopeSec,
    childModelSec: t.childModelSec, childBusyWallSec: t.childBusyWallSec, rootIdleWaitSec: t.rootIdleWaitSec,
    startupSecSum: t.startupSecSum, finishSecSum: t.finishSecSum, unattributedSec: t.unattributedSec,
    planSec: t.planSec, execSec: t.execSec, reviewSec: t.reviewSec, maxConcurrent: t.maxConcurrentChildren,
    rootCost: u?.root.cost, rootIn: u?.root.input, rootOut: u?.root.output, rootCacheRead: u?.root.cacheRead,
    rootCacheWrite: u?.root.cacheWrite, rootTokens: u?.root.totalTokens, rootShare: missing ? null : u?.rootShare,
    rootTurns: u?.root.entries, peakContext: u?.peakContext, finalContext: u?.finalContext,
    delegated: u ? launches > 0 : null, launches, mgmt: u?.managementCalls, childSessions: u?.childFiles.length,
    rootEdits: u?.rootEdits, rootBash: u?.rootBash, childCost: missing ? null : u?.child.cost, totalCost: missing ? null : u?.total.cost,
    wall: meta.wallclockSec, modeOk: run?.modeOk, exit: meta.exitCode, timedOut: meta.timedOut,
    hidden: run?.tests ? `${run.tests.hidden.pass}/${run.tests.hiddenExpected}` : "-",
    hiddenPct: run?.tests?.hiddenExpected ? run.tests.hidden.pass / run.tests.hiddenExpected : null,
    visible: run?.tests ? `${run.tests.visible.pass}/${run.tests.visible.total}` : "-",
    commits: run?.git?.commitsAfterInitial, dirty: run?.git?.dirty,
    flags: run ? run.flags.join(" ") || "-" : "no run.json",
  };
}

const usd = (v) => (v == null ? "missing" : `$${v.toFixed(4)}`);
const int = (v) => (v == null ? "-" : String(Math.round(v)));
const pct = (v) => (v == null ? "-" : `${(v * 100).toFixed(1)}%`);
const sec = (v) => (v == null ? "-" : v.toFixed(1));
const yn = (v) => (v == null ? "-" : v ? "yes" : "no");
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const COLUMNS = [
  ["run", (r) => `${r.mode}-${r.rep}`], ["valid", (r) => yn(r.valid)], ["wall s", (r) => sec(r.wall)],
  ["rootModel s", (r) => sec(r.rootModelSec)], ["childBusy s", (r) => sec(r.childBusyWallSec)], ["rootIdleWait s", (r) => sec(r.rootIdleWaitSec)],
  ["startup s", (r) => sec(r.startupSecSum)], ["finish s", (r) => sec(r.finishSecSum)], ["unattributed s", (r) => sec(r.unattributedSec)],
  ["plan/exec/review s", (r) => `${sec(r.planSec)}/${sec(r.execSec)}/${sec(r.reviewSec)}`], ["maxConc", (r) => int(r.maxConcurrent)],
  ["Root $", (r) => usd(r.rootCost)],
  ["Root in", (r) => int(r.rootIn)], ["Root out", (r) => int(r.rootOut)], ["Root cacheR", (r) => int(r.rootCacheRead)],
  ["Root cacheW", (r) => int(r.rootCacheWrite)], ["Root tok", (r) => int(r.rootTokens)], ["Root share", (r) => pct(r.rootShare)],
  ["Root turns", (r) => int(r.rootTurns)], ["peak ctx", (r) => int(r.peakContext)], ["final ctx", (r) => int(r.finalContext)],
  ["delegated", (r) => yn(r.delegated)], ["launches", (r) => int(r.launches)], ["mgmt calls", (r) => int(r.mgmt)],
  ["child sessions", (r) => int(r.childSessions)], ["Root edits", (r) => int(r.rootEdits)], ["Root bash", (r) => int(r.rootBash)],
  ["child $", (r) => usd(r.childCost)], ["total $", (r) => usd(r.totalCost)],
  ["modeOk", (r) => yn(r.modeOk)], ["exit/TO", (r) => `${r.exit ?? "-"}/${r.timedOut ? "TO" : "-"}`], ["hidden", (r) => r.hidden],
  ["visible", (r) => r.visible], ["commits", (r) => int(r.commits)], ["dirty", (r) => yn(r.dirty)], ["flags", (r) => r.flags],
];

const METRICS = [
  ["wallclock s", "wall", sec], ["Root model s", "rootModelSec", sec], ["Root turn s (median)", "rootTurnSecMedian", sec],
  ["Root turn s (max)", "rootTurnSecMax", sec], ["Root delegate-tool s", "rootDelegateToolSec", sec], ["Root mgmt-tool s", "rootMgmtToolSec", sec],
  ["Root other-tool s", "rootOtherToolSec", sec], ["Root tool envelope s", "rootToolEnvelopeSec", sec], ["child model s", "childModelSec", sec], ["child busy wall s", "childBusyWallSec", sec],
  ["Root idle wait s", "rootIdleWaitSec", sec], ["startup s (sum)", "startupSecSum", sec], ["finish s (sum)", "finishSecSum", sec],
  ["unattributed s", "unattributedSec", sec], ["plan s", "planSec", sec], ["exec s", "execSec", sec], ["review s", "reviewSec", sec],
  ["max concurrent children", "maxConcurrent", int],
  ["Root $", "rootCost", usd], ["Root tokens", "rootTokens", int], ["Root input", "rootIn", int], ["Root output", "rootOut", int],
  ["Root cacheRead", "rootCacheRead", int], ["Root cacheWrite", "rootCacheWrite", int], ["Root share of $", "rootShare", pct],
  ["Root turns", "rootTurns", int], ["peak Root ctx", "peakContext", int], ["final Root ctx", "finalContext", int],
  ["child launches", "launches", int], ["child sessions", "childSessions", int], ["Root edit/write/apply_patch", "rootEdits", int],
  ["Root bash", "rootBash", int], ["child $", "childCost", usd], ["total $", "totalCost", usd],
  ["hidden pass %", "hiddenPct", pct],
];

const stats = (vals) => {
  const v = vals.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [null, null];
  const mid = v.length >> 1;
  return [v.reduce((a, b) => a + b, 0) / v.length, v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2];
};

// Shares can overlap (Root may think while a child runs), so they need not sum to 100%.
function timeShare(rows) {
  const total = (k) => rows.reduce((a, r) => a + (r[k] ?? 0), 0), wall = total("wall");
  if (!wall) return "time share: -";
  const p = (v) => `${((v / wall) * 100).toFixed(1)}%`;
  return `time share of wall (all runs): rootModel ${p(total("rootModelSec"))} / childBusy ${p(total("childBusyWallSec"))} / ` +
    `overhead (startup+finish+unattributed) ${p(total("startupSecSum") + total("finishSecSum") + total("unattributedSec"))}`;
}

function render(batch, runs) {
  const rows = runs.map(row).sort((a, b) => a.rep - b.rep || a.mode.localeCompare(b.mode));
  const out = [`# Native vs Lite A/B results`, "", `Batch: \`${batch}\``, ""];
  const stopped = join(batch, "STOPPED.txt");
  if (existsSync(stopped)) out.push(`**Batch stopped early:** ${readFileSync(stopped, "utf8").trim()}`, "");
  out.push("Costs are provider-reported session costs, not invoices. `valid` = mode recorded correctly, no timeout,",
    "child usage found when Root delegated, all hidden tests pass, and at least one commit.", "", "## Runs", "",
    table(COLUMNS.map(([h]) => h), rows.map((r) => COLUMNS.map(([, f]) => f(r)))), "", "## Per mode", "");
  for (const mode of [...new Set(rows.map((r) => r.mode))]) {
    const all = rows.filter((r) => r.mode === mode), valid = all.filter((r) => r.valid);
    out.push(`### ${mode}`, "", `runs ${all.length}, valid ${valid.length}, delegated ${all.filter((r) => r.delegated).length}, ` +
      `hidden full pass ${all.filter((r) => r.hiddenPct === 1).length}`, "", timeShare(all), "",
      table(["metric", "all mean", "all median", "valid mean", "valid median"], METRICS.map(([label, key, f]) =>
        [label, ...stats(all.map((r) => r[key])).map(f), ...stats(valid.map((r) => r[key])).map(f)])), "");
  }
  return out.join("\n");
}

const args = process.argv.slice(2);
if (args[0] === "--budget") {
  const total = totalCost(loadRuns(args[1]));
  console.log(total.toFixed(6));
  process.exit(total > Number(args[2]) ? 3 : 0);
}
if (args.length !== 1) { console.error("usage: node summarize.mjs BATCH_DIR | --budget BATCH_DIR MAX_USD"); process.exit(2); }
const md = render(args[0], loadRuns(args[0]));
writeFileSync(join(args[0], "results.md"), `${md}\n`);
console.log(md);
