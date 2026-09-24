[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘。送出之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`（§11：只开 ISO-38）
只读驱动：`.scratch/planner-only-cost-control/p19-experiment/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p19-experiment/prompt-38-isolated-baseline.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `ISO-38` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p19-experiment/<round_id>-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者。

## 1. 一句话目标

跑 **一组** 付费对照：`ISO-38`（luna 独立执行票 38：两处同一段无界 Set 注释）。跑完就停。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p19-experiment/<round_id>-*.log` 与 `<round_id>-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在。planner 已 restore `orchestrate.test.mjs`；内层 `pi` 只应改 worktree 的 `orchestrate.ts`（样本，不是主仓）。
[不许动] 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs`、`run.sh`、`freeze.md`、`spend.py`、`prompt-38-isolated-baseline.md`、既有 `session-SMOKE` / `session-ISO-39` / `session-SPLIT-39`。
不 commit、不 push、不勾 checkbox。
**禁止** `SPLIT-*`、`ISO-39`、`SMOKE`、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；要超过 0.10 就让驱动 `exit 1`，不要改数字。
**禁止** `git checkout` / 改 worktree HEAD。必须保持 `45d9493e25f47c58911edc01757c6133caeaa39d`。主仓 HEAD 是 `54cc814`，那是 bookkeeping，不是实验基线。

## 3. 步骤

1. `unset CAP_USD`
2. 确认 worktree 基线，不要 checkout：

```
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff --stat
```

期望：HEAD 为 `45d9493e25f47c58911edc01757c6133caeaa39d`；`orchestrate.ts` 与 `orchestrate.test.mjs` **无** tracked diff。若 `orchestrate.test.mjs` 仍有 PASS 挪位 diff，只允许：

```
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment restore orchestrate.test.mjs
```

不要 `rm -rf` worktree，不要切到主仓 HEAD。
3. slot 预检落盘。
4. 只跑：

```
slot cpu -- bash .scratch/planner-only-cost-control/p19-experiment/run.sh ISO-38
```

5. 立刻：

```
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p19-experiment/runs/session-ISO-38
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p19-experiment/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `runs/session-ISO-38`（除非起 pi 之前就撞帽）
- 没有新的 `session-SPLIT-38` / 第二份 `session-ISO-39`
- 两行 spend.py 原文进报告
- worktree 样本 `git -C <WT> diff --stat -- orchestrate.ts` 进报告；不要把样本 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p19-experiment/<round_id>-execution-report.md`。
贴 round_id、起止 HEAD（主仓与 worktree 分开写）、ISO-38 exit、两行 spend.py、没做到的事、假设。
回报只给路径 + 3–6 行。
