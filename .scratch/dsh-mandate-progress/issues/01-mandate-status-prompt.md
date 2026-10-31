# 01 — Mandate 文案 + handoff status 枚举

Status: resolved
Type: task

## Scope

1. `NATIVE_PROMPT`、handoff `brief` 说明、`handoffPrompt`：Mandate ≠ Assignment；已授权跟进不重 Eval。
2. handoff 新增必填 `status` 枚举；保留 `progress` 三行叙述；投递前缀 `status:`；子代理终态用语对齐（prompt only）。
3. 测试、双语 README、CHANGELOG、CONTEXT；不落账本。

## Done when

- draft PR 开向 main；`test:release` 在仓库外 TMPDIR 通过（contract 可 SKIP）。
- 未 merge、未推 main、未 force-push 共享分支、未削弱既有断言。

## Comments

- 2026-10-31：从零落地（无半成品分支/PR）。

## Answer

已落地：`status` 枚举 + Mandate 文案；`test:release` 通过（contract SKIP）；draft PR 待开。
