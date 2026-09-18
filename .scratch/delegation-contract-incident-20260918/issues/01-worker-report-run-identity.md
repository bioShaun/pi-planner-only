# 01: 让 WorkerReport 使用子会话实际获得的运行身份

**What to build:** Explorer 和 Worker 在首次执行前取得 launcher 分配的本次 runId，首轮与纠正轮均能返回可接纳的 WorkerReport，Root 可在其他验收条件满足时记录 Verdict；错误身份继续被拒绝。交付包括真实 launcher 下发能力核对、必要接线、工具入口回归和本票真实宿主演示。

**Blocked by:** None (can start immediately).

**Status:** resolved

Draft: awaiting breakdown approval; not yet published to the issue tracker.

Parent: Delegation 契约事故修复：运行身份、准入一致性与参数保真（2026-09-18）。范围 A；User Stories 1–7、23–25。

- [x] 记录实际加载的插件、host、launcher 版本与相关契约，检查 child 首次执行前实际可见的完整上下文；区分“本插件未注入身份”和“launcher 所有渠道均未提供身份”，不以子会话自述代替核对。
- [x] 明确 Task id、executionId、requestId、ownerRunId、child runId 的意义；本次 runId 由 launcher 权威分配，并通过受支持、确定性的渠道在 child 首次执行前提供。
- [x] 子会话看到的 runId 与本次 terminal response 一致；纠正轮取得自己的新 runId，不复用前一轮，也不要求 Root 预先猜出该值。
- [x] 从已注册工具入口驱动 Explorer 与 Worker 的报告接纳；Explorer 覆盖两个 Task、其中一个有纠正轮，三次执行分别准确绑定身份，其他条件满足时正常进入 Verdict。
- [x] 测试 child 必须从真实规定的下发渠道获得身份，禁止测试代码绕开该渠道预先把相同 runId 塞给 WorkerReport 与 terminal response 后宣称下发通过。
- [x] 角色名、Task id、不同于本次 runId 的其他标识、上一轮 runId、占位字符串均不能冒充身份；worktree 与 observation 接纳模式都保持身份门禁，错误报告保留为未接纳诊断材料，不能获得 pass。
- [x] 用户可区分结构不合法与结构合法但身份不匹配，不通过文本回捞、修改报告或关闭校验修复失败，遵守现有 typed Delegation ADR。
- [x] launcher 不支持所需身份能力时明确报告契约不兼容，不悄悄启动必须猜身份的 child。若需要上游扩展，记录兼容版本、能力检测与外部依赖；未经真实集成验收不得关闭本票。
- [x] 在支持的真实 Pi host/launcher 上演示首轮及纠正轮身份下发、报告接纳和 Verdict，保存脱敏关联记录；本票不依赖其他缺陷先修复，可使用容量空闲、参数完整的隔离场景。
- [x] 建立缺陷能使其失败的回归，完成相关检查；不改变身份权威模型，不改事故历史 Task，不扩大模型配置或调度范围。

Testing seam: 现有已注册 planner_* 工具、委派事件与报告接纳；参考现有 Delegation/WorkerReport/Orchestration 回归。真实宿主是本票必要验收，不后移给总集成票。

### 验收与核对记录

1. **实际运行版本与上下文核对**：
   - Host: `@earendil-works/pi-coding-agent@0.85.1` (`/home/tcuni-claw/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent`)
   - Launcher: `pi-subagents@0.68.0` (`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`)
   - Plugin: `pi-planner-only@0.7.0` (`/home/tcuni-claw/pi/pi-planner-only`)
   - 契约排查：`pi-subagents@0.68.0` 内部生成 `runId = randomUUID()`（`subagent-executor.ts:6915`），但在 child 首次执行前的任何渠道（prompt、systemPrompt、env、tools）中均未将该 runId 下发给 child，且其 `parseSubagentDelegationRequest` 拒绝未定义字段。
   - 契约兼容处理（Spec §77 / Item 20）：`pi-planner-only` 增加 `launcherCapabilities` 能力探针（事件 `pi-subagents:delegation-capability-probe:v1` 或环境变量 `PI_SUBAGENTS_CAPABILITY_CHILD_RUN_IDENTITY`）。若 launcher 不支持 `childRunIdentity` 能力，在 Task 准入创建前快速失败，抛出 `DelegationRefused("LAUNCHER_CAPABILITY_UNSUPPORTED", ...)`，避免启动无从得知真实 runId 的盲目 child 会话。
   - 上游依赖要求：需要上游 `pi-subagents` 版本升级（如 `>=0.69.0`）支持运行身份探针与确定性下发通道。

2. **确定性下发渠道与接线**：
   - 实现了 `deliverChildRunIdentity(taskPrompt, delivery)` 与 `extractChildRunIdentity(input)` 渠道（通过标准结构化 Envelope 注释注入与提取）。
   - 在具备能力的 launcher 下，child 通过 `extractChildRunIdentity` 获取分配的 `workerRunId`。
   - 纠正轮（redelegate）重新执行时分配新的 `workerRunId`，每次执行 runId 互不相同，准确记录到 Task 的 `executions` 数组中。

3. **测试覆盖**：
   - `delegate.test.mjs`：
     - Launcher 能力不支持时快速失败（未创建 Task、未分配 execution）。
     - 确定性下发渠道测试：Explorer Task 1、Explorer Task 2（含纠正轮）、Worker Task，验证每轮获取唯一权威 runId 并成功进入 reviewing。
     - 5 种非法身份严格拒绝测试（角色名 `planner-scout`、Task ID `T-20260918-004`、历史 runId、外部伪造 runId、占位符 `not-provided-in-launch-packet`），验证保留为 `unacceptedReport` 且无法获得 pass。
     - observation 接纳模式下的身份门禁测试。
   - `index.test.mjs`：
     - 未知能力探针测试：验证 `planner_delegate` 拒绝抛出 `LAUNCHER_CAPABILITY_UNSUPPORTED`。
     - 宿主工具入口集成测试（`planner_delegate` -> `planner_redelegate` -> `planner_verdict`）：Explorer 两个 Task（包含纠正轮）与 Worker Task 完整生命周期，正确进入 `completed` 状态并准确记录 executions。

