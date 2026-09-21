# 上游 PR 记录：cumulative usage on structured delegation UPDATE（2026-09-21）

- PR：https://github.com/nicobailon/pi-subagents/pull/2374（`pr.txt`），base `main`，head 9d9b656c。
- 分支：fork `bioShaun/pi-subagents` 的 `delegation-update-cumulative-usage`，基于上游 main 1ac7b5e2（v0.70.1）。bbb30096 之后上游有 4 个提交，均不触及提案涉及的文件。
- 补丁：`0001-cumulative-usage-update.patch`（8 个文件，+470/-1 加上 Root 补的 2 行）。PR 正文：`PR-BODY.md`。
- 工作副本：`/project/tmp/pi-subagents-runtime-agent-settings`；本机安装的上游 checkout `~/.pi/agent/git/github.com/nicobailon/pi-subagents` 未动，仍为 bbb30096。

## 过程

1. 上游 https 拉取超时（curl 28），改用 ssh 拉到 1ac7b5e2。
2. 实现委派给一个子代理，任务说明 `TaskSpec.md`；子代理被限制为不提交、不推送，产出留在工作树。其自报的检查：typecheck exit 0，`test:unit` 3279 pass / 0 fail / 13 skip，`test:integration` 1058 pass / 0 fail / 7 skip；证据摘要归档在 `evidence/subagent/`。
3. Root 审 diff。子代理相对 TaskSpec 的两处扩展是合理的：
   - `execution.ts` 内部的 `structuredDelegationProgressChanged` 门也比较 cacheRead/cacheWrite/turnCount，否则 cache-only 变化在到达 bridge 之前就被 `suppressUnchangedDelegationUpdates` 吞掉；
   - 新增一条集成测试驱动真实 `execution.ts`，两条 assistant 消息带不同 cache 值，断言最后一次 UPDATE 的 usage 等于终态 usage。
   Root 发现一处遗漏并自行补上：`reconcileAttemptUsage` 之后只同步了 tokens/input/output/turnCount，没有同步 `progress.cacheRead/cacheWrite`，会让 attempt 收尾时的快照带旧的 cache 计数（`execution.ts` 约 1316 行，+2 行）。
4. Root 在补丁后独立复跑（`evidence/root-verify/`，经 `slot cpu`，slot audit 无绕过进程）：typecheck exit 0；`test:unit` 3292 tests，3279 pass / 0 fail / 13 skip；`test:integration` 1065 tests，1058 pass / 0 fail / 7 skip。
5. 该克隆没有 git 身份，首次提交失败、推上去的是上游原样；按上一个上游 PR 提交（875bda1f）的作者身份在该克隆内设置 `user.name/email` 后重新提交，推送为 fast-forward，随后用 `gh pr create` 开 PR。

## 未做

- 未更新插件本地的契约副本与 parity 检查（提案的 downstream follow-up 需等上游合并后进行）。
- 未改本机安装的上游 checkout，未合并到 main。
