# 0.8.0 验收后遗留项与测试套件卫生追踪

**Status:** ready-for-agent

来源：在 `root-stamped-run-identity` (0.8.0) 真实宿主验收及全量门禁交付后，识别出的两项非阻断但影响账本精确度与测试卫生的跟进项。

## Problem Statement

1. **`stateReason` 残留**：
   - 当任务遭遇 `worker_runaway` 或其它 blocked/failure 条件时，`TaskRecord.stateReason` 会被写入具体原因（如 `"worker runaway: tokens 17027 exceeded envelope 12000; delegation cancelled"`）。
   - 随后通过 `planner_redelegate.recovery` 成功重新派工并完成任务（进入 `reviewing` 或 `completed`）后，`stateReason` 未被清除，依然保留在账本及 `planner_tasks` 诊断输出中，造成“状态是 completed，但 stateReason 仍显示历史 runaway 熔断”的不一致。
2. **测试套件写系统 `/tmp`**：
   - 部分测试直接或间接依赖 `os.tmpdir()`，在默认 Linux 环境下指向 `/tmp`，与项目内隔离规范（不写系统 `/tmp`，统一使用仓库内部 scratch/临时目录）产生偏差，且在多人共享或 CI 容器中有命名冲突风险。

## Solution

1. **Issue 01**: 在 Task 状态转换（如通过 redelegate/recovery 重新进入 `executing`，或成功转为 `reviewing` / `completed`）时，清理历史残留的 `stateReason`（或者仅在 blocked/failed 状态下保留有效说明，而在成功推进时重置）。
2. **Issue 02**: 在 `package.json` 的 `test` 及 `test:release` 脚本中（或通过测试环境前置配置），为执行进程显式指定项目内的 `TMPDIR`（例如 `.scratch/test-tmp`，并在每次运行前清理/创建），确保测试套件完全不碰系统 `/tmp`。

## Issues

- `issues/01-clear-statereason-on-re-execution.md` (Status: ready-for-agent)
- `issues/02-project-local-tmpdir-for-test-suite.md` (Status: done)
