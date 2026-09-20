# 当前工作树验收记录

基线：85bdd2a93b994d3e4894e7534ab91cf6b16c9043。本轮没有提交、推送或发布。产品与 harness 哈希分别在 source-manifest.json / harness-manifest.json。P0 的正常终端 release 与 strict PASS 仅属于该基线。

| 项目 | 当前结论 | 证据 |
|---|---|---|
| 状态文档同步 | 已完成 | P0 README/05/acceptance 与路线图当前状态区 |
| P1-A 默认 envelope、canonical spec 重入 | 已实现，入口 fixture 通过 | p1-delegation.test.mjs；logs/last-corrections.json |
| P1-B 有界 partial 与一次格式修复 | 未完成 | transport-capabilities.md；上游接口缺失且本地 report-only 权限/证据链待实现 |
| 封锁请求的队列续跑 | 已修复，真实 SDK/假模型场景通过 | request-host-run-vrbghN/；logs/r3-sdk.* |
| 真实交互 TUI | PASS：单个真实到期停止场景 | study-run-g9NOIF/；关闭后 model/tool/REQUEST 均为 0，正常退出 |
| P2 模型路由 | 已实现、默认关闭，fixture 通过 | delegation-model.ts；P1/P2 入口测试含 expected/actual 对照 |
| 真实模型路由 | PASS：Kimi Root / Luna child，low | study-run-D1Lacq/；正确答案、身份、终态及 usage 关联通过 |
| P3 成本/质量对照 | 单个真实 smoke 已完成；完整对照/价格/校准未完成 | study-run-D1Lacq/；不能据此宣称节省 |
| 有界 Root 读取政策 | 未决、未实现 | 需真实对照支持后单独决定；不放宽当前 Idle 规则 |
| 当前全量 release | PASS，60 个受检文件仍与通过时一致 | release-run-dWGu9v/，exit 0 |
| 严格代码审查 / 独立验收核验 | 两者均 PASS，父/子实际只读已证明，77 项源码/脚本哈希无漂移 | continuation-20260920-0502/strict-attempt-1-reviewer.md、strict-attempt-3-reviewer.md |
| strict launcher 完整退出 | BLOCKED：三次 exit 124；首轮/第三轮 child 在截止前完成，外层未正常转述退出 | strict-run-qE6emR/、strict-run-snUQhK/、strict-run-jYl0O1/；工单 06 |

## 早期检查记录（后续实跑结果见文末）

logs/final-checks.json 与 final-host-checks.json 保留命令、退出码和 stdout/stderr；后续 registry 检查及重跑见 last-corrections.json。typecheck、P1/P2 真实入口 fixture、request-control、request-stop、revalidation-accounting、role-models、ledger-store、成本汇总测试通过。delegate.test.mjs 只做语法检查。run-study.mjs 通过 node --check，tui-driver.py 通过 Python AST parse；这些均不证明完整 harness 可运行或真实宿主通过。

SDK 使用真实 0.85.1 宿主、假模型和 child 事件来源，没有真实模型费用：封锁后的 queued provider 未进入，额外模型调用 0；独立新输入仍正常。最新 request-host-run-vrbghN 的总 12 次模型调用包含其他正反场景，不能把“关闭后 0”写成整场 0。

## 原始失败保留

- Worker 的初始失败和修正记录在 p1-a-implementation/，最终实现者自测通过。
- Root 增补 unsafe integer 测试时，前一个非法环境配置尚未清除，先失败；清理后通过（stage-2-3*.json）。
- 新 SDK 首次仍断言历史额外调用 1，实际变成 0；次轮最终 console 变量名错误，第三轮与最终轮均 exit 0。原始结果没有覆盖。
- registry 限制后一次 fixture 在 30ms Request 截止前来不及完成真实 ledger I/O，尚未派发即拒绝；仅该测试改为 Request 1000ms / envelope 10000ms，并保留优先到界/CANCEL 断言。生产上限没有修改。

## 具体阻碍

此前的 sandbox/slot 权限阻碍已在用户调整权限后解除，证据为 continuation-20260920-0502/host-preflight.json。当前阻碍转为 strict 外层 launcher 的 240 秒转述/调度超时；三次退出码均为 124，详见工单 06。旧 slot-audit.txt 作为历史失败保留，不再代表本次宿主环境。

P1-B 不是只差跑测试：0.69.0 公共协议没有 finish/grace/invalid-output 诊断能力，本地强制只读 report-only 修复也尚未实现。P3 没有真实价格和对照结果，因此不宣称省钱，不据此改变默认读取政策。普通终端可继续的动作和验收要求已写成 terminal-validation.md。

## 独立审查修正

首轮报告保留 review-r1/verdict.md 和当时两份 manifest。两个 Major finding（路由模糊匹配、slot audit 仅看 exit）及一个 README 冲突已修正；logs/review-r2-checks.json 的 7 项检查均 exit 0。路由严格匹配 provider/model，标点/日期/大小写差异需显式 fallback；所有普通终端重任务入口共享 audit 内容门禁。另补汇总的精确答案和 invalid JSON 失败保留、observer Request ID 字段修正。当前 fresh 复核独立于首轮实现讨论；strict 门禁仍缺普通终端证据。

### 第二次修正（r3）

review-r2/ 保留第二轮独立报告与当时 manifest：两个 Major 已关闭，剩余中文 README 说明遗漏已同步。另修正大数墙钟定时器溢出：首次及重新唤醒均不超过 Node 的2147483647ms，但保存完整配置并按实际 elapsed 判断，防止1ms反复唤醒。新真实入口回归、typecheck、diff 通过。统计脚本还保留删除输出文件导致的质量失败，并为 Root 观测到模型调用但没有对应 usage 标 incomplete。

logs/review-r3-checks.json / review-r3-support-checks.json 的检查均 exit 0。最新 SDK 原始 request-host-run-vrbghN 再次确认 extraModelCallsAfterClose=0；route 默认关闭，不能冒充真实 provider 路由测试。所有新源码的全量 release、真实 TUI/实际模型以及独立只读 strict gate 仍未运行。

## 权限调整前的审查与交接记录

review-r3/verdict.md：fresh 独立 reviewer 未发现 r3 窄范围新代码缺陷，r2 文档项关闭；两项 Major 已在 r2 关闭。65 个源码与10个 harness 哈希核对无漂移。大数 timer 的重置分支经静态复核，入口回归动态覆盖初次唤醒参数与不立即取消；未虚称覆盖所有分支。

该历史轮次总验收为 **BLOCKED**。随后 release 与真实宿主证据已补齐；当前状态以本页顶部及文末为准。P1-B 的上游协议和本地只读修复路径仍是开发待办；有界 Root 读取仍等真实测量后独立决策。

## 2026-09-20 普通终端 release 实跑（Claude Bash）

run-release-terminal.sh 实跑：evidence 目录 release-run-0waa9z（slot audit 无绕过进程；TMPDIR=/project/tmp；源码前后哈希一致）。**Release exit 1，不是 PASS。** 前 13 个套件通过后在 index.test.mjs 停止；余下 19 个文件单独实跑，仅 delegate.test.mjs 失败（test-rest-after-index.log）。

两处失败都是 P1-A「redelegate 忽略传入定义字段、以已存 spec 为准」的直接后果，此前未被发现是因为这两份文件只做了语法检查：

- index.test.mjs:2699 — 期望 `validation:{required:true}` 无 commands 的 redelegate 被拒（refusal breaker 场景 4b）；现在该字段被忽略（delegate.ts:762），不再拒绝。
- delegate.test.mjs:245 — 期望 packet.spec.objective 为本次调用的「revised objective」（ticket 53 旧规则）；现在 packet 使用已存 spec。

待决：按新契约改写这两个场景（refusal breaker 需换一种在新契约下仍非法的重派输入，例如非法 envelope），不得删除守卫断言。改完须重跑完整 test:release。

### 修正后复跑（同日）

按新契约改写三处场景，均未删除守卫、只换成新契约下等价或更强的断言：

- index.test.mjs 4b：非法输入改为 `envelope:{maxTokens:0}`（ENVELOPE_INVALID，在预留/启动之前拒绝），新增「未启动任何执行」断言；Repeat notice、query、verdict 断言原样保留。
- delegate.test.mjs:245：packet 改为断言携带已存 spec 全文，并断言 warnings 含「ignored legacy TaskSpec field(s)…objective」。
- delegate.test.mjs 截断包场景：HEAD 上 worker 用本次调用的 spec 启动、因此绕过了缺失 root；P1-A 改为已存 spec 后 worker 会被 ENVIRONMENT_UNVERIFIABLE 预启动拒绝。改为额外 root 启动时存在（真实 committed repo），worker 启动后再删除，reviewer 采样时截断；新增「worker 已启动」断言。已在干净的 HEAD archive 上确认该文件在 85bdd2a 通过（/project/tmp 下一次性目录，已清理）。

第三次 run-release-terminal.sh：**exit 0**，evidence release-run-79Jzy0，源码前后哈希一致。中间一次 release-run-bq4aDF exit 1 的原始结果保留。当前工作树 release 结论由「未运行」改为 **PASS**；真实 TUI、实际模型路由、strict gate 仍未运行。

### ADR-0008 默认墙钟改为 10 分钟（同日）

用户同意后落地：execution-defaults.ts 默认 maxWallMs 300000→600000，token 默认不变；p1-delegation.test.mjs / delegate.test.mjs 两处默认值断言同步；README、README.zh-CN、CONTEXT.md、envelope 参数说明与两个委派工具的 Root 提示同步为「10 分钟默认，重编码 worker 显式传 envelope.maxWallMs，不超过 Request 截止」。依据与被拒方案见 docs/adr/0008-default-execution-wall-clock-ten-minutes.md。typecheck、test:p1、delegate.test 通过；第四次 run-release-terminal.sh **exit 0**，evidence release-run-lHCcgb，源码前后哈希一致。

### ADR-0008 按审阅意见修正（同日）

四条意见均经代码核实成立并已修正：显式 envelope 整体替换默认值（delegate.ts validateEnvelope ?? defaults），推荐用法改为重任务同时传 maxTokens 与 maxWallMs；墙钟须按 Request 剩余时间（首次活动起算 15 分钟）并留验证/评审余量，当前未向 Root 暴露剩余时间，列为后续；样本 5 分钟覆盖 55/61、10 分钟 56/61，ADR 改写为「暂定折中、定性理由、不宣称降低恢复成本」；执行记录已有 endedAt、缺启动时间与耗时口径，取消不丢弃工作区修改而是结果不被接纳并需恢复决策。README/README.zh-CN/工具参数说明/两处 Root 提示同步。第五次 run-release-terminal.sh **exit 0**，evidence release-run-dWGu9v，源码前后哈希一致。

### 2026-09-20 权限调整后的真实宿主与严格审查

用户指定 Root `kimi-coding/kimi-for-coding`，child `tcuni-luna/gpt-5.6-luna`，thinking `low`。astra_validator_complex 在普通宿主环境执行了一个 optimized count smoke 和一个真实 TUI 到期停止场景，均首轮 exit 0；完整命令、stdout/stderr、身份/终态/usage 关联及前后哈希在 continuation-20260920-0502/command-results.json。原始产物为 study-run-D1Lacq/ 和 study-run-g9NOIF/。TUI 确认真正 hasUI、Request 到期、同身份 CANCEL/cancelled、agent_settled，关闭后调用为 0，静默 3 秒后 Ctrl-D 正常退出；无强杀、残留测试进程或 done.txt。

源码冻结清单更新为 66 项，补入 ADR-0008；harness 清单 11 项。旧清单和旧审查请求已保留。宿主测试、严格审查与最终核验均未改变生产源码或既有 harness；本轮不重复运行已匹配当前源码的 release。

strict 三次均通过独立只读父入口、先记录 slot audit/status 再进入 slot cpu。首轮严格代码 Reviewer 在 05:19:06.971Z 返回 PASS；父进程转述未在外部 240 秒时限内结束，exit 124。第二轮完整复核被同一外部时限截断，无最终 verdict。第三轮改为独立验收核验，在 05:34:51.185Z 返回 PASS，确认首轮审查来源、实际只读隔离、冻结内容和原始验收证据；外层仍 exit 124。两份已完成 child verdict 及三次失败状态原样保存。父/子只读证明是实际 O_WRONLY 打开被 EROFS 拒绝、只读覆盖挂载和不变哈希；没有用角色声明代替。三次均确认无自有进程残留。

**当前实施已有严格代码审查与独立核验 PASS；完整自动 strict gate 仍为 BLOCKED，原因是外层 launcher 未正常完成。** 后续按工单 06 处理，保留固定截止与退出码真实性。P1-B、完整 P3 对照/价格/校准、读取政策及更广的定时输入矩阵不在本轮通过范围。未提交、推送或发布。

### 2026-09-20 工单 06 关闭：strict gate 完整通过

用户裁定接受方案 A+B 后，全局 `~/.codex/review-readonly.sh` 与 `astra-planner.md` 已修订（父 low effort、`REVIEW_READONLY_TIMEOUT` 默认 420、子契约软预算；diff 与前后哈希在 issue06/applied 与 issue06/global-budget.patch）。正式第 4 轮（strict-run-IGfEci）exit 0 但 child BLOCKED，原因是父 here-document 探针在只读沙箱失败且把结论塞进子任务；入口提示词随即二次修订。第 5 轮（strict-run-Y59nSS）exit 0：父 gpt-6-astra/low 探针 EROFS、哈希不变；child gpt-5.6-sol/high 独立 EROFS，207 秒后 PASS；总时长 253 秒；无残留，HEAD 85bdd2a，66/11 冻结项零漂移。**当前实施（P1-A、stop、P2）的完整自动 strict gate 为 PASS。** P1-B、完整 P3、定时输入矩阵仍未完成，见 handoff-20260920.md。
