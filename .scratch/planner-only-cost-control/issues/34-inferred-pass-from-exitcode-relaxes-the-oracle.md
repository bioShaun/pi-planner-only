# 34: 由 exitCode 推断出来的 `passed` 能满足门槛，把 oracle 从全量降到 bounded

**What to build:** `report.ts:227-232` 的 `normalizeWorkerReport` 在 validation 元素的
`status` **缺失、为 null 或为空串**时，按 `exitCode` 推断：

```ts
let inferred: ValidationStatus = "not-run";
if (item.exitCode === 0) inferred = "passed";
else if (Number.isInteger(item.exitCode) && item.exitCode !== 0) inferred = "failed";
item.status = inferred;
repairs.push(`${label}.status missing → ${inferred}`);
```

推断本身不算离谱，问题在于**推断出来的 `passed` 与 worker 明写的 `passed` 完全等价地被门槛消费**。
`roles.ts:93` 的 `missingTaskSpecValidationCommands` 与 `roles.ts:121` 的 `lastWorkerValidationPassed`
只看 `item.status === "passed" && item.exitCode === 0`，不区分这个 `passed` 是谁写的。

planner 实测（`p12-r056-33-verify-inference.log`，走完整条 `extractWorkerReport` 管线）：

```
status 整个字段不写，exitCode 0   repairs ["validation[0].status missing → passed"]  gatePassed true   missing []  → ORACLE_SUITE=bounded
status 写成空串，exitCode 0       repairs ["validation[0].status missing → passed"]  gatePassed true   missing []  → ORACLE_SUITE=bounded
status 明写 not-run，exitCode 0   repairs []                                          gatePassed false  missing ["npm test"] → ORACLE_SUITE=full
```

也就是说：**worker 一个字都没说自己通过，只要漏写 `status` 且带了 `exitCode: 0`，
就能让 oracle 不再重跑全量套件。** oracle 存在的理由是独立复核 worker，
让 worker 的「沉默」来放松这道复核，方向是反的。

**这不是假设 —— run5 里真的发生了。** planner 扫了 run5 全部 worker 输出
（`p12-r056-33-verify-run5-repairs.log`）：

```
75d7ae1c  ["validation[0].status missing → passed", "validation[1].status missing → passed"]
e63c7583  ["validation[0].status missing → passed", "validation[1].status missing → passed", "validation[2].status missing → passed"]
```

两份真实报告、五条 validation，全部被推断成 `passed`。

**与工单 33 的关系：** 33 把合同示例的 validation 改成了 `status:"not-run"` + `exitCode:0`，
这两个字段语义上互相矛盾（没跑过却有退出码）。一个想把矛盾消掉的 worker 最省事的做法就是
**删掉 `status`** —— 删完正好落进本票这条推断分支，33 刚堵上的洞从旁边又开了。

**planner 的倾向（执行者可以反驳，但要给理由）：推断出来的状态不应满足门槛。**
推断可以保留（它对展示和 `compactWorkerReport` 有用），但要能区分来源，
让两道门槛只认 worker 明写的 `passed`。机制自选，例如给元素打一个 `inferred: true` 标记、
或让门槛消费归一化前的原始值、或让 `normalizeWorkerReport` 把这种情况推断成 `not-run` 并在 repairs 里说明。
**不接受直接删掉推断逻辑** —— 那会让今天能被接受的报告变成不可接受，属于另一类回归。

**Blocked by:** None（源码在 `report.ts:227-232`、`roles.ts:89-96`、`roles.ts:118-122`）。

**Status:** ready-for-agent

- [ ] 一份 validation 元素**没写 `status`**、只带 `exitCode: 0` 的报告，
      归一化后不再满足 `lastWorkerValidationPassed`，也不再让
      `missingTaskSpecValidationCommands` 把该命令记成已覆盖；
      新增测试直接用 run5 的 `75d7ae1c-*_output.md` 与 `e63c7583-*_output.md` 做输入（不许手写 fixture）。
- [ ] worker **明写** `status:"passed"` + `exitCode:0` 的既有行为逐字不变，两道门槛仍然放行。
- [ ] `status` 写成空串、null 的情形与缺失情形同等处理，有测试覆盖。
- [ ] 推断结果仍出现在 `repairs` 里（可读性不许倒退），且 `compactWorkerReport` 的既有输出不变。
- [ ] 工单 33 的不变量逐条保住：`JSON.parse(workerReportShapeReminder(id))` 仍过 `validateWorkerReport`，
      `lastWorkerValidationPassed` 仍为 false，`missingTaskSpecValidationCommands` 仍返回要求的命令；
      `roles.test.mjs` 里 33 新增的那一块**一行不改**仍然全绿。
- [ ] 工单 28 的不变量逐条保住：`report.test.mjs` 里 run5 四份样本的断言一行不改仍然全绿，
      `isCanonicalReportShape` 不动。
- [ ] 修复前新增用例必须失败，回执贴出失败输出原文。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：planner 验收工单 33 的交付时实测发现（2026-09-08，round_id=p12-r056）。
33 的交付满足全部条款、实测保守，照常收口，本票另开。

**优先级：与 33 同级，阻塞第六次 08 重跑。** 理由与 33 相同 ——
它让 oracle 在 worker 没有任何明确主张的情况下跳过全量套件，
08 测出来的通过会建立在被悄悄放松的验证之上。run5 已有两份真实样本走了这条路。

round_id=p12-r056（工单 33 验收时开）
