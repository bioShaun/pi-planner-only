# 本批收尾

状态：**stopped，0 个有效样本，0 对有效pair。** 唯一允许的retry1已用完。S1 Lite、S2 Lite、S2 Native已取消；不得再发实验请求。没有Native/Lite胜负或性能结论。

## 两次正式尝试

1. C批首次S1 Native：Root读到CWD `/project/tmp/pi-native-lite-20261028T054700+0800/worktrees/S1-native` 后指出它不符合原brief写死的 `/project/tmp/pi-native-lite-pairs/<pair>/<mode>`，请求路径澄清，因此没有启动worker。这是brief/CWD配置冲突，不是Native拒绝委派或模式表现。该次有两条Terra请求预留，估计`$0.2523125`，保留在共享ledger，不退款。
2. 唯一retry1：Root在新路径正确启动并接受仅修正路径的S1调查brief，随后启动了一个异步worker。worker向supervisor澄清只读任务与通用实施/验收约束的冲突，Root明确回复只读。Root最后文本为“结果尚未返回……收到报告后仍需进行证据验收”，是等待异步结果的阶段性返回，并未声称任务完成。Runner把`stop`和`agent_settled`误判为整臂完成，过早调用`/subagent-cost`，将当时没有已完成child usage当作失败，关闭stdin使Pi退出，runner退出1。约39秒后worker才完成，Root已无法接收完成通知和验收报告。主要原因是本轮harness不正确处理异步生命周期；独立的自动结构化验收契约问题见下文。该次不是有效样本，不再重试。

worker run ID `6a5551a6-56a0-4972-9a87-f4cecbda3f87`，agent worker，`tcuni/gpt-6-luna` / medium，session ID `01a17f94-cfda-7079-8163-9409e198a794`，真实child session `/project/tmp/pi-native-lite-20261028T054700+0800/results/retry1/S1-native/6a5551a6-56a0-4972-9a87-f4cecbda3f87/run-0/session.jsonl`。status/events记录run complete、exit 0、8 turns、11 tools、约53.8秒；child报告写到正确路径 `results/retry1/S1-native/report.md`，SHA-256 `750299da04bbe96899070e48dacd097800be13feb91c94d81d74b074d10b233b`。Pi状态将child structured acceptance标为rejected，因为缺少结构化acceptance报告；这不是独立审查判定其源码结论错误。Root没有做最终验收。另有错误路径副本 `/project/tmp/pi-native-lite-20261028+0800/results/retry1/S1-native/report.md`，SHA-256 `2093cc3a851b2e45b287f6e4b83ce26f9d3200ef08831fd6b7bbeed9fabb7106`，大小8511；正确路径报告大小8495。按父Root要求两个文件均保留、不清理，作为输出范围偏差记录。

## 请求、指纹与用量

Root session：`nl-20261028T054700-0800-retry1-S1-native`，Terra/high；worker session如上，Luna/medium。

| 实体 | 输入 | 输出 | cacheRead | cacheWrite | reasoning | usage cost报告 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C首次S1 Root | 11434 | 348 | 8704 | 0 | 98 | `$0.0136092` |
| retry1 Root | 27755 | 1105 | 79360 | 0 | 101 | `$0.037248` |
| retry1 worker | 43003 | 5054 | 161920 | 0 | 198 | `$0.0084465` |

这些是消息/状态中的模型usage报告，不是发票；实验Root+child报告合计`$0.0593037`。生命周期时间不是模型计算时间。C首次两条请求的fingerprint中`instructions`字段缺失；依据retry1测试的真实OpenAI Responses builder，system/developer信息通过`input`传递，所以旧C observer漏记system指纹。retry1 observer已在每条Root/child请求上看到`systemPresent=true`。

Ledger当前19个事件（1个`$3`初始reserve seed + 18 provider请求），`reservedUsd=$4.60623375`，SHA-256 `dc9e71b30b194b79ce1a15c09500341e74b90ab17904e84e7ade55878616cf5e`。18条请求事件分布为C首次2条Terra、retry1 Root 8条Terra、retry1 worker 8条Luna；**18/18 ledger payloadHash都与fingerprint payloadSha256一一匹配**。retry1 Root/worker各8条请求的模型、session、system hash、tools hash见`results/retry1/S1-native/request-fingerprints.jsonl`。retry1预留估计为Root`$1.1933425`、worker`$0.16057875`；总预留不是实际费用。C旧请求和两次S1 attempt均未退款，ledger未重建或重置。

worker child launch receipt的`launchResolvedExtensions`包含`native-lite-budget-guard`与`native-lite-request-fingerprint`，`omitted.required=0`、`omitted.effective=0`；child真实请求也用同一ledger并有匹配fingerprints。**完整Root接受与child usage RPC链仍不完整**：cost RPC在child结束前读取了“无已完成child usage”；没有在Root存续期内获得最终child聚合cost、Root验收或Pi最终process terminal。`status.json`/`events.jsonl`记录child run complete、exit0，但`process-terminal.json`仍为pending而candidate文件存在，矛盾保留、不手改runtime状态。

## 控制费用与风险

最终父端回执与保留会话逐条用量已核对：

| 项目 | 报告费用 USD | 去重口径 |
| --- | ---: | --- |
| 上一批五次准备/控制委派 | 1.12124704 | 保留上一批验收值 |
| 本批首次控制run `7f45d7ef-66af-4dae-a701-c99f2016df59` | 0.05480434 | 完成receipt |
| 本批恢复run `fe450798-44f9-4633-8d7d-db6acad5adf1` | 2.02593008 | 完成receipt，仅恢复增量 |
| 准备/控制累计 | **3.20198146** | 当前保留会话458条assistant usage合计2.08073442，与两次receipt之和相符 |
| 本批正式实验Root/child | **0.05930370** | 上表三项实验用量，独立于控制费用 |
| 已核对报告费用合计 | **3.26128516** | 不含主会话未知费用，非最终账单 |

原US$3控制reserve被超出US$0.20198146，由原US$4安全余量覆盖，账本不重置、不把seed当真实已花费用。US$4.60623375账本预留与上述实际报告费用不可相加为“总消费”；如补计控制超额，保守占用为US$4.80821521。主会话费用和provider实际账单仍unknown。收尾控制委派已结束，不再发起实验请求。控制run终态为complete、exit0、processTerminal observed；实验child的pending终态矛盾另行保留。

## 检查与责任

retry1相关合并检查为22/22通过，原隔离`npm run test:release`曾通过；这些检查未覆盖真实的异步阶段性返回，也不构成有效实验样本。Runner已识别实际费用消息类型，但仍将异步中尚无完成usage误判为无child并退出。child自动checked acceptance因`async declared writer`套用了实施任务模板，缺少结构化attestation而rejected；这不是源码报告内容被独立审查否定。父Root漏审了第一次brief/CWD冲突，也在接受“无child快速失败”修复时漏查了仍有运行中child的场景。上述控制和验收问题不能作为模式优劣证据。

冻结的runner仍包含此次暴露的异步生命周期缺陷；这里将它作为失败证据归档，不能当作已修复的生产入口。测试依赖本机外部fixtures与显式runner覆盖，22/22仅指记录中的实际命令。未来重开需新批次，保留既有费用和失败记录，先解决两项宿主/控制契约：

- Root结束与child终止需分开跟踪；有active async child时不能把第一次“尚无已完成child usage”当作最终无child，应待真实完成receipt后收集费用，并保留有界deadline/终态。
- 针对只读报告的worker验收策略需与自动checked结构化验收契约一致，确保Root拿到child报告后执行有据可查的最终验收，而不是鼓励worker改写任务边界。

## 状态和文件

当前retry1 slot job `3645`已完成exit 1；实际Root PID `2795832`、child PID `2797851`在`2026-10-28T07:17:12+08:00`核查时均不存在，相关retry1 runner/Pi进程也不在进程表中。未终止任何其他进程。没有有效pair，所有其它arm取消。Parent最终决定是stopped；后续不得创建任何provider请求。

本批新增仓库文件（均在此batch目录，无tracked product source改动）：

- `acceptance.md`
- `budget-guard-core.mjs`
- `budget-guard-provider.test.mjs`
- `budget-guard.test.mjs`
- `budget-guard.ts`
- `child-fingerprint-registry.test.mjs`
- `closeout.md`
- `execution.md`
- `freeze-manifest.md`
- `request-fingerprint.test.mjs`
- `request-fingerprint.ts`
- `required-child-extensions-wrapper.mjs`
- `retry1/S1-brief.md`
- `retry1/S2-brief.md`
- `retry1/acceptance.md`
- `retry1/budget-guard-core.mjs`
- `retry1/budget-guard.ts`
- `retry1/execution.md`
- `retry1/freeze-manifest.md`
- `retry1/path-contract.test.mjs`
- `retry1/request-fingerprint.test.mjs`
- `retry1/request-fingerprint.ts`
- `retry1/required-child-extensions-wrapper.mjs`
- `retry1/rpc-cost-result.test.mjs`
- `retry1/run-rpc-arm.mjs`
- `retry1/run-rpc-arm.test.mjs`
- `retry1/runtime-probe-runner.mjs`
- `retry1/runtime-probe.ts`
- `role-settings.test.mjs`
- `run-rpc-arm.mjs`
- `run-rpc-arm.test.mjs`
- `runtime-probe-runner.mjs`
- `runtime-probe.ts`

所有raw测试/runner/probe/slot/usage证据在`/project/tmp/pi-native-lite-20261028T054700+0800/`下；child status/events/session另位于上文精确路径。`git diff --check` exit0，tracked diff empty，index为空/无staged files；新batch文件是untracked，所以标准`git diff --check`不会遍历其内容。另运行`rg -n --pcre2 '[ \t]+$' .scratch/native-lite-comparison/batches/20261028T054700+0800`，exit 1表示未发现尾随空白。没有commit/push/install/reload/clean；旧batch文件未修改。导航索引由父Root最后更新。
