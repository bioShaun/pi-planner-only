# 运行身份由 Root 盖章：删除子代理无法满足的 `workerRunId` 契约与 launcher 能力门禁

Status: done
Date: 2026-09-18
Type: spec
Baseline: 33a5c2c1aeeba6d517987935d25bfdeabf210471（package 0.7.0）

## Problem Statement

0.5.0 之后连续两起事故（`.scratch/delegation-contract-incident-20260918/`、`.scratch/explorer-model-config/evidence/REPORT.md`）的共同症状是：子代理完成了工作，返回了结构合法的 WorkerReport，却因为 `evidence.workerRunId` "身份不匹配" 被拒收（`unacceptedReport`，`reports=[]`，Task `changes_requested`，后续 `pass` 被拒）。三次真实事故值分别是 `planner-scout`（角色名）、`T-20260918-004`（Task id）、`not-provided-in-launch-packet`（占位符）——子代理在诚实地告诉我们它不知道这个值。

根因不在 launcher，在本插件自己的契约自相矛盾：

1. 下发给子代理的 `WORKER_REPORT_SCHEMA` 把 `evidence.workerRunId` 定为**必填** `Type.String()`（`delegate.ts:440`），`additionalProperties: false`，子代理不填就通不过 launcher 的结构化输出校验。
2. 下发的 Task packet 只告诉子代理 canonical taskId（`task.ts:760`），**对 runId 一字未提**；`pi-subagents@0.68.0` 的 runId 是 launcher 内部 `randomUUID()`，从不进入 child 的 prompt / systemPrompt / env / tools。
3. 回收时却拿 launcher terminal response 的 `runId` 做精确比对（`delegate.ts:1619-1624`，`report.ts:130-138`）。

所以这个字段**在结构上不可能被子代理正确填写**。0.5 之前的代码知道这一点——旧 `report.ts` 有 Root 侧回填：`evidence.workerRunId "…" → expected (worker cannot know the run id)`（`.scratch/planner-only-cost-control/p12-verify-r057/report.ts:286`）。0.5 typed 契约删掉了回填但保留了必填 + 比对；当时不匹配只产生 `reportError`、报告仍入账进 review 循环（`da3a81e:delegate.ts:1070-1088`），症状被 `changes_requested` 掩盖。`d1cc34c`（stop-evidence，0.7.0）把不匹配改为**完全不接纳**（`admittedReport`），矛盾于是变成硬故障。

`200985e` 对此的处理方向是反的：发明了 `pi-subagents:delegation-capability-probe:v1` 事件和 `childRunIdentity` 能力，在准入前拒绝所有不宣告该能力的 launcher（`LAUNCHER_CAPABILITY_UNSUPPORTED`，`delegate.ts:813-824`）。已安装的 `pi-subagents@0.68.0` 源码中该事件名零命中；`4fa55e3` 又删除了环境变量逃生口。**当前 HEAD 在本机环境下，除 reviewer 外所有 `planner_delegate` / `planner_redelegate` 都被拒绝，一个 child 都起不了。** 收尾记录自己承认："运行于该版本时 pi-planner-only 将安全拒绝"，并把 01/03/04/05 票全部退回等待一个不存在的上游版本。

`deliverChildRunIdentity` / `extractChildRunIdentity` / `createCapableLauncher`（`delegate.ts:503-612`）全部是测试 fixture，生产路径没有任何东西会把身份注入 child prompt。

## Solution

**报告属于哪次执行，由 Root 用自己已经持有的事实决定，不再要求子代理证明。**

`runDelegation` 在收到 terminal response 时同时持有：本次 `executionId`（Root 的 toolCallId）、launcher 回传的 `runId`、以及 `requestId/ownerRunId/nodeId` 身份三元组（launcher 已按三元组过滤）。报告是从**这一条** response 里取出来的（`delegate.ts:1502`），它的归属不需要子代理再说一遍。

因此：

1. **子代理面 schema 删除 `evidence.workerRunId`。** `additionalProperties: false` 保证 child 连发都发不出来。子代理只声明它能知道的：`cwd`、`taskId`、可选的 Git ref/hash/paths。
2. **Root 在接纳边界盖章。** 取出结构化值后，Root 写入 `evidence.workerRunId = response.runId ?? executionId`。内部 `WorkerReport` / `EvidenceRef` 类型、账本字段、`orchestrate.ts` 的验收门、`task.ts` 的去重都保持原名不动——改的是字段的**所有权**，不是字段名。这与 README 已有措辞一致（"Root-owned evidence fields a worker cannot know"）。
3. **身份校验只剩子代理能负责的部分。** 接纳时 `validateWorkerReportIdentity` 只对 `taskId` / `evidence.taskId` 提出要求；runId 分支保留为 verdict 时的不变量守卫（`orchestrate.ts:2327-2351` 对恢复账本重新推导绑定），盖章值必然通过。
4. **透传值剥离并披露，不拒绝。** 若某个不校验 schema 的 launcher 让 child 带回了 `evidence.workerRunId`，按 ADR-0002/0003 的同款处理：丢弃、在 `warnings` 中披露 child 提供的值、再盖章。不因此 `unaccepted`。
5. **删除 launcher 能力门禁及其全部机器。** `LAUNCHER_CAPABILITY_UNSUPPORTED`、`LauncherCapabilities`、`DelegationDeps.launcherCapabilities`、`ensureLauncherCapabilities`、探针事件、三个 fixture 函数、相关测试。不保留任何"未来上游支持时再启用"的开关——这是本插件自己造出的需求，不是上游缺陷。
6. **记录 ADR-0004**，说明为什么 child 回报的身份不是身份证据、为什么 Root 盖章不违反 ADR-0001 "报告不改写"（Root 填的是 child 结构上不可能填的字段，不是修正 child 的声明），并把 `delegation-contract-incident-20260918` 票 01 的"上游下发身份"方案记为否决。

不变的部分：taskId 身份校验、`unacceptedReport` 机制（taskId 错配和 stop 未确认仍走它）、Evidence 采样与归因、stop 确认、writer hold、restricted-reader 能力分类（`READER_CAPABILITY_UNPROVEN` 是真能力门，保留）、reviewer 的 `review-${executionId}` 合成 id。

## User Stories

1. 作为用户，我希望在已安装的 `pi-subagents@0.68.0` 上 `planner_delegate` 能真的启动 child，以便插件重新可用。
2. 作为用户，我希望 Explorer/Worker 返回的合规报告被接纳并进入 reviewing，以便完成的工作能走到 Verdict。
3. 作为 Root，我希望不再看到 "workerRunId does not match" 这类子代理无法修复的拒绝，以便不浪费纠正轮。
4. 作为 Root，我希望属于别的 Task 的报告仍然被拒收，以便身份校验没有被整体放松。
5. 作为维护者，我希望每条已接纳的报告仍精确绑定产生它的 execution，以便 verdict 时的身份门、Evidence 归因和去重不退化。
6. 作为维护者，我希望旧账本（child 自填的 workerRunId，可能是错值）恢复后行为明确：已接纳的按原值保留，不重写历史。
7. 作为维护者，我希望代码里不再有一套只有测试在用的"身份下发"机器，以便下一个读者不会误以为生产路径有这条通道。
8. 作为用户，我希望真实宿主上跑通一次 Explorer（非 Git 目录、observation）和一次 Worker（Git 目录、含纠正轮），以便这次不再只有 mock 证据。

## Implementation Decisions

### 1. 子代理面 schema

- `WORKER_REPORT_SCHEMA.evidence`（`delegate.ts:437-445`）删除 `workerRunId`。保留 `cwd`、`taskId`、`baseGitRef?`、`finalGitRef?`、`gitStatusHash?`、`changedPaths?`。外层 `additionalProperties: false` 不变；**evidence 子对象不加 `additionalProperties: false`**——launcher 用 `typebox/compile` 做标准 JSON Schema 校验，实测加了会让多填 `workerRunId` 的 child 整份报告被 launcher 拒收（`/evidence must not have additional properties`），重现"工作完成、报告丢失"的故障形状；透传值交给 Root 剥离披露（决定 4）。详见票 01 §schema。
- `REVIEW_RESULT_SCHEMA` 不变（本来就没有 runId）。
- Task packet 文案（`task.ts:760`）不需要新增关于 runId 的说明；schema 即契约。

### 2. Root 盖章

- 盖章点：`delegate.ts:1502` 取出结构化值之后、任何 identity/evidence 使用之前。规则：`workerRunId = response.runId ?? executionId`（`orchestrate.ts:2338` 已接受两种拼法）。
- 盖章前若值上已有 `evidence.workerRunId`（透传），删除并 `warnings.push` 一条含 child 提供值的披露；绝不以此拒收。
- 盖章后的报告是后续所有路径（`validateWorkerReportIdentity`、`recordReport`、`unacceptedReport`、`compareEvidence`、`advanceReview`）看到的唯一版本。`unacceptedReport`（taskId 错配、stop 未确认、late report）同样是盖章后的值，满足 `ledger-store.ts:118` 的字符串要求。
- `cReport` 采样（`delegate.ts:1054-1057 sampleOptions`）继续用 `runId ?? executionId`，与盖章值一致。
- validator 角色同样适用（它也返回 WorkerReport）。reviewer 走 `REVIEW_RESULT_SCHEMA`，不受影响。

### 3. 身份校验

- `report.ts validateWorkerReportIdentity` 函数签名和 runId 分支**保留**：它是 `orchestrate.ts reportIdentityRefusal` 对恢复账本重新推导绑定时的守卫。接纳路径传入的 `workerRunId` 与盖章值恒等，该分支在接纳时不可能触发——这是设计意图，不是死代码，注释写清。
- `unacceptedReportReason` 文案（`delegate.ts:1691`）改为只描述 taskId 错配（runId 不再是 child 可犯的错误）。

### 4. 删除能力门禁

- `delegate.ts`：`LauncherCapabilities`、`ChildRunIdentityDelivery`、`deliverChildRunIdentity`、`extractChildRunIdentity`、`CapableLauncherOptions`、`createCapableLauncher`（503-612）；`DelegationDeps.launcherCapabilities`（621-625）；`LAUNCHER_CAPABILITY_UNSUPPORTED` 门（813-824）及其注释。
- `index.ts`：`launcherCapabilities` 变量与 `ensureLauncherCapabilities`（481-498）；调用点（1014、1022）。`pi-subagents:delegation-capability-probe:v1` 字符串全仓零命中。
- `README*.md` / `CHANGELOG.md` / 事故票中对 `LAUNCHER_CAPABILITY_UNSUPPORTED`、`childRunIdentity` 的描述改为"已撤销"。
- `ensureRestrictedReaderAgent` 和 `READER_CAPABILITY_UNPROVEN` **保留**：那是对 explorer 只读能力的真实证明，上游 `pi-subagents:runtime-agent-register:v1` 确实存在。

### 5. 历史兼容

- 旧账本中已接纳报告的 `evidence.workerRunId` 是 child 当年自填的值，不迁移、不重写。`reportIdentityRefusal` 对它们的行为不变（匹配 `producer.runId` 或 `producer.executionId` 之一即可）。
- `task.ts:1994-2005` 按 `workerRunId` 去重：盖章后同一 execution 的重复接纳仍被去重；不同 execution 的 runId 必然不同（launcher UUID 或不同 toolCallId）。

### 6. 契约文档

- `docs/adr/0004-run-identity-is-root-stamped.md`：决定 + Why + 否决项（上游下发身份；条件必填）。ADR-0001 §identity 段落加指针。
- `CONTEXT.md`：WorkerReport 词条补一句"execution 身份由 Root 在接纳时盖章，child 不声明 runId"；Evidence 词条不变。
- `README.md:221-225`、`README.zh-CN.md:146`：删掉"（存在时的）`evidence.workerRunId`"，改为 taskId 校验 + Root 盖章。
- `package.json` 0.7.0 → 0.8.0（子代理面 schema 变更，对齐 ADR-0002 §Consequences 的 minor bump 约定）；`CHANGELOG.md` Unreleased 段合入 0.8.0。

## Testing Decisions

以外部可观察结果为准：工具返回、Task/账本状态、`reports` / `unacceptedReport`、Verdict 可否落地、launcher 是否被调用。主 seam 与既有测试一致：`delegate.test.mjs` 的真实 `runDelegation` + 可替换 launcher；`index.test.mjs` 的已注册工具入口。**每票先写在 HEAD 上会失败的回归，再改实现。**

| 场景 | 必须观察到的结果 |
|---|---|
| launcher 返回 `runId`，child 报告**不含** `evidence.workerRunId` | 报告接纳，`reports[0].evidence.workerRunId === response.runId`，execution `reportIndex=0`，Task reviewing，`planner_verdict pass` 可落地 |
| launcher terminal **不带** `runId` | 盖章为 `executionId`；其余同上 |
| child 报告透传了 `evidence.workerRunId: "planner-scout"` | 接纳；`warnings` 含披露和 child 值；账本值为 Root 盖章值 |
| child 报告 `taskId` / `evidence.taskId` 属于别的 Task | 仍 `unacceptedReport`，`reports=[]`，reason 只提 taskId；`unacceptedReport.evidence.workerRunId` 为盖章值 |
| 纠正轮（`planner_redelegate`）第二次执行 | 第二份报告盖第二个 runId；两份都在 `reports`；`reportIdentityRefusal` 对最新 revision 通过 |
| validator 执行 | `validatorReports[0].evidence.workerRunId` 为盖章值 |
| stop 未确认 / late report | `unacceptedReport` / `lateReport` 的 `evidence.workerRunId` 为盖章值，`ledger-store` 校验通过 |
| observation 模式 Explorer（非 Git cwd） | 接纳、reviewing、verdict 可完成；无 writer hold |
| 恢复含 child 自填错值的旧账本 | 恢复成功；已接纳报告原值保留；`planner_tasks` 诊断可读 |
| 不宣告任何能力的 launcher（即 0.68.0 的真实形态） | **不再**出现 `LAUNCHER_CAPABILITY_UNSUPPORTED`；child 被启动 |
| `WORKER_REPORT_SCHEMA` 快照 | `evidence.properties` 无 `workerRunId`；`evidence.required` 无 `workerRunId`；`additionalProperties:false` 保留 |
| 全仓 grep | `childRunIdentity`、`delegation-capability-probe`、`LAUNCHER_CAPABILITY_UNSUPPORTED`、`SUBAGENT_RUN_IDENTITY`、`createCapableLauncher` 在 `*.ts` / `*.test.mjs` 中零命中 |

真实宿主验收（票 04）是交付要求，不接受 mock 结果替代：在已安装 `pi-subagents@0.68.0` 上完成一次 Explorer observation Task（非 Git 目录）和一次 Worker Task（Git 目录，含一轮 `request_changes` → `planner_redelegate` 纠正），每次都取得**已接纳**报告并完成 Verdict。记录加载指纹、host/launcher 版本、provider/model。

本地回归：`npm run typecheck`；受影响文件 `delegate.test.mjs`、`index.test.mjs`、`report.test.mjs`、`orchestrate.test.mjs`、`task.test.mjs`、`ledger-store.test.mjs`；最终一次 `npm run test:release`。按 AGENTS.md：spawn 子进程的测试从普通终端跑，不从沙箱执行器跑。中间文件落项目内目录，不写 `/tmp`。

## Out of Scope

- 让 `pi-subagents` 向 child 下发 runId（不再需要；`delegation-contract-incident-20260918/issues/01` 转 wontfix 并指向本 spec）。
- 重命名 `evidence.workerRunId`（127 处测试引用 + 账本兼容，收益不抵成本；所有权变更由 ADR 和 CONTEXT.md 记录）。
- 迁移旧账本中 child 自填的 workerRunId。
- 修改 taskId 身份校验、Evidence 采样、stop 确认、writer hold、restricted-reader 分类、refusal breaker。
- 事故 C 的另两项（准入原子性——已 resolved；`validation.commands` 参数保真——独立问题，留在原票）。
- `test:release` 在沙箱执行器下的 `spawnSync EPERM`（环境问题，见 `subprocess-capture-diagnosis-20260918`）。

## 票

| # | 文件 | 阻塞 | 内容 |
|---|---|---|---|
| 01 | `issues/01-root-stamps-run-identity.md` | — | schema 删字段、接纳边界盖章、透传剥离、身份校验收窄、回归 |
| 02 | `issues/02-remove-launcher-capability-gate.md` | 01 | 删门禁、删 fixture、删探针、改测试 |
| 03 | `issues/03-contract-docs-and-closeout.md` | 01, 02 | ADR-0004、CONTEXT/README/CHANGELOG、版本号、旧票收尾 |
| 04 | `issues/04-real-host-acceptance.md` | 01, 02, 03 | `pi-subagents@0.68.0` 上 Explorer + Worker 真实收口 |

顺序 01 → 02 → 03 → 04。01 和 02 之间不做宿主判断：只完成 01 时门禁仍会拒绝启动；只完成 02 时会重现"身份不匹配"。

## Further Notes

- 依据的原始记录：`.scratch/delegation-contract-incident-20260918/spec.md`（事故表）、`issues/01`（上游源码核对：runId 不下发）、`.scratch/delegation-contract-closeout-20260918/CLOSEOUT.md`（承认当前版本一律拒绝）、`.scratch/explorer-model-config/evidence/REPORT.md:11-13`（真实宿主 runId 错配、`reports=[]`）、`.scratch/typed-delegation/issues/03-spike-host-run.md:126`（0.5 早期 worker 花 28 轮自己翻出 runId 的"成功"样本）。
- ADR-0001 的"identity checked, never rewritten"针对的是 child 的**声明**不被 Root 修正。本 spec 没有修正任何声明：child 不再声明 runId，Root 填的是自己的事实。ADR-0004 要把这个区别写明，防止下一轮又有人把它当作"放松校验"。
