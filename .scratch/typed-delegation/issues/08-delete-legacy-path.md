# 08: delete-legacy-path

Status: needs-triage（到达时由 Devin 展开为完整票面）
Blocked by: 05, 06
Type: task

**Scope（一段话）：** 按 spec.md 去向表删除旧路径：`notify.ts` / `completion.ts` / `reservations.ts` / `acceptance-claims.ts` 整文件；`orchestrate.ts` 的 `beginDelegation*` / `prepareRoleDelegation` / `handleSubagentResult` / `handleAsyncNotify` / 收据与恢复方法；`task.ts` / `report.ts` / `roles.ts` / `review.ts` 的文本解析函数；`index.ts` 的 subagent 拦截分支与 `planner_recover`；对应测试文件与 `architecture.test.mjs` 断言更新；`package.json` `files` / `test` 同步。验收含 LOC 前后对比（基线：源码 21,813 行）与「全仓 grep 无 `JSON.parse` 作用于 prompt/输出文本」。

**Acceptance：** 到达时定；固定一条：`grep` 证明本票没有新增任何对 prompt / 子进程输出文本的解析。
