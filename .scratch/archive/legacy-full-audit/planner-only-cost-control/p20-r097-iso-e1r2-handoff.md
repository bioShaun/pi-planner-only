[轮次] round_id=p20-r097-iso-e1r2

你是本轮的**执行者**（pi，pane `w2E:pG`）。
**做完必须把报告落盘**（见 §5）；没有活的 planner pane，报告文件本身就是回报，写完就停。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
只读规格：`.scratch/planner-only-cost-control/p20-scale/freeze.md`（文末 E1 + 失败记录）
只读驱动：`.scratch/planner-only-cost-control/p20-scale/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`
只读票面 prompt：`.scratch/planner-only-cost-control/p20-scale/prompt-e1-isolated-baseline.md`

**背景（为什么重跑）**：r096 的 ISO-E1 无效——worktree 没被 restore，残留的 SPLIT-E2 样本被当成
本轮产物，$0.157509 沉没。本轮驱动已加基线闸门（worktree 不干净直接 `exit 1`），组名改为
`ISO-E1R2`。worktree 已由 planner restore 到干净基线并验证。

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的子目录，或 `/project/tmp`。
- 本轮 `ISO-E1R2` 用 `slot cpu --`。起重前 `slot audit` + `slot status` 写入
  `.scratch/planner-only-cost-control/p20-scale/p20-r097-slot-audit.log` 与 `-slot-status.log`。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json`。
- 同一 cwd 只有你一个写者；不要碰 `quarantine/`。

## 1. 一句话目标

重跑 **一组** 付费对照：`ISO-E1R2`（luna root + luna worker，E1 票）。跑完就停。

## 2. 围栏

[可以改] 无主仓产品文件。
[可以新建] `.scratch/planner-only-cost-control/p20-scale/p20-r097-*.log` 与 `p20-r097-execution-report.md`。
[不许动] 主仓产品文件、`p19-experiment/` 既有 `runs/`、`p18-contract-run/`、`p20-scale/freeze.md`、
`p20-scale/run.sh`、`prompt-e1-*.md`、既有 `session-*` 各目录（含 `session-ISO-E1` 与
`session-ABORT-ISO-E1R2`，都是留证记录）、`quarantine/`。
不 commit、不 push、不勾 checkbox。
**禁止** `ISO-E1`、`SPLIT-E1`、`SPLIT-E2`、`ISO-E2`、`ISO-E3`、`SPLIT-E3`、p19 的 38/39、任何第二组。
**禁止** 把 `CAP_USD` 写进环境；本驱动写死 `2.86`。不要改这个数字。
**禁止** `git checkout` 改 worktree HEAD。必须保持 `45d9493e25f47c58911edc01757c6133caeaa39d`。
不要 `rm -rf` worktree。

## 3. 步骤

1. `unset CAP_USD`
2. **亲自验证** worktree 干净（不要只引用本工单的话）：

```bash
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment rev-parse HEAD
git -C /home/tcuni-claw/pi/pi-planner-only-p19-experiment diff -- orchestrate.ts orchestrate.test.mjs
```

两条命令的**原样输出**都要进报告。HEAD 必须是 `45d9493e25f47c58911edc01757c6133caeaa39d`，
diff 必须为空。若 diff 非空，只允许
`git -C <WT> restore -- orchestrate.ts orchestrate.test.mjs` 后**重新验证**并把前后输出都写进报告。
3. slot 预检落盘。
4. 只跑：

```bash
slot cpu -- bash .scratch/planner-only-cost-control/p20-scale/run.sh ISO-E1R2
```

（驱动自带的基线闸门会在 worktree 不干净时 `exit 1`——那也是有效结果，照记，restore 后重试一次；
再失败就停下报告。）

5. 立刻：

```bash
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p20-scale/runs/session-ISO-E1R2
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p20-scale/runs
```

撞帽也是有效结果：原样记录，不要改 cap，不要再开一组。

## 4. 验收（r096 的教训：形状对不等于内容对）

- 主仓 `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 有 `p20-scale/runs/session-ISO-E1R2`
- **样本内容必须对照 E1 票面逐项检查**（不要只看 diffstat 是 1+1）：
  `grep -c isQuarantined <WT>/orchestrate.ts` ≥ 1；
  worktree diff 里含 `隔离在会话内不解除`；
  **不含** E2 的 `writeErrorFor` 状态行与 `本会话无法写入该 taskId 的账本`（那是残留样本的特征）。
  三条 grep 的输出原文进报告。
- 两行 spend.py 原文进报告
- worktree `git -C <WT> diff --stat -- orchestrate.ts orchestrate.test.mjs` 进报告；不要 checkout 回主仓

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p20-scale/p20-r097-execution-report.md`：
round_id、起止 HEAD（主仓与 worktree 分开写）、ISO-E1R2 exit、两行 spend.py、
第 2 步与第 4 步的原样输出、没做到的事、假设。落盘即回报，不要再改工作区。
