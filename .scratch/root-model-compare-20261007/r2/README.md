# R2：Root 模型对照（handoff-mode 持久化）

两臂（opus / sonnet，thinking 均显式 `--model <m>:high`）×2 次，worker 固定 Sonnet(medium)，基线提交 1275050，答案提交 ac4af05（只出现在 meta 与隔离扫描里），插件 b44aa00。运行产物都在 `/project/tmp/root-model-compare/r2/`（`out/`、`runs/`、`tmp/`，不进 git）。结构与 `../r1/` 相同，下面只写要点和差异。

- `prompt.md`：冻结的 Root 提示词（逐字取自 design-r2.md §3；占位符 `{RUN_DIR}`、`{TMPDIR}`）。
- `build_rundir.sh <run-id>`：导出 1275050 到 `runs/<run-id>/repo`，git init，`node_modules` 链接到 `/project/tmp/root-model-compare/deps/node_modules`；自检：单提交、无 ac4af05、node_modules 未跟踪。
- `run_one.sh <opus|sonnet> <rep> [--dry-run]`：每次调用是独立 attempt `R2-<arm>-<rep>-a<N>`；流程同 r1（前置检查 → health → 建目录 → Root → metrics/runcheck/隐藏验收 → `make_eval.py`）。Root 超时 `timeout -k 60 5400`；环境 `PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_MODE=lite PI_PLANNER_ONLY_HANDOFF=off`，unset `PI_PLANNER_ONLY_STRICT`。插件与 deps 复用 r1 `pin_plugin.sh` 已建好的副本（这里只检查存在）。dry-run 不调模型、不跑 health，只打印命令并渲染 prompt。meta.json 额外记录 `agentsMdSha256Before/After`、`agentsMdChanged`、`piAgentTopLevelBefore/After`、`piAgentNewTopLevel`（顶层条目仅记录，不判无效）。
- `make_eval.py`：同 r1，另加 `agentsMdChanged` 为真 → `agents_md_changed` 无效。隐藏验收为 `hidden/check_r2.py`（验收“不通过”不影响 valid）。
- `ledger.py`：`total|preflight|streak|has-valid|next-attempt`。累计 = 所有 attempt（含无效、含 health）。预算 `R2_BUDGET`（默认 13.0 = $15 − 准备阶段约 $2）。某臂预留 = 该臂已观测到的单次最大总费用 × 1.2（费用不完整时为已知下界 + 默认预留）；无观测时默认 opus 6.0 / sonnet 3.0。`preflight`：累计 + 预留 > 预算 → 写 `STOP`（`/project/tmp/root-model-compare/r2/STOP`）并非零退出。连续无效 ≥2 写 STOP。测试：`python3 test_ledger.py`。
- `metrics.py` / `test_metrics_isolation.py`：同 r1，隔离标记换成 `r2/hidden`、`check_r2`、`driver_r2`、`ac4af05`、`r2/fixtures`、`r2/verify`、`handoff-mode-persistence`，通用规则（`pi-planner-only`、`plugin-b44aa00`、`node_modules/..`、`~/.pi` 写操作、deps 以外的实验路径）保留；只允许本次 `r2/runs/<id>` 与 `r2/tmp/<id>`。
- `campaign.sh [--dry-run] --until <S1|O1|S2|O2>`：固定顺序 S1=sonnet-1、O1=opus-1、S2=sonnet-2、O2=opus-2，跑到 `--until`（含）为止，这就是检查点。已有 `.current` 指向 valid=true 的 run 跳过；每次启动前 preflight，结束后 streak 检查；STOP 存在则不启动。非 dry-run 先记录 `slot audit`/`slot status` 到 `campaign.log`，再用 `slot cpu -b` 提交 `lanes/lane-<until>.sh`。dry-run 只打印序列和每次的 `run_one.sh --dry-run` 输出。

## 续跑
确认原因后删除 `/project/tmp/root-model-compare/r2/STOP`，再用下一个 `--until` 重跑 `campaign.sh`；状态全部来自磁盘。

## 隔离边界的局限
同 r1：靠提示词约束加事后扫描工具调用参数，只能发现、不能阻止，不覆盖工具输出的间接泄漏；child 转录位置尽力复制扫描。

正式启动顺序：`campaign.sh --dry-run --until O2` → `campaign.sh --until S1` → 核对 → `campaign.sh --until O1` → 检查点汇报 → `campaign.sh --until O2`。
