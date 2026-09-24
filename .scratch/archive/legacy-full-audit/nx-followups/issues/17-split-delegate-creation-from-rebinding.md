# 17: 拆分 `planner_delegate`（只新建）与 `planner_redelegate`（只绑定既有 Task）—— 创建路径上不再有 `taskId` 可填

Status: done（2026-09-16；delegate.ts 双 schema + index.ts 共用 registerDelegationTool 工厂注册 planner_redelegate；policy/prompt/README×2/CONTEXT 同步，ADR-0002 已立，版本 0.6.0）

## 问题

`planner_delegate` 一个工具同时承担"新建 Task"和"再委派 / 评审既有 Task"，靠 Optional `taskId` 区分（`delegate.ts:192-198`）。一个 Optional 字段就是给模型的填空邀请；再加上 `PLANNER_PROMPT` 的 "pass it as taskId on every later call for that Task"（`index.ts:199`）容易被模式匹配为"每次都要传"，模型便按 `T-YYYYMMDD-NNN` 格式凭空造一个（票 13：`T-20260717-001`；本次：`T-20260918-015`，日期在未来）。

票 13/14 把 `TASK_UNKNOWN` 文案改成可操作，但 session `01a0a9cc` 证明模型读到指引后仍重放同参数。**根治是结构性的：新建 Task 的调用面上根本没有 `taskId` 这个键。**

## 决策

**采用拆分（1a）**，不采用"从未铸造过的 ID 视同省略（1b）"：

- 1b 需要判定"该 ID 是否曾被发出"，要同时查 in-memory store、ledger 与 allocator claims（票 46 的 `aliasConflict` 注释 `task.ts:1252-1261` 已指出 restore cap 会让 in-memory 缺记录），三路查询仍有漏判；且把一个存在 Task 的 ID 打错成未发号会静默多出一个 Task。
- 1a 不需要任何"猜测调用方意图"的逻辑：创建工具上 `taskId` 无意义，绑定工具上 `taskId` 必填。"显式 ID 逐字绑定既有记录"的契约（`delegate.ts:498-500` 注释）原样保留在绑定工具。

## 要求

### R1. 参数 schema 拆分（`delegate.ts`）

从现有 `PLANNER_DELEGATE_PARAMETERS`（`delegate.ts:192` 起）派生两份导出，原实现 `runDelegation` **不改签名**：

- `PLANNER_DELEGATE_PARAMETERS`（新建）：
  - **无** `taskId` 键。
  - **无** `recovery` 键（recovery 只对既有 blocked Task 有意义）。
  - `role` 联合去掉 `reviewer`（reviewer 无 taskId 本来就是 `TASK_REQUIRED`，`delegate.ts:494-496`）；描述改为只讲 worker / explorer / validator。
  - 其余字段（objective / cwd / scope / constraints / acceptanceCriteria / validation / instructions / envelope）不变。
- `PLANNER_REDELEGATE_PARAMETERS`（绑定既有 Task）：
  - `taskId` **必填**，pattern 不变，描述：`Canonical id of an existing Task, verbatim from a prior planner_delegate result's details.taskId. Never construct one.`
  - `role` 含全部四种；reviewer 描述保留现有语义（spec 字段被忽略）。
  - `recovery`、`envelope` 保留。
  - 其余与新建版一致（worker 修正轮仍需要完整 spec 进 packet，见 `delegate.ts:529`）。

### R2. 工具注册（`index.ts`）

- 现有 `planner_delegate` 注册（`index.ts:772-787`）改用新建 schema；`execute` 在调用 `runDelegation` 前**删除** `params.taskId` / `params.recovery`（若宿主未按 schema 严格校验而透传了这些键），并在成功结果的 `details.warnings` 追加 `supplied taskId <x> was ignored: planner_delegate always mints a new Task; use planner_redelegate to bind an existing one`。**不得**因为多了一个键而拒绝——那会重新制造一条 refusal 循环。
- 新增 `planner_redelegate` 注册：schema 用 `PLANNER_REDELEGATE_PARAMETERS`，`execute` 与现 `planner_delegate` 的 catch / usage sync / termination 处理逐字共用（抽成一个 `registerDelegationTool(name, schema, description, ...)` 或共享的 execute 工厂，避免两份复制）。description 与 `promptGuidelines` 写明：
  - "Re-enter an existing Task: a correction round after request_changes (worker/explorer/validator), a review of its latest WorkerReport (reviewer), or a recovery re-execution of a blocked Task."
  - "taskId must be the canonical id received in details.taskId. Never invent one."
- `tool_call` hook（`index.ts:1050-1058`）的工具名列表与 `taskId` 归因分支加入 `planner_redelegate`。
- `message_end` / usage 归因中凡按 `toolName === "planner_delegate"` 判定的地方（实现者用 grep 逐处核对 `index.ts` 与 `usage.ts`）同等对待 `planner_redelegate`。

### R3. 策略（`policy.ts`）

- `IDLE_TOOLS`（`policy.ts:26`）与 `ROOT_TOOLS`（`policy.ts:33`）加入 `planner_redelegate`。
- 策略提示文本（`policy.ts:66`、`94-95`）改写：新建走 `planner_delegate`，修正轮 / 评审 / 恢复走 `planner_redelegate`。
- `policy.test.mjs:83-85` 加 `planner_redelegate` 断言。

### R4. Prompt 与文档

- `PLANNER_PROMPT`（`index.ts:192-199`）第 199 行替换为两句：
  - `planner_delegate always mints a new Task and returns its canonical taskId in details.taskId.`
  - `Later calls for that Task (correction round, review, recovery) go through planner_redelegate with that exact taskId. Never construct a taskId.`
- `README.md` / `README.zh-CN.md` 中所有描述 `planner_delegate` 接受 `taskId` 或 reviewer 走 `planner_delegate` 的段落同步改写（grep `taskId`、`role=reviewer`、`re-delegate`）。
- `CONTEXT.md` 术语：`Delegation` 条目下区分 creation / rebinding 两个入口；新增 ADR `docs/adr/0002-split-delegation-creation-from-rebinding.md`，记录本决策与拒绝 1b 的理由（模板参照 `docs/adr/0001-typed-delegation-contract.md`）。

### R5. 测试

- `delegate.test.mjs`：
  - 新增 schema 断言：`PLANNER_DELEGATE_PARAMETERS.properties` 无 `taskId` / `recovery`，`role` 枚举不含 `reviewer`；`PLANNER_REDELEGATE_PARAMETERS.required` 含 `taskId`。
  - 既有 `TASK_UNKNOWN` / `TASK_FOREIGN_WORKSPACE` / `TASK_REQUIRED` 用例（`248-286`、`660-710`）保留——它们测的是 `runDelegation`，现在对应 `planner_redelegate` 路径；注释更新指向新工具名。
- `index.test.mjs`（或既有能触达 registered tool 的 harness）：
  - `planner_delegate` 带 `taskId: "T-20260918-015"` 调用 → **成功**铸造新 Task，`details.taskId` 为新 canonical id，`details.warnings` 含 ignored 提示，launcher 调用 1 次。
  - `planner_redelegate` 不带 `taskId` → schema 层拒绝（或 execute 抛 `TASK_REQUIRED`），launcher 0 次。
  - `planner_redelegate` 带未知 `taskId` → `TASK_UNKNOWN`，文案仍是票 13/14 的角色区分版本。
- `policy.test.mjs`：`planner_redelegate` 在 Idle 与 live 两种相位下与 `planner_delegate` 同判。
- 全部 `*.test.mjs` 与 `npx tsc --noEmit` 绿。

## 验收标准

- 模型面上 `planner_delegate` 的 JSON schema 中不存在 `taskId`；任何带幻觉 ID 的新建调用都成功并给出真实 canonical id，不再进入 `TASK_UNKNOWN`。
- `planner_redelegate` 保持"显式 ID 逐字绑定既有记录"契约，`TASK_UNKNOWN` / `TASK_FOREIGN_WORKSPACE` / `TASK_CLOSED` / recovery gate 行为与文案不变。
- README 两份、CONTEXT.md、ADR、PLANNER_PROMPT、policy 提示中不再有"在 planner_delegate 上传 taskId"的表述。
- 版本：`package.json` 升 minor（工具面契约变更）。

## 非目标

- 不改 `runDelegation` 内部逻辑与 `DelegationRefused` code 集合。
- 不引入 `planner_tasks` 枚举工具（票 18）。
- 不做 1b 的"从未铸造"判定。

## 关联

- 票 13 方向 1（文案）已落地；本票是票 13 §机制中"触发诱因"段的结构性根治。
- 票 14 的角色区分文案在 `planner_redelegate` 上原样生效。
- 票 16 是本票之外的通用防线：本票消除创建路径的 `TASK_UNKNOWN`，票 16 覆盖其余所有 refusal。
- 票 04（refusal-kind-enum）若落地，`TASK_REQUIRED` 在新建工具上不再可达，可在该票中标注。

## Comments

- 2026-09-16（开票）：决策依据为 session `01a0a9cc` 与票 13 两次独立的幻觉 taskId 实证，以及 `delegate.ts:192-198` / `index.ts:199` 的诱因核对。1a vs 1b 取舍见 §决策。
- 2026-09-16（落地）：R2 保留 `planner_redelegate` 命名（理由记入 ADR-0002）。两处实现者对文案的裁量：
  1. R5 要求"文案不变"，但字面保留会让绑定面上的 `TASK_UNKNOWN`/`TASK_FOREIGN_WORKSPACE` 继续教模型 "omit taskId / pass the id"——在 `planner_redelegate` 上前者是 schema 违例、后者无意义。实现改为 refusal 前缀与 mint-vs-bind 子句随 `options.toolName` 感知调用面：默认仍是 `planner_delegate`（runDelegation 级既有逐字断言全部原样通过），redelegate 面提示改为"传 canonical taskId；铸新请用 planner_delegate"。code 集合与票 13/14 的角色区分句逐字保留。
  2. R2 要求 redelegate 缺 taskId 时"schema 层拒绝（或 execute 抛 TASK_REQUIRED）"：为覆盖不做严格校验的宿主，execute 工厂在 `runDelegation` 之前显式抛 `TASK_REQUIRED`（`DelegationRefused`，计入票 16 breaker），绝不静默铸新。
  - `tool_call` 归因分支调整：`planner_delegate` 的 `taskId` 是被忽略的透传垃圾，不再参与 turn 归因；只有 `planner_redelegate` / `planner_verdict` 的 `taskId` 有绑定语义。
