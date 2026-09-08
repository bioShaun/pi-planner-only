# 23: 失败的子委派与 unbound scout 必须入 usage 账，不得静默丢弃

**What to build:** 委派失败的子代理消耗了真实 token 与费用，但现在完全不进 `usage.jsonl`。`usage.jsonl` 的 children 去重与写入逻辑要覆盖失败/被拒的子委派：只要有 `<runId>_<agent>[_0]_meta.json` 就按 meta 入账，并带一个能区分成功与失败的字段；连 meta 都没有（子进程根本没起来）时不伪造 0 成本条目，而是计入 `costUnknown` 或等价的未知项。成功委派的既有字段与去重规则不变。

同一规则覆盖 unbound-explorer 路径（含 `scout`）：`delegation.kind` 为 explorer 不等于不入账，只要落了 `<runId>_<agent>[_0]_meta.json` 就按 meta 入账。工单 21 的既有行为（不建 Task、不调 `nextTaskId()`、输出原样返回）一律不动，本票只改账本。

**Blocked by:** None (can start immediately). Sequential with 21：不要与 21 同一轮抢改 `orchestrate.ts` / `roles.ts`；本票的验收全部走 fixture，不依赖 21 先落地。

**Status:** done（p10-r047/r048 + p11-r049/r051/r052，planner 复核后逐条勾选）

- [x] 一次 `isError: true` / Mission failed 的子委派，其 meta 文件中的用量出现在 `usage.jsonl` 的 children 里，条目的 `runId` 与 meta 文件名中的 runId 一致。
- [x] 该条 child 带一个可区分成功与失败的字段；成功委派条目的既有字段一个不变。
- [x] 子进程根本没启动、没有 meta 文件时，不写入 0 成本条目；该次委派计入 `costUnknown` 或等价的未知项，不静默丢弃。
- [x] 一次无 TaskSpec 的 `scout`（unbound explorer）委派，其 meta 中的用量出现在 children 里；工单 21 的既有验收（不建 Task、`delegation.kind` 为 explorer、原样返回）全部仍然成立。
- [x] children 仍按 `runId` 去重，同一 runId 不重复入账；同一 scout 的内层 run 目录（r4 的 `session-tree/6614fce2-…`）不被当作第二个子代理重复计数。
- [x] 回归以 fixture 形式进单测，用 r4 的六个 meta 文件名与 `usage.jsonl` 的差集构造（差集恰为 `73bd7b92` 与 `eb50ca15` 两条），补记后 children 合计从 $0.15155643 变为 $0.24052828、含 root 的总额等于 $0.29581593，不需要重跑真实模型。
- [x] 不勾 08/13 checkbox、不改 08/13 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 28–30，阶段 D 决策）。

证据：2026-09-07 phase-a-08-rerun-4。`/home/tcuni-claw/pi/pi-planner-only-phase-a-08-r4/.scratch/phase-a-08-session/subagent-artifacts/73bd7b92-06a4-4c17-a5c8-e9936494f47f_worker_0_meta.json` 存在，会话中该次委派回执为 `Mission: 03d86289-86ca-4d43-bf3c-7d6a5800f618 (failed)` / `isError: true`；而 worktree 的 `.agent-dir/planner-only/usage.jsonl` 四条记录里，children 只有 `4e032aed`、`c22defe6`、`f1d2b014`、`2d9ca9b6` —— **`73bd7b92` 完全没入账**。

工单 13 的第一条 checkbox 是「全部用量记入同一账本」，直接压在本票上。13 的 Blocked by 已于 2026-09-08 改成「05、08、23」。

scout（unbound explorer）入账**在**本票范围（2026-09-08 用户拍板）：r4 的 `eb50ca15-…_scout_meta.json` 同样不在 `usage.jsonl` 里。不建 Task 是工单 21 的设计，不入账不是 —— 两者互不牵连，21 的路径行为本票一个字不动。scout 那笔的用量有两个来源可取：meta 文件，以及 `bg_wait` 回执的 `details.completions[0].results[0].usage`。

2026-09-08 补量（产物快照 `.scratch/planner-only-cost-control/phase-a-08-run4/artifacts/`，README 有全表）：r4 的 6 个 meta 都带 `usage.cost`，但 `usage.jsonl` 最后一条的 children 只有 4 个。漏的两条是 `73bd7b92`（失败 worker，**$0.06495503**、10 turns）与 `eb50ca15`（scout，**$0.02401682**、5 turns）。账本记 root $0.05528765 + children $0.15155643 = **$0.20684408**；实际 **$0.29581593**；**少记 $0.08897185，占实际支出的 30.1%**。scout 那 $0.024 在 `bg_wait` 回执的 `details.completions[0].results[0].usage` 里也有一份，不只在 meta 里。

round_id=claude-pD-2026-09-07-open-22-23
round_id=claude-pD-2026-09-08-scope-23-scout

p10-r047（pi，w2E:pG）已落地，planner 独立验收：`npm test` / `npm run typecheck` / `npm run test:e2e` / `git diff --check` 退出码全 0，fixture 实测打印 `run4 fixture: children 0.24052828 total 0.29581593`。改动仅 `index.ts`、`usage.ts`、`usage.test.mjs`，fence 未越界。实现要点：`CHILD_META_AGENTS` 补进 `scout`；`childFromMeta()` 统一从 meta 建 child 并按 `meta.exitCode` 附 `outcome`（0=succeeded／非 0=failed／缺失=unknown）；`recordSyncChildren` 的 runId 取 `runIdFromDetails(details) ?? delegation.runId`；results 为空且无 runId 时改为记一条 pending child 而不是 `return`。fixture 是真读 run4 的 6 个 meta 与 usage.jsonl 算差集，数字由被测代码算出，不是硬编码。

**第 4 条不勾 —— planner 核对发现 scout 那笔仍然进不了 `usage.jsonl`**：unbound explorer 在 `orchestrate.ts:911-933` 注册的 delegation 用的是合成 taskId `unbound-explorer-<toolCallId>`，`recordSyncChildren` 因此把 scout 的用量记到这个合成 id 名下；而 `index.ts:412-417` 的 `writeUsageLog` 开头是 `const task = orchestrator.store.get(taskId); if (!task || !usage) return;` —— 合成 id 在 store 里不存在，直接 early return。也就是说 scout 的钱进了内存账本的一个永远不会被写出的“任务”，**r4 那 $0.02401682 仍然不会出现在 `usage.jsonl` 的任何一行里**，本票 Comments 里「少记 30.1%」的那一半没有真正闭合。这不是执行者的疏漏，是本票验收第 4 条的措辞（「出现在 children 里」）没说清是哪个任务的 children，fixture 又只测账本算术、测不到归属。

另外两项收尾（不影响已勾条目，但要在下一轮一起做）：
1. `outcome` 目前是 `Object.assign` 挂上去的**未声明字段** —— `types.ts` 的 `ChildUsage` 接口里没有它。能通过类型检查是因为交叉类型可赋值给 `ChildUsage`，且 `cloneChild`/`upsertChild` 都是展开，所以运行时能活到 `JSON.stringify`。但类型系统看不见它，任何按字段显式构造 `ChildUsage` 的新代码都会静默丢掉它。是我上一轮的 fence 把 `types.ts` 列进了禁止清单，执行者无法声明，责任在我。
2. `index.ts` 这一侧的接线（scout meta 探测、exitCode→outcome、无 meta→costUnknown、`delegation.runId` 回退）**没有任何测试**：fixture 只覆盖 `UsageLedger` 的算术，`index.test.mjs` 本轮未动。第 1、3 条按实现与账本级测试勾上，但接线层的回归仍是空的。

round_id=p10-r047

2026-09-08 p10-r048（executor pi，planner claude-pD 独立复验）：**第 4 条补勾**，scout 那笔现在真的能进 `usage.jsonl`。

做法：`orchestrate.ts` 的 `DelegationRecord` 新增可选 `accountingTaskId`；`orchestrate.ts:920` 的 unbound explorer 分支**行为一个字没动**（仍用合成 taskId `unbound-explorer-<toolCallId>`、仍原样返回输出、仍不建 Task），只是在注册时把当时 `this.store.active()` 的真实 Task id 一并写进 `accountingTaskId`，没有 active 时不写这个字段。`index.ts` 新增 `accountingTaskId(record) => record.accountingTaskId ?? record.taskId`，`recordSyncChildren`、`recordBgWaitChildren`、`recordAsyncChild` 以及注入文本 `recordInjectedText`、终态 `flushIfTerminal` 五个落点统一改用它。因为 `writeUsageLog` 走的是 `ledger.taskUsage(taskId)`（整包含 children 一起序列化），scout 的 child 挂到真实 Task 上之后，那个 Task 走到终态时就会连它一起写进 `usage.jsonl` —— 原来卡在 `store.get(合成 id)` 返回 undefined 的 early return 不再命中。没有 active Task 时保持合成 id，这是已知限制，由测试钉住。

`types.ts` 的 `ChildUsage` 补上 `outcome?: "succeeded" | "failed" | "unknown"`，`index.ts` 里那个 `Object.assign` 改回正常对象赋值 —— 上一轮的未声明字段问题清掉了。

`index.test.mjs:3267-3319` 补了接线测试：scout meta 被探测到并入账且归属为真实 `T-` 开头 id（显式断言 `notEqual` 合成 id）、`exitCode: 0 → outcome succeeded`、`exitCode: 1 → outcome failed`、abandon 掉 active Task 后无 meta 的那次仍落在合成 id 上且 `pending: true`（不伪造零成本 child）。

Planner 独立复验（`slot cpu`，日志 `p10-r048-planner-verify.log`）：`npm test=0`、`npm run typecheck=0`、`npm run test:e2e=0`、`git diff --check=0`，17 个 suite 全 PASS，上一轮的 run4 fixture 原文 `run4 fixture: children 0.24052828 total 0.29581593` 一字未变。fence 未越界（改动只落在 `index.ts`、`index.test.mjs`、`usage.ts`、`usage.test.mjs`、`types.ts`、`orchestrate.ts`）。

**遗留一条新发现的窄缺陷，下一阶段第一轮修**：`task.ts:481` 的 `TaskStore.active()` **不按 cwd 过滤**（只按非终态 + `updatedAt` 排序取第一个）。而 explorer 分支恰恰是在 `active.cwd === cwd` 这个绑定条件**不成立**时才走到的，所以现在存在这条路径：cwd A 里的一次 explorer 委派，把钱记到 cwd B 里那个正活着的 Task 头上，跨仓库串账。修法是一行守卫 —— 只在 `active.cwd === cwd` 时才写 `accountingTaskId`，cwd 不同就回落合成 id（即本票已经承认的那个限制），外加一条对应测试。不影响已勾的条目：已勾的都是同 cwd 场景。

2026-09-08（planner claude-pD，phase 11 开局自查）：**上面那段「跨仓库串账」的判断是错的，作废，按下面这段为准。**

错在两处，都是我没读够就下的处方：

1. `TaskStore` 没有任何持久化 —— `task.ts:416-423` 就是一个进程内 `Map`，构造函数只接一个 `now`，全文件没有读盘写盘（唯一的 `JSON.parse` 在 `task.ts:261`，是 TaskSpec 解析，与 store 无关）。一个 orchestrator 一个 store，一个 pi 会话一个 orchestrator。所以仓库 B 会话里的 Task **根本不会出现在**仓库 A 的 store 里，「cwd A 的委派把钱记到 cwd B 的 Task 上」这条跨会话路径不可达。
2. 绑定条件里的 `cwd` 是**这次委派的** cwd（`orchestrate.ts:596-599`：`input.cwd` 相对 `baseCwd` resolve，缺省才回落 `baseCwd`），不是会话的 cwd。Root 为了当前 Task 特意把 scout 派去读别处，`cwd !== active.cwd` 是**正常且正确**的用法，这笔钱本来就该记在当前 Task 头上 —— 谁引发的支出谁付账，跟 scout 去哪读文件无关。我原来那条严格守卫会把这种情况打回合成 id，等于把 r048 刚闭合的缺口重新捅开，并且会直接测挂 `index.test.mjs:3267` 那条用例（它的 `cwd` 正是 `/fixture/r048-unbound`）。

**真正残留的是一条更窄的不精确**：`store.active()` 只按「非终态 + `updatedAt` 最新」取第一个，不看 cwd。单个会话里同时存在两个非终态 Task 时（Root 在同一会话里为不同目录各建了一个），scout 的钱会落到「最近更新的那个」而不是「这次委派实际服务的那个」，同会话内错账。

修法不是加守卫，是**加偏好**：在 explorer 分支取归属 Task 时，先找非终态 Task 里 cwd 与本次委派 cwd 相同的那个，找到就用它；找不到再回落 `store.active()`（保住上面第 2 点那种正当用法），两个都没有才保留合成 id。这样 r048 的既有断言全部不变，同时把同会话双 Task 的错账堵掉。

2026-09-08 p11-r049（executor pi `w2E:pG`，planner claude-pD 独立复验）：上面那条「加偏好」已落地。`task.ts:488` 新增 `TaskStore.activeForCwd(cwd)`（非终态 + `normalizeWorkspaceIdentity` 匹配 + `updatedAt` 最新），`orchestrate.ts:917` 的 explorer 分支改为 `const accountingTask = this.store.activeForCwd(cwd) ?? active;`。`store.active()` 语义与全部既有调用点未动，explorer 的行为语义（合成 taskId、原样返回、不建 Task、不加写锁）未动。

执行者自己加了一道我没要求但必要的过滤：`task.cwd !== ""`。`TaskStore.create` 的 cwd 默认是空串（`task.ts:443`），而 `normalizeWorkspaceIdentity("")` 会 resolve 成进程 cwd —— 不挡就会让所有空 cwd 的 Task 假匹配到当前目录。

测试 `orchestrate.test.mjs:1051-1080`：同 cwd 优先那条先断言 `store.active()` 返回的是**错的那个** taskB，再断言 `accountingTaskId` 落在 taskA，钉的是缺陷本身而不只是修复；回落那条（active 的 cwd 与委派 cwd 不同时仍记到它头上）单独一个 case。`task.test.mjs:291-298` 覆盖 `activeForCwd` 排除终态 Task 与无匹配返回 undefined。`index.test.mjs:3267-3319` 一行未改且继续通过 —— 它正是回落场景。

Planner 独立复验（`slot cpu`，日志 `p11-r049-planner-verify.log`，预飞 `p11-r049-planner-slot-audit.log`／`-slot-status.log`）：`npm test=0`、`npm run typecheck=0`、`npm run test:e2e=0`、`git diff --check=0`，17 个 suite 全 PASS，`run4 fixture: children 0.24052828 total 0.29581593` 原文未变。fence 未越界（改动只落在 `orchestrate.ts`、`orchestrate.test.mjs`、`task.ts`、`task.test.mjs`）。本票至此无残留。

---

2026-09-08 p11-r051 + p11-r052（executor pi `w2E:pG`，planner claude-pD 独立复验）：**23 关闭后暴露出的一个衍生缺陷，已修并已用能钉住缺陷的回归测试锁住。**

缺陷：`flushIfTerminal(taskId, before, …)` 的去重闸门是 `if (before === after.state) return;`，但两个调用点都拿**合成 taskId** 取 before 快照、却拿**真实记账 taskId** 去 flush。对 unbound explorer 而言 `store.get("unbound-explorer-…")` 恒为 `undefined`，于是 `before` 永远是 `undefined`，闸门永远不合，`usage.jsonl` 会为同一个 taskId 写出**第二条终态记录**。异步路径可达：async explorer 还在跑、其记账 Task 已转终态，通知后到即触发。这正好打在工单 08 新硬化的账本一致性条款上。

修复（`index.ts`，r051）：让 before 快照的键与 flush 的目标是同一个 id。
- `index.ts:848`：`orchestrator.store.get(accountingTaskId(delegation))?.state`
- `index.ts:901-905`：先算 `const usageTaskId = accountingTaskId(item.record)`，用它取 state 也用它作 `beforeByTask` 的键；`index.ts:922` 取值同样用 `usageTaskId`

`flushIfTerminal` 本身、`accountingTaskId` helper、explorer 语义都未动。

**r051 的回归测试被 planner 打回，这一条要记下来。** 执行者报「修复前该计数会失败」，planner 实测不成立：把修复精确回退后 `node --experimental-strip-types index.test.mjs` 仍 PASS。往 async 通知循环插临时探针得到 `{"recTaskId":"T-20260908-049","usageTaskId":"T-20260908-049","kind":"explorer"}` —— 两者相等，说明那个 scout **走的是绑定分支不是 unbound 分支**，`accountingTaskId()` 退化成恒等函数，测试无法区分修复前后。根因在 `orchestrate.ts:900-912`：explorer 只有在 `store.active()` 不满足「cwd 相同且 state ∈ {changes_requested, reviewing}」时才进 unbound 分支；旧用例在 worker 的 `tool_result` **之后**才派 scout，那时 Task 已是 reviewing。

r052 重写测试（`index.test.mjs:3372-3427`）：改成在 worker `tool_result` **之前**、Task 还是 `executing` 时就派同 cwd 的 async scout —— 绑定分支的 state 条件不满足，走 unbound 分支，而 `activeForCwd(cwd)` 仍能找到该 Task，`accountingTaskId` 得以写入。另加一条永久断言 `notices.some(… "explorer delegation is not attached to any Task")`，把「确实走了 unbound 分支」钉在测试里，不靠人工记忆。

钉住效果（planner 亲自回退三处后实跑，日志 `p11-r052-planner-defect-pin.log`）：退出码 1，`3 !== 1`，多出来的行里能看到 `{"kind":"explorer","runId":"r052-scout-async","agent":"scout"}` 这个子项被重复计入。执行者自己那轮回退跑出的是 `2 !== 1` —— 条数差异不影响结论（都 > 1），但说明重复写的条数依赖同一进程内先前用例留下的状态，不是常数。还原后同命令 PASS。

Planner 独立复验（`slot cpu`，日志 `p11-r052-planner-verify.log`，预飞 `p11-r051-planner-slot-audit.log`／`-slot-status.log`）：`npm test=0`（16 suite 全 PASS）、`npm run typecheck=0`、`npm run test:e2e=0`、`git diff --check=0`。还原后的 `index.ts` 与 r051 复验过的版本 `cmp` 字节一致，`git diff --numstat index.ts` 仍是 65 增 49 删 —— 回退实验没留残迹。

round_id=p11-r052
