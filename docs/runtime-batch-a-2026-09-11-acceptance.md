# 批次 A 验收闭环与模型预检反写复盘

日期：2026-09-11
范围：IS-01、IS-02、O-02
状态：实现完成，标准单元门禁通过；真实 Pi 宿主重放不在本批次范围内。

## 1. 模型预检反写缺陷

模型预检会计算最终的 `provider/model/thinking`，但“宿主默认”不是插件显式配置。旧路径把 host-default 结果反写到 `subagent` 输入，导致下游宿主无法继续使用自己的 `settings.json` 默认值，并把归因信息误当成启动参数。

修复后的边界如下：

- `host-default` 只进入编排历史的 preflight attribution/summary，不写入下游 `input.model` 或 `input.thinking`。
- 显式输入、角色策略或 TaskSpec 指定的模型仍写入最终启动输入，并保留 resolved provider/model/thinking。
- 预检仍发生在预算、reservation、证据采样和 Task 创建副作用之前。
- 回归测试检查真实传入对象没有被 host-default 预检新增的 `model`/`thinking` 字段污染。

## 2. IS-01 身份验收矩阵

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| I01 | 恢复同日 Task 后创建新 Task | passed | `ledger-store.test.mjs` A34-A37；恢复记录与新 objective/id 分离 |
| I02 | 共享 ledger 命名空间 | passed | `task.test.mjs` 持久 claim/ledger namespace 回归 |
| I03 | 独立进程并发分配 | passed | `task.test.mjs` 两个并发 Node child 通过 `.allocate.lock` 获得不同 id |
| I04 | 不可解析历史快照仍占用 | passed | `task.test.mjs` 写入坏 JSON 后跳过 `T-20260911-003` |
| I05 | claim/写入故障边界 | implemented | atomic temp+rename、锁 stale recovery、beforeClaim hook 已实现；未加入崩溃进程故障注入宿主回放 |
| I06 | 显式重复创建 | passed | `TaskIdAllocator.reserve()` 返回 `TASK_ID_CONFLICT`，不覆盖旧文件 |
| I07 | 显式继续与 workspace 校验 | implemented | `TaskStore.continueTask()` 解析 canonical/alias 并拒绝 workspace mismatch；现有 TaskStore 生命周期测试覆盖基础路径 |
| I08 | 三个现场新 Task 不复用旧 Task | passed | allocator 由 Orchestrator `ledgerDir` 默认接入，恢复后新 spec 使用新 id |

实现要点：跨进程 allocator 在 identity lock 下扫描 ledger 与 claim 文件；claim 和 snapshot 均保留身份占用，即使记录未加载、超过恢复上限、终态或内容损坏。自动分配的 claim 通过 `createAllocated()` 与新 Task snapshot 关联。显式 ID 走 `reserve()`，冲突在写入前返回结构化错误。

## 3. IS-02 修复保真矩阵

| ID | 场景 | 结果 | 证据 |
|---|---|---|---|
| S01 | 原始非法 Worker TaskSpec 回放 | passed | `policy.test.mjs` 验证 agent=worker 的角色保留 |
| S02 | 合法、缺失、未知 agent | passed | `inferTaskRoleFromAgent` 单一角色表；未知 agent 不猜测权限 |
| S03 | 非法 validation 且有验证意图 | passed | 可无损转换为 `required:true`；不可转换返回 `needs-input` |
| S04 | 合法 validation/字段保留 | passed | repair renderer 保留合法字段并输出变更摘要 |
| S05 | 无法可靠转换 validation | passed | 不生成可复制模板，不静默变成 `required:false` |
| S06 | 修复后最终角色/能力 | passed | 角色来自 submitted role、工具意图或可信 agent；不会因模板修复降为 Explorer |
| S07 | 共享拒绝模板 | passed | Policy 与 Orchestration 均调用 `buildTaskSpecRepair`/`appendTaskSpecRepair` |

## 4. O-02 多身份修正

report-only 修正现在必须有可验证的单一目标：

- 多个正文 Task ID 返回 `REPORT_TARGET_AMBIGUOUS`。
- 单个未知 Task ID、显式未知 `taskId` 或不可继续的终态 Task 返回 `REPORT_TARGET_UNBOUND`。
- 所有上述拒绝均发生在模型预检、预算 reservation、证据采样和 child launch 之前。
- 不创建 placeholder，不猜测 active/latest Task，不增加 report correction 次数；原 Task 状态、报告和费用保持不变。
- 只有同 workspace、可继续的 canonical ID/登记 alias，或完全未命名且能通过同 cwd fallback 解析的 correction，才进入后续绑定路径。

`orchestrate.test.mjs` 回放了 O-02 形状（T-011 目标、T-010 变更所有者）以及未知单 ID，并断言 Task 数量为零、无 delegation 记录。

## 5. 标准验证

本批次执行以下命令：

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm run typecheck` | passed | TypeScript 无错误 |
| `npm test` | passed | 标准单元/架构链全部通过 |
| `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` | failed | 隔离的 pi-subagents clone 缺少 `@earendil-works/pi-tui`，公开 `preflight` 契约无法导入；不是本批次单元测试失败 |
| `git diff --check` | passed | 无 whitespace 错误 |

验收口径区分 unit-verified、implemented 和 host-verified。I05 的真实崩溃故障注入及所有宿主加载/通知链路仍属于后续运行通道批次，不由本文件冒充完成。
