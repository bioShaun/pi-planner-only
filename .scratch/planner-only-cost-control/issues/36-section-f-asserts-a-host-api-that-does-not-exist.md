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

---

## 2026-09-08 planner 原型探测：三条候选方向作废两条，出现更强的第四条

我把装好的 pi-subagents 0.66.0 源码翻了一遍（它以 TypeScript 源码分发，`src/` 全在包里）。
结论比开票时精确得多：

**1. 宿主是真的接受每次委派的 `toolBudget` 与 `usageBudget`。**
`src/extension/schemas.ts:366-367` 是委派工具的入参 schema，两个字段都在，形状与我们发的一致：

```json
toolBudget  {"type":"object","required":["hard"],
             "properties":{"soft":{"type":"integer","minimum":1},
                           "hard":{"type":"integer","minimum":1},
                           "block":{...}},"additionalProperties":false}
usageBudget {"type":"object",
             "properties":{"tokens":{"type":"object","required":["hard"],...},
                           "costUsd":{"type":"object","required":["hard"],...}},
             "additionalProperties":false,
             "description":"Optional root-only reported-usage budget. Hard limits prevent
                            future child launches; running children are not stopped."}
```

也就是说 `roles.ts:311-315` 把 `input.toolBudget = { hard: N }` 写进委派入参这件事，
宿主侧是**认的**，不是我们自说自话。

**2. 但 `./preflight` 的启动契约里没有它。**
`src/shared/launch-contract.ts` 里 `toolBudget` 只作为**代理定义**字段出现
（`:73 toolBudget: agent.toolBudget`，参与 agent definition digest）；
每次调用的 `LaunchBindingInput`（`:82-105`）**既没有 toolBudget 也没有 usageBudget**。
所以 §F 现在这种「找 `resolveSubagentBudgetContract`」的写法，无论宿主怎么升都不会命中 —— 
预算根本不在 launch binding 这条线上。

**3. `./delegation` 是纯类型，运行时拿不到值。**
`src/api/delegation.ts` 运行时只导出 5 个事件名常量
（`SUBAGENT_DELEGATION_{REQUEST,STARTED,UPDATE,RESPONSE,CANCEL}_EVENT`）；
`SubagentDelegationRequest.toolBudget`（`:35`）是 interface 字段，strip-types 之后不存在。

**4. `SubagentParams` 是可运行时断言的，但不在 exports 里。**
`src/extension/schemas.ts` 导出 `SubagentParams` 与 `createSubagentParamsSchema()`，
后者是纯函数、无副作用，返回上面那份 JSON schema。**已实跑验证**（照 §E/§G 的办法把整包拷出
node_modules、软链兄弟依赖后 strip-types 导入）：

```text
exports: ChainItem,DynamicCollectSchema,DynamicExpandSchema,DynamicParallelTemplateSchema,
         ParallelTaskSchema,SubagentParams,SubagentWaitParams,createSubagentParamsSchema
has toolBudget: true | has usageBudget: true
```

但 `package.json` 的 14 个 `exports` 子路径里**没有** `./src/extension/schemas.ts`，
`.` → `index.ts` 也只导出 `registerSubagentExtension` 一个注册函数，不转出 schema。

### 由此重写候选方向

- ~~断言 `./delegation` 的事件常量~~ —— 与预算无关，作废。
- ~~断言「不存在 token/cost 预算字段」~~ —— **事实相反**，宿主有，作废。
- **F1（内部路径断言，现在是首选）**：导入 `src/extension/schemas.ts` 的
  `createSubagentParamsSchema()`，断言 `properties.toolBudget` / `properties.usageBudget`
  的形状与我们发送的一致（`toolBudget.hard` 必填正整数；`usageBudget.tokens/costUsd.hard`
  必填正数）。代价：依赖**非导出的内部路径**，必须在测试里显式写明这一点并锁死版本，
  这样上游哪天重构会**变红**而不是悄悄变绿。已实跑可行。
- **F2（具名豁免）**：把 §F 声明成上游缺口，闸门放行但必须打印具名豁免（缺的公开入口 + 工单 05
  第 1、2 条），且豁免要在一份显式白名单里。
- **F3（真跑一次子进程读启动参数）**：唯一能证明**运行时真的被执行**（hard 到了就停）的办法，
  要花模型钱，需用户拍板。

### 还要拍板的点

F1 只能证明「宿主的公开工具契约接受我们发的预算字段」，证明不了「跑起来真的在 hard 处停」。
工单 05 第 1、2 条的措辞是「宿主实际启动参数含默认 toolBudget.hard 与 usageBudget
（真实公开宿主入口验证）」—— F1 能满足「实际启动参数含」，但「公开」这个词要放宽成
「公开分发的包内、有导出符号的模块」。这一步措辞是否放宽，是用户的决定，不是我的。

**Status:** ready-for-planner-prototype → **needs-user-decision（F1 / F2 / F3 三选一，且 F1 需放宽「公开」措辞）**

---

## 2026-09-08 用户拍板：走 F1（内部路径断言 + 放宽措辞）

用户在 AskUserQuestion 里选了「F1 内部路径断言 + 放宽措辞（推荐）」。据此定下：

- §F 改成导入包内 `src/extension/schemas.ts` 的 `createSubagentParamsSchema()`，断言
  `properties.toolBudget`（`hard` 必填、正整数）与 `properties.usageBudget`
  （`tokens.hard` / `costUsd.hard` 必填、正数）的形状与插件发送的一致。
- 测试里必须**显式写明这是非导出的内部路径**，并把断言绑到已声明的 pi-subagents 版本上，
  让上游重构变红而不是变绿。
- 工单 05 第 1、2 条的「真实公开宿主入口验证」放宽为
  「**公开分发包内、有导出符号的模块**」；放宽范围仅限本条，别处不适用。
- F1 证明的是「宿主的委派工具契约接受我们发的预算字段」。**运行时是否真的在 hard 处停**
  仍未证明（那是 F3，用户未选，本轮不做）—— 闭合 05 第 1、2 条时必须把这句留痕写进工单。
- 闭合后 `npm run test:release`（`PI_PLANNER_ONLY_REQUIRE_CONTRACT=1`）应从 §F 的红转绿；
  §E/§G 的闸门分支与 `markContractUnverified`（工单 26）不得改动。

**Status:** ready-for-agent（下一轮派活；fence 只写 `e2e.pi-subagents.test.mjs`）
