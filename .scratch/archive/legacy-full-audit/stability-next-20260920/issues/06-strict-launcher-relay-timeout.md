# 06 strict launcher 在 child 完成后仍超时

Status: done
Type: task
Blocked by: none

What to build: 定位独立只读父入口的启动、调度及最终转述延迟，使已完成 child verdict 能在既定 240 秒外部时限内可靠返回。生产插件、Pi Request 默认截止和 Reviewer 的只读隔离不在本票修改范围。全局入口及角色配置变化须遵循全局 Astra 协议和新主会话要求。

Evidence: 当前源码已取得严格代码审查与独立验收核验的 PASS，父/子实际只读通过 EROFS、覆盖挂载和不变哈希证明；外层均未正常退出。原始记录在 ../continuation-20260920-0502/ 与以下目录：

| 尝试 | 原始目录 | child 结果 | 外层结果 |
|---|---|---|---|
| 1 完整代码审查 | strict-run-qE6emR | 05:19:06.971Z PASS，早于外部截止 | 124 |
| 2 精简父入口、完整复核 | strict-run-snUQhK | 截断前无最终 verdict | 124 |
| 3 已完成审查的独立验收核验 | strict-run-jYl0O1 | 05:34:51.185Z PASS，早于外部截止 | 124 |

三次均无自有进程残留，66 个源码项、11 个 harness 项无漂移。首轮和第三轮 raw rollout、角色/model/effort、child 完成时间、权限探测、原样 verdict 已归档。两次精简未解决外层完成问题，不继续机械重跑同样方案。

Acceptance:

- 明确耗时属于父模型、消息投递、等待工具还是最终转述，并以实际事件时间支撑；当前只确认 child 已完成而父未正常结束，尚未断定根因。
- 保留独立 read-only 父、fresh astra_reviewer、父/子实际权限探测、冻结证据与退出码的真实含义；不得把 124 改写成 0，或把行为约束审查冒充严格隔离。
- 在原有门禁要求下取得完整父流程退出及可关联的 child verdict；记录命令、审计、原始 stdout/stderr/exit 和无漂移/无残留证据。
- 若调整全局外部预算或角色配置是必要方案，先形成具体可审阅的变更与理由，按全局协议处理；本轮未修改它们。

## Diagnosis 2026-09-20（issue06/diagnosis.md）

已按事件时间断定耗时归属：父模型自身延迟（全局 config 使独立 Root 以 gpt-6-astra/max 运行，委派前 62–105 秒，子完成后的转述超过剩余 17–20 秒）加子审查固有时长（gpt-5.6-sol/high 完成同一契约 115–148 秒，三次在 >178/>203/>202 秒被截断）。消息投递 0.8–1.5 秒，slot 排队 <1 秒，均不是原因。

| 实验 | 原始目录 | 父 effort | 父委派前 | child | 外层 |
|---|---|---|---|---|---|
| 1 父 effort=low + 立即转述提示 | issue06/strict-run-WKrCon | low（turn_context） | 32 s | gpt-5.6-sol/high，>203 s 截断 | 124 |
| 2 同上 | issue06/strict-run-baWBGu | low | 30 s | gpt-5.6-sol/high，>202 s 截断 | 124 |

两轮均无自有残留进程；HEAD 与 66/11 冻结项未动；实验入口是全局入口的项目内副本（issue06/review-readonly-proposed.sh），不是门禁本身。

验收项状态：
- 归因：完成。
- 只读父/fresh reviewer/权限探测/退出码真实含义：保留，两轮均记录 124。
- 完整父流程退出：未达成。方案 A（issue06/global-entry.patch，只改父 effort 与提示）已验证能省 30–75 秒且不影响子角色 effort，但 child 本身超过 240 秒余量。
- 全局变更：已形成可审阅草案 issue06/global-budget.patch（入口时限改为 `REVIEW_READONLY_TIMEOUT`，草案默认 420；协议第 92、112 行同步），未应用。需要用户决定：放宽外部预算（B）、或拆小子契约（C，见 diagnosis.md）。

## Comments

2026-09-20：本票仅记录外层完成问题，不撤销已完成的两个独立严格 child verdict，也不将整个自动 strict gate 标为通过。P1-B 和 P3 的开发范围见原有工单。

2026-09-20（后续）：工单从 ready-for-agent 转为 needs-decision。不再用现有 240 秒预算重跑；下一步取决于用户对 global-budget.patch 的裁定。

2026-09-20（裁定后）：用户接受 A+B。全局入口与协议已按 issue06/global-budget.patch 应用（父 low effort、`REVIEW_READONLY_TIMEOUT` 默认 420、子契约软预算 300 秒），并因第 4 轮暴露的 here-document 探针失败再修订一次提示词。正式门禁第 5 轮（../strict-run-Y59nSS，continuation-20260920-0502/strict-attempt-5-*）exit 0、父子各自 EROFS 证据、child PASS、总时长 253 秒，无残留、零漂移。第 4 轮（../strict-run-IGfEci，strict-attempt-4-*）exit 0 但 BLOCKED，原因与修正见 issue06/diagnosis.md。四条验收项全部满足；工单关闭。

2026-09-20（P1-B 新轮）：strict-run-qgpWLM 外层退出 0，父 low；直接 child Sol/high 实际 278.5 秒，但它额外派生 reviewer，违反单层委派契约。本次不是 strict PASS。嵌套 reviewer 实际 204.5 秒，返回 REQUEST_CHANGES；自报约 250 秒未用于预算统计。已保留 contract/manifests/runtime/verdict，并改为仅子任务的 ReviewRequest；全局入口及角色配置未改。下一轮必须 fresh。

第二个 P1-B 新轮 strict-run-HRTA2r 外层 124；父委派前 55.0 秒，child Sol/high 362.4 秒到最后记录，未完成 verdict，无残留。本次完整源码加全部宿主/P3证据的契约未在预算内完成。下一步将契约拆为代码和证据两个独立门禁，保持全局 420 秒，不机械重复完整契约。

第三个 P1-B 新轮 strict-run-XlcaPu：父委派前45.3秒，child361.5秒返回 REQUEST_CHANGES，外层420秒在转述前超时。PID 泛筛记录1498966在后续检查时已不存在。修复已加入红绿回归及release-run-piF9Rd。代码审查仅单次600秒、child软420；证据审查仍420/300，全局入口/协议/角色未变。

第四轮 strict-run-2FEEMJ：单次600秒，父49.8秒、child469.1秒（超过软420）、父转述完成，外层0，无残留；结果REQUEST_CHANGES，不是PASS。保留实际时间，不宣称软预算强制生效。下一轮审剩余三文件修正，沿用已独立核实的未变化范围。

P1-B最终收尾：ed0kfI代码修正PASS/exit0，child166.3秒。完整证据Bg1P0s child523.9秒PASS，但外层600秒在父转述阶段exit124；原状态保留。fresh收尾dihsWK核验完整审查链及无漂移，child417.6秒PASS，父转述成功、外层0、无残留。soft预算超时如实记录；全局默认420和角色未变，本轮重审使用单次600秒。最终实现与证据详见execution-20260920/closeout.md。
