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
| `test_metrics_isolation.py` | 「写入 ~/.pi」隔离检查的单测：真实误判形态不报，故障注入的真写入必须报（`python3 -m unittest test_metrics_isolation`，在 r1/ 下运行） |
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
5. **slot 2824 在 08:38 停止**：sonnet1、opus1、dsflash2、opus2 四次都被判为 `isolation: write-to-~/.pi`，opus 臂连续 2 次无效，于是触发 STOP。逐条核对后确认全是误判：
   - write/edit 只要内容里提到 `~/.pi` 就报警；
   - bash 规则会把同一行里 `sed -i` 改仓库文件之后的 `grep`/`ls ~/.pi` 算成写入；
   - heredoc 正文里的 `<runId>` 含有 `>`，被当成了重定向。

   运行期间 `~/.pi` 只有 pi 自身的 missions 状态有变动；settings.json 在 09:19 才被修改，晚于 campaign 结束。
6. **修复（09:2x）**：`metrics.py` 改为按「写入目标」判断：
   - write/edit 看 `path`/`file_path`；
   - apply_patch 看 `*** ... File:` 目标；
   - bash 先去掉 heredoc 正文，再用 shlex 按 `; && || | &` 分段；在每段里看重定向目标、`tee/mv/rm/touch/mkdir/...` 的参数、`sed -i` 的文件参数，以及 `cp/install/ln/rsync` 的目标（最后一个参数或 `-t`）；
   - 无法解析时退回旧的启发式规则，按段判断（宁可多报）。

   新增 `test_metrics_isolation.py`：先跑出 5 条误判用例的红灯，修复后 19/19 通过。

   之后做了一轮 reviewer 审查（gpt-6.1-sol），按审查意见补齐：
   - 注释里的 `<<EOF` 不再被当成 heredoc 起点；
   - 识别 `cp -t/path` 这种紧贴写法的 `-t`；
   - `command --` 等包装命令会跳过其选项；
   - `bash/sh -c` 会递归检查内层命令；
   - 增加 `<>`、`>&` 两种重定向；
   - 无法解析时，只要同时出现写操作痕迹和 `~/.pi` 就报警；
   - 参数不是 dict 或字符串时不再崩溃。

   测试先红后绿，现在 26/26 通过。已知未修的问题（审查定为 P2，属于可能多报的方向）：
   - 数字形式的 heredoc 定界符；
   - 引号里的 `'>'` 会被当成重定向。

   `python -c`/`node -e` 在代码里写文件的情况不在检测范围内（旧版本同样不查）。

   已有的 6 次全部重评为有效，除 isolation_flags 外其他指标与旧值一致；旧文件保存为 `*.metrics.v2.json`/`*.eval.v2.json`。STOP 改名为 `STOP.20261008T0838-false-invalid`。
7. **09:27 重新提交 campaign，slot 任务号 2832**。已有有效结果的 6 次自动跳过，只补跑 sonnet3、opus3、dsflash3。提交时账本累计 $9.15。

当前已有结果（自动项共 18 条，另有 2 条人工项未评）：

| 尝试 | 自动项 | 总费用 | Root 费用 | Root 轮数 | 未过项 |
|---|---|---|---|---|---|
| dsflash-1-a3 | 15/18 | $0.84 | $0.10 | 43 | handoff_guard、assertions_kept、scout_write_tools |
| sonnet-1-a1 | 18/18 | $1.44 | $0.91 | 24 | — |
| opus-1-a1 | 18/18 | $2.24 | $1.73 | 31 | — |
| dsflash-2-a1 | 16/18 | $0.72 | $0.10 | 55 | reviewer_unaffected、assertions_kept |
| sonnet-2-a1 | 17/18 | $0.62 | $0.62 | 20 | scout_write_tools |
| opus-2-a1 | 18/18 | $2.93 | $2.34 | 37 | — |
| sonnet-3-a1 | 17/18 | $0.72 | $0.72 | 20 | scout_write_tools |

注意：sonnet-2 和 sonnet-3 的 child 费用都是 $0，Root 一次委派也没有，全部自己完成；只有 sonnet-1 委派了。判读时要单独讨论，这不符合 planner-only 的用法。

8. **09:59 campaign 完成**（lane_done）：9 次全部有效，账本累计 $14.93。
   - opus-3：冻结分 8/18，$4.35。
   - dsflash-3：16/18，$0.66。
   - 人工项、P1 核对和判读已完成，结论见 `.scratch/root-model-compare-20261007/findings-phase2.md`。要点：
     - opus-3 的低分是隐藏 driver 不应答 pi-subagents 运行时注册事件造成的，变体为 `r1/supplementary/driver_reg.mjs`；
     - handoff_guard 只检查拒绝文案；
     - 冻结提示词「explorer 和 reviewer …和 worker 仍互斥」有歧义，dsflash-2/3 照字面给 reviewer 加了锁。

sonnet-3 的 metrics 是 lane 用中间版代码算的，已用最终版重算，结果仍为有效（旧文件为 `.v2.json`）。opus3 和 dsflash3 会直接用最终版。

## 4. 接手步骤

> **2026-10-08 用户决定**（采纳 findings-phase2 的建议）：
> - 采用裁量口径。
> - 日常 Root 试用 Sonnet，并配套两条规则：
>   - 涉及多文件或行为变更的任务，收尾前至少派一次 reviewer；
>   - 需求有歧义或需要做大的设计取舍时，切回 Opus。
> - 做 R2：Sonnet 和 Opus 各 2 次，预算约 $15。任务要选靠 Root 自己做明显不划算的，提示词不能有歧义，检查不绑定答案特有的接口或文案。
> - DS Flash 暂不用作日常 Root。
>
> **2026-10-08 11:30 R2 已完成**：
> - 日常 Root 已是 Sonnet high（settings 原本就是这个值，未改动）；规则 (a)(b) 已写进 `~/.pi/agent/AGENTS.md`。
> - R2 设计见 `design-r2.md`，脚手架见 `r2/`，结论见 `findings-r2.md`。
> - 4 次全部有效：质量无明显差异；Sonnet 的总费用是 Opus 的 47%；在规则 (a) 下 Sonnet 两次都派了 reviewer，但实现不委派。
> - 花费约 $7。
> - 待用户决定：是否给规则 (a) 补上「审查意见要么修掉，要么说明理由」。
>
> 2026-10-08 10:xx：下面第 1–5 步已全部完成，结论见 `findings-phase2.md`。剩余待办：
> - 用户确认是否把日常 Root 换成 Sonnet；
> - 用户确认是否做 R2。R2 要选一个更大的任务，提示词不能有歧义，隐藏检查不要绑定答案特有的接口或文案。

1. **查状态**：
   ```bash
   ps -ef | grep -E 'lane.sh|run_one.sh' | grep -v grep   # slot 任务 2832；slot status 里未必按任务号显示
   tail /project/tmp/root-model-compare/r1/campaign.log
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
