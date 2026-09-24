# 31: reviewer 合同示例里的绑定值是字面量，照抄即被 mismatch 拒收

**What to build:** 工单 27 修好之后，`review.ts:150-151` 的输出合同示例长这样：

```
  {"taskId":"{TASK_ID}","verdict":"pass","summary":"...","evidenceFresh":true,
   "reportRevision":0,"workspaceDigest":"0000000000000000","findings":[]}
```

`taskId` 用的是占位符 `{TASK_ID}`（会被替换成真值），`summary` 用的是 `"..."`，
**但 `reportRevision` 和 `workspaceDigest` 是两个看起来完全像真值的字面量**。
上面三行祈使句确实写了「echo from the ReviewRequest packet」，
可是 run5 的教训就是：**子代理会照着形状串的字面照抄**，而不是照着散文办事。

后果不是死锁（27 已经解掉了），是换了一种失败：
`review.ts:190` 会在最新 report revision ≠ 0 时报 `reportRevision mismatch`，
`review.ts:198` 会在包里带 digest 时报 `workspaceDigest mismatch`。
Root 同样拿不到一次可记录的 PASS，只是报错文案换了一句。
严重度低于 27（27 是 100% 拒收，本票只影响照抄字面值的 reviewer），但成因是同一个。

**约束：示例必须仍然是合法 JSON。** 工单 27 的条款 10 立了一条不变量 ——
`review.test.mjs` 的 `extractReviewResultContractExample()` 会把示例括号配对提取出来
`JSON.parse` 再过 `validateReviewResult` + `validateReviewResultBinding`。
所以不能把值换成 `<from packet>` 这类非 JSON 占位符。可行方向（自行判断，回执说明理由）：

- ① 保留合法字面值，但在示例正下方加一句明确的禁令，例如
  「the reportRevision and workspaceDigest above are placeholders — copy the packet's values, never these」；
- ② 让示例里的字面值**自我暴露为占位符**（例如把 digest 写成一串明显不可能是真摘要的值），
  同时保持 JSON 合法与校验通过；
- ③ 两者都做。

**Blocked by:** None（工单 27 已收口，源码在 `review.ts:142-156`）。

**Status:** invalid（2026-09-08 作废，见文末）

- [ ] 合同示例仍然是合法 JSON，`extractReviewResultContractExample()` 那条测试**一行不改**仍然全绿。
- [ ] 合同里出现一处**机器可检的**禁令或占位标记，使「照抄示例里的 reportRevision/workspaceDigest」
      成为一件读合同的人不会做的事；新增一条测试断言该文本存在（不许只改文案不加测试）。
- [ ] 工单 27 新增的四条测试（`review.test.mjs`、`index.test.mjs` 末尾的端到端、`roles.test.mjs`）
      逐字不变且仍然全绿。
- [ ] `validateReviewResultBinding` 一行不改 —— 本票只动合同文本与测试。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：planner 在验收工单 27 的交付时发现（2026-09-08，round_id=p11-r053）。
不是执行者的疏漏 —— 27 的验收条款要求「示例串本身能过校验」，这条要求本身就把示例逼成了合法字面值，
占位符问题是那条要求的副产品。定 31 的条款时特意保住了 27 的那条不变量。

优先级低于 28/29/30：27 已经把「永远拒收」解掉了，本票解的是残留的「照抄即 mismatch」。

round_id=claude-pD-2026-09-08-open-31

2026-09-08 作废（planner claude-pD，round_id=p12-r054）。

本票的前提是工单 27 走了方案一「合同要求回显」，示例里因此出现
`"reportRevision":0` 与 `"workspaceDigest":"0000000000000000"` 两个字面值。
27 最终落地的是**方案二「编排侧补齐」**，合同文本相对 `47036db` 一行未改，
示例里根本没有这两个字段，`extractReviewResultContractExample()` 那条测试也不存在。
本票描述的代码状态从未进入 HEAD，条款全部落空，故作废而非搁置。

若将来把 27 改回方案一（合同回显），本票的三条路线仍然适用，届时重开。
