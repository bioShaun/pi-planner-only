# 01: Pasteable TaskSpec JSON and non-aliasing sentinel

**What to build:** Policy parent-tool refusals and Orchestration invalid-TaskSpec refusals share one example-JSON renderer owned next to TaskSpec validation. The JSON always passes TaskSpec validation. The documented `taskId` sentinel `T-pending` is always replaced by a generated canonical id and is never stored as an alias, so a second paste starts a new Task. PolicyInput gains `cwd` so the example can name the adapter workspace. Composite-workflow refusal is unchanged and does not gain this JSON.

**Blocked by:** [Evidence 01](../../evidence-baseline-lag/issues/01-t2-lag-partition.md), then [retry stop-loss 02](../../evidence-baseline-lag/issues/02-reviewer-baseline-and-revalidate-spin.md). This feature follows those priorities; within this feature, implement this issue before 02.

**Status:** done

- [x] Renderer (next to TaskSpec validation) emits an object that `validateTaskSpec` accepts. Tests parse the fenced JSON out of the reason; they do not snapshot the reason or the helper name.
- [x] Per-tool fill: inspect path → constraints + Explorer; bash command → objective + Explorer; write/edit → Worker; other → placeholder objective + Explorer. Invalid `validation` (array, non-boolean `required`, non-string-array `commands`) becomes `{ required: false }` with commands omitted. Submitted valid fields are preserved except the sentinel `taskId`. No invented budget, Evidence, extra worktree roots, or test commands.
- [x] Policy refused `write`/`bash` (and later Idle gather tools) append that fenced JSON plus "embed this in the subagent task". First lines of the existing block reason remain. PolicyInput includes `cwd`; adapter passes `ctx.cwd || process.cwd()` even before Idle gather ships.
- [x] Orchestration begin-Delegation on characteristic-but-invalid TaskSpec still creates no Task and starts no child; the block reason includes the same validating JSON.
- [x] Explorer examples request the existing WorkerReport output contract for a standalone Task. The accepted launch packet uses the returned canonical Task id and real report identity, never `T-pending`. Do not invent changed files, validation commands, or successful Evidence; terminal lifecycle handling belongs to 02.
- [x] First Delegation with `taskId: "T-pending"` gets a generated canonical id; `T-pending` is not in `aliases`; `store.get("T-pending")` does not return that Task. Second Delegation still using `T-pending` creates a different Task (including when the first Task is already completed).
- [x] CHANGELOG Unreleased notes the sentinel-alias fix (or this bullet lands together with ticket 02's Idle gather entry). Composite-workflow refusal still has no example JSON.

## Comments

Parent: [Root Idle Policy](../spec.md), stories 20–31, 42–44, 46 and 52.

2026-09-10: The example contract must support the standalone Explorer closure implemented in 02. This issue alone does not enable Idle. Evidence → retry stop-loss → this feature remains the delivery order.

2026-09-11 实现（R01 完成）：

- 渲染器：`task.ts` 新增 `TASKSPEC_EXAMPLE_SENTINEL`（`T-pending`）、`buildTaskSpecExample()` 与 `appendTaskSpecExample()`，紧邻 `validateTaskSpec`；内置安全网——合并保留字段后若校验非空则回退到保证合法的最小形态。
- Policy：`PolicyInput.cwd`（adapter 传 `ctx.cwd || process.cwd()`）；被拒父工具的 reason 保留原首行后追加 fenced JSON 与 "Embed this in the subagent task prompt…" 指引；非子进程委派的 composite `subagent` 调用保持纯拒绝（composite 提示属于 Orchestration，不加 JSON）。
- Orchestration：characteristic-but-invalid TaskSpec 的拒绝复用同一渲染器（以 `specDetails.candidate` 为 submitted 来源），仍然无 Task、无子进程；`T-pending` 走 `shouldReplaceTaskId` 替换路径但不再写入 `aliases`，同例二次粘贴（含首个 Task 已 completed）生成新的 canonical Task。C37-3 architecture 断言随 create/rekey 形态同步更新。
- 测试：policy.test 新增 8 组断言（bash/read/write 填充表、validation 修复、字段保留、sentinel、composite 无 JSON），orchestrate.test 新增 invalid-TaskSpec 拒绝与 sentinel 双粘贴生命周期两组。全量 17 个测试模块通过，`tsc --noEmit` 干净。
