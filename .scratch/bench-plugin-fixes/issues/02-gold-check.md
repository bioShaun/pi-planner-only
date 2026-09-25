# 02：标准答案检查；修 T1

Status: ready-for-agent
Type: task
Blocked by: 01

## Problem

T1 的 target `978392f` 放在 parent 加目标测试之上，会让 `tests/contracts/test_replace_primaries_cli_wiring.py` 的 2 个测试失败（上游后来在 `cee4c0f` 改了这些测试）。所以抄答案的 run 被判失败，T1 的失败率反映的是任务本身的缺陷。

## Changes

- 新增 `bench/goldcheck.sh <task-id>`：
  - 用 01 的 `prepare-clone.sh` 准备克隆；
  - 把 target 相对 parent 的非测试改动应用上去（`git -C REPO diff PARENT TARGET -- . ':!tests'`，再 `git apply`）；
  - 按 run.sh 的评测规则（目标测试加 masked suite，对照 baseline）判定，输出 PASS/FAIL 和新增失败列表。
  - 把 run.sh 的评测部分抽成共用脚本，goldcheck 和 run.sh 调同一份，不要复制一份。
- 对 T1、T2、T3 分别跑 goldcheck。T1 预计会失败。修法：把 `cee4c0f` 版本的 `tests/contracts/test_replace_primaries_cli_wiring.py` 作为额外的目标测试，或者用其他能让标准答案通过的最小方案，改动写进 `T1.json` 和 `T1.md`，并重新生成 `baselines/T1.failures.txt`。
- README 写明：新增任务时必须先通过 goldcheck。

## Acceptance

- 三个任务的 goldcheck 都输出 PASS。
- T1 的 prompt 和任务文件改动在票的 Comments 里说明理由。
