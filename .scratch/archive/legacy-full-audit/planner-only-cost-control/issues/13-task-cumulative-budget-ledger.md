# 13: Task 累计预算账本与状态展示

**What to build:** 使用者可为一项 Task 设置累计 token 与费用预算，两个维度独立。Root 规划与审核、Worker、Explorer、Validator、Reviewer 及所有重试的用量都记入同一 Task 账本，Root 按可证明的 Task 与阶段归属，子进程按实际角色归属；Task 创建前的 Root 规划和无法归属的用量保留为会话级未归属项，不归入最后 active Task。status 显示已知消耗、未知项、剩余额度；未配置累计预算的 Task 显示未设累计上限而不是虚构余额。既有 TaskSpec budget 的单次语义不变。Usage 仍是唯一用量事实来源，不建第二套计费数据。

**Blocked by:** 05、08、23。

**Status:** done（2026-09-08 p14-r067 + p14-r068 落地，planner 复跑核验并自行修正后提交 `8a22d1c`、`e56573c`）

- [x] 一项 Task 依次经历 Root 规划、Worker、Validator、Reviewer、Root Verdict、Worker 修正：全部用量记入同一账本，status 显示按角色分项（p14-r067 账本 + p14-r068 渲染）。
- [x] Task 创建前的 Root 轮次记为会话级未归属，status 单独列出（p14-r068，`Unattributed (会话级，未归入任何 Task)` 行）。
- [x] 未配置累计预算：status 显示未设累计上限，不显示余额数字（p14-r068，测试断言整段 status 不含「剩余」）。
- [x] 配置了累计预算：status 显示 token 与费用两个维度的已用、未知、剩余（p14-r068）。
- [x] 旧 TaskSpec budget 配置在无累计预算时行为与改动前一致（p14-r067）。
- [x] 费用对照所需的整段会话成本可从 Usage 读出（p14-r067，`summarizeSessionUsage().totalCostUsd`）。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 28–30，阶段 D 决策第 1–2 条）。
- 2026-09-07：r4 产物暴露失败子委派不入账（`73bd7b92` 有 meta、不在 `usage.jsonl` 的 children 里），直接压在本票第一条 checkbox「全部用量记入同一账本」上，已开新票 23。Blocked by 已按用户 2026-09-08 拍板改成「05、08、23」。本票仍不派工。

2026-09-08 `p14-r067`（13A：账本与配置，pi `w2E:pG` 落地，planner 复跑核验并自行修正后提交 `8a22d1c`）：

落地 `TaskSpec.cumulativeBudget`（整个 Task 一份余额，与既有单次 `budget` 并存、语义互不影响）、
`task.ts` 同形校验与提取搬运（**未**加入 `TASKSPEC_CHARACTERISTIC_FIELDS`），以及两个纯函数
`summarizeTaskBudget` / `summarizeSessionUsage`。**没有新建第二套计费数据**：两者都按需从既有
`TaskUsage` / `sessionUsage()` 算出来，Usage 仍是唯一事实来源。

冻结口径：token 只累加 input/output/cacheRead/cacheWrite（**不含 `reasoning`**，与 output 的包含关系因 provider 而异，
加进去可能重复计数）；未知项只报数、不折进 `known`、不抵扣 `remaining`（把未知算成负债是工单 15）；
`remaining` **不 clamp**，超支就是负数；同一角色的重试合进同一个桶，不重新发预算；
会话级未归属桶来自 `sessionUsage().untasked`，绝不折给任何 Task。

**planner 复核发现并自行修正的缺陷**：执行者把「成本未知」写成了 `costUsd === undefined`，
而空桶（`turns === 0`）的 `costUsd` 天生就是 `undefined`。后果是一个**什么都不未知**的正常会话
（每条 Root 轮次都有归属、每笔费用都查得到价）也会报 `unattributed.costUnknown: true`、`costUnknownParts: 1`，
即把「零」渲染成「不可知」——正好是 `renderUsage` 早已用 `root.turns > 0 && costUsd === undefined` 防住的那个反向错误。
已按同一条规则修正三处（Task 费用维度、`byRole.root`、会话级），并补了回归断言；
把修正撤掉可复现 `AssertionError: an empty unattributed bucket is known-zero, not unknown / true !== false`（`usage.test.mjs:113`）。
探针与证据：`.scratch/planner-only-cost-control/p14-probe/r067-verify.mjs`、`p14-r067-verify-*.log`。

四条验收 planner 独立重跑均退出 0，`npm run test:release` 亦退出 0。
第 1–4 条要等 13B（渲染：`renderTaskStatus` + `/planner-only status`）才能勾。

round_id=p14-r067

2026-09-08 `p14-r068`（13B：渲染，pi `w2E:pG` 落地，planner 复跑核验并自行修正后提交 `e56573c`）：

`renderTaskStatus` 调 `summarizeTaskBudget` 渲染累计预算块与角色分项；`/planner-only status` 调
`summarizeSessionUsage` 追加整段会话合计与会话级未归属行。**只渲染，不新增任何口径**；
`architecture.test.mjs:81-83` 那三条（`orchestrate.ts` 不得出现 `UsageLedger` / `recordRootTurn` / `recordChild`）保持绿，
所以会话级那两行写在 `index.ts`（那里才有 ledger），Task 级写在 `orchestrate.ts`。

**执行者明确没交失败证明**（它照实说了「未执行、没有可提供的逐字失败输出、我没有伪造证明」——这点值得记一笔）。
证明由 planner 自己补跑，脚本与逐字输出见 `.scratch/planner-only-cost-control/p14-probe/r068-proofs.sh`
与 `p14-r068-planner-proofs.log`：九处注入缺陷（编造余额／`remaining` clamp 到 0／丢掉未知项批注／
`task.usage` 缺失仍渲染／未配置维度也打印剩余／金额精度改两位／抹掉未归属行／抹掉会话合计行）
逐一复现断言失败并还原，还原后 md5 与备份一致。

**planner 复核发现并自行修正的缺陷**：交付版 U7 是**空断言**——
`renderTaskStatus(task).split("\\n")` 写的是字面反斜杠加 n，不是换行，切出来永远只有一段，
而整段 status 以 `Task:` 开头，于是 `some(line => line.startsWith("Budget"))` 恒为 false，
把「`task.usage` 缺失时不许渲染预算块」这条测成了永远通过。
已改成 `split("\n")`，并现场证过：把「缺失时照样渲染」的缺陷注进去，交付版仍打印 `PASS`，改对后立刻变红。
另补一条缺失的断言：**零调用角色不许出现**（Root 尚无轮次时不许出现 `- root: 0 turns` 行），
把 `.filter(calls > 0)` 去掉即复现 `a Root with zero turns must not get a role row / true !== false`。

四条验收 planner 独立重跑均退出 0，`npm run test:release` 亦退出 0。

round_id=p14-r068
