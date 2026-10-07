# R1：Root 模型对照

三臂（opus / sonnet / dsflash，thinking 均为 high）×3 次，worker 固定 Sonnet(medium)，基线提交 850933b，插件 b44aa00。运行产物都在 `/project/tmp/root-model-compare/r1/`（不进 git）。

- `prompt.md`：冻结的 Root 提示词（占位符 `{RUN_DIR}`、`{TMPDIR}`）。
- `build_rundir.sh <run-id>`：导出基线到 `runs/<run-id>/repo`，git init，`node_modules` 链接到隔离副本 `/project/tmp/root-model-compare/deps/node_modules`（不是 MAIN），自检（单提交、无 f2fe050）。
- `pin_plugin.sh`：一次性导出 b44aa00 到 `/project/tmp/root-model-compare/plugin-b44aa00/`，核对日常安装版本，并把 MAIN/node_modules `cp -a` 到 `deps/node_modules`（已存在则跳过）；插件副本和各 run 目录都链接到这份副本。
- `run_one.sh <arm> <rep> [--dry-run]`：每次调用是一个独立 attempt，id 为 `R1-<arm>-<rep>-a<N>`（N=已有最大值+1），所有产物（`runs/`、`tmp/`、`out/`）都用 attempt id，不覆盖旧尝试；`out/R1-<arm>-<rep>.current` 指向最新 attempt，正式结果以 `.current` 指向且 `valid=true` 的 attempt 为准。流程：前置检查 → health（`--mode json`，费用写 `<id>.health.json` 并计入累计）→ 建 run 目录 → Root（`timeout -k 60 3600`，环境 `PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_MODE=lite PI_PLANNER_ONLY_HANDOFF=off`，unset `PI_PLANNER_ONLY_STRICT`，写入 meta.json；handoff 关闭因 `-p` 无人值守下交接会话无法继续，三臂相同）→ 复制 child 转录到 `<id>.children/` → metrics/runcheck/隐藏验收 → `make_eval.py`。`valid=false` 时以非零退出；health/build 阶段失败的 attempt 也写 eval.json（`root_started=false`）。dry-run 用 `R1-<arm>-<rep>-dryrun`，不调模型、不占 attempt 号。
- `make_eval.py <out> <attempt-id> [--early reason]`：合成 `<id>.eval.json`。以下任一使 `valid=false` 并写入 `invalid_reasons`：runcheck 无效；isolation_flags 非空；settingsChanged；metrics 缺失；隐藏验收退出码非 0 或输出缺 `checks/auto_pass/auto_total`（验收“不通过”不影响 valid）；Root 实际模型与期望不符；worker 模型/thinking 与 Sonnet medium 不符（取不到记 `worker_identity: unknown`，不判无效）。
- `ledger.py`：费用账本与停止规则（`total|preflight|streak|has-valid|next-attempt`）。累计 = 所有 attempt（含无效、含 health）；`cost_complete=false` 或 metrics 读不出的 attempt 按“已知下界 + 该臂预留值”计。预留值 opus $8 / sonnet $5 / dsflash $1.5（`ledger.py` 顶部 `RESERVE`，预算 `BUDGET`=28：第二阶段上限 $30 减去准备阶段约 $2）。
- `campaign.sh [--dry-run]`：固定种子交错 9 次，生成 `lanes/lane.sh`，预检 slot audit/status（写 `campaign.log`），用 `slot cpu -b` 提交。每次启动前 `ledger.py preflight`：累计 + 本次预留 > $28 写 `STOP`；每次 attempt 结束后由磁盘上的 eval.json 重算该臂“最近连续无效次数”，≥2 写 `STOP`（有效结果重置，已有有效结果被跳过也等于重置）。状态全部来自磁盘，lane 无进程内计数。
- `metrics.py <run.jsonl>`：费用（含 `compaction_end` 的 usage）、轮数、上下文、Root 工具分类、隔离检查。delegate 发起/结束配对；有发起无结束、结束无 usage、child 模型无价格、Root 某轮 usage 缺失 → `cost_complete=false`、`total_cost=null`，`known_cost_lower_bound` 给已知部分，绝不以 0 代替未知。`--health-merge` 汇总 health 流。
- `hidden/check_r1.py`：隐藏验收；子进程在独立进程组，超时 `killpg` 整组；npm 测试上限 300s（调试用环境变量 `R1_CHECK_TEST_TIMEOUT` 可调小）。

## 续跑与账本
- 费用账本：`out/*.health.json`、`out/*.metrics.json`、`out/*.eval.json`，由 `python3 ledger.py total /project/tmp/root-model-compare/r1/out` 汇总。
- 续跑：确认原因后删除 `/project/tmp/root-model-compare/r1/STOP`，重跑 `campaign.sh`；lane 会跳过 `.current` 已有有效结果的 run，并在每次启动前重新检查预算。

## 隔离边界的局限
- Root 的读取隔离靠提示词约束加事后扫描，不是内核级：Root 工具调用参数里出现 `pi-planner-only`、`plugin-b44aa00`、`r1/hidden`、`check_r1`、`f2fe050`、`node_modules/..`、deps 以外的 `/project/tmp/root-model-compare` 路径、对 `~/.pi` 的写操作，记 isolation flag 并使该 attempt 无效；但只能发现、不能阻止，且只覆盖工具调用参数（不含工具输出间接泄漏，如 grep 命中）。
- child 读取：lite 模式下 child 转录位置**未在真机核实**（未执行任何 pi 会话）。run_one.sh 只能尽力把 Root TMPDIR 下名含 `transcript` 的 jsonl 复制到 `<id>.children/` 并用相同规则扫描；找不到时 child 读取只靠提示词约束，未核查。
- 费用不含 child 内部可能的压缩调用；compaction 费用按 Root 模型价格计。

正式启动顺序：`pin_plugin.sh` → `campaign.sh --dry-run` → 用户确认 → `campaign.sh`。
