# 10: host-acceptance

Status: needs-triage（到达时由 Devin 展开为完整票面）
Blocked by: 07, 08
Type: task

**Scope（一段话）：** 宿主端到端验收：在真实仓库上用新路径跑完一个 Task 的完整生命周期——`planner_delegate`(worker) → evidence 比对 → `planner_delegate`(reviewer) → `planner_verdict` → `git_commit`；采集 jsonl、ledger 前后、usage；同时观察票 03 记下的 worker 过度验证（28 tool call 建 hello.txt）是否与 packet 文本有关。更新 README / README.zh-CN / CONTEXT.md（Delegation 词条去掉「packet」措辞、加 Verdict 流程）。

**Acceptance：** 到达时定；固定一条：`grep` 证明本票没有新增任何对 prompt / 子进程输出文本的解析。

**04 复核承接项（2026-09-15）：** 宿主验收须断言 `planner_delegate` 落账的 usage 行 `ownerRootSessionId` 等于 ledger provenance 的 sessionId（新链直接写 `deps.ownerRunId`，其回退值为进程级随机 UUID；旧链走 `bindOwnedChild` 取 provenance）。
