# p18-r085 执行报告

## 基本信息

- round_id: `p18-r085`
- 开始 HEAD: `6b66126d28fe37595d414c6b82c432c4462b969e`
- 结束 HEAD: `6b66126d28fe37595d414c6b82c432c4462b969e`
- 分支: `planner-only-cost-control`
- 未调用真实 `pi`，未运行 `npm test`。

## 变更

新增：

- `.scratch/planner-only-cost-control/p19-experiment/run.sh`
- `.scratch/planner-only-cost-control/p19-experiment/gate-probe.sh`
- `.scratch/planner-only-cost-control/p19-experiment/root-prompt-smoke.md`
- 本报告

`run.sh` 固定 `CAP_USD=0.10` 并拒绝启动时已定义的环境变量；使用绝对路径调用现有 p18 `spend.py`；每组启动前检查金额，每组结束以 `--require` 对账；只链接 `models.json`、`models-store.json`、`auth.json`，不链接 `settings.json`。`gate-probe.sh` 的完整路径为：

`.scratch/planner-only-cost-control/p19-experiment/gate-probe.sh`

## 验收结果

执行的核心命令及结果：

```text
bash -n run.sh gate-probe.sh                         exit 0
GREP_OVERRIDE_EXIT:1
A exit=1                                               (CAP_USD 环境覆盖被拒绝，假 pi 未调用)
B exit=1                                               (假 pi 被调用，--require 无会话失败)
C exit=1                                               (0.100000 命中 SPEND GATE，假 pi 未调用)
gate probes passed: A=1 B=1 C=1                     exit 0
PROBE_EXIT:0 PI_EXIT:0
```

`command -v pi` 输出：

```text
/home/tcuni-claw/.nvm/versions/node/v24.14.0/bin/pi
```

C 探针假 jsonl 的数字由现有对账脚本测量，命令和输出为：

```text
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py .scratch/planner-only-cost-control/p19-experiment/session-SEED
0.100000
python3 .scratch/planner-only-cost-control/p18-contract-run/spend.py --require .scratch/planner-only-cost-control/p19-experiment/session-SEED
0.100000
```

进程检查命令：

```text
ps -ef | grep -v grep | grep '[.]scratch/planner-only-cost-control/p19-experiment'
```

无输出；没有真实 `pi -p` 会话。`git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 无输出。

## Git 原文

`git status --short`：

```text
?? .scratch/planner-only-cost-control/p19-experiment/gate-probe.sh
?? .scratch/planner-only-cost-control/p19-experiment/root-prompt-smoke.md
?? .scratch/planner-only-cost-control/p19-experiment/run.sh
?? .scratch/planner-only-cost-control/p19-experiment/p18-r085-execution-report.md
```

`git rev-parse HEAD`：

```text
6b66126d28fe37595d414c6b82c432c4462b969e
```

`git diff --stat`：无输出（新增文件未跟踪，因此不在 diff stat 中）。

## slot 记录

在任何实验命令前已执行并落盘：

- `.scratch/planner-only-cost-control/p19-experiment/p18-r085-slot-audit.log`
- `.scratch/planner-only-cost-control/p19-experiment/p18-r085-slot-status.log`

审计输出尾部明确为“没发现绕过 slot 的重进程”。本轮命令均为轻量脚本和离线探针，没有提交重任务，也没有启动 slot 作业。

## 推迟项与限制

- 推迟真实 `SMOKE`；本轮只用假 `pi` 验证驱动闸门。
- 未运行 `ISO-38`、`ISO-39`、`SPLIT-38`、`SPLIT-39`，因此没有票 38/39 的实验样本或费用结论。
- 未实现票 38/39 的产品改动。
- 未调用真实 `pi` 二进制的任何付费或零费率会话。
- 未创建 git worktree、未运行 `npm test`、未提交、未 `git add`、未勾选任何 checkbox。
- 未绕过冻结断言；唯一使用的替代是 PATH 前置假 `pi`，这是 A/B/C 探针要求的离线替身。B 的 `--require` 失败是预期闸门行为，不是剔除样本。

## 假设

- `p18-contract-run/spend.py` 的 `session-*` 递归规则是唯一费用来源；未新增 usage jsonl 解析器。
- `ROOT_MODEL` 的默认值按冻结规格为 `tcuni/gpt-5.6-luna`，环境覆盖仅保留给未来真实 `SMOKE`。
- 本轮假 `pi` 不需要真实 worktree 中的产品源码；因此没有创建 git worktree。
- 探针工作目录中的 `session-SEED` 是离线种子账本，金额仅用于证明 `spend.py` 返回 `0.100000`，不代表真实花费。
