# 33: worker 合同示例改成可照抄实例后，照抄一份就等于伪造一次 npm test 通过

**What to build:** 工单 28 把 `workerReportShapeReminder`（`report.ts:448`）从「取值图例」改成
**一份可照抄的合法实例**（条款 2 的选项 ①，理由成立：worker 会整段复制合同 JSON，图例形态今天必被
`validateWorkerReport` 拒收）。同时条款 1 要求示例元素带上门槛读取的 `command` / `exitCode`，
于是示例里的 validation 元素长这样：

```json
{"command":"npm test","type":"test","status":"passed","exitCode":0,"summary":"npm test passed"}
```

`roles.ts:59-70` 的 `wrapWorkerContract` 把这份实例放在
「Return only a WorkerReport JSON object:」后面，**周围没有任何一句话让 worker 把里面的值换成真值**。

**后果是严重度反转：照抄从"吵闹但安全"变成"安静且危险"。** planner 实测
（`p12-r056-28-copy-verbatim.log`，2026-09-08，输入是 `JSON.parse(workerReportShapeReminder(...))` 原样）：

```
照抄之后：lastWorkerValidationPassed = true   missingTaskSpecValidationCommands(["npm test"]) = []
          → ORACLE_SUITE=bounded. ... Do not run npm test, npm run test:e2e, or the full suite.
修复之前（validation: []）：lastWorkerValidationPassed = false
          → ORACLE_SUITE=full. Re-run the listed validation commands.
```

也就是说，一个一行命令都没跑、只把合同示例复制回来的 worker，现在能让 oracle **跳过全量套件**，
并让 TaskSpec 要求的 `npm test` 被记为已覆盖。修复前这份照抄会被 `status` 枚举挡下、整份报告拒收。
**本仓库自己的记录证明 worker 确实会照抄形状串**（工单 31 的成因、工单 28 的 run5 样本），
所以这不是理论风险。

**这个缺陷的责任在工单 28 本身，不在执行者** —— 是 28 的条款 1（示例必须带 `command`/`exitCode`）
叠加条款 2 选项 ①（示例必须是合法实例）逼出来的形状，执行者两条都照办了。

要求：让「照抄示例」的失败方向重新变成保守的那一侧 —— 照抄要么被人看出来，要么退化成**更多**验证，
绝不能退化成更少。可行方向（自行判断，回执说明理由）：

- ① 示例仍是合法实例，但 validation 元素取一个**不满足门槛**的组合
  （例如 `"status":"not-run"`，或 `"status":"failed","exitCode":1`），
  使照抄后 `lastWorkerValidationPassed` 为 false、oracle 走 full；
  `command`/`exitCode` 两个字段仍然出现在示例里以说明形状；
- ② 保留当前的 passed/0 示例，但在合同里加一句机器可检的祈使句
  （例如 "Replace every value above with what you actually ran; copying this block verbatim is a false report."），
  并新增测试断言该句存在；
- ③ 让示例里的值**自我暴露**（`"command":"<the command you actually ran>"` 之类），
  但这会让串本身过不了校验，与 28 条款 2 冲突，选它必须给出如何两全的方案。

**Blocked by:** None（源码在 `report.ts:448`、`roles.ts:59-70`，工单 28 已落地）。

**Status:** ready-for-agent

- [ ] 照抄一份 `workerReportShapeReminder()` 的输出当作 WorkerReport 时，
      `lastWorkerValidationPassed`（`roles.ts:118`）为 **false**，或该报告被明确判为不可接受；
      新增一条测试直接用 `JSON.parse(workerReportShapeReminder(id))` 做输入断言这一点（不许手写 fixture）。
- [ ] `missingTaskSpecValidationCommands`（`roles.ts:89`）不再因为照抄而把一条 TaskSpec 要求的命令记成已覆盖。
- [ ] 工单 28 的既有不变量逐条保住：渲染串本身仍过 `validateWorkerReport`；
      `report.test.mjs` 里 run5 四份样本的断言（三份失败含 `picked candidate with keys [`、
      `74f164e8` 仍抽出 `status=completed`）**一行不改**仍然全绿。
- [ ] `orchestrate.test.mjs` 的 I-2 用例仍然通过 `workerReportShapeReminder` 派生期望串，不回退成硬编码。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：planner 验收工单 28 的交付时实测发现（2026-09-08，round_id=p12-r056）。
执行者的交付满足 28 的全部条款、没有引入回归，故 28 照常收口，本票另开。

**优先级：高于 29/30，且阻塞第六次 08 重跑。** 理由是 08 的条款 8 数的是
`not a valid WorkerReport` 的出现次数；本缺陷恰好把「无效报告」变成「有效但内容伪造的报告」，
计数会从非 0 掉到 0，**08 会因此测出一个建立在伪造绿灯之上的通过**。
这正是本专题反复记的那类事故（工单 27 收口注：绿灯建立在真实链路上不存在的东西之上）。

round_id=p12-r056（工单 28 验收时开）
