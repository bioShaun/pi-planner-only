# 03：explorer 共享读锁（待评估）

Status: needs-triage
Type: task

Source: `../spec.md`（问题 6）。

## Problem

同一 cwd 下的两个 explorer 会互相排队。原评审建议让 explorer、validator 和 reviewer 共用一道读锁。

## 复核发现

- 原稿的前提"只读角色"有误。已安装的 pi-subagents 里，`scout`（explorer）的工具包括
  `bash` 和 `write`，`oracle`（validator）的工具包括 `bash`。现有 `contract.test.mjs`
  的规则"独占 == 有写工具"正是按这个事实写的。
- validator 会运行测试和构建。两个 validator 在同一目录并发，会争构建产物和锁文件，
  不应该共享。
- 能考虑的只有 explorer 之间共享：两个 explorer 互不阻塞，但仍与 worker、validator 互斥。
  这需要把契约测试的规则改成"独占 == 有写工具，explorer 除外，并注明理由"，
  也要接受 explorer 偶尔写文件的风险（事后由 git 摘要复核）。

## 待决定

收益还没量化：只有 Root 在同一轮并行发出多个同 cwd 的 explorer 时才有收益。
决定之前，先在已有 bench transcript 里统计同一轮并行 delegate 的次数。
次数可以忽略时，改为 wontfix。

## Comments

- 2026-09-25 agent 收益评估完成（有数据支撑的 wontfix 建议，待维护者拍板；未改代码）：
  - 数据：139 个 bench run（`/project/tmp/ppo-bench/results/*/runs/*.jsonl`，pilot + control 全量）。
    同一 turn 内发出 >1 个 delegate 的共 49 turn；其中含 2+ explorer 的只有 7 turn
    （`explorer+explorer` ×6、`explorer×3` ×1，且三连发那次 2 个被锁拒绝、双发也常因独占锁只跑成 1 个）。
    全量共 40 次 `still running` 锁拒绝，分布在 37 个 run（绝大多数是 explorer×validator 等异构并行被串行化）。
  - 结论：explorer 共享读锁能解锁的只是这 7 turn 里的部分串行等待；validator 之间、worker 之间、
    explorer×validator 之间仍须互斥（构建产物/锁文件竞争，见复核发现）。收益上限很小，
    代价是改契约测试的独占规则（\"独占 == 有写工具，explorer 除外\"）并接受 scout 偶尔写文件的风险。
  - 建议：改为 wontfix。若维护者同意，我再把本票 Status 改为 wontfix 并在 spec 处置表里同步一行；
    若仍想做，再按票面做 explorer 例外（需先接受上述风险）。
