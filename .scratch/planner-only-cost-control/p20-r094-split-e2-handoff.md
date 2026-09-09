[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 agy，pane `w2E:pF`。
**做完必须用 `herdr agent prompt w2E:pF '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘。送出之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p20-scale/freeze.md`（文末 E2）
只读驱动：`.scratch/planner-only-cost-control/p20-scale/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p20-scale/prompt-e2-role-split.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `SPLIT-E2` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p20-scale/<round_id>-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者。

## 1. 一句话目标

跑 **一组** 付费对照：`SPLIT-E2`（luna root + qwen-local worker，同一张 E2）。跑完就停。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p20-scale/<round_id>-*.log` 与 `<round_id>-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在。planner 已把 `orchestrate.ts` / `orchestrate.test.mjs` restore 回基线；内层 `pi` 会再改它们一次。
[不许动] 主仓产品文件、`p19-experiment/` 既有 `runs/`、`p18-contract-run/`、`p20-scale/freeze.md`、`p20-scale/run.sh`、`prompt-e2-*.md`、`iso-e2-*.diff`、既有 `session-ISO-E2` / `session-ISO-E3` / `session-SPLIT-E3` / `session-ABORT-SPLIT-E3`。
不 commit、不 push、不勾 checkbox。
**禁止** `ISO-*`、`SPLIT-E3`、`SPLIT-E1`、p19 的 38/39、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；本驱动写死 `2.86`。不要改这个数字。
**禁止** `git checkout` 改 worktree HEAD。必须保持 `45d9493e25f47c58911edc01757c6133caeaa39d`。
不要 `rm -rf` worktree。

## 3. 步骤

1. `unset CAP_USD`
2. 确认 worktree 基线，不要 checkout：

```bash
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff --stat -- orchestrate.ts orchestrate.test.mjs
```

期望：HEAD 为 `45d9493e25f47c58911edc01757c6133caeaa39d`；两文件 **无** tracked diff。若 ISO-E2 样本仍在，只允许：

```bash
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment restore -- orchestrate.ts orchestrate.test.mjs
```

不要切到主仓 HEAD。
3. slot 预检落盘。
4. 只跑：

```bash
slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh SPLIT-E2
```

5. 立刻：

```bash
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p20-scale/runs/session-SPLIT-E2
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p20-scale/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `p20-scale/runs/session-SPLIT-E2`（除非起 pi 之前就撞帽）
- 没有新的第二份 `session-ISO-E2`
- 两行 spend.py 原文进报告
- worktree `git -C <WT> diff --stat -- orchestrate.ts orchestrate.test.mjs` 进报告；不要把样本 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p20-scale/<round_id>-execution-report.md`。
贴 round_id、起止 HEAD（主仓与 worktree 分开写）、SPLIT-E2 exit、两行 spend.py、没做到的事、假设。
回报用 `herdr agent prompt w2E:pF '<短回报或报告路径>'` 送回，正文只给路径 + 3–6 行。
