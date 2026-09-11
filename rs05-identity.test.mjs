import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { PlannerOrchestrator } from "./orchestrate.ts";
import { RunRecordStore } from "./completion.ts";
import { TaskIdAllocator, TaskIdentityError, TaskStore, createTaskId, createTaskSpec } from "./task.ts";

const gitRunner = async () => ({ stdout: "", stderr: "", code: 0 });

function allocateInChild(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", [
      'import { TaskIdAllocator } from "./task.ts";',
      'process.stdout.write(new TaskIdAllocator(process.env.RS05_ROOT).allocate());',
    ].join(" ")], {
      cwd: process.cwd(),
      env: { ...process.env, RS05_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let error = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(`allocator child exited ${code}: ${error}`));
      else resolve(output.trim());
    });
  });
}

test("A05: concurrent child allocators persist unique claims and recover a stale lock", async () => {
  const root = mkdtempSync(join(process.cwd(), ".planner-only-rs05-process-"));
  try {
    const ids = await Promise.all(Array.from({ length: 8 }, () => allocateInChild(root)));
    assert.equal(new Set(ids).size, ids.length, "child processes receive unique ids");
    const claimsDir = join(root, "planner-only", "identity", "claims");
    assert.equal((await import("node:fs")).readdirSync(claimsDir).filter((name) => name.endsWith(".json")).length, ids.length);

    const lockPath = join(root, "planner-only", "identity", ".allocate.lock");
    mkdirSync(join(root, "planner-only", "identity"), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, acquiredAt: "1970-01-01T00:00:00.000Z" }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath, old, old);
    const recovered = new TaskIdAllocator(root, { staleMs: 10, acquireTimeoutMs: 500 }).allocate();
    assert.ok(recovered.startsWith("T-"));
    assert.equal(existsSync(lockPath), false, "stale lock is removed after allocation");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A05: corrupt snapshot occupies its id and is quarantined during recovery", () => {
  const root = mkdtempSync(join(process.cwd(), ".planner-only-rs05-corrupt-"));
  try {
    const occupied = createTaskId(new Date(), 1);
    const ledgerDir = join(root, "planner-only", "ledger");
    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(join(ledgerDir, `${occupied}.json`), "not json", "utf8");
    const allocator = new TaskIdAllocator(root);
    assert.notEqual(allocator.allocate(), occupied, "unparseable snapshot id is never reissued");

    const orch = new PlannerOrchestrator({ ledgerDir: root, gitRunner });
    const result = orch.restoreFromLedger();
    assert.ok(result.corrupt.some((item) => item.taskId === occupied));
    assert.match(orch.renderTaskStatus(orch.store.require(occupied)), /账本快照无法读取|余额不可信/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A05: continuation enforces workspace identity and completed ids remain occupied", () => {
  const root = mkdtempSync(join(process.cwd(), ".planner-only-rs05-identity-"));
  try {
    const allocator = new TaskIdAllocator(root);
    const store = new TaskStore({ allocator });
    const taskId = "T-20260911-901";
    const task = store.create(createTaskSpec({ objective: "identity regression", cwd: join(root, "workspace") }, taskId));
    store.transition(task.taskId, "executing");
    store.transition(task.taskId, "reviewing");
    store.transition(task.taskId, "completed");
    assert.equal(store.continueTask(taskId, join(root, "workspace")).taskId, taskId);
    assert.throws(() => store.continueTask(taskId, join(root, "other")), (error) => error?.code === "TASK_WORKSPACE_MISMATCH");
    assert.throws(() => store.createTask(createTaskSpec({ objective: "reuse", cwd: join(root, "workspace") }, taskId)), (error) => error instanceof TaskIdentityError && error.code === "TASK_ID_CONFLICT");
    assert.notEqual(allocator.allocate(), taskId, "allocator never reissues a completed Task id");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A05: recovery view distinguishes bound and cross-workspace identity conflicts", async () => {
  const root = mkdtempSync(join(process.cwd(), ".planner-only-rs05-recovery-"));
  try {
    const cwd = join(root, "workspace");
    const taskId = "T-20260911-902";
    const first = new PlannerOrchestrator({ ledgerDir: root, gitRunner });
    const task = first.store.create(createTaskSpec({ objective: "recovery identity", cwd }, taskId));
    first.store.beginExecution(taskId, {
      executionId: "execution-902",
      kind: "worker",
      runId: "run-902",
      cwd,
      worktreeRoots: [cwd],
      aRun: { cwd, taskId, workerRunId: "execution-902", gitAvailable: false, generatedAt: new Date(0).toISOString() },
    });
    const runs = new RunRecordStore(join(root, "planner-only", "run-state"));
    runs.put({
      version: 1,
      sessionId: "session-902",
      workspaceId: cwd,
      taskId,
      executionId: "execution-902",
      runId: "run-902",
      agent: "worker",
      role: "worker",
      executionState: "running",
      ingestionState: "waiting",
    });
    const restored = new PlannerOrchestrator({ ledgerDir: root, gitRunner });
    restored.restoreFromLedger();
    assert.equal(restored.getRecoveryView(cwd).find((item) => item.runId === "run-902")?.status, "bound");

    runs.put({
      version: 1,
      sessionId: "session-902",
      workspaceId: join(root, "other-workspace"),
      taskId,
      executionId: "execution-foreign",
      runId: "run-902",
      agent: "worker",
      role: "worker",
      executionState: "running",
      ingestionState: "waiting",
    });
    const conflicted = new PlannerOrchestrator({ ledgerDir: root, gitRunner });
    conflicted.restoreFromLedger();
    const view = conflicted.getRecoveryView(cwd);
    assert.ok(view.some((item) => item.status === "identity-conflict" && item.runId === "run-902"));
    const recovery = await conflicted.reingestOriginalReport("run-902", cwd, taskId);
    assert.equal(recovery.status, "identity-conflict");
    assert.equal(recovery.code, "RUN_IDENTITY_CONFLICT");
    assert.match(conflicted.renderTaskStatus(conflicted.store.require(taskId)), /Recovery binding: identity-conflict/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

console.log("planner-only A05 identity regression: PASS");
