# 03：场景回放 campaign 与结论

Status: ready-for-human
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
