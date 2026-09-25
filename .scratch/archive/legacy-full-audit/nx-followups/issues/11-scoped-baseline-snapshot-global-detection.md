# 基线证据：快照范围收缩到任务 scope，保留全局变化检测

Status: verified

## 背景
`baseline hash skipped (3474 dirty paths)`：证据层对**整个 worktree** 做基线哈希，脏路径超阈值即跳过并退化为保守启发式——这是票 08/09/10 三类症状的共同触发器（2026-09-13 宿主 session 01a09aca 三次复现）。

## 决策（2026-09-13，operator 裁定）
区分两个范围：
1. **内容快照 / 哈希**：限制在任务 scope（allowedPaths ∪ truthPaths）内；目录 scope 展开到既存文件。
2. **工作区变化检测**：仍覆盖整个 worktree，用于发现 scope 外修改，再按 tracked / untracked 分类处理（tracked → 票 08 的硬拒/豁免规则）。

约束：
- 若把所有检测都缩到 scope 内，将无法可靠判定"工作区无声明外变化"（票 10 的 Root override 条件依赖该判定）。
- 资源上限导致快照不完整时，应明确记录为**归因证据缺口**，不直接判为虚假声明。

## 关联
- 票 08/09/10 实施的共同前置；ticket-20 语义不变。

- 2026-09-13 11 fix host-verified on host (session 01a09b32, T-20260913-042: typecheck + evidence suite exit 0); status flipped by Root. Implementation commit 67f888a.
