import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const REPO_DIR = "/home/tcuni-claw/pi/pi-planner-only";
const ACCEPT_BASE = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/acceptance");
const AGENT_DIR = path.join(ACCEPT_BASE, "agent-b");
const WORKSPACE_DIR = path.join(ACCEPT_BASE, "workspace-b");
const TMP_DIR = path.join(ACCEPT_BASE, "tmp-b");
const EVIDENCE_DIR = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/evidence/B");

fs.rmSync(AGENT_DIR, { recursive: true, force: true });
fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// 1. Prepare Git workspace with initial commit
execSync("git init -q", { cwd: WORKSPACE_DIR });
execSync("git config user.name 'acceptance-runner'", { cwd: WORKSPACE_DIR });
execSync("git config user.email 'acceptance-runner@invalid'", { cwd: WORKSPACE_DIR });
fs.writeFileSync(path.join(WORKSPACE_DIR, "hello.txt"), "hello\n", "utf8");
execSync("git add hello.txt && git commit -q -m 'initial commit'", { cwd: WORKSPACE_DIR });

// 2. Prepare agent directory with models & settings
const sourceModels = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi/agent/models.json"), "utf8"));
const selectedProviders = {};
for (const p of ["tcuni-agy", "tcuni-luna", "qwen-local"]) {
  if (sourceModels.providers?.[p]) {
    selectedProviders[p] = sourceModels.providers[p];
  }
}
fs.writeFileSync(path.join(AGENT_DIR, "models.json"), JSON.stringify({ providers: selectedProviders }, null, 2) + "\n");
fs.writeFileSync(path.join(AGENT_DIR, "models-store.json"), "{}\n");
fs.writeFileSync(path.join(AGENT_DIR, "auth.json"), "{}\n");
fs.writeFileSync(
  path.join(AGENT_DIR, "settings.json"),
  JSON.stringify(
    {
      subagents: {
        agentOverrides: {
          scout: {
            model: "qwen-local/qwen3.8-27b",
            thinking: "low",
          },
          worker: {
            model: "tcuni-luna/gpt-5.6-luna",
          },
        },
      },
    },
    null,
    2
  ) + "\n"
);

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

const prompt =
  "Execute these exact steps in order:\n" +
  "1. Call planner_delegate with role='worker', objective='Change hello.txt to contain exactly the line hi', validation={required:true, commands:['cat hello.txt']}, envelope={maxTokens:50000, maxWallMs:180000}.\n" +
  "2. When round 1 completes, call planner_verdict with taskId, verdict='request_changes', summary='Need trailing newline'.\n" +
  "3. Call planner_redelegate with taskId, role='worker', objective='Ensure hello.txt contains hi with trailing newline', instructions='Add trailing newline to hello.txt', validation={required:true, commands:['cat hello.txt']}.\n" +
  "CRITICAL RULE: In step 3, you MUST NOT include the 'recovery' argument in your tool call. The 'recovery' argument is ONLY for blocked tasks; passing 'recovery' on changes_requested will be immediately refused with RECOVERY_NOT_APPLICABLE. Your tool call arguments object must only have: { taskId, role, objective, instructions, validation }.\n" +
  "4. When round 2 completes, call planner_verdict with taskId, verdict='pass', summary='All verified'.";

console.log("=== Launching Scenario B in slot cpu ===");
const stdoutFile = path.join(ACCEPT_BASE, "scenario-b-stdout.jsonl");
const stderrFile = path.join(ACCEPT_BASE, "scenario-b-stderr.txt");

const runResult = spawnSync(
  "slot",
  [
    "cpu",
    "-L",
    "scenario-b-acceptance",
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

// Process and verify results
const ledgerDir = path.join(AGENT_DIR, "planner-only/ledger");
const ledgerFiles = fs.existsSync(ledgerDir) ? fs.readdirSync(ledgerDir).filter(f => f.endsWith(".json")) : [];
console.log("Ledger files captured:", ledgerFiles);

let ledgerData = null;
if (ledgerFiles.length > 0) {
  ledgerData = JSON.parse(fs.readFileSync(path.join(ledgerDir, ledgerFiles[0]), "utf8"));
  console.log("Ledger task state:", ledgerData.task?.state);
  console.log("Reports count:", ledgerData.task?.reports?.length);
  console.log("Executions count:", ledgerData.task?.executions?.length);
  if (ledgerData.task?.reports) {
    console.log("Report workerRunIds:", ledgerData.task.reports.map(r => r.evidence?.workerRunId));
  }
  if (ledgerData.task?.executions) {
    console.log("Execution runIds:", ledgerData.task.executions.map(e => e.runId));
  }
}
