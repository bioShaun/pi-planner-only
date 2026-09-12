#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  T004_REPAIR_TASK_ID,
  repairT004LedgerSnapshot,
  repairT004UsageRecords,
} from "../usage.ts";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const agentDir = resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
const usagePath = resolve(option("--usage", join(agentDir, "planner-only", "usage.jsonl")));
const ledgerPath = resolve(option("--ledger", join(agentDir, "planner-only", "ledger", `${T004_REPAIR_TASK_ID}.json`)));
const dryRun = process.argv.includes("--dry-run");

function atomicWrite(path, body) {
  const temporary = `${path}.repair-${process.pid}`;
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temporary, body, "utf8");
    renameSync(temporary, path);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no temporary file */ }
    throw error;
  }
}

function readUsageRecords(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid JSON in ${path} at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function auditRecordsForMoved(moved) {
  return moved.map((item) => ({
    root: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, tokensUnknownTurns: 0, byPhase: {
      planning: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 },
      executing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 },
      reviewing: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 },
    }, reviewLeakBytes: 0, injectedBytes: 0 },
    children: [item.child],
    costUnknown: item.child.costUsd === undefined,
    taskId: "unattributed",
    unattributed: true,
    sourceTaskId: T004_REPAIR_TASK_ID,
    sessionHint: item.sessionHint,
  }));
}

const originalUsage = readUsageRecords(usagePath);
const usageRepair = repairT004UsageRecords(originalUsage);
let repairedUsage = usageRepair.records;
let ledgerRepair = { snapshot: undefined, moved: [], removedFromTask: 0 };
if (existsSync(ledgerPath)) {
  const raw = JSON.parse(readFileSync(ledgerPath, "utf8"));
  ledgerRepair = repairT004LedgerSnapshot(raw);
  const seen = new Set(usageRepair.moved.map((item) => item.runId).filter(Boolean));
  const ledgerOnly = ledgerRepair.moved.filter((item) => !seen.has(item.runId));
  repairedUsage = [...repairedUsage, ...auditRecordsForMoved(ledgerOnly)];
}

const movedRunIds = new Set();
for (const record of repairedUsage) {
  if (record && typeof record === "object" && record.taskId === "unattributed" && Array.isArray(record.children)) {
    for (const child of record.children) {
      if (child && typeof child === "object" && typeof child.runId === "string") movedRunIds.add(child.runId);
    }
  }
}
const summary = {
  taskId: T004_REPAIR_TASK_ID,
  moved: movedRunIds.size,
  removedFromUsage: usageRepair.removedFromTask,
  removedFromLedger: ledgerRepair.removedFromTask,
  usagePath,
  ledgerPath,
  dryRun,
};

if (!dryRun) {
  if (existsSync(usagePath) || repairedUsage.length > originalUsage.length) {
    atomicWrite(usagePath, repairedUsage.map((record) => JSON.stringify(record)).join("\n") + (repairedUsage.length ? "\n" : ""));
  }
  if (ledgerRepair.snapshot !== undefined && ledgerRepair.removedFromTask > 0) {
    atomicWrite(ledgerPath, `${JSON.stringify(ledgerRepair.snapshot)}\n`);
  }
}

process.stdout.write(`${JSON.stringify(summary)}\n`);
