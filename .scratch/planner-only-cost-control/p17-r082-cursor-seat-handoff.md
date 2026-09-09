[轮次] round_id=PLACEHOLDER

# 交接：你（cursor, w2E:pE）接任本专题的 planner

发件人：claude planner，pane `w2E:pD`（**这是回信地址，报告发回这里**）。
工作目录 `/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，HEAD `32039ae`。

用户 2026-09-09 指示：「你将当前的进度总结下来交接给 cursor，我的 opus 额度不足了」。
所以这不是一轮执行任务，**是交接 planner 座位**。本轮你不要改任何代码。

## 这一轮只做三件事

1. **读**（按顺序，都在工作目录内）：
   - `.scratch/planner-only-cost-control/deferred-backlog.md` —— 唯一的总纲。
     **G 节是给你的交接**，F 节是仍然有效的规划，A–E 是分档。**从 G 节开始读，再回头读 F。**
   - `.scratch/planner-only-cost-control/p18-contract-run-design.md` §8–§13 —— 刚做完那轮
     花钱实验的推理过程与结论。
   - `.scratch/planner-only-cost-control/p18-contract-run/evidence-extract.md` —— 上面那些结论的逐字证据。
2. **回信**（发到 `w2E:pD`），只要三段，不要复述文档：
   - 你打算**按什么顺序**推进 G3 表里的 5 项，以及**第一轮派给谁**（pi `w2E:pG` / agy `w2E:pF`）。
   - G2 那五条花钱闸门里，**你认为哪一条最容易被自己绕过**，你打算怎么防。
   - 你读完后**发现的任何矛盾或说不通的地方**——文档是我写的，我会写错；
     指出来比照着执行更有价值。
3. **不要动手**：本轮不改代码、不 commit、不勾 checkbox、不动 `spec.md` 与 `issues/`。

## 交接时的硬事实（这些不要靠猜，也不要重新推导）

- **真实模型花费累计 `$0.039576`**，用户 $1 硬顶**剩余约 $0.96**。这是余额，不是预算。
  单轮驱动闸门 `CAP_USD=0.10`，**要超过就停下来问用户**，不是你能自己决定的事。
- **宿主接受 `usageBudget` 但不执行它**（已实测闭合）。预算护栏的实际约束力
  **全部来自本插件自己的记账**。别再设计任何依赖宿主强制的方案。
- **验收基线在 HEAD 上实跑过**（`p17-r082-baseline.log`）：typecheck=0；
  `npm test`=1 且输出里有 `planner-only architecture: PASS`、**唯一**的 `AssertionError` 是
  `naming.test.mjs:26` 的 `extension install is missing ledger-store.ts`（预期必红，
  它对着仓外一份跟踪 main 的安装副本跑）；e2e=0；`git diff --check`=0。
  **`npm test` 里的 `PASS` 横幅不是证据**——`orchestrate.test.mjs` 的横幅在第 3717 行，
  文件却有 5957 行。看 `&&` 链能不能走到 `architecture`。

## 你接任后必须守的纪律（F5 全部有效，这里只强调最常翻车的三条）

1. **不许用「执行者说通过了」结束一轮。** 四条验收命令你要在自己 pane 里原样重跑，
   日志按 `p<phase>-r<NN>-*.log` 存进 `.scratch/planner-only-cost-control/`。
2. **派活前先实跑核验工单本身。** 这类错误在本专题已经出现五次（工单写反成因、
   漏必填字段、引用不存在的函数、fence 把唯一能落盘的文件划成只读）。
3. **不许执行者删既有断言。** p17-r079 有人把两条既有断言藏进 diffstat 的 `-3` 里。
   每份工单要写死这条，交付前 `git diff -- <测试文件> | grep '^-.*assert'` 自查。

## 环境硬规则（执行者不继承全局规则文件，你派活时必须逐字带进每份工单）

- `/tmp` 及其子目录**一律禁止**放任何中间产物、临时目录、缓存、构建产物；
  任务内的中间文件放当前工作目录下有明确名字的可丢弃子目录；跨 cwd 的放 `/project/tmp`。
- 预计超 1 分钟 / 超 2G 内存 / 大量读写 `/data_0` 的命令**一律 `slot` 提交**。
- **起重任务前必须先跑 `slot audit` 和 `slot status`，并把输出写进项目日志。**
  `slot audit` 发现绕过 slot 的重进程**不得擅自终止**，应等待、降并发或报告冲突。
  禁止先启动重活、事后补查。不得用 `slot slots` 调大槽位给自己插队。
- **`~/.pi/agent/models.json` 与 `~/.pi/agent/auth.json`（以及任何 `.agent-dir/` 下的同名文件）
  含 provider API key**——永远不读、不回显进报告、不提交。
- **本 cwd 有四个 agent 同时在跑**（pD 我 / pE 你 / pF agy / pG pi）。同一 cwd 同时只能有一个写者。
  散落的 `.planner-only-test-*` 目录可能是别的 agent 正在跑的沙箱，**不要批量删**；
  要清理就 `mv` 进 `.scratch/planner-only-cost-control/quarantine/`（可逆）。
