# 07: progress-and-cancel

Status: needs-triage（到达时由 Devin 展开为完整票面）
Blocked by: 04
Type: task

**Scope（一段话）：** 进度与取消：`createHostLauncher` 订阅 `SUBAGENT_DELEGATION_UPDATE_EVENT`，把 `recentOutput` / `toolCount` / `durationMs` 经 execute 的 `onUpdate` 回调推给宿主 UI；abort → CANCEL 事件；宿主 TUI 下按 Esc 验证子进程被终止、Task 进 blocked、无孤儿进程（票 03 的 `-p` 模式孤儿问题记入 README 限制）。

**Acceptance：** 到达时定；固定一条：`grep` 证明本票没有新增任何对 prompt / 子进程输出文本的解析。
