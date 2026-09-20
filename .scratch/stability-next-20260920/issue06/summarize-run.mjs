// Summarize one strict-run-* directory produced by run-strict-terminal-proposed.sh
// into result.json: launcher exit, parent/child threads, actual model/effort/sandbox,
// event-time attribution, verdict, residue and runtime tmp paths.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
const runDir = path.resolve(process.argv[2]);
const read = (f) => fs.readFileSync(path.join(runDir, f), "utf8");
const parse = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const sessionsRoot = "/home/tcuni-claw/.codex/sessions";
const sessionDirs = fs.readdirSync(sessionsRoot, { withFileTypes: true })
  .filter((year) => year.isDirectory())
  .flatMap((year) => {
    const yearPath = path.join(sessionsRoot, year.name);
    return fs.readdirSync(yearPath, { withFileTypes: true })
      .filter((month) => month.isDirectory())
      .flatMap((month) => {
        const monthPath = path.join(yearPath, month.name);
        return fs.readdirSync(monthPath, { withFileTypes: true })
          .filter((day) => day.isDirectory())
          .map((day) => path.join(monthPath, day.name));
      });
  });
const rolloutFor = (id) => sessionDirs.flatMap((dir) => fs.readdirSync(dir).filter((f) => f.endsWith(`${id}.jsonl`)).map((f) => path.join(dir, f)))[0];
const events = parse(path.join(runDir, "events.jsonl"));
const parentThread = events[0].thread_id;
const parentRollout = rolloutFor(parentThread);
const p = parse(parentRollout);
const ctx = (rows) => { const t = rows.find((o) => o.type === "turn_context"); return t ? { model: t.payload.model, effort: t.payload.effort, sandbox: t.payload.sandbox_policy?.type } : null; };
const started = p.find((o) => o.type === "session_meta").timestamp;
const spawn = p.find((o) => o.type === "response_item" && o.payload.type === "function_call" && o.payload.name === "spawn_agent");
const childStartItem = p.find((o) => o.type === "event_msg" && o.payload.type === "item_completed" && o.payload.item?.type === "SubAgentActivity" && o.payload.item.kind === "started");
const childThread = childStartItem?.payload.item.agent_thread_id ?? null;
const childRollout = childThread ? rolloutFor(childThread) : null;
const c = childRollout ? parse(childRollout) : [];
const childComplete = c.find((o) => o.type === "event_msg" && o.payload.type === "task_complete");
const childFinalMsg = [...c].reverse().find((o) => o.type === "response_item" && o.payload.type === "message" && o.payload.role === "assistant");
const childCalls = c.filter((o) => o.type === "response_item" && ["custom_tool_call", "function_call"].includes(o.payload.type)).length;
const parentFinal = [...p].reverse().find((o) => o.type === "event_msg" && o.payload.type === "task_complete");
const lastParent = p[p.length - 1].timestamp;
const lastChild = c.length ? c[c.length - 1].timestamp : null;
const sec = (a, b) => a && b ? Number(((new Date(b) - new Date(a)) / 1000).toFixed(1)) : null;
const mtime = (f) => fs.statSync(path.join(runDir, f)).mtime.toISOString();
const launchedAt = fs.existsSync(path.join(runDir, "launched-at.txt")) ? read("launched-at.txt").trim() : mtime("slot-status.txt");
const finishedAt = fs.existsSync(path.join(runDir, "finished-at.txt")) ? read("finished-at.txt").trim() : mtime("exit-code.txt");
// Residue = codex processes started after this launch whose cwd is this project (other projects' sessions are not ours).
const residue = execSync("for p in $(pgrep -x codex); do s=$(ps -o lstart= -p $p); c=$(readlink /proc/$p/cwd 2>/dev/null); [ \"$c\" = \"" + process.cwd() + "\" ] && [ \"$(date -d \"$s\" +%s)\" -ge \"$(date -d '" + launchedAt + "' +%s)\" ] && echo \"$p $s $c\"; done; true", { shell: "/bin/bash" }).toString().trim().split("\n").filter(Boolean);
const tmpPaths = execSync("find /project/tmp -maxdepth 1 -name 'planner-strict-*' -newermt '" + launchedAt + "' ! -newermt '" + finishedAt + "' 2>/dev/null; true", { shell: "/bin/bash" }).toString().trim().split("\n").filter(Boolean);
const verdict = childComplete && childFinalMsg ? (childFinalMsg.payload.content.map((x) => x.text || "").join("").split("\n")[0]) : null;
const out = {
  runDir, launcherExit: Number(read("exit-code.txt").trim()), launchedAt, finishedAt,
  slotQueueSeconds: sec(launchedAt, started),
  parent: { thread: parentThread, rollout: parentRollout, ...ctx(p), sessionStarted: started, spawnAt: spawn?.timestamp ?? null, preDelegationSeconds: sec(started, spawn?.timestamp), taskComplete: parentFinal?.timestamp ?? null, lastRecord: lastParent },
  child: childThread ? { thread: childThread, rollout: childRollout, ...ctx(c), startedAt: childStartItem.timestamp, toolCalls: childCalls, taskComplete: childComplete?.timestamp ?? null, lastRecord: lastChild, elapsedSeconds: sec(childStartItem.timestamp, childComplete?.timestamp ?? lastChild), verdictFirstLine: verdict } : null,
  externalTimeoutSeconds: Number(process.env.REVIEW_READONLY_TIMEOUT || 600),
  gateComplete: Boolean(parentFinal && childComplete && Number(read("exit-code.txt").trim()) === 0),
  residueCodexProcessesStartedAfterLaunch: residue,
  runtimeTmpPaths: tmpPaths,
  recordedAtUtc: new Date().toISOString(),
};
fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out, null, 1));
