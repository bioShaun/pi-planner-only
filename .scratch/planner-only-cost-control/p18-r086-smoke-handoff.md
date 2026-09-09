[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
正文几 KB 以内；长日志落盘，回报给路径 + 3–6 行摘要。
送出报告之后不要再动工作区。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
分支 `planner-only-cost-control`。HEAD 以你开跑时 `git rev-parse HEAD` 为准（派活时约 `f8ae0c3`）。

只读规格：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`
只读驱动：`.scratch/planner-only-cost-control/p19-experiment/run.sh`
只读对账：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`

---

## 0. 环境硬规则

- 禁止 `/tmp`。中间文件放当前目录下有名字的可丢弃子目录，或 `/project/tmp`。
- 超 1 分钟 / 超 2G / 重读写 `/data_0` 走 `slot`。本轮 `SMOKE` 用 `slot cpu --`。
- 起重前先 `slot audit` 和 `slot status`，写入 `.scratch/planner-only-cost-control/p19-experiment/<round_id>-slot-audit.log` 与 `-slot-status.log`。禁止先跑后补查。
- 不得终止别人的重进程，不得 `slot slots` 插队。
- 不读、不回显 `models.json` / `auth.json` 以及任何 `.agent-dir` 里的同名文件。
- 同一 cwd 只有你一个写者。散落的 `.planner-only-test-*` 不要批量删；要清理就 `mv` 进 `.scratch/planner-only-cost-control/quarantine/`。

## 1. 一句话目标

用本地零费率模型跑一次真实 `SMOKE`，证明驱动能起 `pi`、写出宿主会话、并且 `spend.py --require` 得到 **$0.000000**。

本轮**不许**跑 `ISO-*` / `SPLIT-*`，**不许**实现票 38/39，**不许**把 `CAP_USD` 写进环境。

## 2. 围栏

[可以改] 无产品文件。
[可以新建]
- git worktree：`/home/tcuni-claw/pi/pi-planner-only-p19-experiment`（detached，指向当前 HEAD）
- `.scratch/planner-only-cost-control/p19-experiment/<round_id>-*.log`
- `.scratch/planner-only-cost-control/p19-experiment/<round_id>-execution-report.md`
驱动自己会在 `p19-experiment/runs/` 下写会话（已 gitignore）。
[不许动] `index.ts`、测试、`run.sh`、`gate-probe.sh`、`freeze.md`、`spend.py`、`issues/`、`spec.md`。
不 commit、不 git add、不勾 checkbox。
若 worktree 路径已存在：停下来问 planner，不要 `rm -rf`。planner 已清走过一次非 git 残留。

## 3. 步骤

1. `unset CAP_USD`
2. `git worktree add --detach /home/tcuni-claw/pi/pi-planner-only-p19-experiment HEAD`
3. 确认 worktree 的 `index.ts` 存在，且 `git -C <WT> rev-parse HEAD` 等于主仓 HEAD。
4. slot 预检落盘。
5. 只跑这一组（照抄，不要加别的组）：

```
ROOT_MODEL=qwen-local/qwen3.8-27b slot cpu -- bash .scratch/planner-only-cost-control/p19-experiment/run.sh SMOKE
```

6. 立刻：

```
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p19-experiment/runs/session-SMOKE
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p19-experiment/runs
```

期望两行都是 `0.000000`。若第二行不是 0，**停**，不要开付费组、不要改 `CAP_USD`。

## 4. 验收

- worktree HEAD == 主仓 HEAD
- `run.sh SMOKE` 结束（exit 码记下来；非零也可以，只要花费是 0 且有会话）
- `--require` 成功且金额 `0.000000`
- `runs/` 合计 `0.000000`
- `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空
- 没有 `ISO-` / `SPLIT-` 会话目录
- `env | grep CAP_USD` 为空（跑的时候）

## 5. 回报

落盘 `.scratch/planner-only-cost-control/p19-experiment/<round_id>-execution-report.md`。
贴：round_id、起止 HEAD、`git status --short`、worktree HEAD、SMOKE exit、两行 spend.py 原文、没做到的事、假设。
回报 prompt 只给路径 + 3–6 行。
