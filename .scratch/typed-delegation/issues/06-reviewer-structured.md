# 06: reviewer-structured

Status: needs-triage（到达时由 Devin 展开为完整票面）
Blocked by: 04
Type: task

**Scope（一段话）：** Reviewer 走结构化返回：定义 ReviewResult 的 JSON schema（镜像 `types.ts:560`），`runDelegation` 增加 role=reviewer 分支（agent `reviewer`，packet 用 `buildReviewRequest` 单向渲染，结果直接进 `advanceReview({ review })`）；`review.ts` 的 `extractReviewRequest` / `extractReviewResult` 标记待删（08 删）。

**Acceptance：** 到达时定；固定一条：`grep` 证明本票没有新增任何对 prompt / 子进程输出文本的解析。
