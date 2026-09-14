# 48: 绑定已入库 Task 的 validator 委派不得被提交的 spec 覆盖其 validation 定义（语义洞）

**What to build:** validator 委派一旦绑定到一个**已入库**的 Task，该 Task 的 stored spec 就是被验收的定义。提交的 spec 若给出**不一致**的 validation，必须 fail-closed 拒绝，而不是让它顶掉 stored 定义。

1. **判据**：绑定已入库 Task 时，若提交的 spec 带有 validation，且与 `target.task.spec.validation` **不一致**（`required` 不同，或 `required === true` 时命令集合不同），拒绝；结构化 code（例如 `VALIDATOR_SPEC_CONFLICT`），文案指明冲突字段与双方取值。
2. **一致或未给**：提交的 validation 与 stored 相等、或提交方根本没给 validation → 行为不变（现有取证与 packet 逻辑不受影响）。
3. **两个取值序都要审视**：守卫是 `specDetails.spec ?? spec ?? target?.task?.spec`，packet 是 `target.spec ?? target.task?.spec`（`roles.ts:686`）—— 两处都让**提交的** spec 优先，所以「拒绝失效」与「用另一套定义验收」是同一个根因的两面。
4. 未绑定 Task 的 validator（声明的 absent id、p12-r058 那条未绑定路径）**不在本票范围**，不得因此回归。

**Background / 证据：**

- 这不是文案问题，是语义洞：嵌入一份 `required:true + commands:[…]` 的 spec，就能（i）让工单 45 的 stored-task 拒绝失效，（ii）让 validator 在一套**worker 从未被要求覆盖的 commands** 下被判「验收」。
- 工单 45 的要求 6 已把它明确记为**隐藏逃生口**并选择保留（当时只要求「引导到新建 Task」），所以洞本身仍在。
- 现场证据：2026-09-14 工单 47 的宿主复跑**第一轮未复现**，原因正是 operator 的委派嵌了完整 spec 对 `T-20260912-016`（stored `{required:true}` 无可用 commands）发起校验 —— 委派**未被拒**、正常放行。见 [工单 47](47-validator-named-task-unresolved-falls-back-to-active.md) 的 Comments 与「宿主复跑」段。

**Acceptance:**

- 绑定已入库 Task + 提交 spec 的 validation 与 stored 不一致 → 被拒，code 结构化、文案含冲突字段与双方取值；不起 run。
- 提交 validation 与 stored 一致、或未提交 validation → 行为与今天逐字不变。
- 回归用例覆盖 `T-20260912-016` 的两种形状（嵌一致 spec / 嵌不一致 spec），并断言不一致那次的拒绝文案。
- 未绑定 validator（`orchestrate.test.mjs:1275-1299` 的 p12-r058 族）保持通过。
- `npm run typecheck` 与 `npm test` 绿。

**Blocked by:** 无。**优先级**：46 之后、49 之前（用户定：46 → 48 → 49）。

**实现记录（2026-09-14，本机）：**

- **判据**：`task.ts` 新增 `describeValidationConflict(submitted, stored)` —— `required` 必须相等；`required === true` 时再比较**可用命令集合**（`uniqueNonEmpty`，与其余归一化一致）；`required === false` 的命令不比较（无义务）。返回不一致的描述串，或 `undefined` 表示一致。
- **落点**：`orchestrate.ts` 中置于 45 的守卫**之前**（`specDetails` 可用处）：`target.role === "validator"`、提交方**显式带了 `validation` 键**（`specDetails.candidate` 含该键）、且已绑定 `target.task.spec` 时，不一致 → `VALIDATOR_SPEC_CONFLICT`，文案含 `validation.required/commands differ`、双方取值与 Task id。
- **为什么必须按「显式键」判定**：提取路径（`extractTaskSpec` → `createTaskSpec`）总把 `validation` 物化成 `{ required: false, … }`，所以「未提交 validation」与「显式 false」在这一层**不可分**。直接比较会误伤「嵌了 spec 但没提 validation」的常规用法，违背票面「未提交 validation → 行为逐字不变」。故以原始候选（`specDetails.candidate`）是否含该键为准。
- **为什么放在 45 守卫之前**：48 与 45 是同一个「validator 的有效定义」问题的两面；48 先拦，45 的 stored-task 拒绝就不再能被提交 spec 绕过。
- **本票不覆盖（需单独定）**：stored spec **没有** `validation` 字段、而提交方显式给了一个（如 `required:true` + commands）——按本票「双方都需有 validation」的字面判据**不算冲突**，该形状仍按今天的行为放行。是否把「stored 无 validation」视作 `{required:false}` 参与比较，留待决定。

**测试**（`orchestrate.test.mjs`）：提交 commands 与 stored 不一致（45 的 stored-task 形状 + 提交 `{required:true, commands:["npm test"]}`）→ `VALIDATOR_SPEC_CONFLICT`，文案含 `validation.commands differ`、`npm test` 与 Task id，且无 run；`required` 不一致 → 文案含 `validation.required differs`；两者一致、以及**完全省略** `validation` 键 → 均不按本票拒绝。

**回归证据**（本轮新验证）：临时关掉本票检查 → `orchestrate.test.mjs:1522` 失败（`expected: 'VALIDATOR_SPEC_CONFLICT'`、`actual: undefined`）；恢复后全绿。

**门禁**：`npm run typecheck` exit 0；`npm test` exit 0（35 个测试文件无失败）。日志 `.scratch/planner-only-cost-control/p48-impl/`。

**Status:** done（2026-09-14 本机落地、门禁绿。**未做宿主复跑** —— 与 46 同在 `fix/tickets-46-48-49-50` 分支上，待一次性宿主验证后再进 main。）

## Comments

2026-09-14 立案（工单 47 宿主复跑第一轮「未复现」的根因分析）。与 47 §1 的判据相邻但不同：47 管**点名解析不到**，本票管**指名解析到了、但提交方提供了不同的定义**。
