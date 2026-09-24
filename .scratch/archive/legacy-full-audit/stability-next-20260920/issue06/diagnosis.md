# 工单 06 诊断：strict launcher 的 240 秒去向

日期：2026-09-20。数据全部来自 codex rollout 的事件时间戳（`~/.codex/sessions/2026/09/20/`）与 launcher 目录内的文件 mtime；未采信任何模型自述。时间线脚本：`../tmp/rollout-timeline.mjs`；结果汇总脚本：`summarize-run.mjs`。

## 结论

耗时属于**父模型自身的推理延迟**加**子审查的固有时长**，两者共用同一个 240 秒外部时限；不是消息投递、等待工具或 slot 排队。

- 消息投递/等待工具：attempt 3 中 child `task_complete` 05:34:51.230Z，父 `wait` 在 05:34:52.705Z 返回 "Wait completed"，投递延迟 1.5 秒。attempt 1 为 0.8 秒（05:19:07.012Z 子完成事件 → 05:19:07.845Z 父开始推理）。
- slot 排队：每次 `slot status` 写入到 codex `session_meta` 的间隔均小于 1 秒（实验两轮为 0.9 s / 0.4 s）。
- 父模型：全局 `~/.codex/config.toml` 为 `model = "gpt-6-astra"`、`model_reasoning_effort = "max"`，`codex exec` 的独立 Root 直接继承（三次 `turn_context` 均为 gpt-6-astra/max）。父在委派前要跑一次权限探针并组织 spawn 消息，在 max effort 下花了 62–105 秒；子完成后的最终转述在 max effort、约 25 万 token 上下文下超过剩余的 17–20 秒。
- 子审查：astra_reviewer 固定 gpt-5.6-sol/high。同一份独立验收契约（strict-audit-request.md）三次实际耗时 148 s（完成）、>203 s、>202 s（被截断）；完整代码审查一次 115 s（完成）、一次 >178 s（截断）。子时长本身就逼近或超过 240 秒扣除父开销后的余量。

## 逐次归因（UTC）

| 轮次 | 父 model/effort | 父会话开始 | spawn | 父委派前开销 | child 完成 | child 时长 | 截止 | 子完成后余量 | 结果 |
|---|---|---|---|---|---|---|---|---|---|
| attempt 1 完整代码审查 | gpt-6-astra/max | 05:15:27.10 | 05:17:12.35 | 105 s | 05:19:06.97 PASS | 115 s | 05:19:27 | 20 s | 父收到结果后推理 11 s，又在 05:19:26 起了一轮复核命令，随即被 TERM；exit 124 |
| attempt 2 精简父入口、完整复核 | gpt-6-astra/max | 05:23:33.69 | 05:24:35.29 | 62 s | 无（截断） | >178 s | 05:27:34 | – | child 无 verdict；exit 124 |
| attempt 3 独立验收核验 | gpt-6-astra/max | 05:31:09.68 | 05:32:23.01 | 73 s | 05:34:51.19 PASS | 148 s | 05:35:10 | 18 s | 父 05:34:52.78 开始写最终消息，未在 17 秒内写完；exit 124 |
| 实验 1（本票，父 effort=low） | gpt-6-astra/low | 05:48:25.97 | 05:48:58.00 | 32 s | 无（截断） | >203 s，12 次工具调用 | 05:52:26 | – | exit 124；child gpt-5.6-sol/high 未受覆盖影响 |
| 实验 2（同上） | gpt-6-astra/low | 05:53:36.59 | 05:54:06.90 | 30 s | 无（截断） | >202 s，16 次工具调用 | 05:57:37 | – | exit 124；child gpt-5.6-sol/high |

attempt 1–3 的原始目录在 `../strict-run-qE6emR`、`../strict-run-snUQhK`、`../strict-run-jYl0O1`；实验 1、2 在本目录 `strict-run-WKrCon`、`strict-run-baWBGu`，各含 `result.json`（线程、rollout 路径、实际 model/effort/sandbox、事件时间、残留检查、运行时临时目录）。

## 已验证的方案 A：父入口只改父方

`global-entry.patch`（对 `/home/tcuni-claw/.codex/review-readonly.sh` 的 diff，未应用；基线哈希见 `global-entry-baseline.sha256`）：

1. `codex exec` 追加 `-c model_reasoning_effort="low"`（可用 `REVIEW_READONLY_PARENT_EFFORT` 覆盖）。父只做探针、spawn、wait、转述，不需要 max。
2. 提示词补一段预算说明：一条命令完成探针、立即 spawn、等待期间只调用 wait、子完成后立即转述，不再复核。

实验证据（两轮）：父 `turn_context` 为 gpt-6-astra/**low**，子 `turn_context` 仍为 gpt-5.6-sol/**high**、read-only，即 `-c` 顶层覆盖没有渗入角色文件固定的 effort；父委派前开销从 62–105 秒降到 30–32 秒；父等待期间未再向子发消息。方案 A 单独不够：两轮 child 都在 ~200 秒时被截断，说明 child 自身时长超过了 240 − 30 − 转述 的余量。

## 需要决策的方案 B：外部预算

`astra-planner.md` 第 92、112 行与 `review-readonly.sh --timeout 240` 把 240 秒写死。按上表，child 在 gpt-5.6-sol/high 下完成本审查契约需要 115–148 秒（已完成样本）到 >203 秒（截断样本，真实值未知）。若维持角色与契约不变，只有放宽外部时限才能可靠取得完整父流程退出。草案见 `global-budget.patch`：入口的时限改为 `REVIEW_READONLY_TIMEOUT`（默认值由用户定；草案写 420，即 child 约 380 秒余量，覆盖已观察下界并留一倍以上余量），协议两处相应改写。这是全局协议变更，按协议须由用户审阅后处理；本票未应用。

## 替代方案 C：缩小子契约

保持 240 秒，把 strict-audit-request.md 的检查项拆成两次独立 child（例如"权限证明+零漂移"与"原始证据抽查"各一轮），每轮各自走一次 launcher。缺点：两轮各自只证明一部分，最终 PASS 需由 Root 汇总，且合计成本更高。未实施。

## 残留与临时目录

两轮实验后 `pgrep -x codex` 中没有启动时间晚于 launcher 的进程；启动前存在的 codex 进程（最早 2026-09-07，含一个 cwd 为本项目、11:17 启动的会话）不属于本票，未触碰。运行时临时目录 `/project/tmp/planner-strict-*` 与前三次一样保留，路径记录在各 `result.json`。

## 应用与结果（用户 2026-09-20 接受 A+B 后）

已应用到 `~/.codex/review-readonly.sh` 与 `~/.codex/astra-planner.md`（应用前备份在 `applied/*.before`，应用后哈希在 `applied/after.sha256`，最终 diff 为 `global-budget.patch`）。子契约入口改为 `../continuation-20260920-0502/strict-attempt-4-entry.md`：同一份 strict-audit-request.md，加 300 秒软预算与 issue06/ 目录不属漂移的说明。

| 正式运行（全局入口） | 目录 | 父 | 父委派前 | child | 转述 | 外层 | verdict |
|---|---|---|---|---|---|---|---|
| 4 | ../strict-run-IGfEci | gpt-6-astra/low | 38 s | gpt-5.6-sol/high，162 s，11 次调用 | 18 s | 0 | BLOCKED：父探针用 here-document，在只读沙箱里 zsh 无法建临时文件（`can't create temp file for here document: read-only file system`），父按"一条命令后立即 spawn"没有重试，且把失败和 BLOCKED 建议写进了子任务；子正确判定证据缺失加污染 |
| 5 | ../strict-run-Y59nSS | gpt-6-astra/low | 25 s | gpt-5.6-sol/high，207 s，15 次调用 | 21 s | 0 | PASS：父探针 `python3 -c` 内联，EROFS/errno 30、`/` ro、哈希不变；子独立探针同样 EROFS；66/11 零漂移；release/provider/TUI 原始证据核实 |

第 4 轮暴露的 here-document 问题在 attempt 2 与实验 1 的父会话中同样出现过（首次探针均报同一错误），只是那两次父有重试或没被追究。入口提示词已第二次修订：探针必须用 `python3 -c` 内联、不得用 here-document 或临时文件、失败可重试一次；子 TaskSpec 原样传递，不得附带父的探针结果、假设或 verdict 建议；转述后再附父自己的探针证据。

第 5 轮总时长 253 秒（父 25 + 子 207 + 转述 21），超过原 240 秒预算，直接验证了方案 B 的必要性。420 秒默认值下余量 167 秒。两轮均无自有残留进程，HEAD 85bdd2a，77 个冻结项零漂移。

## 默认时限二次校准（2026-09-20 晚，审核后）

用户实施 P1-B 期间的 8 次 strict child 耗时 166–524 秒（qgpWLM 279、HRTA2r >362、XlcaPu >362、2FEEMJ 469、ed0kfI 166、ONdoZZ >371、Bg1P0s 524、dihsWK 418）。420 默认下两次无 verdict 被截断；闭环的四次中三次靠 `REVIEW_READONLY_TIMEOUT=600`。按用户授权把全局入口与协议默认改为 600（`global-budget.patch`、`applied/after.sha256` 已更新）。仍要求每次 strict 运行记录 child 耗时。
