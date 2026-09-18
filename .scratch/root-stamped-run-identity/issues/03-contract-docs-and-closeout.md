# 03: ADR-0004、契约文档、版本号与旧票收尾

Status: resolved
Type: docs（契约记录）
Blocked by: 01, 02
来源：../spec.md §Solution 6、§Implementation Decisions 6、§Out of Scope

**What to build：** 把"运行身份由 Root 盖章"写成可被下一位读者找到的决定；把所有仍声称 child 要填 `workerRunId` 或 launcher 要宣告 `childRunIdentity` 的文档改正；把等待上游的旧票明确关掉。

## ADR-0004

文件 `docs/adr/0004-run-identity-is-root-stamped.md`，按 `.agents/skills/domain-modeling/ADR-FORMAT.md`（决定 1-3 句 + Why + 有价值的否决项）。要点：

- **决定**：child 的 WorkerReport 不声明 `evidence.workerRunId`（子代理面 schema 无此字段）；Root 在接纳边界用 launcher terminal 的 `runId`（缺省 `executionId`）盖章。透传值剥离并在 `warnings` 披露，不拒绝。
- **Why**：
  - child 结构上不可能知道 launcher 内部 `randomUUID()` 生成的 runId；0.5-0.7 的契约要求一个不可满足的字段，事故值 `planner-scout` / `T-20260918-004` / `not-provided-in-launch-packet` 是 child 诚实地说"不知道"。
  - 报告是从按 `requestId/ownerRunId/nodeId` 三元组过滤的**那一条** terminal response 里取出的，归属由 Root 已经掌握；让 child 复述不增加任何证据。
  - 与 ADR-0001 "identity checked, never rewritten" 的关系：ADR-0001 禁止 Root 修正 child 的**声明**；本决定下 child 不再声明 runId，Root 填的是 Root 自己的事实。taskId 声明仍受 ADR-0001 约束，错配仍 `unaccepted`。
- **否决项**：
  - *上游下发身份*（`delegation-contract-incident-20260918/issues/01`、`200985e`）：把插件自己的契约矛盾外包给 launcher，且以能力门禁的形式让插件在已安装版本上整体不可用；即便上游实现，也只是让 child 复述 Root 已知的值。
  - *`workerRunId` 改为 Optional 但保留比对*：可选字段是"请填满"的邀请（ADR-0002 §Why 的经验），模型会继续猜。
  - *重命名字段*：127 处测试 + 账本兼容成本，所有权变更由本 ADR 和 CONTEXT.md 承担。
- ADR-0001 在 identity 相关段落加一行指针："run identity: see ADR-0004"。

## CONTEXT.md

- **WorkerReport** 词条追加一句：它声明 Task 身份（`taskId` / `evidence.taskId`）和 child 能观察到的 Git 事实；产生它的 execution 身份（`evidence.workerRunId`）由 Root 在接纳时盖章，child 不声明。`_Avoid_` 追加 "child-reported runId"。
- 其余词条不动（Evidence 已写"Root's own Git samples, never the Worker's word"）。CONTEXT.md 不写实现细节，不提函数名。

## README

- `README.md:221-225` "Task identity and the PASS boundary" 第一条改为：WorkerReport 接纳要求 `taskId` / `evidence.taskId` 匹配被委派 Task；`evidence.workerRunId` 由 Root 从 launcher terminal 盖章，child 提供的值被剥离并披露。
- `README.zh-CN.md:146` 同步。
- 写票时 `rg` 确认两个 README、CHANGELOG、CONTEXT.md 都**没有** `LAUNCHER_CAPABILITY_UNSUPPORTED` / `childRunIdentity` 字样（`200985e` 只改了代码和 `.scratch/`），所以 README 只需改 workerRunId 那一条；CHANGELOG 的"已删除"条目是首次出现。

## CHANGELOG / 版本

- `package.json` `0.7.0` → `0.8.0`。
- `CHANGELOG.md`：Unreleased 两条（completionGuard、launch_failure）并入 `## 0.8.0 - <日期>`，新增：
  - **Run identity is Root-stamped (ADR-0004)**：子代理面 schema 删 `evidence.workerRunId`；接纳时盖章；透传剥离披露；事故三值不再导致拒收。
  - **Launcher capability gate removed**：`LAUNCHER_CAPABILITY_UNSUPPORTED` / `childRunIdentity` / `pi-subagents:delegation-capability-probe:v1` 全部删除；0.7.x 在 `pi-subagents@0.68.0` 上无法启动任何 worker/explorer/validator 的问题由此修复。写明这是 0.7.x 的回归。

## 旧票收尾（只改 Status / 加 Comments，不重写正文）

- `.scratch/delegation-contract-incident-20260918/issues/01-worker-report-run-identity.md`：Status → `wontfix`；Comments 追加：方案被 ADR-0004 否决，问题由 `root-stamped-run-identity/01` 解决；"Blocked by 上游" 一行删除或注明失效。
- 同目录 `03`、`04`、`05`：Comments 追加指针——身份链路部分由本 spec 承接；`03` 的 `validation.commands` 参数保真、`04` 的遗留 planning Task 路径、`05` 的宿主验收中与身份无关的项**保留原状态**，不在本票关闭。
- `.scratch/delegation-contract-closeout-20260918/CLOSEOUT.md`：顶部加一段"2026-09-18 后记：能力门禁方向已被 ADR-0004 撤销，见 `../root-stamped-run-identity/`"。不改其余历史文字。
- `.scratch/explorer-model-config/issues/03-real-pi-acceptance.md`、`explorer-model-config-closeout/CLOSEOUT.md` 未关闭条件 3："需上游提供真实 runId"→ Comments 注明该前提已由本 spec 取消，宿主重跑并入 `root-stamped-run-identity/04`。

## 验收

1. `docs/adr/0004-*.md` 存在且 ADR-0001 有指针；`rg -n "ADR-0004" docs CONTEXT.md README.md` 各至少 1 命中。
2. `rg -n "childRunIdentity|LAUNCHER_CAPABILITY_UNSUPPORTED|delegation-capability-probe" README.md README.zh-CN.md CONTEXT.md docs/` 只允许出现在 CHANGELOG 的"已删除"描述和 ADR-0004 的否决项里。
3. `package.json` 版本 0.8.0；`CHANGELOG.md` 无 Unreleased 遗留。
4. 旧票 Status 行与 Comments 如上；`git diff --stat` 中 `.scratch/` 只有这些文件的追加，没有正文重写。
5. `npm run typecheck` exit 0（版本号变更可能影响指纹测试 `architecture.test.mjs` / `rs01.test.mjs`，跑一遍）。

## Comments

- 2026-09-18 开票。ADR 写短：spec 里的论证够长了，ADR 只留决定、三条 Why、三条否决。
- 2026-09-18 已完成：创建 `docs/adr/0004-run-identity-is-root-stamped.md`，更新 ADR-0001、CONTEXT.md、README.md、README.zh-CN.md；package.json 升至 0.8.0；CHANGELOG.md 将 Unreleased 合并为 0.8.0 并增加特性说明；更新 7 个旧票/收尾文档状态与指针；验收检查全部通过。
