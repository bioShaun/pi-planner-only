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

## 初筛 Root 的选择（2026-09-25 试跑）

T1–T3 × 2 次，成本按 opus 价，参照 2026-09-24 的 sol lite（轮数 15–22，每次委派 5–7 次，$1.05–2.01）：

| arm | 通过 | Root 轮数 | 每次委派 | 每次成本 |
|---|---|---|---|---|
| lite-kimi | 6/6 | 18–32 | 0–1 | $0.61–1.68 |
| lite-gemini | 6/6 | 35–106 | 1–11 | $2.57–9.54 |
| lite-kimi-strict | 6/6 | 14–18 | 3–8 | $0.57–1.12 |

- kimi 在默认模式下几乎不委派，等于 direct 模式；gemini 轮数多、波动大，实价也不比 sol 便宜。
- 初筛用 `lite-kimi-strict`（kimi + `PI_PLANNER_ONLY_STRICT=1`）：行为最接近 sol，同任务两次差异最小。
- 它测的是严格模式。改提示词措辞、调整"小事自己做"这类改动，结论必须在 `lite-opus` 上确认。
