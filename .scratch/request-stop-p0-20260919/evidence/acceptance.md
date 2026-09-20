# P0 实现与验收状态

2026-09-20，验收基线 `3991c5c762584cbbc235576359734259f69931ce`。用户已批准 spec、建议值和五票拆分，并要求“将 05 处理完”。01–05 全部完成；05 的强制门禁在普通终端（Claude Code 的 Bash，不是 pi 的 sandbox executor）跑完。验收当时未提交；随后源码与证据纳入提交 `85bdd2a93b994d3e4894e7534ab91cf6b16c9043`。本文没有推送或发布证明。

## 实现结果

每 Request 默认最多 32 次工具尝试、8 次全角色 child 启动，同类未解决失败达到 3 次封锁，最多 2 次真实结构参数修复，活动截止 15 分钟。每 Task 原有 revalidation 上限仍为 3，改为实际派发时持久记账。

新增持久 Request 准入控制、失败因果链、可信新输入与 UI 确认恢复。封锁先于取消，重载、换 Task、recovery 或策略切换不能刷新额度；未确认停止的 child 保留 Writer hold。调用尚未返回时 operator resume 也被拒绝。工具 hook、直接 execute 和最终 child dispatch 使用同一控制状态。

## 05 在普通终端发现并修正的缺陷

第一次完整 `npm run test:release`（[release-run-LICUcN](../release-run-LICUcN/test-release.log)，exit 1）暴露了此前各轮只做过语法检查、从未真跑的三个文件：

| 文件 | 现象 | 判定与处理 |
|---|---|---|
| `policy-cutover.test.mjs:178`、`index.test.mjs:1758` | 同一会话切到另一个 workspace 时，新 controller 因会话里已有别的 workspace 的 `planner-only-request` 条目而判定 `previouslyManaged`，目录尚不存在即抛 `request-persistence: request record missing`，而该 fault 对 `input()`/`resume()` 永久关闭 | **产品缺陷**。`index.ts` `requestFor` 改为只有 `data.sessionId`/`data.workspace` 与本命名空间一致的条目才算“已管理”。修复后跨 workspace 只按设计走 `session-boundary-unverified` 封锁，settled 空闲交互输入可重开 |
| 同上两个 fixture 的跨 workspace 调用 | 修复后仍被设计内的边界封锁挡住 | fixture 在切换前后补 `agent_settled` + 交互 `input`（与 P0 实施者在 shutdown 用例已用的相同序列），`policy-cutover` ctx 补 `isIdle()`。`git diff -- '*.test.mjs' \| grep '^-.*assert'` 为空，未删改任何断言 |
| `evidence.test.mjs:1532` | 在未改动的基线 3991c5c 上同样失败（[baseline-3991c5c-check](../release-run-LICUcN/baseline-3991c5c-check/evidence.log)） | **环境**：该用例要求 `tmpdir()` 不在任何 Git 仓库内，而首轮脚本把 TMPDIR 放在 `.scratch/` 下。两个终端脚本改为在 `/project/tmp` 下建临时根（不用 `/tmp`） |

新增回归用例 `request-stop.test.mjs` `sibling-workspace`：兄弟 workspace 的条目不使本命名空间 fault；本命名空间自身目录丢失后 reload 仍为 `request-persistence` fault。ADR-0005 补一句命名空间限定。

## 证据

| 范围 | 结果与证据 | 适用边界 |
|---|---|---|
| 普通终端完整 `npm run test:release` | [release-run-Xg0XFH](../release-run-Xg0XFH/test-release.log) exit 0：typecheck + 33 个测试文件（含 spawn 子进程的 policy-cutover/index/task）；`source-before.sha256` = `source-after.sha256` = 当前源码；slot preflight、`tmp-root.txt` 在同目录 | 失败首轮 [release-run-LICUcN](../release-run-LICUcN/) 及 `per-file/*.log`、`after-fix*.log` 全部保留 |
| 真实 CLI + pi-subagents 0.69.0 | [cli-acceptance/REPORT.md](../cli-acceptance/REPORT.md)：`natural` 默认额度下代表性任务完成（5/32 工具、2/8 child、request 保持 open）；`deadline` 以 `PI_PLANNER_ONLY_REQUEST_ACTIVE_MS=45000` 强制封锁，真实 transport 上 CANCEL → `cancelled` terminal 24 ms 内关联，封锁后模型调用/工具/REQUEST 均为 0，`rootStop: confirmed` | 仅 `pi -p` print 模式；被动观察扩展只记录不干预；自然语言运行与强制封锁分开记录；模型身份 Root 与 child 均为 `tcuni-luna/gpt-5.6-luna`（无路由） |
| 独立只读父 launcher strict gate | [review-r4/strict-verdict.md](review-r4/strict-verdict.md) **PASS，无 findings**；父/子各自的写打开探测均返回 EROFS、哈希不变、挂载只读（[strict-run-5j4u9K/events.jsonl](../strict-run-5j4u9K/events.jsonl)、[strict-attempt-2.json](review-r4/strict-attempt-2.json)）；冻结 63 文件与工作区一致，审后 [source-final.sha256](review-r4/source-final.sha256) 与冻结相同 | launcher 退出码 124：child 已返回、父已核对源码未变，但父的最终转述未在 240 s 内送出；verdict 取自 child 线程原始记录。首次全量范围尝试超时无 verdict（[strict-attempt-1.json](review-r4/strict-attempt-1.json)），改为 delta 范围（[strict-request.md](review-r4/strict-request.md)，v1 保留） |
| 此前各轮 | [首轮 21/22](final-validation/summary.md)、[复验 7/7](final-validation-r2/summary.md)、SDK 0.85.1 faux 探针 [PASS](../request-host-run-mZtnv0/results.json)、行为复审 r1–r3 PASS | r3 PASS 早于上述五文件改动；r4 只审 delta 并核对原始证据 |

## 结论（分列）

- **P0 保底（准入封锁）：通过。** 发布门禁、真实 launcher 验收、strict gate 均有原始证据；被审源码与最终状态一致。
- **完整 Root stop：在 `pi -p` print 模式下已证明**（封锁后无模型调用、无 child、无续跑，`agent_settled` 确认）。SDK faux 探针里“队列续跑仍多一次模型调用”的观察未被推翻，交互 TUI **未验证**（本终端无 TTY；不用 replica binding 冒充）。不承诺 token/费用硬上限。
- 默认值：代表性任务只用到 5/32 工具、2/8 child，无需改值；未让模型自动抬高边界。
- 环境说明：pi 的 sandbox executor 子进程 stdio EPERM 与本次无关；本终端未绕过 slot、未改权限或角色配置。
