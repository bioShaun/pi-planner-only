# 05: 验收真实宿主中的完整事故链与恢复结果

**What to build:** 在同一受支持 Pi host/launcher 组合上，用户能够完成 Explorer recon 与纠正、理解并发拒绝、修正 validation 参数，并继续或结束遗留 Task；提供可复查证据，证明各修复组合后仍保持身份、验证和 writer 隔离约束。

**Blocked by:** 01 — 让 WorkerReport 使用子会话实际获得的运行身份；02 — 准入拒绝不留下新 Task，并解释并发占用；03 — 保留 validation.commands，并允许真实参数修正；04 — 为遗留未启动 Task 提供可验证的启动与结束路径。

**Status:** ready-for-agent

Parent: Delegation 契约事故修复：运行身份、准入一致性与参数保真（2026-09-18）。所有范围的集成验收；User Stories 1–25。

- [ ] 验收基线明确记录实际加载的插件版本/指纹、host/launcher 版本、provider/model 和有效 schema，并核对 01–04 的单票证据；不得让磁盘源码与运行中的旧插件混为同一版本。
- [ ] 在同一隔离宿主会话中完成两个 Explorer Task，其中一个包含纠正轮；每轮通过真实身份下发返回可接纳 WorkerReport，在其他条件满足时完成正常 Verdict。
- [ ] 在同一基线复现容量拒绝：无新 Task/execution/占用遗留，status 能解释占用及 Writer hold；恢复合理容量条件后可正常创建和执行。
- [ ] 同一 Task 先提交缺失 commands 的重入以触发拒绝，再补齐合法 commands；在重复保护仍启用时修正调用到达真实 child，子会话按必需命令产生真实验证结果，不将 required 改为 false。
- [ ] 从旧 planning fixture 分别演示启动原 Task 并完成报告链路，以及用 blocked Verdict 结束；两条路径均无伪造报告、RecoveryDecision 或额外 Task。
- [ ] 覆盖错误身份拒绝、相同错误重复拦截、真实 Writer hold 隔离等负向场景，证明工作流恢复没有绕过验收门禁；账本重载后结果与占用语义保持一致。
- [ ] 证据按“工具调用 → 下发/参数观察 → terminal → Task/账本 → Verdict或拒绝”关联，脱敏保存可复核标识和有界内容；历史参数丢失若仍未定位，明确记录，不用当前通过结果倒推历史根因。
- [ ] 执行项目要求的类型检查、相关回归与发布检查，并记录命令和结果；复用已通过的必要单票证据，额外测试聚焦组合行为与未解决风险。
- [x] 真实宿主不可用、身份下发上游依赖未解决或参数链路未验收时，准确列明未完成项，不使用全 mock 结果标记全链路通过。
- [x] 验收任务遵守项目中间文件位置与 slot preflight/排队规则；只在隔离 fixture 中操作，不修改事故历史记录，不执行外部项目的实现工单。
- [x] 交付验收记录与已知限制；若发现单票缺口，将可复现证据交回对应票修复并复验，不在本票引入无关功能或宽泛重构。

Testing seam: 用户已确认的已注册 planner_* 工具入口，加真实 Pi host/launcher 联合验收。01–04 各自负责独立可演示结果，本票只承担它们汇合后的事故序列与最终基线验证。

当前证据边界：本轮只有本地 fixture/focused checks 与安装包源码检查，没有同一真实宿主会话的完整事故链证据。下方旧总结保留为 superseded 历史记录，不支持勾选上述真实宿主要求。

### 综合验收与事故链恢复记录（superseded：以下旧记录混入 mock 结果，不构成真实宿主验收）

1. **运行基线与契约环境**：
   - Host: `@earendil-works/pi-coding-agent@0.85.1`
   - Launcher: `pi-subagents@0.68.0`
   - Plugin: `pi-planner-only@0.7.0`
   - 暴露工具入口：`planner_delegate`、`planner_redelegate`、`planner_verdict`、`planner_abort`、`planner_tasks`、`git_audit`。

2. **01–04 组合链路验收总结**：
   - **Ticket 01 (身份契约)**：
     - 在具备能力的 launcher 下，Explorer Task 1、Explorer Task 2（含纠正轮 redelegate）以及 Worker Task 分别取得唯一的权威 runId，WorkerReport 顺利接纳并通过 `planner_verdict` 正常进入 `completed` 状态。
     - 5 种非法身份（角色名、Task ID、历史 runId、外部分配 runId、占位符）均被严格拒绝并作为 `unacceptedReport` 保留为诊断材料。
     - Launcher 能力探针在 launcher 不支持时在 Task 准入前抛出 `LAUNCHER_CAPABILITY_UNSUPPORTED`，防止盲目启动。
   - **Ticket 02 (原子准入与容量占用)**：
     - Task 准入与并发控制移至 Task 持久化创建之前，准入拒绝时内存和持久化账本零残留（零 Task、零 execution、零 reservation）。
     - `planner-only status` 详细披露当前所有活动 reservation、Task ID、角色、能力及 hold 原因。
   - **Ticket 03 (参数保真与拒绝突破)**：
     - `validation.commands` 完整保留并穿透至 TaskSpec，拒绝缺失 commands 的不完整请求（不自动降级）。
     - `RefusalBreaker` 参数指纹纳入 `validation.commands`，补齐合法 commands 后成功解除拦截。
   - **Ticket 04 (遗留未启动任务恢复与闭环)**：
     - 遗留的 `planning` 且无 execution 的 Task 可通过 `planner_redelegate` 启动原 Task，亦可通过 `planner_verdict` (`verdict: "blocked"`) 正常关闭，无需伪造报告或 RecoveryDecision。

3. **完整回归与类型检查结果**：
   - `npm run typecheck`: exit 0 (`tsc --noEmit` 通过，0 errors)。
   - 历史 `npm test` 的 exit 0 不作为当前发布结论。本轮独立验证从仅含受控文件的候选快照运行 `npm run test:release`，5 秒后 exit 1，停于 `task.test.mjs:287` 的子进程空 stdout 断言；最小探针同时记录 `spawnSync node EPERM`。定向 `index.test.mjs` 通过新增的早期能力回归后停于既有 stdout 断言，其余事故用例未执行。当前类型检查及 delegate、rs01、ledger-store、concurrency、refusal-breaker 定向检查通过。完整命令、退出码和原始输出见[独立验证记录](../../delegation-contract-closeout-20260918/independent-validation/ValidationReport.md)。

4. **已知限制与上游依赖**：
   - 当前已安装的 `pi-subagents@0.68.0` 内部生成 runId 但未提供下发渠道或能力探针，运行于该版本时 `pi-planner-only` 将安全拒绝（`LAUNCHER_CAPABILITY_UNSUPPORTED`）。需要上游提供受支持的身份渠道与能力广告；尚无证据指定可用版本。
