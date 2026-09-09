[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘。送出之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p20-scale/freeze.md`
只读驱动：`.scratch/planner-only-cost-control/p20-scale/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p20-scale/prompt-e3-isolated-baseline.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `ISO-E3` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p20-scale/<round_id>-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者。

## 1. 一句话目标

跑 **一组** 付费对照：`ISO-E3`（luna 独立执行 F6 E3：exhausted 拒启与 untrusted 一样删掉 usageBudget）。跑完就停。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p20-scale/<round_id>-*.log` 与 `<round_id>-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在。planner 已 restore `orchestrate.ts`；内层 `pi` 只应改 worktree 的 `orchestrate.ts` / `orchestrate.test.mjs`。
[不许动] 主仓产品文件、`p19-experiment/` 既有 `runs/`、`p18-contract-run/`、`p20-scale/freeze.md`、`p20-scale/run.sh`、`prompt-e3-isolated-baseline.md`。
不 commit、不 push、不勾 checkbox。
**禁止** `SPLIT-*`、`ISO-E2`、`ISO-E1`、p19 的 `ISO-38`/`SMOKE`、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；本驱动写死 `2.86`。不要改这个数字。
**禁止** `git checkout` 改 worktree HEAD。必须保持 `45d9493e25f47c58911edc01757c6133caeaa39d`。

## 3. 步骤

1. `unset CAP_USD`
2. 确认 worktree：

```
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff --stat
```

期望 HEAD 为 `45d9493e25f47c58911edc01757c6133caeaa39d`；`orchestrate.ts` 无 tracked diff。若 38 的注释仍在，只允许 restore `orchestrate.ts`。不要切到主仓 HEAD。
3. slot 预检落盘。
4. 只跑：

```
slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh ISO-E3
```

5. 立刻：

```
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p20-scale/runs/session-ISO-E3
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p20-scale/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `p20-scale/runs/session-ISO-E3`（除非起 pi 之前就撞帽）
- 没有 `session-SPLIT-E3`
- 两行 spend.py 原文进报告
- worktree `git -C <WT> diff --stat` 进报告；不要把样本 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p20-scale/<round_id>-execution-report.md`。
贴 round_id、起止 HEAD、ISO-E3 exit、两行 spend.py、没做到的事、假设。
回报只给路径 + 3–6 行。
