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
（`p12-r055-verify-28-copy-verbatim.log`，2026-09-08，输入是 `JSON.parse(workerReportShapeReminder(...))` 原样）：

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

**选项 ① 的可满足性 planner 已实测**（`p12-r055-verify-33-opt1-check.log`），三种写法都成立 ——
仍过 `validateWorkerReport`（`exitCode` 本来就是选填），且门槛全部退到保守侧：

```
{command,type,status:"not-run",summary}              validate [] | gatePassed false | missing ["npm test"]
{command,type,status:"not-run",exitCode:0,summary}   validate [] | gatePassed false | missing ["npm test"]
{command,type,status:"failed",exitCode:1,summary}    validate [] | gatePassed false | missing ["npm test"]
```

所以选 ① 不会与工单 28 的条款 2（渲染串本身过校验）冲突。选 ② 或 ③ 需自行论证等效性。

**Blocked by:** None（源码在 `report.ts:448`、`roles.ts:59-70`，工单 28 已落地）。

**Status:** done

- [x] 照抄一份 `workerReportShapeReminder()` 的输出当作 WorkerReport 时，
      `lastWorkerValidationPassed`（`roles.ts:118`）为 **false**，或该报告被明确判为不可接受；
      新增一条测试直接用 `JSON.parse(workerReportShapeReminder(id))` 做输入断言这一点（不许手写 fixture）。
- [x] `missingTaskSpecValidationCommands`（`roles.ts:89`）不再因为照抄而把一条 TaskSpec 要求的命令记成已覆盖。
- [x] 工单 28 的既有不变量逐条保住：渲染串本身仍过 `validateWorkerReport`；
      `report.test.mjs` 里 run5 四份样本的断言（三份失败含 `picked candidate with keys [`、
      `74f164e8` 仍抽出 `status=completed`）**一行不改**仍然全绿。
- [x] `orchestrate.test.mjs` 的 I-2 用例仍然通过 `workerReportShapeReminder` 派生期望串，不回退成硬编码。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：planner 验收工单 28 的交付时实测发现（2026-09-08，round_id=p12-r055）。
执行者的交付满足 28 的全部条款、没有引入回归，故 28 照常收口，本票另开。

**优先级：高于 29/30，且阻塞第六次 08 重跑。** 理由是 08 的条款 8 数的是
`not a valid WorkerReport` 的出现次数；本缺陷恰好把「无效报告」变成「有效但内容伪造的报告」，
计数会从非 0 掉到 0，**08 会因此测出一个建立在伪造绿灯之上的通过**。
这正是本专题反复记的那类事故（工单 27 收口注：绿灯建立在真实链路上不存在的东西之上）。

round_id=p12-r055（工单 28 验收时开）

2026-09-08 收口（planner claude-pD 逐条复现后接收，执行者 pi `w2E:pG`，round_id=p12-r056）。

执行者选 ①，落点是 reminder 的 validation 元素：`status` 由 `passed` 改为 `not-run`，
`summary` 改为 `npm test was not run in this worker round`，`command` 与 `exitCode` 保留。
净改动 `report.ts +2/-2`、`report.test.mjs +1/-1`、`roles.test.mjs +14/-0`，`orchestrate.test.mjs` 未动
（I-2 本来就从 `workerReportShapeReminder` 派生期望串，无需跟改 —— 这正是工单 28 条款 4 的作用）。

**planner 自己复现的证据：**

- slot 预飞已记（`p12-r056-verify-slot-audit.log` / `-slot-status.log`）：`bowtie2-align-l`(10.2G)、
  `sort`(3.8G)、两个 `agy` 绕过 slot，按规矩未终止；测试全部走 `slot cpu`。
- 四条命令全 exit 0（`p12-r056-33-verify-typecheck.log` / `-npm-test.log` / `-e2e.log` / `-diff-check.log`），
  16 个套件全 PASS，e2e 只剩既有的「§F 预算宿主契约未验证」。
- **RED 由 planner 独立复现**：只回退 `report.ts`，`node --experimental-strip-types roles.test.mjs`
  退出码 1，`true !== false` at `roles.test.mjs:48`，与回执逐字一致；按字节还原后 md5 相同、numstat 仍是 2/2。
  日志 `p12-r056-33-verify-red.log`。
- **关键一步：不只验原始 JSON，把渲染串当作 worker 的真实输出走完整条管线**
  （`p12-r056-33-verify-pipeline.log`）。这是必须做的，因为工单 28 的缺陷 B 已经证明
  `normalizeWorkerReport` 会改写候选，只看 `JSON.parse` 的结果会得出错误结论。实测：
  `extractWorkerReport` 无错、**repairs 为空**（归一化没有把 `not-run` 改回 `passed`，
  因为 `report.ts:220-232` 的 exitCode 推断只在 `status` 缺失/为空时才触发），
  归一化后 `lastWorkerValidationPassed` 为 false、`missingTaskSpecValidationCommands` 仍返回
  `["npm test"]`，`wrapOracleContract` 输出 `ORACLE_SUITE=full. Re-run the listed validation commands.`
  —— 照抄的失败方向已经翻回保守侧。
- 工单 28 的不变量保住：渲染串仍过 `validateWorkerReport`（`[]`）；
  `report.test.mjs` 里 run5 四份样本的断言一行未改（本轮对该文件的唯一改动是第 537 行
  `item.status` 的期望值），`isCanonicalReportShape` 未动。

**注记：**

1. 形状串长度 290 → 317 字符。相对 28 之前的 199，累计 +118（约 +30 token），每份 worker 合同一次。
2. 示例里 `status:"not-run"` 与 `exitCode:0` 语义上是矛盾的（没跑过却有退出码 0）。
   `status:"failed", exitCode:1` 本可两全，但当前写法已满足全部条款且实测保守，故不打回。
   矛盾本身有代价，见下条。

**验收时发现的相邻缺陷，已开工单 34，同样阻塞 08 重跑：**
`report.ts:227-232` 在 `status` 缺失或为空串时按 `exitCode === 0` 推断出 `passed`，
而这个推断出来的 `passed` 会直接满足 `lastWorkerValidationPassed` 与
`missingTaskSpecValidationCommands` 两道门槛，把 oracle 从 full 降到 bounded
（实测 `p12-r056-33-verify-inference.log`）。**这不是假设：run5 里 `75d7ae1c` 与 `e63c7583`
两份真实 worker 输出就漏写了 status，五条 validation 全部被推断成 passed。**
本票的 `not-run`/`exitCode:0` 矛盾还额外提高了「worker 顺手删掉 status 以消除矛盾」的概率，
删掉之后正好落进这条推断分支。

round_id=p12-r056（验收接收）
