# 证据归因：基线前已脏文件 / 既存未跟踪文件的就地修改被判 over-declared 且不可清除

Status: verified

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

- 2026-09-13 10 fix host-verified on host (session 01a09b32, T-20260913-046: oracle re-ran 6 validation commands exit 0; full npm test 35/35 at 20eb6d3 + dcf6ca9); status flipped by Root. Implementation commits 20eb6d3, follow-up dcf6ca9.

## 2026-09-14 lifecycle 收口记录（未达 completed）

新代码（本分支 HEAD `9d45f8d`，经 pi git-package ref pin 加载）下重跑 operator override，**封锁已解除但未收口**：

- operator override 生效：`reviews` 末条为 `pass | source=operator`，`state` 由 `blocked` 变为 `changes_requested`，`blockedReasonCode` 与 `stateReason` 均为 `null`；
- 但 `recordRootVerdict` 在裁定瞬间重新采样工作区，判为 `evidence-stale` → decision `revalidate`，未进 `completed`。

**这次不是本票描述的归因缺口症状。** 决定性依据：新比较里 `attributionGapPaths: []` —— 三分支归因降级逻辑**明确判定不构成 attribution-gap**，与 2026-09-13 的日志重吸收误归属不是同一回事。

真实原因是取证基线已不可复现：

1. **baseline 提交被 rebase 抹出分支谱系**：报告写于 `5f9b4e1`，而 `5f9b4e1` 不在 HEAD 谱系内（`git branch -a --contains 5f9b4e1` 为空），它是本票提交被重写前的版本（与 `20eb6d3` 同题）。故比较恒得 `headChanged (5f9b4e1 → 9d45f8d)`、`missing` 与 `over-declared`；
2. `missing` (4) + `over-declared` (4)：`.scratch/c13-repo/`、`.scratch/nx-followups/host-validation/{c13-isolation,d1-review,d3-review}/repo/`；
3. `drift` (1)：`docs/pi-planner-only-recursive-improvement-plan.md`；
4. `undeclared` (1)，聚合 142 个路径，全部位于 `.scratch/nx-followups/host-validation/**`（宿主验证 scratch 产物，非本票变更）。本票 scope 为空，按空 scope 即全 in-scope，故拿不到票 08 的 scope-exempt external 豁免。

**结论：该 lifecycle 位无法靠 override 收口**，因为 baseline 已被重写，任何重新采样都会判 stale。可选的正当路径只有两条：

1. **新开 TaskSpec**：基线取当前 `9d45f8d`，声明本票实际交付文件（`evidence.ts`、`orchestrate.ts`、`review.ts`、`package.json`），跑 bounded oracle 取新鲜证据后记 verdict。这不是重做实现，是在未被重写的基线上重新见证已交付工作；
2. **接受现状**：本文件 `Status: verified` 与上文 Root 审码 + 6 项 oracle 记录即为权威结论，PR #8 复核不依赖该生命周期位。

**明确不得采用**（属事后改验收标准以凑过闸门，与本项目「不得回填历史 RED」同类）：

- 为消除 `undeclared` 而删除 `.scratch/nx-followups/host-validation/**`（含受保护目录）；
- 为本票事后补 scope / allow-list 使 142 条 finding 变为 non-blocking。

## 2026-09-14 收口完成（T-20260914-010）

上文两条路径中的第 1 条已执行并成功。PR #8 以 squash 合入 main（`ac59a16`），分支 `fix/host-validation-cumulative-patch` 已删除 —— 因此上文中「基线取 `9d45f8d`」**已失效，基线必须取当前 main HEAD**。

收口的实际落点是一个新的 verification-only 任务 **T-20260914-010**，首轮即达 `state: completed`：

- baseline：`ac59a162be82a670636b94acd3b763391f5e058b`（main），worker 与 oracle 各自在前后核对；
- worker（run c110adda）与独立 oracle 复核（run b3f180ab）分别重跑 6 项 validation（`npm run typecheck`、`nx10-attribution.test.mjs`、`evidence.test.mjs`、`review.test.mjs`、`orchestrate.test.mjs`、`rs02.test.mjs`）全部 exit 0；
- `changedFiles: []`；`truthPaths` / `undeclaredPaths` / `extraDeclaredPaths` / `missingPaths` 全为空 → comparison 干净，Root 记 `pass`；
- 工作树逐字节未变，仅存两个预存在的未跟踪目录。

**本票 T-20260913-046 自身仍为 `changes_requested`**，这是预期的：收口落在新任务的 `completed`，而不是旧任务位的改判。旧 baseline 已被重写，任何重新采样都会判 stale —— 这一点不因收口而改变。

**复用这条 recipe 时的两个坑**（均已实测踩过）：

1. 新任务若把本票交付文件声明为 `changedFiles`，会因 `priorTruthPaths` 只取自**同一任务**的历史轮次（`orchestrate.ts:1997-1999`）、**不继承父任务**，而落进 `extraDeclaredPaths`（`evidence.ts:1686-1690` 的 `!priorTruth.has(path)` 豁免不成立）→ 判 `over-declared / unreliable declaration`，永远到不了 `completed`。**必须报 `changedFiles: []`**。
2. `scope.allowedPaths` 必须非空（填真实交付面）。空 scope 在证据侧等于全 in-scope，正是本票 142 条 `undeclared` 的成因。
