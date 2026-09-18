import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const REPO_DIR = "/home/tcuni-claw/pi/pi-planner-only";
const ACCEPT_BASE = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/acceptance");
const AGENT_DIR = path.join(ACCEPT_BASE, "agent-c");
const WORKSPACE_DIR = path.join(ACCEPT_BASE, "workspace-c");
const TMP_DIR = path.join(ACCEPT_BASE, "tmp-c");
const EVIDENCE_DIR = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/evidence/C");

fs.rmSync(AGENT_DIR, { recursive: true, force: true });
fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// Copy agent-b and workspace-b baseline state to c
const AGENT_B = path.join(ACCEPT_BASE, "agent-b");
const WORKSPACE_B = path.join(ACCEPT_BASE, "workspace-b");
fs.cpSync(AGENT_B, AGENT_DIR, { recursive: true });
fs.cpSync(WORKSPACE_B, WORKSPACE_DIR, { recursive: true });

const env = {
  ...process.env,
  PI_CODING_AGENT_DIR: AGENT_DIR,
  TMPDIR: TMP_DIR,
  TMP: TMP_DIR,
  TEMP: TMP_DIR,
  PI_PLANNER_ONLY_SEED_PRICING: "0",
  PI_PLANNER_ONLY_QUIESCENCE_MS: "0",
};
delete env.PI_SUBAGENT_CHILD;

const prompt = "Call planner_verdict with taskId='T-99999999-001', verdict='pass', summary='Testing unknown taskId rejection'.";

console.log("=== Launching Scenario C in slot cpu ===");
const stdoutFile = path.join(ACCEPT_BASE, "scenario-c-stdout.jsonl");
const stderrFile = path.join(ACCEPT_BASE, "scenario-c-stderr.txt");

const runResult = spawnSync(
  "slot",
  [
    "cpu",
    "-L",
    "scenario-c-acceptance",
    "--",
    "pi",
    "-p",
    "--mode",
    "json",
    "--no-extensions",
    "-e",
    path.join(os.homedir(), ".pi/agent/npm/node_modules/pi-subagents/index.ts"),
    "-e",
    path.join(REPO_DIR, "index.ts"),
    "--provider",
    "qwen-local",
    "--model",
    "qwen3.8-27b",
    prompt,
  ],
  {
    cwd: WORKSPACE_DIR,
    env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }
);

fs.writeFileSync(stdoutFile, runResult.stdout || "");
fs.writeFileSync(stderrFile, runResult.stderr || "");
console.log(`Pi exited with code: ${runResult.status}`);

// 1. ledger.json: copy from agent-c ledger
const ledgerSrc = path.join(AGENT_DIR, "planner-only/ledger/T-20260918-001.json");
if (fs.existsSync(ledgerSrc)) {
  fs.copyFileSync(ledgerSrc, path.join(EVIDENCE_DIR, "ledger.json"));
}

// 2. Parse session file and generate session-head.txt & toolcalls.json
const SESSIONS_DIR = path.join(AGENT_DIR, "sessions/--home-tcuni-claw-pi-pi-planner-only-.scratch-root-stamped-run-identity-acceptance-workspace-c--");
let sessionFiles = [];
if (fs.existsSync(SESSIONS_DIR)) {
  sessionFiles = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl") && !f.includes("worker")).sort();
}
// Latest session is Scenario C
const latestSession = sessionFiles.length > 0 ? sessionFiles[sessionFiles.length - 1] : null;

if (latestSession) {
  const sessionFullPath = path.join(SESSIONS_DIR, latestSession);
  const sessionRel = path.relative(REPO_DIR, sessionFullPath);
  const content = fs.readFileSync(sessionFullPath);
  const sha256 = crypto.createHash("sha256").update(content).digest("hex");
  const lines = content.toString("utf8").trim().split("\n");
  const headText = `Session path: ${sessionRel}\nSHA-256: ${sha256}\nSize: ${content.length} bytes\nLines: ${lines.length}\n`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, "session-head.txt"), headText, "utf8");

  const toolCalls = [];
  const startMap = new Map();
  for (const l of lines) {
    try {
      const ev = JSON.parse(l);
      if (ev.type === "tool_execution_start") {
        startMap.set(ev.toolCallId, {
          toolCallId: ev.toolCallId,
          toolName: ev.toolName,
          args: ev.args,
        });
      } else if (ev.type === "tool_execution_end") {
        const start = startMap.get(ev.toolCallId) || { toolCallId: ev.toolCallId, toolName: ev.toolName };
        toolCalls.push({
          ...start,
          result: ev.result,
          isError: Boolean(ev.isError),
        });
      } else if (ev.type === "message") {
        if (ev.message?.role === "assistant") {
          for (const c of ev.message.content || []) {
            if (c.type === "toolCall") {
              startMap.set(c.id, {
                toolCallId: c.id,
                toolName: c.name,
                args: c.arguments,
              });
            }
          }
        } else if (ev.message?.role === "toolResult") {
          const start = startMap.get(ev.message.toolCallId) || { toolCallId: ev.message.toolCallId, toolName: ev.message.toolName };
          toolCalls.push({
            ...start,
            result: { content: ev.message.content, details: ev.message.details },
            isError: Boolean(ev.message.isError),
          });
        }
      }
    } catch(e) {}
  }
  fs.writeFileSync(path.join(EVIDENCE_DIR, "toolcalls.json"), JSON.stringify(toolCalls, null, 2) + "\n", "utf8");
}

// 3. meta.json for Scenario C
const meta = {
  scenario: "C",
  targetTaskId: "T-99999999-001",
  expectedRefusal: "TASK_UNKNOWN / unknown task",
  testedOn: "live host",
  provider: "qwen-local",
  model: "qwen3.8-27b",
  timestamp: Date.now(),
};
fs.writeFileSync(path.join(EVIDENCE_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

console.log("Scenario C executed and evidence saved successfully!");
