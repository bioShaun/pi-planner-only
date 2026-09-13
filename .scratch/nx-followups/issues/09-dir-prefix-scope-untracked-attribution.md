# 目录前缀 scope 不归属目录内新建的未跟踪文件

Status: verified

## 现象
TaskSpec 的 `scope.allowedPaths` 写**目录前缀**（如 `.scratch/nx-followups/host-validation/`）时，worker 在该目录内**新建**的未跟踪文件（`d1-verify.txt`）在 round 1 被判 `evidence-stale (out-of-scope)` —— 文件已被探测到（D1 修复后不再"no longer present"），但归属判定没有把"目录前缀下的新文件"归入 truth/allow-list，导致一轮可修复的纠正；改为**精确文件路径**绑定后 round 2 直接 `evidence: fresh (attributed 1 path)` 并 accept。

## 设计问题
`evidence.ts:1397-1406` 的 `allowedPaths` 匹配是**精确集合匹配**（`allowedPaths.has(path)`），不支持目录前缀。需要产品决策：

1. 这是**设计如此**（scope 必须精确到文件，避免目录级放权过宽）→ 把 D1 票的复现结论改为"按设计"，worker TaskSpec 必须写精确文件路径；或
2. 支持**目录前缀语义**（`allowedPaths` 含尾随 `/` 时按前缀匹配），让"在允许目录内新建文件"直接归属。

若选 2，注意与 ticket-20 的外部噪声规则组合后的语义（目录前缀 + 未声明 + 未跟踪 → 归属而非 external）。

## 复现证据
- 真实宿主 session `2026-09-13T12-43-06-809Z_01a09aca…`，Task T-20260913-031（alias T-D1-RV）round 1 → `evidence-stale (out-of-scope)`；round 2（精确文件绑定）→ `evidence: fresh (attributed 1 path)`，Root accept。
- D1 修复（`3740c9e`）本身工作正常：文件被探测到（不再"no longer present"），且 `-uall` 展开使文件级归属成为可能 —— 本票仅涉及 **scope 语义**。

## 关联
- 06 号票（D1 折叠目录解析/哈希）已修复并验证；本票是其验证过程中发现的**独立 scope 语义**问题。

## Triage 结论（2026-09-13，operator 裁定）

支持目录前缀语义，统一匹配契约：
- `foo`：精确匹配该文件。
- `foo/`：匹配目录内所有后代路径；不匹配 `foobar/`（前缀边界必须是路径分隔符）。
- 统一使用仓库相对路径规范化；拒绝越出仓库根的路径。
- scope 校验、证据归因、报告检查使用**同一套**匹配规则。

两步分离（授权 ≠ 归属）：
- 目录内新建的未跟踪文件是**归属候选**（非 external）；
- 但目录授权本身不使目录内所有既存文件成为本任务 truth——既存文件仍需任务基线 + 报告时的变化证据（与票 10 的快照机制衔接）。

- 2026-09-13 09 fix host-verified on host (session 01a09b32, T-20260913-044: typecheck + nx09-scope + evidence suites exit 0); status flipped by Root. Implementation commit 4d69250 (duplicate 6f1487d folded into it).
