# 端到端基准

`bench/` 用固定任务、模型配置和插件版本运行并评估 pi；脚本只执行任务，不负责成本汇总。成本之后由 `bench/summarize.py` 汇总。

## 文件

- `tasks/`: 任务元数据与原始提示词；`baseline/` 不在此目录，基线位于 `baselines/`。
- `arms/`: 对比配置。Lite arm 指定 root 模型与插件 ref，direct 不加载插件。
- `run.sh`: 执行单次运行并写入 `$BENCH_OUT/runs/`。
- `campaign.sh`: 配对、交错地提交多任务 campaign。
- `summarize.py` / `prices.json`: 汇总 token、成本和评测结果。

新增任务时添加同名 JSON 和 Markdown prompt，并提供 masked-suite baseline；新增 arm 时添加 JSON，字段沿用现有配置。`pluginRef` 可设为 `WORKTREE` 使用当前工作树，或用 git ref 固定插件快照。

## 第一层：确定性开销

```bash
npm run bench:overhead
node --experimental-strip-types bench/overhead.mjs static --ref HEAD~2 --ref HEAD
node --experimental-strip-types bench/overhead.mjs corpus .handoff/p21-r100/runs
```

`static` 对比插件系统提示词与工具定义的字符数及近似 token；可用 `--json OUT` 保存结果，指定一个 ref 时与工作树对比，指定两个 ref 时直接对比。`corpus` 汇总 pi JSONL Root assistant 轮次和工具结果长度，并估算结果在后续轮次中的重读成本。近似 token 算法仅用于相对比较，不等同于模型 tokenizer。两条命令都不调用 LLM，通常数秒内完成。

## Campaign

```bash
bench/campaign.sh <名称> <重复次数> <任务逗号列表> <arm逗号列表>
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --dry-run
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --resume
```

Campaign 输出位于 `/project/tmp/ppo-bench/results/<名称>`。提交前会把 `slot audit`、`slot status` 和各 task/rep 的随机化 arm 顺序写入 `campaign.log`，顺序种子也写入 `campaign.json`。`--resume` 只跳过已有 `.eval.json` 的 run。

## 汇总

```bash
python3 bench/summarize.py /project/tmp/ppo-bench/results/<名称>/runs --weight opus --baseline direct --json summary.json
```

支持多个 runs 目录及 `opus`、`astra`、`sol`、`actual` 权重。缺少评测文件的 run 会列为 `INCOMPLETE`，并排除在汇总外。便宜 Root 模型的成本按 opus 权重计算的 token 成本，只能在相同 Root 模型之间比较；得出结论前，应在真实 Root（`lite-opus`）上确认结果。

## 运行

```bash
export BENCH_OUT=/project/tmp/ppo-bench/results/<campaign>
slot audit > /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot status >> /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot cpu -- bench/run.sh T1 lite-sol 1
```

也可用 `slot cpu -b` 后台提交。每次启动重跑前必须执行 `slot audit` 与 `slot status`，并把输出记录到 campaign 日志。运行结果、stderr、耗时、退出码及评测分别保存在 `runs/` 下；克隆默认在成功评测后删除，可设 `BENCH_KEEP_CLONE=1` 保留。`BENCH_DRY_RUN=1` 只执行预检和命令展示，不启动 pi。
