# 36: §F 断言的是一个 pi-subagents 根本不存在的 API（发布闸门因此长红）

**What to build:** 工单 26 落地后 `npm run test:release` 因 §F 而红 —— 这是设计中的结果，但红因不是
「我们还没写覆盖」，而是 **§F 断言的那个宿主接口不存在，且大概率不会以那个形状出现**。
`e2e.pi-subagents.test.mjs` 的 §F（`:305-327`）先找 `installedManifest.exports["./budget"]`
或 `["./preflight"]`，再要求模块里有 `resolveSubagentBudgetContract` 函数。实测
pi-subagents **0.66.0**：`exports` 里根本没有 `./budget`；`./preflight` 存在但**通篇没有一个
budget 字样**（`grep -c 'budget\|Budget' src/api/preflight.ts` → 0），它导出的是
`resolveSubagentLaunchContract` 和一整套 `SubagentLaunchContract*` 类型。

要求：把 §F 重新定成**宿主真的提供、且能在无模型调用下检验**的那件事，或者明确把 §F 降级为
「上游缺口」并停止让它顶着一个假断言长红。两者选其一，不允许让发布闸门永远红在一个写错的断言上。

**Blocked by:** 26（已落地，闸门现在真的会拦）。

**Status:** ready-for-planner-prototype —— 派活前 planner 必须先自己跑通一版，证明新 §F 可检验。

- [ ] §F 的断言对象换成 pi-subagents 公开面上**实际存在**的预算契约，或者 §F 被明确标注为上游缺口
      并从发布闸门里按名单豁免（豁免必须写清豁免的是哪一节、为什么、什么条件下解除）。
- [ ] 不许为了让闸门变绿而放宽工单 26 的守卫（`markContractUnverified` 的闸门分支一个字不动）。
- [ ] 不带 `PI_PLANNER_ONLY_REQUIRE_CONTRACT` 时 stdout 逐字不变。
- [ ] 不勾 08/26 的 checkbox、不改它们的 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`。开票人 planner claude-pD，2026-09-08，
来源是工单 26 验收后的直接后果（round_id=p13-r061）。

**已实测的上游事实（pi-subagents 0.66.0，`~/.pi/agent/npm/node_modules/pi-subagents`）：**

- `exports` 共 14 个子路径，无 `./budget`；`./preflight` → `src/api/preflight.ts`，
  导出 `SUBAGENT_LAUNCH_CONTRACT_VERSION = 2`、`resolveSubagentLaunchContract` 及其类型，
  **不含任何 budget 概念**。
- 整个 `src/api/` 里 `toolBudget|usageBudget` 只在 `src/api/delegation.ts` 出现一次：
  `SubagentDelegationRequest.toolBudget?: SubagentDelegationToolBudget`，形状是
  `{ soft?: number; hard: number; block?: string[] | "*" }`；配套有状态
  `tool_budget_exhausted`。
- **公开的委派请求里没有任何 token / 成本预算字段** —— 只有工具次数。也就是说我们
  `floors.ts` 的 `tokensHard` / `costUsdHard` **不是宿主替我们兜的，是我们自己记账兜的**。
  这条事实本身值得被一条测试钉住：上游哪天加了这类字段，我们应当知道。
- `delegation.ts` 运行期只导出 5 个事件名常量（其余全是类型，`--experimental-strip-types`
  下运行期取不到），所以新 §F 若要断言形状，要么断言那 5 个常量，要么读源码文本，
  **不能**指望 `typeof mod.X === "function"`。

**候选方向（planner 原型阶段定夺，不要让执行者替我们选）：**
①「工具预算契约」——断言 `./delegation` 的 5 个事件常量与 `tool_budget_exhausted` 状态确实在
上游源码里；②「token/成本预算由本插件自负」——断言上游公开面**不含** token/成本预算字段，
一旦出现就要求重新对齐；③ 把 §F 标为上游缺口并按名单豁免。

优先级：0.3.x 要对外声称「release gate 绿」之前必须闭合；不阻塞任何在跑的工单。

round_id=claude-pD-2026-09-08-open-36
