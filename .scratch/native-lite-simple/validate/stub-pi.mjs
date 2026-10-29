#!/usr/bin/env node
// Offline stand-in for pi, used only to validate the harness. STUB_BEHAVIOR = happy | timeout | wrongmode | queued
// Session entries carry timestamps at fixed offsets from the stub's start so every timing metric is predictable.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("stub-pi 0.0.0"); process.exit(0); }
const sd = args.includes("--session-dir") ? args[args.indexOf("--session-dir") + 1] : null;
if (!sd) { console.error("stub-pi: no --session-dir"); process.exit(2); }
const behavior = process.env.STUB_BEHAVIOR ?? "happy";

if (behavior === "timeout") {
  spawn("setsid", ["sleep", "300"], { stdio: "ignore" });
  spawn("sleep", ["300"], { stdio: "ignore" });
  setInterval(() => {}, 1000);
} else {
  const lite = process.env.PI_PLANNER_ONLY_MODE === "lite";
  let mode = process.env.PI_PLANNER_ONLY_MODE ?? "unset";
  if (behavior === "wrongmode") mode = mode === "native" ? "lite" : "native";
  const base = Date.now();
  const at = (s) => new Date(base + s * 1000).toISOString();
  const usage = (input, output, cacheRead, cacheWrite, cost) => ({ input, output, cacheRead, cacheWrite, totalTokens: input + output + cacheRead + cacheWrite, cost: { total: cost } });
  const call = (id, name, a) => ({ type: "toolCall", id, name, arguments: a });
  const asst = (id, parentId, s, content, u) => ({ type: "message", id, parentId, timestamp: at(s), message: { role: "assistant", content, usage: u } });
  const result = (id, parentId, s, toolCallId, toolName, details) => ({ type: "message", id, parentId, timestamp: at(s),
    message: { role: "toolResult", toolCallId, toolName, content: [{ type: "text", text: "ok" }], details, isError: false } });
  const rootFile = join(sd, "2026-01-01T00-00-00-000Z_stub.jsonl");
  const childFile = join(sd, "..", "child-1", "run-0", "session.jsonl");
  const launch = lite ? call("t1", "delegate", { role: "worker", task: "implement" }) : call("t1", "subagent", { agent: "worker", task: "implement" });
  let R = [
    { type: "session", version: 3, id: "stub-root", timestamp: at(0), cwd: process.cwd() },
    { type: "custom", customType: "planner-only-mode", data: { mode }, id: "m1", parentId: null, timestamp: at(0) },
    { type: "message", id: "u1", parentId: "m1", timestamp: at(0.1), message: { role: "user", content: "task" } },
    asst("a1", "u1", 0.6, [call("t0", "bash", { command: "ls" })], usage(200, 50, 1500, 100, 0.005)),
    result("r0", "a1", 0.8, "t0", "bash"),
    asst("a2", "r0", 1.2, [launch, call("t2", "subagent", { action: "status", id: "child-1" }), call("t3", "edit", { path: "README.md" })], usage(1000, 100, 500, 0, 0.01)),
  ];
  if (lite) {
    R.push(result("r2", "a2", 1.25, "t2", "subagent"), result("r3", "r2", 1.3, "t3", "edit"),
      result("r1", "r3", 3.4, "t1", "delegate", { usage: { durationMs: 1700 } }), asst("a3", "r1", 4.0, [], usage(100, 20, 1900, 0, 0.003)));
  } else {
    R.push(result("r1", "a2", 1.3, "t1", "subagent", { asyncId: "child-1" }), result("r2", "r1", 1.35, "t2", "subagent"),
      result("r3", "r2", 1.4, "t3", "edit"), asst("a2b", "r3", 2.0, [], usage(50, 10, 1700, 0, 0.002)),
      { type: "custom_message", customType: "subagent-notify", content: "Background task completed", display: false,
        details: { runs: [{ runId: "child-1", sessionValue: childFile }] }, id: "n1", parentId: "a2b", timestamp: at(3.5) },
      asst("a3", "n1", 4.0, [], usage(100, 20, 1900, 0, 0.003)));
  }
  let C = [
    { type: "session", version: 3, id: "stub-child", timestamp: at(1.5), cwd: process.cwd(), parentSession: rootFile },
    { type: "message", id: "cu", parentId: null, timestamp: at(1.5), message: { role: "user", content: "implement" } },
    asst("c1", "cu", 2.5, [call("ct", "bash", { command: "npm test" })], usage(300, 30, 0, 0, 0.002)),
    result("cr", "c1", 2.7, "ct", "bash"),
    asst("c2", "cr", 3.2, [], usage(100, 10, 200, 0, 0.001)),
  ];
  if (behavior === "queued") {
    // One message issues delegate then bash; the bash result lands 0.1 s after the 2 s child's delegate result.
    R = [R[0], R[1], R[2],
      asst("a1", "u1", 0.5, [call("t1", "delegate", { role: "worker", task: "implement" }), call("t2", "bash", { command: "npm test" })], usage(500, 50, 0, 0, 0.004)),
      result("r1", "a1", 2.9, "t1", "delegate", { usage: { durationMs: 2000 } }), result("r2", "r1", 3.0, "t2", "bash"),
      asst("a2", "r2", 3.5, [], usage(100, 10, 600, 0, 0.002))];
    C = [{ ...C[0], timestamp: at(0.7) }, { ...C[1], timestamp: at(0.7) },
      asst("c1", "cu", 1.7, [call("ct", "bash", { command: "npm test" })], usage(300, 30, 0, 0, 0.002)),
      result("cr", "c1", 1.9, "ct", "bash"), asst("c2", "cr", 2.7, [], usage(100, 10, 200, 0, 0.001))];
  }
  await new Promise((r) => setTimeout(r, Math.max(0, base + 4200 - Date.now())));
  const jsonl = (xs) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";
  writeFileSync(rootFile, jsonl(R));
  // Copies of the child session that must not be double counted.
  for (const f of [childFile, join(sd, "subagent-artifacts", "child-1_transcript.jsonl"), join(sd, "..", "tmp", "dup", "session.jsonl")]) {
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, jsonl(C));
  }
  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", usage: { input: 1, output: 1, cost: { total: 99 } } } }));
  cpSync(join(dirname(fileURLToPath(import.meta.url)), "..", "reference"), process.cwd(), { recursive: true });
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "implement timesheet"]);
}
