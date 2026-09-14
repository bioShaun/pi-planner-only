# 53: 嵌入 TaskSpec 的委派会用 `bindSpec` 整个替换已存 Task 的 stored 定义（report-only 纠正也不例外）

**What to build:** 已存在的 Task 被再次委派（尤其是 ticket 42 的 report-only 纠正）时，**不得**用本次提交的 spec 覆盖 stored TaskSpec。stored 定义只在 Task 首次创建时写入；后续委派携带的 spec 只作为本次调用的 packet 内容，不落库。

**Why（证据，2026-09-14）：**

- 20:03 宿主检查 1 对 016 的 task-id-only validator 委派被 45 守卫拒绝，文案「Task T-20260912-016 is stored with validation.required = true but no usable validation.commands」——当时 stored 确实如此。
- 22:13:32 root 发起 report-only 纠正委派 `tool_1NQkH65wpljhCBCrM8l42LKM`（agent=worker，prompt 首行「Correction (report-only) for T-20260912-016 — second attempt」，嵌入 TaskSpec：objective「Report-only correction: submit an amended WorkerReport declaring the complete 91-path changed-file set…」，role worker，constraints 为 report-only 约束，无 validation）。
- 23:33 账本 `~/.pi/agent/planner-only/ledger/T-20260912-016.json` 的 `task.spec` 已变成上述纠正 spec：objective 是纠正文案、`scope: {}`、`acceptanceCriteria: []`、`validation: {"required":false}`。原 Batch-4（RS-04+RS-05）的 objective / scope / 验收标准 / 验证要求全部丢失，且被静默放宽为「无需验证」。
- 代码路径：`orchestrate.ts` `beginDelegationInner` 的 `if (spec) { … const existing = this.store.get(spec.taskId); if (existing) { … this.store.bindSpec(existing.taskId, persisted); } }`。`bindSpec` 直接 `record.spec = spec; record.role = spec.role; record.cwd = spec.cwd`。本机复现：validator 委派不走这条（本票不影响 48 的判定），worker / report-only 纠正会走。

这直接违反 45 票写进文案的承诺「The stored TaskSpec is not editable」，也让 48「validator 按 stored 定义判定」失去意义——stored 定义可以被任何一次嵌 spec 的 worker 委派改掉。

**建议修法（待确认）：** `if (existing)` 分支里，当 `spec.reportOnly === true`（ticket 42 已在纠正 spec 上盖章）或更一般地当 `existing.spec` 已存在且非占位（`!existing.isPlaceholder`）时，跳过 `bindSpec`，仅沿用 `existing`；本次 spec 继续作为 packet 使用。要核对 `bindSpec` 的副作用（`isPlaceholder=false`、successor 链接、`record.cwd`）在占位 Task 首次绑定时仍要发生。

**Acceptance:**
1. 对已存 Task 的 report-only 纠正委派放行后，ledger 中该 Task 的 `spec`（objective / scope / acceptanceCriteria / validation）逐字不变。
2. 对已存 Task 的普通 worker 委派（嵌入不同 objective 的 spec）放行后，stored spec 同样不变；packet 里子进程拿到的仍是本次提交的内容（或按 46/51 的 workspace/identity 规则拒绝，另议）。
3. 占位 Task（`isPlaceholder`）首次被带 spec 的委派绑定时，行为不变。
4. 016 的 stored 定义无法从账本恢复（无历史），记账说明即可；其原始 objective 见 48 票档案表。

**2026-09-15 落地（分支 `fix/ticket-52-refusal-attribution`）：** `beginDelegationInner` 的 `if (existing)` 分支只在 `existing.isPlaceholder || !existing.spec` 时 `bindSpec`；其余情况沿用 stored spec，若提交定义在 objective / cwd / role / scope / constraints / acceptanceCriteria / validation / expectedEvidence / stopConditions 任一项上不同，追加 warning「Task X keeps its stored TaskSpec; the submitted definition differs and applies to this invocation's packet only」。新增 `storedDefinitionDiffers()`（invocation-only 字段 reportOnly / budget / contextPack / readFirst 不计入）。

测试（`orchestrate.test.mjs`）：普通 worker 再委派与 report-only 纠正各一例，嵌入不同 objective / 无 validation 的 spec → 放行、绑定到既有 Task、stored spec 逐字不变、mandatory validation 未被放宽、warning 出现；占位 Task 首次绑定一例 → 取提交定义、`isPlaceholder=false`。既有 C09 测试原本依赖「再委派把 stored cwd 改到 holder 的目录」制造写锁冲突，改为创建时即用该 cwd（意图不变）。`npm run typecheck` / `npm test` exit 0。

**宿主验收（待 operator）：** 对 `T-20260913-046`（changes_requested，stored validation 6 条命令）发一次 report-only 纠正委派并嵌入不同 objective 的 TaskSpec → 放行后 `~/.pi/agent/planner-only/ledger/T-20260913-046.json` 的 `task.spec` 与委派前逐字一致（基线指纹由本机记录），且工具回执含 keeps its stored TaskSpec 的 warning。

**Status:** done（本机落地、门禁绿；宿主验收待跑。）
