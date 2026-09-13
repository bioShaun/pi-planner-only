# 证据归因：基线前已脏文件 / 既存未跟踪文件的就地修改被判 over-declared 且不可清除

Status: ready-for-agent

## 现象
Task 的 changedFiles 声明两类合法变更时，报告摄取恒判 `over-reported / unreliable declaration`（evidence finding: over-declared），且**任何后续轮次都无法清除**——oracle 复核全部通过后 Root 的 pass 裁定被转为 `blocked (evidence-no-progress)`，提示 "this evidence state was already revalidated"：

1. **基线前已脏的已跟踪文件**：文件在 Task 基线（HEAD）对比时已带前序已验收但未提交的修改（例如 07 号票带着场景 B 的追加行），本任务再改它 → 整文件被判 over-declared；
2. **既存未跟踪文件的就地修改**：未跟踪目录内一个任务前就存在的文件（如 `host-validation/handoff-evidence-index.json`）被本任务编辑 → 无法对基线 diff → 同样 over-declared。

## 复现证据
- 真实宿主 session `2026-09-13T12-43-06-809Z_01a09aca…`，Task T-20260913-034（alias T-CLOSE-EDITS，runId d42c2c05…）：
  - round 0 摄取：`decision: revalidate`，finding 原文含 `baseline hash skipped (3474 dirty paths); over-reported / unreliable declaration: …/handoff-evidence-index.json, …/07-git-commit-porcelain-v2-tracked-file-refusal.md`；
  - bounded oracle 复核（runId 446bc227…）十项检查全过（Status 行、JSON 可解析、diff 仅限 06/07）；
  - Root `planner_verdict pass` 被转为 `state: blocked, failure: evidence (evidence-no-progress)`；
  - 恢复仅由 operator 显式决定解开（随后 T-20260913-035 直接提交四个票据文件完成结算）。
- 对照：同 session 内"任务内新建的未跟踪文件"（T-20260913-031 round 2，精确路径绑定）可正常 `attributed 1 path` → accept。缺口仅在**既存**脏/未跟踪路径。

## 设计问题
1. "over-declared" 判定是否应区分**前序已验收工作的延续修改**（可归属到前序 Task 的 truth paths）与真正的越界声明？
2. 既存未跟踪文件的**就地修改**是否应支持归属（基线无 blob 可比，可用 mtime/内容快照或声明信任 + oracle 复核）？
3. `evidence-no-progress` 的 blocked 是否应在 oracle 复核全过时允许 Root pass 直接解（而非强制 operator）？

## 关联
- 08 号票（未跟踪脏路径阻断 git_commit）是提交侧闸门；本票是**报告摄取侧**的归因缺口；
- 09 号票（目录前缀 scope 语义）与第 2 点相邻但不同：09 是"目录内新建"，本票是"既存文件就地改"。
- 触发任务链：T-20260913-031/032/033/034/035（2026-09-13）。

## Triage 结论（2026-09-13，operator 裁定）

三项均采纳，各加限定：

1. **台账感知降级**：台账只证明历史归属，不证明本次变更。三分支：
   - 有本任务增量证据 → 正常归属；
   - 缺完整基线但有前序台账依据 → 归因缺口（降级为可复核 finding）；
   - 证据完整且无本任务变化，或路径越界 → 维持声明不一致 / scope finding。
2. **任务启动快照**：比较"任务启动时工作区状态 → 报告时工作区状态"（而非仅 HEAD）；快照同时覆盖 scope 内**既存脏的已跟踪文件**；哈希证明内容是否变化，需展示/核验具体增量时须保存基线内容或其他可恢复快照；mtime 不作内容归因的权威依据。
3. **Root 解 blocked 严格限定为已识别的 attribution-gap**，全部条件：
   - blocked 原因仅为可复核的归因缺口；
   - bounded oracle 针对当前证据快照通过，且覆盖所缺失的归因检查；
   - 当前 scope、声明与工作区变化一致，无其他阻断 finding；
   - 裁定前验证快照未漂移；
   - Root 显式 override，并记录原因、证据快照、oracle 结果和受影响路径；
   - "无声明外变化"按票 08 的分类解释：已确认的 scope 外未跟踪 external finding 不阻止解锁；
   - 不能仅凭"测试全绿"解锁（功能正确 ≠ 变更归属）；oracle 未覆盖归因缺口、scope 含混或存在其他阻断 → 维持 operator-only。

