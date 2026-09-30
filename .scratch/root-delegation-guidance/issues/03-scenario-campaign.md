# 03：场景回放 campaign 与结论

Status: done
Type: task
Blocked by: 01, 02

Source: `../spec.md`（User Stories 22–24、Further Notes）。

## 为什么需要人

这张票会真实调用模型并产生费用，启动前需要用户批准。Root 模型要不要再加一组贴近实际的 Sonnet 或 Opus arm，也要由用户决定。

## 要做的事

1. 估算费用和时长，报给用户，等用户批准。可参考 `.scratch/root-decomp-trial-20260928/round2-report.md`：T3/T2b 每个 run 约 $0.06–0.28，用时 7–33 分钟。
2. 运行 campaign，每个 arm 每个任务重复 3 次：
   `bench/campaign.sh rdg-r1 3 G1,G2 lite-tds-guid-base,lite-tds-guid-treat`
   campaign 会自动把 `slot audit` 和 `slot status` 写进 `campaign.log`。出现 STOP 或无效 run 时不自动重跑，先向用户报告。
3. 汇总结果：成本用 `bench/summarize.py`，行为指标用 `bench/guidance_metrics.py`。
4. 在本目录写 `campaign-report.md`，对比 base 和 treat：
   - 主指标：
     - G1：角色不匹配的委派次数；
     - G2：timed_out 次数、超时后的补派次数、同轮重复的等待命令数；
     - 两个任务：通过率和达到通过所用的时间与总用量。
   - 反向指标：委派次数、Root 的 edit/write/bash 次数、总成本。
   - 写明 n=3 只能发现明显差别，不能证明"没有差别"。

## 判定

- treat 在主指标上有明显改善，且反向指标没有明显变差：保留票 01 的改动，把 spec 状态改为 done。
- 没有明显差别：保留改动，因为它是低成本的文字修改；在报告里写明"未观察到效果"，并考虑下一步是否把关键句移进系统提示（需另开票讨论 1,700 字符上限）。
- 反向指标明显变差（例如过度拆分、总成本上升）：向用户报告，由用户决定是否回退。

## Comments

- 2026-09-30 pilot（用户批准试跑一轮）：第一次 `rdg-r1-pilot`（tds 路由）在健康检查被熔断，`tcuni-ds` 余额不足（400 insufficient credits），零有效 run、零费用。改用同模型 ClinePass 路由新建 `lite-pds-guid-base/treat` 两个 arm（commit `27fb745`），跑 `rdg-r1-pilot-pds` 4 次全过、全部 valid，实际花费约 $0.08（opus 权重口径约 $1.87）。
- **pilot 结论：flash 上 base 没有重现任何故障模式**。G1：base/treat 都把产物任务直接派给 worker（各 1 次委派，completed，无 validator 误派）。G2：base 1 次 worker 委派 completed，treat 0 次委派 Root 自己做；两臂均无超时、无补派、无 sleep 等待命令（`bash_sleep_cmds=0`、`dup_wait_cmds=0`）、无同轮重复调用。按用户既定规则：base 干净则 flash 对比测不出效果，不补跑 flash 的 n=3，转为由用户决定是否加一对 Sonnet arm（需先补 prices.json 的 Sonnet 条目）。
- 结果目录：`/project/tmp/ppo-bench/results/rdg-r1-pilot-pds/`（含 `guidance-metrics.json`）。
- 2026-09-30 Sonnet base 预跑（用户批准两步走第一步）：先核对 G2 等待机会——pilot 显示 flash base 用前台 bash 阻塞 7 分钟避开等待，`bash_sleep_cmds=0` 不提供信息，故改 G2.md 明确要求完整流水线用 `slot cpu -b` 后台提交（commit `6f66f6c`，同时补 prices.json 的 `tcuni/gpt-6-sol` 条目、建 `lite-sol-guid-base/treat` 两个 arm）。跑 `rdg-sol-base 1 G1,G2 lite-sol-guid-base`，2 次全过、valid，花费约 $0.37（sol 权重口径）。
- **Sonnet base 结果**：G1 两次委派角色都正确（worker 实现 + validator 只读验证），误派未重现；G2 worker 修复 + validator 提交后台 slot 作业均 completed，无超时无补派，`dup_wait_cmds=0`（同轮重复等待未重现），但 Root 顺序发出 11 次 `sleep 30; slot queue cpu` 轮询（`bash_sleep_cmds=11`、合计 325s）——是阻塞等待的温和变体（每轮一条有界查询，非同轮重复）。严格口径：三个目标故障模式均未重现；温和变体存在。
- 结果目录：`/project/tmp/ppo-bench/results/rdg-sol-base/`（含 `guidance-metrics.json`）。
- 2026-09-30 更正与补测（用户指出 `gpt-6-sol` ≠ Sonnet）：原始故障模型是 Astra（误派）、Opus（超时）、Sonnet `tcuni-claude/claude-sonnet-5-5`（同轮重复等待）。按用户批准的方案 A，在原始模型上各跑 1 次 base：G1 × astra（arm `lite-astra-guid-base`）、G2 × sonnet（arm `lite-sonnet-guid-base`，先补 prices.json 条目），commit `7c682c5`。Opus 不跑（G2 结构触发不了 child 超时）。
- **最终结果：三个故障组合全部未重现**（JSONL 已核验 Root 模型：astra 8 条、sonnet 7 条记录）。G1×astra：worker ×1 completed，未派 validator。G2×sonnet：0 委派，Root 用 sed 自修、`slot cpu -b` 后台提交，等待用 2 条长 sleep（290+200s，各一轮一条），`dup_wait_cmds=0`。均 pass+valid。本次花费 astra $0.69 + sonnet $0.18。
- 按用户裁决收尾：不跑 treat、不上 Opus、不再追加费用。结论“场景未能重现故障，票 01 改动保留、效果未验证”。全部数据与限制写入 `../campaign-report.md`；场景重设计转 `04-scenario-redesign.md`（needs-triage）。累计实际花费约 $1.32。
