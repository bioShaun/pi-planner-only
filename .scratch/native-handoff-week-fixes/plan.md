# Native handoff findings, 2026-11-18

Baseline 3c66673. The local report docs/native-week-2026-11-18.md documents 23 stale-context notices across 5 sessions and 6 unknown-status admission refusals across 2 sessions. These are symptoms, not proof of the cause on the pinned 1.4.0 host or current 1.5.2 installation.

1. Reproduce the stale replacement path on the real host with offline model/fixtures, checking the post-newSession owner, async lifetime and retry. Fix the proven cause; preserve mode/model/known thinking level, the original brief, correct chain, and exactly-once user delivery. Distinguish an unsent brief from a failure after it was sent. Independent review before dependent work.
   - 已确认的复现：Pi 1.5.2 真实离线宿主中，新 Root 在收件后的同一轮发起下一次交接。外层 `sendUserMessage` 等到新轮及后续切换结束，随后访问已失效的目标上下文。在基线上，三份简报先各收到一次，末会话计数记录为 `[2, 0, 0]`；再运行一次手动 `handoff` 会重发第一份，累计 `[2, 1, 1]`。历史样例另经原文对照，不能把“未发送”通知计作实收失败。
2. Make Native activity failures actionable at both admission and delivery and enable checking current activity without composing/resubmitting a brief. Keep unknown fail-closed, existing two barriers and retention semantics. Do not automatically resend, retry indefinitely, create a persistent ledger or modify upstream. Test distinct failure causes and read-only status path.
3. Red/green targeted tests, independent review, then one release gate in detached final checkout; use the known isolated fixture fallback for local missing pi-ai. No deployment or push requested. Separate Rex delegation to pi-todo already accepted; no direct edits to that project.

## 执行结果

- 第 1 项：嵌套发送前完成目标上下文和交接链处理；已发送的简报不会因迟到的异常被回滚或进入重试。取消期间不增加链计数。独立复审通过；Pi 1.4.0 与 1.5.2 分别在真实离线宿主上通过普通交接、三次连续交接。
- 第 4 项：新增 `/planner-only handoff-status`，活动诊断区分超时、传输异常、失败回复和无效回复。准入、派发两道独立检查保持 fail-closed。51 项 Native 测试通过，独立审查通过；最后追加的两条测试断言另行通过靶向验证。
- 最终代码候选：`649837bfcc9f1f47c3b231590a6b1dfa5878268f`、tree `59d601220b10150a8107e653c512f73e40079756`。独立检出：`/project/tmp/ppo-native-week.rF2fIB4S/release-final`。早先两次在安装隔离依赖时被 `systemd-oomd` 终止（退出 255）；获准本地运行后，限时 55 秒的尝试通过类型检查和前半段测试，到时未跑完全套。资源恢复后通过 `slot` 完成全套隔离发布门禁（`test:release:isolated`，退出 0，74.91 秒，`time` 记录最大 RSS 864240 KiB）。门禁前后 SHA、tree 相同，检出干净。完整通过日志为同级 `final-release-resume.log`；中断日志为 `final-release.log`、`final-release-retry.log`、`release-oom.log` 和 `final-release-local.log`。

最终使用的隔离门禁命令如下（运行前已把 `slot audit`、`slot status` 写入项目日志）：

```bash
env -u PI_HOST_DIR -u PI_PACKAGE_DIR -u PI_SUBAGENTS_DIR \
  -u PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT TMPDIR=/project/tmp \
  npm_config_offline=true npm_config_maxsockets=2 UV_THREADPOOL_SIZE=2 \
  slot cpu -- npm run test:release:isolated
```
