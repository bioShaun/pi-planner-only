# 03: soak — P0 全链宿主证据轮（零源码改动）

Status: ready-for-agent

来源：.scratch/typed-delegation/handoff/12-PLAN.md §5；本票只采证，不改源码。

## 用例与次数

- P1 ×3（worker+测试+validation → reviewer → planner_verdict pass → git_commit）。
- N1 ×3（worker 无测试 → request_changes → 修正 worker（constraints 不带
  changedFiles 限定）→ reviewer → git_commit）。
- 3b ×3（hello.txt worker → reviewer）。
- N2 跑飞 ×1（envelope maxTokens 低线；必须由 WRC CANCEL 收掉，不许人 kill）。

探针：从 `.scratch/typed-delegation/host-10/probe-template` cp；
会话 id 前缀 `soak-`；`PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_REQUIRE_REVIEW=1`，
配方同 10-r5 §环境（`pi -ne -e <pi-subagents> -e index.ts --mode json -p`）。

## 每次采集

toolcalls（jsonl 抽 tool_call/tool_result）、render-status、账本 taskId.json
复制、git log -1 --stat + status --porcelain、usage.jsonl 该行、账本 md5 前后。

## 关闭标准（全部满足才关阶段）

1. 无手动 kill（全程 `pgrep -af probe` 由脚本记录为空）。
2. 无锁泄漏：每次结束后 render-status 无残留 reservation；重启 Root 后能派新 writer。
3. 无重复记账：每个 executionId 在 usage children 中恰一行。
4. `stop_unconfirmed` 只在 N2 出现且最终解除或明确标注 evidence-incomplete。
5. P1／N1／3b 九次全部 completed + git_commit 成功。

任一不满足 → 定位到 12-A 或 12-B 开 rework，soak 重跑失败的那一类。

## 阶段关闭

全部满足 → 写 `.scratch/worker-runaway-controller/handback.md`；
票 12（.scratch/typed-delegation/issues/12-worker-runaway-controller.md）
Status done；spec Status 改 `delivered (P0)`；最终 stage commit 由用户执行
（不含 host-*/ 证据目录）。
