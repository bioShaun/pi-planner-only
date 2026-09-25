# 02：标准答案检查；修 T1

Status: done
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

## Comments

T2：`GOLD T2 PASS`，new_failures=[]，target_failed=[]。T3：`GOLD T3 PASS`，new_failures=[]，target_failed=[]（masked suite exit=1，但无相对 baseline 的新增失败）。

T1 修正：将 `tests/contracts/test_replace_primaries_cli_wiring.py` 作为额外目标测试，来源固定为 `cee4c0f074bd43efebc76942d2682f152caeb074`，因为 TARGET 中 `_run_annotate` 改经 `ExternalTool.run`，该测试在上游 cee4c0f 版本中相应改为 patch `rp.ExternalTool.run`。prompt 和目标测试列表已同步；clone 准备脚本支持可选 `testRefs`，README 已记载。

验证：重建 T1 masked baseline，仍为 13 个失败 ID，added=[]，removed=[]，因此 `bench/baselines/T1.failures.txt` 未改。`slot cpu -- bench/goldcheck.sh T1` 输出 `GOLD T1 PASS`（target_failed=[]，new_failures=[]，suite_exit=1）；`slot cpu -- bench/goldcheck.sh T3` 同样输出 `GOLD T3 PASS`。四目标文件在 BASE 上的 pytest 调用退出码为 2，因首个测试导入时缺少尚未实现的 `ExternalToolTimeoutError` 而在 collection 阶段中止。
- 2026-09-25 Root 验收：evaluate.sh 与原来的评测代码逐行一致。修了一处回归：run.sh 调用 evaluate.sh 时没有传入 ARM/ID，eval.json 里的 arm 会变成 gold，现在显式传入。T1 的 `/project/tmp/ppo-bench/gold/T1.eval.json` 显示 pass=true、new_failures 为空。T1 改成 4 个目标测试，所以与旧的 T1 结果不能直接比较。
