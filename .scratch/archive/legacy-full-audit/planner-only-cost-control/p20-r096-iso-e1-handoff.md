[轮次] round_id=p20-r096-iso-e1

你是本轮的**执行者**（pi，pane `w2E:pG`）。
**做完必须把报告落盘**（见 §5）；没有活的 planner pane，报告文件本身就是回报，写完就停。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p20-scale/freeze.md`（文末 E1）
只读驱动：`.scratch/planner-only-cost-control/p20-scale/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p20-scale/prompt-e1-isolated-baseline.md`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `ISO-E1` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p20-scale/p20-r096-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者；不要碰 `quarantine/`。

## 1. 一句话目标

跑 **一组** 付费对照：`ISO-E1`（luna root + luna worker，同一张 E1）。跑完就停。
用户已授权（2026-09-09）；`CAP_USD=2.86` 已写死在驱动里，不许改。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p20-scale/p20-r096-*.log` 与 `p20-r096-execution-report.md`。
worktree `/home/tcuni-claw/pi/pi-planner-only-p19-experiment` 已存在；其当前样本 diff（SPLIT-E2）已由
planner 存为快照（`split-e2-*.diff`），可以 restore。
[不许动] 主仓产品文件、`p19-experiment/` 既有 `runs/`、`p18-contract-run/`、`p20-scale/freeze.md`、
`p20-scale/run.sh`、`prompt-e1-*.md`、既有 `session-*` 各目录、`quarantine/`。
不 commit、不 push、不勾 checkbox。
**禁止** `SPLIT-E1`、`SPLIT-E2`、`ISO-E2`、`ISO-E3`、`SPLIT-E3`、p19 的 38/39、任何第二组。
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

期望：HEAD 为 `45d9493e25f47c58911edc01757c6133caeaa39d`；若 SPLIT-E2 样本仍在，只允许：

```bash
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment restore -- orchestrate.ts orchestrate.test.mjs
```

（快照已存档于 `p20-scale/split-e2-*.diff`，可以放心 restore。）不要切到主仓 HEAD。
3. slot 预检落盘。
4. 只跑：

```bash
slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh ISO-E1
```

5. 立刻：

```bash
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p20-scale/runs/session-ISO-E1
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p20-scale/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `p20-scale/runs/session-ISO-E1`（除非起 pi 之前就撞帽）
- 没有新的第二份 `session-SPLIT-E1` 或其他组
- 两行 spend.py 原文进报告
- worktree `git -C <WT> diff --stat -- orchestrate.ts orchestrate.test.mjs` 进报告；不要把样本 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p20-scale/p20-r096-execution-report.md`：
round_id、起止 HEAD（主仓与 worktree 分开写）、ISO-E1 exit、两行 spend.py、没做到的事、假设。
落盘即回报，不要再改工作区。
