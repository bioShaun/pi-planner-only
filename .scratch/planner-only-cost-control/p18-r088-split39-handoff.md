[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘。送出之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`（§8–§9：只开 SPLIT-39）
只读驱动：`.scratch/planner-only-cost-control/p19-experiment/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p19-experiment/prompt-39-role-split.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `SPLIT-39` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p19-experiment/<round_id>-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者。

## 1. 一句话目标

跑 **一组** 付费对照：`SPLIT-39`（luna root + qwen-local worker，同一张票 39）。跑完就停。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p19-experiment/<round_id>-*.log` 与 `<round_id>-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在。planner 已把 `orchestrate.test.mjs` restore 回 ISO-39 之前的基线；内层 `pi` 会再改它一次。
[不许动] 主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs`、`run.sh`、`freeze.md`、`spend.py`、两份 `prompt-39-*.md`、`iso-39-orchestrate.test.mjs.diff`。
不 commit、不 push、不勾 checkbox。
**禁止** `ISO-*`、`SMOKE`、`SPLIT-38`、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；要超过 0.10 就让驱动 `exit 1`，不要改数字。

## 3. 步骤

1. `unset CAP_USD`
2. 确认 worktree 仍是基线（PASS 还在中段，不是文件末尾）：

```
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff --stat
```

期望：HEAD 等于主仓 HEAD；`orchestrate.test.mjs` **无** diff。若已有 PASS 在末尾的 diff，先

```
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment restore orchestrate.test.mjs
```

不要 `rm -rf` worktree。
3. slot 预检落盘。
4. 只跑：

```
slot cpu -- bash .scratch/planner-only-cost-control/p19-experiment/run.sh SPLIT-39
```

5. 立刻：

```
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p19-experiment/runs/session-SPLIT-39
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p19-experiment/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `runs/session-SPLIT-39`（除非起 pi 之前就撞帽）
- 没有新的 `session-ISO-38` / `session-SPLIT-38`
- 两行 spend.py 原文进报告
- worktree 样本 `git -C <WT> diff --stat` 进报告；不要把样本 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p19-experiment/<round_id>-execution-report.md`。
贴 round_id、起止 HEAD、SPLIT-39 exit、两行 spend.py、没做到的事、假设。
回报只给路径 + 3–6 行。
