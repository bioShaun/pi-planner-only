#!/usr/bin/env node
// Usage: node score.mjs RUN_DIR            -> writes RUN_DIR/run.json
//        node score.mjs --usage-only DIR|ROOT.jsonl [WALL_SEC] -> prints usage and timing
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classifyCall, collectTiming } from "./timing.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
// subagent-artifacts holds transcript copies of child sessions; counting them would double count.
const SKIP_DIRS = new Set(["repo", "score-tree", "ref-tree", "subagent-artifacts", ".git", "node_modules"]);
const EDIT_TOOLS = ["edit", "write", "apply_patch"];
const num = (v) => (Number.isFinite(v) ? v : 0);
const readJsonl = (p) => readFileSync(p, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const emptyUsage = () => ({ entries: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 });
const contextOf = (u) => num(u.input) + num(u.cacheRead) + num(u.cacheWrite);

function sessionFiles(dir, top = dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) sessionFiles(p, top, out); continue; }
    if (!ent.isFile() || !ent.name.endsWith(".jsonl") || (dir === top && ent.name === "stdout.jsonl")) continue;
    try { if (JSON.parse(readFileSync(p, "utf8").split("\n", 1)[0]).type === "session") out.push(p); } catch {}
  }
  return out;
}

function addUsage(acc, u) {
  acc.entries++;
  for (const k of ["input", "output", "cacheRead", "cacheWrite"]) acc[k] += num(u[k]);
  acc.totalTokens += num(u.totalTokens) || contextOf(u) + num(u.output);
  acc.cost += num(u.cost?.total);
}

// DIR may also be one Root session file; its children live in the sibling directory named after it.
export function collectUsage(dir, wallSec) {
  const p = resolve(dir), childDir = p.slice(0, -".jsonl".length);
  const files = p.endsWith(".jsonl") ? [p, ...(existsSync(childDir) ? sessionFiles(childDir) : [])] : sessionFiles(p);
  const sessions = files.sort().map((file) => ({ file, lines: readJsonl(file) }));
  const modeEntries = (s) => s.lines.filter((o) => o.type === "custom" && o.customType === "planner-only-mode");
  let roots = sessions.filter((s) => modeEntries(s).length);
  if (roots.length > 1 && roots.some((s) => !s.lines[0].parentSession)) roots = roots.filter((s) => !s.lines[0].parentSession);
  const root = roots[0] ?? null;
  // Native completion notices record each child's session file; read any that landed outside DIR.
  const external = [];
  for (const o of root?.lines ?? []) {
    if (o.type !== "custom_message" || o.customType !== "subagent-notify") continue;
    for (const run of o.details?.runs ?? []) {
      const f = typeof run.sessionValue === "string" ? resolve(run.sessionValue) : null;
      if (f?.endsWith(".jsonl") && existsSync(f) && !sessions.some((s) => s.file === f)) { sessions.push({ file: f, lines: readJsonl(f) }); external.push(f); }
    }
  }
  const seen = new Set();
  const r = { rootFile: root?.file ?? null, rootCandidates: roots.length, modes: root ? modeEntries(root).map((o) => o.data?.mode) : [],
    root: emptyUsage(), child: emptyUsage(), childFiles: [], toolCalls: {}, launches: 0, managementCalls: 0,
    peakContext: 0, finalContext: 0, duplicatesSkipped: 0, externalChildFiles: external };
  for (const s of sessions) {
    const isRoot = s === root;
    let n = 0;
    s.lines.forEach((o, i) => {
      const u = o.message?.usage;
      if (o.type !== "message" || o.message.role !== "assistant" || !u) return;
      // Entry ids are short random hex; pairing with the timestamp avoids merging distinct entries.
      const key = o.id ? `${o.id}|${o.timestamp ?? ""}` : `${s.file}:${i}`;
      if (seen.has(key)) { r.duplicatesSkipped++; return; }
      seen.add(key); n++;
      addUsage(isRoot ? r.root : r.child, u);
      if (!isRoot) return;
      r.peakContext = Math.max(r.peakContext, contextOf(u));
      r.finalContext = contextOf(u);
      for (const p of o.message.content ?? []) {
        if (p?.type !== "toolCall") continue;
        r.toolCalls[p.name] = (r.toolCalls[p.name] ?? 0) + 1;
        const kind = classifyCall(p);
        if (kind === "launch") r.launches++;
        else if (kind === "mgmt") r.managementCalls++;
      }
    });
    if (!isRoot && n) r.childFiles.push(s.file);
  }
  r.total = { cost: r.root.cost + r.child.cost, totalTokens: r.root.totalTokens + r.child.totalTokens };
  r.rootShare = r.total.cost > 0 ? r.root.cost / r.total.cost : null;
  r.rootEdits = EDIT_TOOLS.reduce((a, k) => a + (r.toolCalls[k] ?? 0), 0);
  r.rootBash = r.toolCalls.bash ?? 0;
  r.childUsage = r.child.entries ? "ok" : r.launches > 0 ? "missing" : "none";
  r.timing = collectTiming({ root, children: sessions.filter((s) => r.childFiles.includes(s.file)), wallSec });
  return r;
}

function runTests(tree, sub) {
  const files = existsSync(join(tree, sub)) ? readdirSync(join(tree, sub)).filter((f) => f.endsWith(".test.mjs")).sort().map((f) => join(sub, f)) : [];
  const args = sub ? ["--test", "--test-reporter=tap", ...files] : ["--test", "--test-reporter=tap"];
  if (sub && !files.length) return { pass: 0, fail: 0, total: 0, exitCode: null, note: "no test files" };
  const r = spawnSync(process.execPath, args, { cwd: tree, encoding: "utf8", timeout: 120_000, killSignal: "SIGKILL" });
  const count = (k) => Number((r.stdout ?? "").match(new RegExp(`^# ${k} (\\d+)$`, "m"))?.[1] ?? 0);
  return { pass: count("pass"), fail: count("fail") + count("cancelled"), total: count("tests"), exitCode: r.status, timedOut: r.error?.code === "ETIMEDOUT" };
}

function copyTree(src, dest, overlay) {
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, filter: (p) => !p.endsWith("/.git") });
  if (overlay) cpSync(overlay, dest, { recursive: true });
}

const git = (cwd, ...args) => spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });

export function scoreRun(runDir) {
  const run = resolve(runDir);
  const meta = existsSync(join(run, "meta.json")) ? JSON.parse(readFileSync(join(run, "meta.json"), "utf8")) : {};
  const usage = collectUsage(run, Number.isFinite(meta.wallclockSec) ? meta.wallclockSec : undefined);
  const modeOk = usage.modes.length > 0 && usage.modes.every((m) => m === meta.mode);
  let tests = null, gitInfo = null;
  if (existsSync(join(run, "repo"))) {
    const tree = join(run, "score-tree"), ref = join(run, "ref-tree");
    copyTree(join(run, "repo"), tree);
    const visible = runTests(tree, "");
    cpSync(join(HERE, "hidden-tests"), join(tree, "test-hidden"), { recursive: true });
    const hidden = runTests(tree, "test-hidden");
    copyTree(join(HERE, "fixture"), ref, join(HERE, "reference"));
    cpSync(join(HERE, "hidden-tests"), join(ref, "test-hidden"), { recursive: true });
    const refHidden = runTests(ref, "test-hidden");
    tests = { visible, hidden, hiddenExpected: refHidden.total, referenceHiddenOk: refHidden.fail === 0 && refHidden.pass === refHidden.total };
    const count = Number(git(join(run, "repo"), "rev-list", "--count", "HEAD").stdout.trim());
    gitInfo = { commitsAfterInitial: Number.isFinite(count) ? count - 1 : null, dirty: git(join(run, "repo"), "status", "--porcelain").stdout.trim() !== "" };
  }
  const flags = [];
  if (!modeOk) flags.push(`mode:${usage.modes.join(",") || "none"}`);
  if (meta.timedOut) flags.push("timeout");
  if (usage.childUsage === "missing") flags.push("child-usage-missing");
  if (usage.rootCandidates !== 1) flags.push(`root-candidates:${usage.rootCandidates}`);
  if (usage.launches > usage.childFiles.length) flags.push("fewer-child-sessions-than-launches");
  if (tests && !tests.referenceHiddenOk) flags.push("reference-hidden-failed");
  if (usage.externalChildFiles.length) flags.push("child-outside-run");
  for (const f of usage.timing.flags ?? []) flags.push(`time:${f}`);
  const hiddenFull = !!tests && tests.hidden.total === tests.hiddenExpected && tests.hidden.fail === 0 && tests.hidden.pass === tests.hiddenExpected;
  if (!hiddenFull) flags.push("hidden-not-full");
  if (!(gitInfo?.commitsAfterInitial >= 1)) flags.push("no-commit");
  const valid = modeOk && !meta.timedOut && usage.childUsage !== "missing" && hiddenFull && gitInfo?.commitsAfterInitial >= 1;
  return { meta, modeRecorded: usage.modes.join(",") || null, modeOk, usage, tests, git: gitInfo, hiddenFull, valid, flags };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--usage-only") console.log(JSON.stringify(collectUsage(args[1], args[2] ? Number(args[2]) : undefined), null, 2));
  else if (args.length === 1) {
    const result = scoreRun(args[0]);
    writeFileSync(join(args[0], "run.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`score: ${result.meta.mode}-${result.meta.rep} valid=${result.valid} total$=${result.usage.total.cost.toFixed(4)} flags=${result.flags.join(" ") || "-"}`);
  } else { console.error("usage: node score.mjs RUN_DIR | --usage-only DIR"); process.exit(2); }
}
