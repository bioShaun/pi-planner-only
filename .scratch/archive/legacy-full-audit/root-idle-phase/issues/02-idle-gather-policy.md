# 02: Explorer lifecycle and bounded recovery before Idle gather Policy

**What to build:** Implement [Root Idle Policy](../spec.md) as one complete lifecycle: legal standalone Explorer Delegation → confirmed terminal WorkerReport → reviewing → Root Verdict → Idle. Distinguish auxiliary/unbound Explorers and recover one known pending run through exact-id `bg_wait` without making gather live. Enable cwd-scoped Idle Policy only when these paths work together. Reuse existing Evidence, review-mode, and blocked/failed Verdict gates.

**Blocked by:** [01](01-taskspec-example-json.md), after [Evidence 01](../../evidence-baseline-lag/issues/01-t2-lag-partition.md) → [retry stop-loss 02](../../evidence-baseline-lag/issues/02-reviewer-baseline-and-revalidate-spin.md).

**Status:** done

- [x] Fix Explorer ownership at launch: newly created standalone Task (including its later continuations), auxiliary call on an existing execution Task, or unbound call. Persist standalone Task ownership for restore. Auxiliary begin, success, failure, and cancellation never change the assisted Task lifecycle, report, baseline, review mode, or pending writer ownership.
- [x] A standalone confirmed successful result records a validated WorkerReport and bound Evidence, moves to reviewing, then requires Root `planner_verdict` for completed. An unchanged workspace is valid read-only work. Keep existing review-mode choice and required validation; do not force an extra Reviewer/Validator call for every lookup or auto-complete raw prose.
- [x] Confirmed launch failure/nonzero exit/cancellation records failed; invalid or missing terminal standalone report records blocked with a repair instruction. Launch receipt, timeout/window expiry, management-only response, or ambiguous error without confirmed exit stays pending. Auxiliary/unbound errors affect only their invocation. Existing sealed receipts and Root blocked-Verdict remain effective.
- [x] Sync, async notify, and trusted saved-result reconciliation share Explorer terminal processing. Idempotent consumption delivers output once; duplicate/late/superseded notices do not revive sealed/completed Tasks or overwrite newer reports. Unbound reconciliation retains and returns output even without a Task.
- [x] Policy input derives cwd and `liveTask` from `activeForCwd(adapter cwd)`. Add per-call recovery authorization derived from the registered pending Delegation's exact host run id, original tool-call identity, and launch cwd, including unbound records. An accounting Task or another cwd cannot authorize recovery.
- [x] Idle allows child-delegating `subagent`, questions, `planner_verdict`, and only exact-id `bg_wait` with a bounded blocking timeout ≤ 60 seconds. Refuse omitted/prefix/unknown/consumed ids, all-runs requests, nonblocking subscriptions, unknown extra fields, and wrong cwd. Other wait/supervisor, read/search, Git-read, shell, mutation, and unknown tools remain blocked. Pending unbound work never sets `liveTask` true. Live gather retains today's allowlist; guard-off and children still bypass Policy.
- [x] Before/after the authorized wait, reconcile only its registered run from the trusted saved-result location and return the recovered terminal output through the adapter. A host management-only response is not completion proof. Exact-id completion payloads require terminal validation. Missing metadata/output or receipt id produces pending/unavailable guidance without generic waits, broad scans, or auto-Delegation. Existing `bg_wait` Usage recording is retained and not mistaken for lifecycle processing.
- [x] Replayed or restored data cannot grant recovery from a Task id, accounting id, caller path, or untrusted filename. Restored non-final Task keeps that cwd gather-live under the existing rule; a missing trusted pending binding refuses the Idle recovery exception. Full legacy cross-session run reconstruction is not added.
- [x] Blocked/failed Tasks are gather-Idle absent other local live Tasks, and `planner_verdict` still works through the actual adapter path. L-4 blocked → pass → completed keeps report/Evidence gates. Preserve “Blocked lifecycle: still accepts Root planner_verdict”; do not redefine blocked as terminal for Verdict.
- [x] PLANNER_PROMPT stays ≤ 1800 UTF-8 bytes using the spec's authorized cuts. Explain new gather starts with Delegation, skills in TaskSpec constraints, bounded known-run recovery, and Root Verdict. Preserve standing report/review contracts with semantic-fragment tests; do not snapshot the whole prompt or add a Root slash command.
- [x] CONTEXT defines Idle as a gather Policy phase, not a Task state. README and Chinese README describe standalone closure and exact-run recovery in parity, preserving blocked/failed direct pass. CHANGELOG records Idle, lifecycle/recovery, and the sentinel fix if not already in 01.
- [x] Primary acceptance uses the user-confirmed complete Orchestration lifecycle with adapter Policy enabled: Idle read refused → validating example starts standalone Explorer → pending recovery available → report/review/Verdict → next read refused. Repeat through sync/async/reconcile, plus auxiliary outcome isolation, unbound lost-notice recovery with a management-only wait result, failure/invalid report, duplicate/late notice, wrong cwd/id, restore, and another live local Task. Smaller Policy/TaskSpec/prompt tests only supplement this path.

## Comments

2026-09-10: Supersedes the old blanket Idle wait prohibition. Lifecycle closure and bounded result recovery are release prerequisites in this issue, not optional follow-up issues. Do not enable the guard while standalone Explorer results still leave Tasks executing.

Host contract evidence: the installed `bg_wait` accepts `id` (including prefixes), but this feature permits only exact registered host run ids. Ordinary async waits may contain management data without completions; saved terminal metadata/output and the original Delegation binding drive reconciliation. Current adapter Usage handling does not implement that completion path yet. Verify using host-shaped fixtures rather than inventing a completion payload.

Scope excludes Root waiting-cost optimization during Worker execution, a generic capability platform, weakening Evidence, changing structured warn/strict defaults, and mandatory extra review calls for simple exploration. Observe Root Usage, child calls, retries, recovery attempts, and task cost for the same workload; fixture success does not prove live-host delivery or cost savings.

2026-09-11 实现（R02 完成）：

- 所有权：Explorer 委派在 launch 即固定 `explorerOwnership`（standalone / auxiliary / unbound）；standalone 通过 `TaskRecord.standaloneExplorer` 持久化以区分 restore 后的 continuation；auxiliary begin 跳过 reconcile/supersede/状态推进，auxiliary 与 unbound 的成功输出原样返回、错误只记调用结果。role stamp（`__delegationRole`）让未结构化 explorer 在 agent remap 后仍按 explorer 登记。
- 闭环：standalone 终局走 Worker 的同一条处理链（C_report 采样 → WorkerReport 校验/身份 → 绑定 Evidence → 快照 → truth/findings → advanceReview）；零变更只读交付合法；畸形/缺失终局报告直接 blocked + 修复指引（不自动消耗 report-only 轮），C_report 仍保留。
- 恢复：`authorizedWaitId`（精确 host run id + launchCwd 归一匹配 + 未消费）与 `recoverPendingRun`（只 reconcile 该 registered run；host 形状的 meta/输出 fixture 驱动；管理性响应不算完成证据；缺失 → pending/unavailable 指引；消费后的 id 不再授权）。adapter 的 `bg_wait` tool_result 保留 Usage 记录并接上该恢复路径。
- Idle Policy：`PolicyInput.liveTask` / `authorizedWaitId` 由 adapter 每次计算传入（store 内存读取，fail closed）；Idle 允许 child-delegating subagent / question / questionnaire / planner_verdict / 授权 exact-id bg_wait（≤60s、拒绝未知字段），其余全部拒绝并附 R01 可粘贴 JSON；live 保持原允许清单；guard-off 与子进程不受影响。
- Prompt/文档：PLANNER_PROMPT 重写为 1792 UTF-8 字节（≤1800），包含 Idle 契约与既有 Root 合同的语义片段断言；CONTEXT.md 将 Idle 定义为 gather Policy 阶段；README/中文 README 增补 Idle gather 策略与 standalone 闭环；CHANGELOG 记录 Idle、lifecycle/recovery 与 sentinel 修复。
- 测试：policy.test 新增 Idle 允许/拒绝矩阵（含 bg_wait 60s/未知字段/前缀）；orchestrate.test 新增 standalone 零变更闭环、畸形报告 blocked、auxiliary 隔离、exact-id 恢复（授权矩阵 + 消费幂等 + pending 指引）；index.test 新增 adapter 全生命周期验收（Idle read 拒 → 粘贴 → async standalone → bg_wait pending/recovered → Verdict → 再次 Idle → 重放不重消费）。全量 17 个测试模块通过，`tsc --noEmit` 干净。
- 未验证项：live Pi host 的真实交付与费用对比未跑（按主 spec 标记未验证）；fixture 通过不证明宿主端到端行为。

2026-09-11 收尾（审核后）：

- 补齐主验收缺口测试：unbound lost-notice + 管理性 wait 从 artifacts 回收原文（无 Task）；restore 后无可信 pending binding 拒 Idle recovery；同一 cwd 另一 live Task 使 gather 保持 live（Orchestration + adapter Policy）。
- Story 38：Idle `read` 拒绝用户附件路径，拒绝 JSON 按 story 22 把该路径写入 constraints。不增加宿主附件枚举或 Idle `read` 豁免。
- 未验证项不变：live Pi host 交付与费用对比。
