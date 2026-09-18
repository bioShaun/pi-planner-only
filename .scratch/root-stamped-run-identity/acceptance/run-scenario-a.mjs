import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const REPO_DIR = "/home/tcuni-claw/pi/pi-planner-only";
const ACCEPT_BASE = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/acceptance");
const AGENT_DIR = path.join(ACCEPT_BASE, "agent-a");
const WORKSPACE_DIR = path.join(ACCEPT_BASE, "workspace-a");
const TMP_DIR = path.join(ACCEPT_BASE, "tmp-a");
const EVIDENCE_DIR = path.join(REPO_DIR, ".scratch/root-stamped-run-identity/evidence/A");

fs.rmSync(AGENT_DIR, { recursive: true, force: true });
fs.rmSync(WORKSPACE_DIR, { recursive: true, force: true });
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(AGENT_DIR, { recursive: true });
fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

// 1. Prepare non-Git workspace with fixture.txt
fs.writeFileSync(
  path.join(WORKSPACE_DIR, "fixture.txt"),
  "The quick brown fox jumps over the lazy dog today.\n",
  "utf8"
);

// 2. Prepare agent directory with models & settings
const sourceModels = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".pi/agent/models.json"), "utf8"));
const selectedProviders = {};
for (const p of ["tcuni-luna", "qwen-local"]) {
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

const prompt = "Read fixture.txt in the current workspace and report its word count. Make no changes.";

console.log("=== Launching Scenario A in slot cpu ===");
const stdoutFile = path.join(ACCEPT_BASE, "scenario-a-stdout.jsonl");
const stderrFile = path.join(ACCEPT_BASE, "scenario-a-stderr.txt");

const runResult = spawnSync(
  "slot",
  [
    "cpu",
    "-L",
    "scenario-a-acceptance",
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
    "tcuni-luna",
    "--model",
    "gpt-5.6-luna",
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
  if (ledgerData.task?.executions?.[0]) {
    console.log("Execution runId:", ledgerData.task.executions[0].runId);
    console.log("Execution unacceptedReport:", ledgerData.task.executions[0].unacceptedReport ? "YES" : "NO");
  }
}
