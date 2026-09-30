# Root 委派指导：场景回放 campaign 报告

日期：2026-09-30。票：`.scratch/root-delegation-guidance/issues/03-scenario-campaign.md`。
结论先行：**三个出故障的模型/任务组合都测了 base，目标故障模式一个都没重现。按既定规则收尾：保留票 01 的文字改动，效果未验证；G1/G2 场景转票 04 重新设计。**

## 背景

票 01（commit `d186304`）改了 Root 看到的指导文本（角色路由、长运行拆分、等待方式、验收分层）。本报告用固定场景回放对比改动前后的插件版本（base = `c2fcc8b`，treat = `d186304`），判断改动有没有可观察的效果。

故障证据来自 `.scratch/om09-usage-20260929/findings.md`，三个故障出在三个不同模型上：

| 故障 | 原始模型 | 对应场景 |
|---|---|---|
| 写产物的任务派给 validator | Astra（tcuni/gpt-6-astra） | G1 |
| 两次 600s 子任务超时 | Opus | G2（本轮不可测，见限制 2） |
| 同一轮发 6 条 `sleep 598` | Sonnet（tcuni-claude/claude-sonnet-5-5） | G2 |

## 运行记录与费用

| campaign | 模型（JSONL 已核验） | 任务×arm | 结果 |
|---|---|---|---|
| rdg-r1-pilot | tcuni-ds/deepseek-v4.1-flash | G1,G2 × base,treat | 健康检查熔断：余额不足，0 有效 run，$0 |
| rdg-r1-pilot-pds | cline/cline-pass/deepseek-v4.1-flash | G1,G2 × base,treat 各 1 | 4/4 pass、valid，$0.08 |
| rdg-sol-base | tcuni/gpt-6-sol | G1,G2 × base 各 1 | 2/2 pass、valid，$0.37 |
| rdg-astra-g1 | **tcuni/gpt-6-astra**（8 条 Root 记录核验） | G1 × base | 1/1 pass、valid，$0.69 |
| rdg-sonnet-g2 | **tcuni-claude/claude-sonnet-5-5**（7 条 Root 记录核验） | G2 × base | 1/1 pass、valid，$0.18 |

实际总花费约 **$1.32**（`--weight actual`）。中途教训：`gpt-6-sol` 不是 Sonnet，曾误当作 Sonnet 跑了一轮；后续所有结论以 JSONL 里 assistant 记录的 provider/model 为准。

## 主指标

### G1（考角色路由）：误派 validator 未重现（含 Astra）

| run | 委派 | validator 任务性质 |
|---|---|---|
| flash base / treat | worker ×1 | —（没派 validator） |
| gpt-6-sol base | worker ×1 + validator ×1 | validator 做**只读**终验（"Read-only final validation. Do not edit files"），角色正确 |
| **astra base** | worker ×1 | —（没派 validator） |

四个模型（含原始故障模型 Astra）都把产物任务直接派给 worker。`validator_write_tasks` 全部为 0。G1 的"审计/核对"措辞对任何受测模型都不构成诱导。

### G2（考拆分与等待）：超时与同轮重复等待均未重现（含 Sonnet）

| run | 委派 | timed_out | dup_wait_cmds | bash_sleep |
|---|---|---|---|---|
| flash base | worker ×1 completed | 0 | 0 | 0（Root 前台 bash 阻塞 7 分钟跑完） |
| flash treat | 0（Root 自己做：13 bash + 1 edit） | 0 | 0 | 0 |
| gpt-6-sol base | worker 修复 + validator 提交后台 slot 作业 | 0 | 0 | 11 次 / 325s（顺序逐轮 `sleep 30; slot queue`） |
| **sonnet base** | 0（Root 用 sed 自修，`slot cpu -b` 提交后台作业） | 0 | 0 | 2 次 / 490s（`sleep 290`、`sleep 200`，各一轮一条，时长与 7 分钟流水线基本对齐） |

- 子任务超时：全部为 0。所有 Root 都把 7 分钟运行放进了后台或自己前台跑完，没有任何一个 child 顶着 5 分钟时限前台跑流水线。
- 同轮重复等待（6 条 `sleep 598` 那种）：`dup_wait_cmds` 全部为 0，**在原始故障模型 Sonnet 上也是 0**。Sonnet base 的等待甚至是教科书式的：两条长 sleep 各管一半流水线时长。
- gpt-6-sol 的 11 次 `sleep 30` 轮询是最接近故障的行为，但每轮只发一条有界查询——这恰恰是票 01 指导认可的形式，treat 跑了也量不出差别。

### 通过率与时间

所有 run 全部 pass + valid。wall：G1 65–144s，G2 470–542s（另各有约 7 分钟的离线评估流水线，不计入 run wall）。

## 反向指标

委派次数 0–2 次/run，无过度拆分；Root 自己动手量（root_bash/edit/write）最高 13 bash + 1 edit（flash treat G2），属 n=1 噪声范围，但也说明新指导没有强迫委派。各 arm 单 run 成本 $0.02–0.69，无异常放大。

## 判定

按票 03 的判定规则和用户在过程中的两次裁决：

- flash 上 base/treat 无差别 → 不补 n=3（用户裁决 1）。
- 出故障的模型上 base 各测 1 次，仍未重现 → **不跑 treat、不上 Opus、不再追加费用**（用户裁决 2）。
- 结论：**"未观察到效果"，且原因是场景未能重现故障，而不是改动被证明无效**。票 01 的改动是低成本文字修改，予以保留。
- n=1/条件的样本量只能发现明显差别；本次结论的更准确表述是"这些场景在这些模型上没有给出失败的机会"。
- 后续可考虑的方向（需另开票）：把关键句移进系统提示（涉及 1,700 字符上限的讨论）；场景重设计（票 04）。

## 场景限制（转票 04 重设计）

1. **G2.md 提示泄底**（commit `6f66f6c`）：题目直接写明"用 `slot cpu -b` 后台提交"，测不了"要不要拆出去后台跑"的决策，只能测等待方式。注意这与真实会话一致——真实 Root 也是从全局 AGENTS.md 的 slot 规则知道要后台提交的（pilot 里 flash 看到了规则仍前台跑完）。
2. **G2 触发不了子任务超时**：Root 自己用 bash 前台跑不受 child 5 分钟时限约束（flash pilot 正是这样做的）。要测超时，需让 Root 更倾向于委派长运行（如 strict 模式）或让运行时长远超前台可接受程度。
3. **G1 诱导强度不够**：在所有受测模型上，"审计/核对"措辞都没有诱发误派 validator。
4. **bench 环境自带纠偏**：全局 AGENTS.md 的 slot 规则、TMPDIR 说明都会进入 Root 提示，部分故障机会在场景之外就被消除了。

## 产物

- 结果目录：`/project/tmp/ppo-bench/results/rdg-r1-pilot-pds/`、`rdg-sol-base/`、`rdg-astra-g1/`、`rdg-sonnet-g2/`（各含 `guidance-metrics.json`）
- 指标脚本：`bench/guidance_metrics.py`；场景：G1/G2（票 02，commit `748ac8d`）；arm：`lite-{pds,sol,astra,sonnet}-guid-{base,treat}`（pds/sol 的 treat 未运行）
