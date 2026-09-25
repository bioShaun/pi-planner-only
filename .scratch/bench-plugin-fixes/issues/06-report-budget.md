# 06：子报告长度要求与截断上限

Status: done
Type: task

## Problem

`MAX_CHILD_TEXT_CHARS = 4000`，截断时保留开头 25% 和结尾 75%。cpass-ds 里 41% 的子报告被截断，explorer 报告中间的内容丢失。截断后 Root 下一轮平均自己读 0.63 个文件，不截断时是 0.11 个。

## Changes

- 子任务文本加一行：最终报告控制在 3000 字符以内，先写结论和 file:line，大段原始输出只留关键行。
- `MAX_CHILD_TEXT_CHARS` 调到 6000。截断时改为保留开头 60%：子 agent 最后一条消息本身就是报告，开头是结论（原来的注释"children put the report at the end"也要改）。
- 两个数字都放在 `delegate.ts` 顶部的常量里，写注释说明依据是本票的复盘数据。

## Acceptance

- 测试断言任务文本里有长度要求；截断测试按新比例断言，旧的截断断言如果和新比例冲突，只改数值，不删测试。
- `npm run test:release` 全绿。

## Comments

- Implemented the 3,000-character child report target, 6,000-character clipping limit, and conclusion-first 60/40 clipping. Added task-text and clipping coverage. `TMPDIR=/project/tmp/ppo-review npm run test:release` passed; 25% fault injection failed on the new head-retention assertion as expected, then 60% was restored.
- 2026-09-25 Root 验收：检查了 diff。另外 `clipChildText` 也用于失败 run 回收来的部分输出，那里保留的结尾部分从 75% 降到 40%，也就是 2400 字符，可以接受。效果由 09 的 truncated 和 root_reads 指标验证。
