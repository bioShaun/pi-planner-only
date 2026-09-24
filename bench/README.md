# 端到端基准

`bench/` 用固定任务、模型配置和插件版本运行并评估 pi；脚本只执行任务，不负责成本汇总。成本之后由 `bench/summarize.py` 汇总。

## 文件

- `tasks/`: 任务元数据与原始提示词；`baseline/` 不在此目录，基线位于 `baselines/`。
- `arms/`: 对比配置。Lite arm 指定 root 模型与插件 ref，direct 不加载插件。
- `run.sh`: 执行单次运行并写入 `$BENCH_OUT/runs/`。

新增任务时添加同名 JSON 和 Markdown prompt，并提供 masked-suite baseline；新增 arm 时添加 JSON，字段沿用现有配置。`pluginRef` 可设为 `WORKTREE` 使用当前工作树，或用 git ref 固定插件快照。

## 运行

```bash
export BENCH_OUT=/project/tmp/ppo-bench/results/<campaign>
slot audit > /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot status >> /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot cpu -- bench/run.sh T1 lite-sol 1
```

也可用 `slot cpu -b` 后台提交。每次启动重跑前必须执行 `slot audit` 与 `slot status`，并把输出记录到 campaign 日志。运行结果、stderr、耗时、退出码及评测分别保存在 `runs/` 下；克隆默认在成功评测后删除，可设 `BENCH_KEEP_CLONE=1` 保留。`BENCH_DRY_RUN=1` 只执行预检和命令展示，不启动 pi。
