# Root 模型对照：进度记录（2026-10-08）

本文给后续会话接手用。设计见 `.scratch/root-model-compare-20261007/design.md`（§4 R1 任务，§5 判读规则，§6 预算与停止条件）。第一阶段结论见 `.scratch/root-model-compare-20261007/findings-phase1.md`。

## 1. 问题与已定事项

- **要回答的问题**：worker 固定为 Sonnet medium，Root 从 Opus 换成 Sonnet 或 DeepSeek Flash 后，交付质量会不会下降，能省多少钱。
- **用户已确认**：
  - 第二阶段总预算 $30；
  - 冻结的提示词和隐藏验收；
  - 先跑一次冒烟测试，再起 9 次正式运行。
- **三个臂**：Root 分别是 `tcuni-claude/claude-opus-5-5`、`tcuni-claude/claude-sonnet-5-5`、`cline/cline-pass/deepseek-v4.1-flash`，thinking 都是 high。
- **固定的运行条件**：
  - 插件固定为日常安装版 b44aa00；
  - 环境变量 `PI_PLANNER_ONLY_MODE=lite`、`PI_PLANNER_ONLY_HANDOFF=off`；
  - 各角色的模型来自 `~/.pi/agent/settings.json`：worker 是 Sonnet medium，explorer 和 validator 是 Luna，reviewer 是 gpt-6.1-sol；
  - 运行期间不得修改 settings.json 的 agentOverrides。
- **R1 任务**：
  - 在基线提交 850933b 导出的独立仓库里做读写锁改动：explorer 之间可以并行，和 worker 仍然互斥；scout 去掉写工具。
  - 答案是提交 f2fe050，Root 看不到。
  - R2（业务数据任务）暂缓，等 R1 的结果再定。

## 2. 产物（已提交：79f0c0b、e36223d；均未 push）

`.scratch/root-model-compare-20261007/r1/`：

| 文件 | 用途 |
|---|---|
| `prompt.md` | 冻结的 Root 提示词（用户级需求，不含实现提示） |
| `build_rundir.sh` / `pin_plugin.sh` | 构造运行目录：用 git archive 导出，再 git init，`node_modules` 指向独立副本 `/project/tmp/root-model-compare/deps/`；固定插件版本 |
| `run_one.sh <arm> <rep>` | 单次运行：健康检查（失败时 30 秒后重试一次）→ 构造目录 → `pi --mode json -p`（`timeout -k 60 3600`）→ metrics → runcheck → 隐藏验收 → `make_eval.py` |
| `campaign.sh` | 交错串行跑 9 次，用 `slot cpu -b` 提交一个 lane；启动前把 slot audit/status 写入日志 |
| `ledger.py` | 费用账本和停止规则：每次启动前检查「累计 + 本次预留 > $28」就停（预留额：opus $8、sonnet $5、dsflash $1.5）；同一臂连续 2 次无效就停 |
| `metrics.py` | 统计 Root 的轮数、费用、上下文最大值、自己读文件和跑命令的次数及结果字符数，以及 child 的费用和按角色的委派次数，并做隔离检查（Root 和 child 的转录都查） |
| `make_eval.py` | 判定一次运行是否有效：runcheck、隔离、模型身份、agentOverrides 是否变动、验收脚本是否完整运行 |
| `hidden/check_r1.py`、`driver.mjs`、`CHECKS.md` | 隐藏验收：18 条自动、2 条人工。答案 f2fe050 得 18/18，基线 7/18 |

运行产物在 `/project/tmp/root-model-compare/r1/`：
- `out/`：每次尝试的 jsonl、meta、metrics、eval、check、children；
- `runs/`：运行目录；
- `campaign.log`：slot 预检记录和事件备注；
- `STOP*`：停止标记。

每次尝试的 ID 形如 `R1-<arm>-<rep>-a<N>`。`out/R1-<arm>-<rep>.current` 指向当前采用的那次尝试。

## 3. 已发生的事

1. **冒烟测试（dsflash1）**：
   - a1：Luna 健康检查超时，判无效。手动重试正常，之后给健康检查加了一次重试。
   - a2：DS Flash 在第 33 轮收到 provider 的「Stream error occurred」，判无效。pi 1.0.4 的可重试错误列表里没有这条文案，所以不会自动重试，属于环境故障。
   - a3：有效。隐藏验收自动项 15/18，人工 2 条未评。总费用 $0.84（Root $0.10，child $0.73）。Root 43 轮，自己读文件 33 次、跑命令 24 次，委派 worker 1 次、validator 1 次、reviewer 2 次。
2. **a3 起初被误判为无效，lane 因此写了 STOP**。原因有三，已在 e36223d 修复：
   - 隔离正则把项目名和「转告 worker 的禁读路径」当成越界。现在只在读取类工具里查路径；答案提交号、隐藏验收等标记仍在任何位置都查。
   - worker 模型名带 `:medium` 后缀时没有拆开解析。
   - 别的会话改了 settings.json 的 enabledModels。现在只比对 agentOverrides。

   修复后 a3 重新判为有效，旧判定保存为 `.eval.v1.json`。旧的 STOP 改名为 `STOP.20261008T0750-false-invalid`。
3. **2026-10-08 07:51 重新提交 campaign，slot 任务号 2824**。顺序是 dsflash1（已有有效结果，跳过）、sonnet1、opus1、dsflash2、sonnet2、opus2、sonnet3、opus3、dsflash3。写这份记录时 sonnet1-a1 正在运行。
4. **费用**：准备阶段约 $2；冒烟 3 次合计 $1.03。正在运行的尝试按预留额计入账本，所以 `ledger.py total` 显示 $6.06。

## 4. 接手步骤

1. **查状态**：
   ```bash
   slot status | grep '^2824 '
   ls /project/tmp/root-model-compare/r1/STOP
   python3 .scratch/root-model-compare-20261007/r1/ledger.py total /project/tmp/root-model-compare/r1/out
   ```
   查看各 `.current` 文件和对应的 `eval.json`。
2. **如果出现 STOP**：
   - 先读 STOP 的内容和对应尝试的 `eval.json` 里的 `invalid_reasons`，判断是真故障还是检查误判。
   - 是误判就修检查，然后对已有结果重新运行 `metrics.py` 和 `make_eval.py`（先备份旧的 eval）。
   - STOP 改名后重新执行 `campaign.sh`：已有有效结果的会自动跳过。重新提交前把 `slot audit`/`slot status` 写进 `campaign.log`（campaign.sh 会自动做）。
3. **9 次都有效后，逐次核对**：
   - 隔离标记；
   - 在 `children/` 下抽查 child 转录；
   - 两条人工项：`scout_write_report`，以及 `readme_consistent:manual`。判定细则见 `hidden/CHECKS.md`，素材是 metrics 里的 `final_text` 和运行目录中的 README。
   - Root 审查时是否发现并修正了 worker 的缺陷（看 reviewer、validator 的结果之后有没有返工委派）。
4. **按设计稿 §5 判读**：
   - 便宜臂的平均通过数不低于 Opus 平均减 1；
   - 没有 Opus 从未出现过的 P1 缺陷；
   - 需要人工介入的不超过 1 次。

   结论写进证据文档，并给出 R2 是否要做的建议。
5. 在结果里单独记录各臂因 provider 中断（例如 Stream error）造成的无效次数，作为可靠性指标。

## 5. 其他待办

- 建议 2 的盲评仍等用户来做，素材位置不变。
