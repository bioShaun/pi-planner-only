[轮次] round_id=PLACEHOLDER

你是本轮的**执行者**。Planner 是 cursor，pane `w2E:pE`。
**做完必须用 `herdr agent prompt w2E:pE '<短回报或报告路径>'` 把报告送回。**
你自己 pane 里写的东西没人看得到。正文几 KB 以内；长日志落盘，回报给路径 + 3–6 行摘要。

**送出报告之后不要再动工作区。** 想换方案先问 planner。

工作目录：`/home/tcuni-claw/pi/pi-planner-only`
分支 `planner-only-cost-control`。HEAD 以你开跑时 `git rev-parse HEAD` 为准。

规格（只读，一字不改）：`.scratch/planner-only-cost-control/p19-experiment/freeze.md`
样板（只读）：`.scratch/planner-only-cost-control/p18-contract-run/run.sh`
对账（只读，直接调用，禁止复制改写）：`.scratch/planner-only-cost-control/p18-contract-run/spend.py`

---

## 0. 环境硬规则（你的全局规则文件可能没被加载，逐条遵守）

- **禁止**在 `/tmp` 或其子目录下放任何中间文件、临时目录、缓存、构建产物。
  任务内中间文件放当前工作目录下有明确名字的可丢弃子目录；跨 cwd 用 `/project/tmp`。
- 预计超 1 分钟 / 超 2G 内存 / 大量读写 `/data_0` 的命令**一律 `slot` 提交**。
- **起重任务前必须先跑 `slot audit` 和 `slot status`**，输出写入
  `.scratch/planner-only-cost-control/p19-experiment/`，文件名带本 round_id。禁止先跑后补查。
- `slot audit` 发现绕过 slot 的重进程**不得擅自终止**；等待、降并发或报告冲突。
- 不得用 `slot slots` 调大槽位插队。
- `~/.pi/agent/models.json`、`~/.pi/agent/auth.json` 以及任何 `.agent-dir/` 下的同名文件
  含 provider API key：**不读、不回显进报告、不提交**。
- 本 cwd 同时有四个 agent。同一 cwd 只能有一个写者（你）。
  散落的 `.planner-only-test-*` 可能是别人的沙箱，**不要批量删**；要清理就 `mv` 进
  `.scratch/planner-only-cost-control/quarantine/`。

## 1. 一句话目标

写出工单 19 的实验驱动和离线闸门探针，并用假 `pi` 证明：环境里的 `CAP_USD` 会被拒绝、缺会话会 fail-closed、已花满 0.10 不会再起下一组。

本轮**不许**调用真实 `pi` 二进制，**不许**实现票 38/39，**不许**跑 `ISO-*` / `SPLIT-*`。

## 2. 围栏

[可以改] 无产品文件。
[可以新建]
- `.scratch/planner-only-cost-control/p19-experiment/run.sh`
- `.scratch/planner-only-cost-control/p19-experiment/gate-probe.sh`
- `.scratch/planner-only-cost-control/p19-experiment/root-prompt-smoke.md`（短，只够 `SMOKE` 证明会话能写出来；真 `SMOKE` 不在本轮跑）
- `.scratch/planner-only-cost-control/p19-experiment/p18-r085-*.log`
- `.scratch/planner-only-cost-control/p19-experiment/p18-r085-execution-report.md`
[不许动] `index.ts`、`index.test.mjs`、`orchestrate.ts`、`orchestrate.test.mjs`、
`p18-contract-run/spend.py`、`p18-contract-run/run.sh`、`p19-experiment/freeze.md`、
`issues/`、`spec.md`、`deferred-backlog.md`、`package.json`、产品源码、任何未列文件。
不 commit、不 git add、不勾 checkbox。
不 `git worktree add`（worktree 留给付费轮）。
不把 `CAP_USD` 写成 `0.10` 以外的数字。

## 3. 冻结要点（以 freeze.md 全文为准，这里只防漏）

- `CAP_USD`：若环境已定义该变量 → `exit 1` 且不得起 `pi`；然后脚本内 `CAP_USD=0.10; readonly CAP_USD`。禁止 `${CAP_USD:-0.10}`。
- 无 argv → `exit 2`。认识的组名：`SMOKE` `ISO-38` `ISO-39` `SPLIT-38` `SPLIT-39`。本轮探针只许点 `SMOKE` 当「下一组」名字，因为假 `pi` 不会真跑票。
- `run_group` 抄 p18 的形状：事前 `spend.py "$RUN"`、门槛、`--session-dir "$RUN/session-$group"`、事后 `spend.py --require`。
- 对账只调用现有 `spend.py`，路径写绝对路径。
- 隔离 `PI_CODING_AGENT_DIR`；只链 `models.json` `models-store.json` `auth.json`；不链 `settings.json`。
- `ROLE_MODELS=1` + worker 模型 + `THINKING_WORKER=low` + `THINKING_ROOT=low` + `PI_PLANNER_ONLY_PRICING`。
- ISO 组 worker = luna；SPLIT 组 worker = `qwen-local/qwen3.8-27b`；两边 `MODEL_ROOT` 都等于 CLI `--model`。
- `ROOT_MODEL` 默认为 luna，允许环境覆盖（只为将来的真 `SMOKE`）。`CAP_USD` 不允许覆盖。
- worktree 变量可先写成 `/home/tcuni-claw/pi/pi-planner-only-p19-experiment`，本轮不要创建它。

`gate-probe.sh` 必须按 freeze.md §5 做 A/B/C。假 `pi` 写入探针工作目录下的 `pi-was-invoked` 后 `exit 42`。探针工作目录放在
`.scratch/planner-only-cost-control/p19-experiment/gate-probe-work/`（gitignore 已覆盖），不要用 `/tmp`。

探针 A 与 C：`pi-was-invoked` 必须不存在。
探针 B：假 pi 可以被调用，且 `run.sh` 因 `--require` 非零退出。

## 4. 验收

先 `slot audit` / `slot status` 写入
`.scratch/planner-only-cost-control/p19-experiment/<round_id>-slot-audit.log` 与 `-slot-status.log`。

然后：

```
test ! -e .scratch/planner-only-cost-control/p19-experiment/run.sh || grep -n 'CAP_USD=\${CAP_USD:-' .scratch/planner-only-cost-control/p19-experiment/run.sh; echo GREP_OVERRIDE_EXIT:$?
test "$(grep -c 'CAP_USD=0.10' .scratch/planner-only-cost-control/p19-experiment/run.sh)" -ge 1
bash .scratch/planner-only-cost-control/p19-experiment/gate-probe.sh
command -v pi >/dev/null
```

期望：

1. `GREP_OVERRIDE_EXIT` 为 `1`（没有 `${CAP_USD:-` 那种覆盖写法）。
2. 至少一行字面 `CAP_USD=0.10`。
3. `gate-probe.sh` exit 0；stdout 明确列出探针 A/B/C 各自 exit。
4. 真实 `pi` 在 PATH 里（证明探针用的是 PATH 前面的假二进制，没有改系统 `pi`）。
5. `git diff -- index.ts orchestrate.ts orchestrate.test.mjs` 为空。
6. `ps -ef | grep -v grep | grep '[.]scratch/planner-only-cost-control/p19-experiment'` 不应出现真实 `pi -p` 付费会话；本轮零真实 `pi`。

不要跑 `npm test`（本轮无产品改动）。

## 5. 回报契约

不要只说「已完成」。贴：

1. 本 round_id、开始/结束 HEAD
2. `git status --short` 与 `git rev-parse HEAD` 原文
3. `git diff --stat`
4. 验收命令的 exit code 与输出尾
5. 没做到的事：**含所有推迟项、绕过的断言、降级的做法**
6. 你做的每一个假设
7. 每个数字的测量命令（含 `spend.py` 对探针 C 假 jsonl 的输出）
8. `gate-probe.sh` 全文路径；不要把脚本贴进 prompt

长报告落盘为
`.scratch/planner-only-cost-control/p19-experiment/p18-r085-execution-report.md`，
回报只给路径 + 3–6 行摘要。
