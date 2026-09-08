# 契约实跑设计（轮 3）—— planner 自己跑，不派给执行者

**状态：设计完成，等 p17-r080（工单 18，pi）收尾后执行。**
理由：paid run 不可逆，不能一边盯执行者回执一边花钱；且实跑要另开 worktree，等本轮 fence 释放更干净。

## 1. 一次运行要同时取证的四件事

| 票 | 条款 | 现状 | 本次实跑要拿到的证据 |
|---|---|---|---|
| 36 | F3 | 未做（用户当时未选） | 宿主**运行期**是否真的在 `usageBudget.hard` 处拦住后续子进程启动 |
| 09 | 第 2 条 | 留空 | Root 模型「只在宿主允许范围内校验，**不伪称已切换**」 |
| 25 | 第 3 条 | 留空 | §E/§F 的最终结论（§E 已真验证，§F 靠本次定性） |
| 25 | 第 4 条 | 留空 | 工单 09 宿主侧角色模型核对的结论 |

25 第 5 条是否定约束（不勾 08、不改 spec），随手满足。

## 2. 隔离：另开 worktree，不在共享 cwd 里跑

沿用 `phase-a-08-run4/run.sh` 已验证的形状：

- 工作树 `/home/tcuni-claw/pi/pi-planner-only-contract-run`（`git worktree add`，同分支的 detached 副本）。
- `PI_CODING_AGENT_DIR=<WT>/.agent-dir`，`--session-dir <WT>/.scratch/contract-session`。
- 产物落 `.scratch/planner-only-cost-control/p18-contract-run/`（本仓 cwd 内，日志已 gitignore）。
- **绝不在 `/tmp` 下放任何东西。**
- 共享 cwd 里有四个 agent，实跑必须完全避开它——另开 worktree 正是为此。
- 起跑前跑 `slot audit` + `slot status` 并存日志；实跑本身用 `slot cpu` 包。

## 3. 36-F3 的实验设计（关键：要看的是**宿主**的闸门，不是我们自己的）

我们自己的累计预算闸门会**先于**宿主拦住委派，所以直接把余额调小只能测到我们自己的代码。
要观测宿主，必须让我们的闸门保持敞开、只把**单次委派**的 `usageBudget.hard` 压到不可能够用：

- **A 组（宿主应当拒绝）**：Task 的 `cumulativeBudget` 给足（例如 `costUsd: 0.05`），
  但下传 `usageBudget: {"tokens":{"hard":1}}`。宿主文档原话是
  「Hard limits prevent future child launches; running children are not stopped」，
  Root 此刻的已报用量早已远超 1，因此**预期宿主直接拒绝启动**。
- **B 组（对照，宿主应当放行）**：同一 Task、同样的子进程提示词，
  `usageBudget: {"tokens":{"hard":200000}}`，预期正常启动并返回。

两组只差一个数字，**这就是阳性对照**——没有 B 组，A 组的「没启动」也可能是别的原因造成的。
A 组几乎不花钱（子进程没起来），B 组是本轮主要成本，提示词压到一句话。

判读：
- A 拒绝 + B 放行 ⇒ **宿主真的在 hard 处拦**，36-F3 闭合，05 第 1、2 条可据此收尾。
- A 也放行 ⇒ **宿主只收字段不执行**，那么 `floors.ts` 的 hard 是我们自己记账兜的
  （与 36 Comments 里已实测的判断一致）。**这同样是有效结论**，写进票里，
  并把 §F 定为「宿主接受但不承诺执行」，闸门按具名豁免放行。
- 出现第三种情况（报错/超时/字段被拒）⇒ 原样记录，不硬凑成上面两种。

## 4. 09 第 2 条的实验设计

Root 不是被委派的子代理，拿不到启动契约，只能观测「宿主实际把 Root 跑成了什么」并核对
插件的说法：

- **C 组**：CLI `--model <RootModel>` 与 `PI_PLANNER_ONLY_MODEL_ROOT` **一致**。
  取证：`usage.jsonl` 里该 Task 的 `rootModel` 与 CLI 传入值一致。
- **D 组（反向对照，本条的重点）**：`PI_PLANNER_ONLY_MODEL_ROOT` 故意与 CLI `--model` **不一致**。
  要求：`/planner-only status` **不得**声称 Root 已切到策略里的那个模型
  （「不伪称已切换」）。这一条是否定断言，所以必须有 C 组做阳性对照。

D 组不需要任何子进程，成本≈一次 Root 回合。

## 5. $1 硬上限的双层闸门

用户授权：**总花费硬上限 $1**，覆盖契约实跑 + 工单 19 的全部真实运行。

1. **票内层**：每个实跑 Task 自带 `cumulativeBudget`（契约实跑合计 `costUsd: 0.10` 封顶）。
2. **驱动层**：`run.sh` 在每次 `pi` 调用**前后**各读一次 `usage.jsonl`，累计本专题的真实花费；
   超过本轮预算即 `exit 1`，不再发起下一次调用。**不能只靠事后对账**——用户明确要求
   「跑到上限即停，实验驱动必须自己带这道闸门」。
3. 每次运行的实际花费逐笔记进 `p18-contract-run/spend.tsv`，工单 19 开跑前先读它算剩余额度。

## 6. 报告纪律

- 失败样本不剔除；**报告里不许出现任何未经测量的节省比例**。
- 观测到什么写什么；三选一之外的结果原样记录，不硬套进预设的两种。
- 每条结论标明它由哪一组（A/B/C/D）的哪一行输出支撑。
