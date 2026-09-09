# 工单 19 冻结（p18-r085 起）

Planner：cursor `w2E:pE`，2026-09-09。本文件是执行工单的规格；执行者照抄，不许改数字、不许改 arm 名、不许加未点名的样本票。

累计真实花费（p18 契约实跑，`p18-contract-run/total-spend.txt`）：**$0.039576**。用户硬上限 **$1**。剩余 ~$0.96 是余额不是预算。本驱动层 **`CAP_USD=0.10`**。

## 1. 样本（只这四次运行）

点名票：`38`、`39`。用户写过「+1–2 张同量级」但从未点名。**本实验不加第三张票**。38×2 + 39×2 跑完若仍有余额，停下来问用户，不要自己挑 backlog。

| 组名 | arm | 票 | 说明 |
|---|---|---|---|
| `ISO-38` | `isolated-baseline` | 38 | 高费用模型独立执行 |
| `ISO-39` | `isolated-baseline` | 39 | 同上 |
| `SPLIT-38` | `role-split` | 38 | Root luna + worker qwen-local |
| `SPLIT-39` | `role-split` | 39 | 同上 |

另：`SMOKE` 只用本地零费率模型，**不计为对照样本**，只证明驱动能起 `pi`、写会话、走 `spend.py --require`。

默认 argv **必须为空则 `exit 2`**。禁止 `p18` 那种「无参数就跑 A B C D」。付费组只能被显式点名。

## 2. 两 arm 的配置（两边都开 Root policy）

隔离基线**不解除** Root 的 Policy。两边都：

- 加载 planner-only + `pi-subagents`
- `PI_PLANNER_ONLY=1`
- `PI_PLANNER_ONLY_ROLE_MODELS=1`
- `PI_PLANNER_ONLY_THINKING_WORKER=low`
- `PI_PLANNER_ONLY_THINKING_ROOT=low`
- `PI_PLANNER_ONLY_PRICING` 指向只读真实 `pricing.json`（隔离 agent dir 里没有这份表）
- CLI `--model` = `tcuni/gpt-5.6-luna`（`SMOKE` 除外，见下）
- `PI_PLANNER_ONLY_MODEL_ROOT` = 与 CLI `--model` 相同的字符串

唯一差别：

| arm | `PI_PLANNER_ONLY_MODEL_WORKER` |
|---|---|
| `isolated-baseline` | `tcuni/gpt-5.6-luna`（与 Root 同一高费用模型） |
| `role-split` | `qwen-local/qwen3.8-27b` |

`SMOKE`：`ROOT_MODEL` **允许**被环境覆盖成 `qwen-local/qwen3.8-27b`；worker 也用同一个本地模型。`CAP_USD` **不允许**被环境覆盖。

跑完每个付费组后，在同一会话里执行 `/planner-only usage record --arm isolated-baseline` 或 `--arm role-split`（名字必须与上表一致）。失败组不剔除、不补跑来「凑绿」。

## 3. 票面工作（两边同一份，不许一边加 FIFO 一边只写注释）

### 39

把 `orchestrate.test.mjs` 里那唯一一句
`console.log("planner-only orchestration: PASS")`
挪到该文件全部断言之后。不要拆成每块一行 PASS。不要删、不要改写既有 `assert`。
自查：`git diff -- orchestrate.test.mjs | grep '^-.*assert'` 为空。

### 38

**不加数字上限、不发明 FIFO。** 在 `processedRunIds` 与 `confirmedNotLaunchedIds` 两处采用**同一段**注释（英文，逐字）：

```
// Intentionally unbounded session-scoped Sets. A FIFO cap would evict IDs and
// allow a repeated completion/not-launched event to be settled twice.
// Boundedness and idempotency are in tension here; until that is resolved
// in product, no prune and no max.
```

不要改 Set 的增删行为。自查：`git diff -- orchestrate.ts | grep '^-.*assert'` 不适用（这不是测试文件）；行为 diff 只许出现上述注释。

p18-r085 **禁止**实现 38/39。它们是付费对照的样本，驱动闸门没走通之前动手会毁可比性。

## 4. 驱动闸门（G2，硬性）

样板：`.scratch/planner-only-cost-control/p18-contract-run/run.sh` 的 `run_group()`。必须修掉它的 `CAP_USD=${CAP_USD:-0.10}`（那行允许 env 覆盖）。

1. 若启动时环境里**已经定义** `CAP_USD`（包括空字符串），立刻 `exit 1`，一句说明「本驱动写死 0.10，禁止 env 覆盖」，**不得**起 `pi`。
2. 然后 `CAP_USD=0.10` 且 `readonly CAP_USD`。禁止补丁把 `0.10` 改成别的数字。要超过 0.10 必须停下来问用户。
3. 每次起 `pi` **之前**用 `p18-contract-run/spend.py` 算 `$RUN` 下已花金额；`>= CAP_USD` 则打印 `SPEND GATE` 并 `exit 1`。
4. 对账只认宿主会话 jsonl，只许调用现有 `spend.py`，禁止新写读 `usage.jsonl` 的脚本，禁止把 `type=custom` 的 `root-turn:untasked:*` 加进合计。
5. 每组跑完立刻 `python3 …/spend.py --require "$RUN/session-$group"`；没有会话记录就失败退出。
6. 子进程花费在 `session-X/<sess>/<uuid>/run-0/*.jsonl`；`spend.py` 已递归 `session-*`，不要另写「只读根记录」的合计。
7. 累计花费还要加上 p18 已花的 **$0.039576** 吗？**本驱动的 `CAP_USD=0.10` 只管本驱动自己的 `$RUN` 目录。** p18 的会话不计入本 `total_spent`。用户 $1 总硬限由 planner 在派付费组之前用两本账相加看守；执行者不得把 p18 的 `session-*` 链进本 `RUN`。

隔离：

- 新 worktree：`/home/tcuni-claw/pi/pi-planner-only-p19-experiment`（不要复用 `pi-planner-only-contract-run`）。
- `PI_CODING_AGENT_DIR=<WT>/.agent-dir-<group>`
- 只符号链接 `models.json` `models-store.json` `auth.json`；**不链接 `settings.json`**；不读、不回显这些文件。
- `--session-dir` 指向 `$RUN/session-<group>`
- 产物目录：`.scratch/planner-only-cost-control/p19-experiment/`
- 禁止 `/tmp`
- 起重前 `slot audit` + `slot status` 落本目录日志；跑 `pi` / 测试用 `slot cpu`

`ROOT_MODEL` 可以有默认值 `tcuni/gpt-5.6-luna` 且允许 env 覆盖（只为 `SMOKE`）。`WORKER_MODEL` 按组选，不要用一个全局 worker 覆盖 isolation arm。

## 5. 离线闸门探针（必须在任何真实 `pi` 之前绿）

`gate-probe.sh` 在 PATH 前面放一个假 `pi`：写入 `$RUN/pi-was-invoked` 后 `exit 42`，**不写会话**。

| 探针 | 做法 | 期望 |
|---|---|---|
| A | `CAP_USD=0.12` 调 `run.sh SMOKE` | exit 1；`pi-was-invoked` 不存在 |
| B | 不设 `CAP_USD`，空 `$RUN`，调 `run.sh SMOKE`（假 pi） | 因 `--require` 失败而非 0；假 pi **可以**被调用 |
| C | 在 `$RUN/session-SEED/` 放一条 `type=message` 且 `message.usage.cost.total=0.10` 的 jsonl，再调下一组 | exit 1 且文案含 `SPEND GATE`；`pi-was-invoked` 不存在 |

假 jsonl 必须能被现有 `spend.py` 算成 `0.100000`。不要改 `spend.py`。

探针 A/C 失败（假 pi 被不该调用的路径调到）= 闸门坏了，禁止进入 `SMOKE` 真 `pi`。

## 6. 报告纪律

失败样本留在报告里。任何「节省 X%」若不是从本实验记录算出来的，一行都不许出现。

## 7. 规格缺陷（2026-09-09，planner 复核 p18-r085 时发现）

§5 原写法把探针 C 的种子放在对账根 `$RUN/session-SEED/`，且 `spend.py` 会递归所有 `session-*`。执行者按字面做了之后，对账目录被永久记成 $0.10，下一次真实组会误触 SPEND GATE。这是规格缺陷，不是执行错误。

已改：

- `$RUN` 改为 `p19-experiment/runs/`，探针工作目录是兄弟目录 `gate-probe-work/`。
- 探针 C 结束后必须删掉 `session-SEED`。
- `ISO-*` / `SPLIT-*` 在票面 prompt 落地前 `exit 2`，禁止误用 `root-prompt-smoke.md` 去调付费 luna。

## 8. 用户采纳的收窄（2026-09-09 cursor `w2E:pE`）

帽保持 `0.10`，不加第三张票，不 push。付费组改为串行：

1. `SMOKE`（本地零费率）—— p18-r086，`$0.000000`。
2. **只开 `ISO-39`**。撞帽或看完账单之前，不开 `SPLIT-39` / 任何 38 组。
3. 38 整票可降级：若 39 已经说明「账单被 root 开场开销主导」，不再为对照去跑 38。

## 9. ISO-39 实测（p18-r087，planner 重算）

`spend.py` 全文：`--require session-ISO-39` = `0.037454`，`runs/` 合计相同（SMOKE 为 `0.000000`）。拆开宿主 jsonl：根记录 `0.025638`，子进程 `run-0` `0.011816`。worker meta 模型为 `tcuni/gpt-5.6-luna:high`，费用 `0.01181556`，与子进程 jsonl 一致。

样本：worktree `orchestrate.test.mjs` 把 PASS 从中段挪到文件末尾；`git diff | grep '^-.*assert'` 为空。快照：`iso-39-orchestrate.test.mjs.diff`。主仓三文件无 diff。

`/planner-only usage record` 在该 `-p` 会话里不可用，工单 18 的 JSON 记录缺席。对照口径以宿主 `spend.py` + 样本 diff + worker meta 为准，不编节省百分比。

驱动剩余约 `$0.062`。下一步只开 `SPLIT-39`（同一基线 SHA `45d9493`，worktree 已 restore）。不开 38。

## 10. SPLIT-39 实测（p18-r088，planner 重算）

`spend.py` 原文：`--require session-SPLIT-39` = `0.009766`；`runs/` 合计 `0.047220`（ISO-39 `0.037454` + SPLIT-39 `0.009766` + SMOKE `0.000000`）。

拆开宿主 jsonl（只计 `type=message`）：

| 文件 | ISO-39 | SPLIT-39 |
|---|---|---|
| 根会话 | `0.025638`（luna 7 轮 assistant `0.013823` + toolResult 镜像 worker `0.011816`） | `0.009766`（luna 7 轮 assistant；toolResult 费用 `0`） |
| `run-0/session.jsonl` | `0.011816`（luna worker，9 轮） | `0.000000`（`qwen3.8-27b`，9 轮，宿主 usage 全 0） |
| worker_transcript | `0`（不入账） | `0` |
| **spend.py 合计** | **`0.037454`** | **`0.009766`** |

`spend.py` 会把 isolation arm 的 worker 费用算两遍（根 `toolResult` + `run-0`）。去重后的一次生成口径：ISO root luna `0.013823` + ISO worker luna `0.011816` = `0.025639`；SPLIT root luna `0.009766` + SPLIT worker qwen `0`。根输入 token ISO `49480` / SPLIT `27548`；根输出 `1506` / `1567`。两边都是 7 个 root assistant 回合、9 个 worker assistant 回合。

首轮 root（开场）ISO `0.003842`、SPLIT `0.003816`，量级相同。isolation 账单里 worker 约占去重后的一半，**不满足** §8「开场主导所以不必跑 38」的字面条件；role-split 之后剩余账单才是 100% root。

样本：worktree HEAD 保持冻结基线 `45d9493`（主仓 `54cc814` 只超前「Accept ISO-39 and arm role-split」这一笔 bookkeeping，执行者未擅自 checkout，正确）。`orchestrate.test.mjs` 与 ISO-39 快照 **字节相同**（`fa78d27..c6c8f3e`，PASS 挪到文件末行，无 `assert` 删除）。快照：`split-39-orchestrate.test.mjs.diff`。主仓 `index.ts` / `orchestrate.ts` / `orchestrate.test.mjs` 无 diff。

`/planner-only usage record` 在该 `-p` 会话里仍不可用。对照口径仍是宿主 `spend.py` + 样本 diff + 模型字段。

驱动已花 `0.047220`，帽内剩余 `0.052780`。用户 $1 账：p18 `0.039576` + p19 `0.047220` = `0.086796`，剩余约 `0.913`。

## 11. 用户继续：只开 ISO-38（2026-09-09 cursor `w2E:pE`）

用户对「停 / 跑 38 / 抬帽」回复「继续」。**不抬帽**（仍 `0.10`）。下一步只开 `ISO-38`（同一基线 SHA `45d9493`；先 restore `orchestrate.test.mjs`，避免 39 样本残留）。不开 `SPLIT-38`，直到看完 ISO-38 账单。不开第三张票。

## 12. ISO-38 实测（p19-r089，planner 重算）

`spend.py` 原文：`--require session-ISO-38` = `0.030139`；`runs/` 合计 `0.077359`。拆开：根会话 `0.023772`（luna assistant `0.017406`，11 轮；toolResult 镜像 worker `0.006366`），`run-0` luna worker `0.006366`（5 轮）。去重一次生成：root `0.017406` + worker `0.006366` = `0.023772`。

样本：worktree HEAD `45d9493` 未动。`orchestrate.ts` 两处字段换成同一段冻结四行注释，Set 构造与 add/has 无改。快照：`iso-38-orchestrate.ts.diff`。主仓三文件无 diff。

帽内剩余 `0.022641`。SPLIT-39 同类是 `0.009766`，下一步只开 `SPLIT-38`（同一基线，planner 已 restore `orchestrate.ts`）。不开第三张票、不抬帽。

## 13. SPLIT-38 实测（p19-r090，planner 重算）

`spend.py` 原文：`--require session-SPLIT-38` = `0.014101`；`runs/` 合计 `0.091459`。拆开：根会话 luna assistant `0.014101`（8 轮）；`run-0` `qwen3.8-27b` 6 轮、费用 `0`。去重一次生成即 `0.014101`。

样本：worktree HEAD `45d9493` 未动。`orchestrate.ts` 与 ISO-38 快照 **字节相同**（`c21df04..4a052ab`）。快照：`split-38-orchestrate.ts.diff`。主仓三文件无 diff。

### 四组对照（点名样本已齐）

闸门口径（`spend.py`，isolation 会把 worker 算两遍）：

| 组 | spend.py | 去重一次生成 | root luna | worker |
|---|---|---|---|---|
| ISO-39 | `0.037454` | `0.025639` | `0.013823`（7 轮） | luna `0.011816`（9 轮） |
| SPLIT-39 | `0.009766` | `0.009766` | `0.009766`（7 轮） | qwen `0`（9 轮） |
| ISO-38 | `0.030139` | `0.023772` | `0.017406`（11 轮） | luna `0.006366`（5 轮） |
| SPLIT-38 | `0.014101` | `0.014101` | `0.014101`（8 轮） | qwen `0`（6 轮） |
| SMOKE | `0.000000` | — | 不计对照 | — |

驱动合计 `0.091459`，帽内剩余 `0.008541`（不够再开一组 isolation 量级）。用户 $1 账：p18 `0.039576` + p19 `0.091459` = `0.131035`，剩余约 `0.869`。`run.sh` 已卸武装全部付费组。按 §1：38×2 + 39×2 已齐，不加第三张票。

## 14. 汇总（p19 收口，planner 2026-09-09）

用户再「继续」：不抬帽、不加第三张票。写汇总并勾工单 19：`.scratch/planner-only-cost-control/p19-experiment/summary.md`。通过率 2/2 vs 2/2；去重合计 isolation `$0.049411`、role-split `$0.023867`；平均根墙钟 98 s vs 555 s；样本 diff 两臂字节相同。工单 19 `Status: done`。

## 15. 用户把用量硬限改到 $3（2026-09-09）

p19 的 `CAP_USD=0.10` **不再改**（那批 38/39 对照冻结）。扩规模另开 `p20-scale/`，驱动帽 `2.86`，样本 E3。见 `p20-scale/freeze.md`。


