[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘。送出之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`（含 §8：只开 ISO-39）
只读驱动：`.scratch/planner-only-cost-control/p19-experiment/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p19-experiment/prompt-39-isolated-baseline.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `ISO-39` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p19-experiment/<round_id>-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者。

## 1. 一句话目标

跑 **一组** 付费对照：`ISO-39`（luna 独立执行票 39）。跑完就停。看账单是 planner 的事。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p19-experiment/<round_id>-*.log` 与 `<round_id>-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在（p18-r086，detached）。驱动会在 worktree 里让内层 `pi` 改 `orchestrate.test.mjs`——那是样本，不是你在主仓改。
[不许动] 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs`、`run.sh`、`freeze.md`、`spend.py`、`prompt-39-isolated-baseline.md`。
不 commit、不 push、不勾 checkbox。
**禁止** `SPLIT-*`、`ISO-38`、`SMOKE`、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；要超过 0.10 就让驱动 `exit 1`，不要改数字。

## 3. 步骤

1. `unset CAP_USD`
2. 把 worktree 对到当前主仓 HEAD（不要新建 worktree）：
   `git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment checkout --detach "$(git rev-parse HEAD)"`
   若这条失败，停下来问 planner，不要 `rm -rf`。
3. slot 预检落盘。
4. 只跑：

```
slot cpu -- bash .scratch/planner-only-cost-control/p19-experiment/run.sh ISO-39
```

5. 立刻：

```
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p19-experiment/runs/session-ISO-39
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p19-experiment/runs
```

撞帽（exit 1 且含 SPEND GATE）也是有效结果：原样记录，不要改 cap、不要改跑 SPLIT。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `runs/session-ISO-39`（除非驱动在起 pi 之前就撞帽）
- 没有 `session-SPLIT-*`、`session-ISO-38`
- `spend.py` 两行数字写进报告（原文）
- worktree 若有 `orchestrate.test.mjs` diff，那是样本产物，报告里给 `git -C <WT> diff --stat`，不要把它 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p19-experiment/<round_id>-execution-report.md`。
贴 round_id、起止 HEAD、ISO-39 exit、两行 spend.py、没做到的事、假设。
回报只给路径 + 3–6 行。
