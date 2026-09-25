# 端到端基准

`bench/` 用固定任务、模型配置和插件版本运行并评估 pi；脚本只执行任务，不负责成本汇总。成本之后由 `bench/summarize.py` 汇总。

## 文件

- `tasks/`: 任务元数据与原始提示词；任务 JSON 可用可选 `testRefs` 将单个目标测试路径映射到其来源 commit，未配置的测试从 target 读取；`baseline/` 不在此目录，基线位于 `baselines/`。
- `arms/`: 对比配置。Lite arm 指定 root 模型与插件 ref，direct 不加载插件。
- `run.sh`: 执行单次运行并写入 `$BENCH_OUT/runs/`。每个克隆只包含 parent 可达历史，测试文件取自 target；`runcheck.py` 会标记 transcript 中对 target 提交的引用。
- `campaign.sh`: 配对、交错地提交多任务 campaign。
- `summarize.py` / `prices.json`: 汇总 token、成本和评测结果。

新增任务时添加同名 JSON 和 Markdown prompt，并提供 masked-suite baseline。新增 arm 时添加 JSON，字段沿用现有配置。`pluginRef` 可设为 `WORKTREE` 使用当前工作树，或用 git ref 固定插件快照；campaign 会把干净工作树的 WORKTREE arm 固定到 campaign 创建时的 HEAD。

## 标准答案检查

新增任务投入使用前，必须先通过 `bench/goldcheck.sh <task-id>`。

## 第一层：确定性开销

```bash
npm run bench:overhead
node --experimental-strip-types bench/overhead.mjs static --ref HEAD~2 --ref HEAD
node --experimental-strip-types bench/overhead.mjs corpus .handoff/p21-r100/runs
```

`static` 对比插件系统提示词与工具定义的字符数及近似 token；可用 `--json OUT` 保存结果，指定一个 ref 时与工作树对比，指定两个 ref 时直接对比。`corpus` 汇总 pi JSONL Root assistant 轮次和工具结果长度，并估算结果在后续轮次中的重读成本。近似 token 算法仅用于相对比较，不等同于模型 tokenizer。两条命令都不调用 LLM，通常数秒内完成。

## Campaign

```bash
bench/campaign.sh <名称> <重复次数> <任务逗号列表> <arm逗号列表> [--resume] [--dry-run] [--parallel N]
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --parallel 4
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --dry-run --parallel 4
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --resume
```

Campaign 输出位于 `/project/tmp/ppo-bench/results/<名称>`。提交前会把 `slot audit`、`slot status` 和各 task/rep 的随机化 arm 顺序写入 `campaign.log`，顺序种子及并行 lane 数写入 `campaign.json`。`--parallel N` 将交错后的 run 顺序轮询分配到最多 N 个 lane，每个 lane 顺序执行。`--dry-run` 只显示 lane 分配和提交命令。执行前会按 Root 与 child 模型做健康检查；可用 `BENCH_SKIP_HEALTH=1` 跳过。检查失败退出码为 3，runcheck 判定运行无效时退出码为 4，并写入 `STOP` 熔断后续 lane。campaign 的每条 run 最多尝试 `BENCH_MAX_ATTEMPTS` 次（默认 2）：非最后一次失败时 `run.sh` 只追加一行 `RETRY` 并以退出码 5 退出，lane 把该次文件移入 `void/<id>-attempt<N>-<时间>`，等待 `BENCH_RETRY_DELAY` 秒（默认 120）后重试；最后一次仍失败才写 `STOP`。直接调用 `run.sh` 时默认只尝试 1 次，行为不变。`--resume` 归档 STOP，跳过 eval 标记有效的 run；旧 eval 无 `valid` 字段时按 JSONL 重新检查，无效 run 的旧文件会在 lane 执行时移入 `void/` 后重跑。

## 汇总

```bash
python3 bench/summarize.py /project/tmp/ppo-bench/results/<名称>/runs --weight opus --baseline direct --json summary.json
```

支持多个 runs 目录及 `opus`、`astra`、`sol`、`actual` 权重。缺少评测文件的 run 会列为 `INCOMPLETE`，由 `bench/runcheck.py` 判定无效的 JSONL 会列为 `INVALID` 并从统计中排除。健康检查与 runcheck 不触发额外汇总；`BENCH_DRY_RUN=1` 会打印健康检查命令但不执行。

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

### Root 走 Cline / Command Code 的路由（2026-09-25）

- Cline 的模型 ID 不带 `cline-pass/` 前缀时按 Cline Credits 计费。`control-cline-{muse,mimo,ds}-strict` 三组在 13:15 起收到 402 余额不足，已跑的 12 次全部 INVALID，三组作废。
- ClinePass 在本地区不提供 muse，也没有 mimo-v2.6-flash。这两个模型改走 Command Code Provider API（pi provider `commandcode`，key 为 `TCUNI_COMMAND_KEY`），对应 arm 为 `lite-ccmuse-strict*`、`lite-ccmimo-strict*`。glm-5.3-flash 与 deepseek-v4.1-flash 走 ClinePass，对应 arm 为 `lite-pglm-strict*`、`lite-pds-strict*`。provider 定义在本机 `~/.pi/agent/models.json`，不在仓库内。
- ClinePass 按 5 小时滚动、周、月三层额度计量，撞限会写 STOP，用 `--resume` 续跑。
