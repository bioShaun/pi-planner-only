# 13: Task 累计预算账本与状态展示

**What to build:** 使用者可为一项 Task 设置累计 token 与费用预算，两个维度独立。Root 规划与审核、Worker、Explorer、Validator、Reviewer 及所有重试的用量都记入同一 Task 账本，Root 按可证明的 Task 与阶段归属，子进程按实际角色归属；Task 创建前的 Root 规划和无法归属的用量保留为会话级未归属项，不归入最后 active Task。status 显示已知消耗、未知项、剩余额度；未配置累计预算的 Task 显示未设累计上限而不是虚构余额。既有 TaskSpec budget 的单次语义不变。Usage 仍是唯一用量事实来源，不建第二套计费数据。

**Blocked by:** 05、08、23。

**Status:** ready-for-agent

- [ ] 一项 Task 依次经历 Root 规划、Worker、Validator、Reviewer、Root Verdict、Worker 修正：全部用量记入同一账本，status 显示按角色分项。
- [ ] Task 创建前的 Root 轮次记为会话级未归属，status 单独列出。
- [ ] 未配置累计预算：status 显示未设累计上限，不显示余额数字。
- [ ] 配置了累计预算：status 显示 token 与费用两个维度的已用、未知、剩余。
- [ ] 旧 TaskSpec budget 配置在无累计预算时行为与改动前一致。
- [ ] 费用对照所需的整段会话成本可从 Usage 读出。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 28–30，阶段 D 决策第 1–2 条）。
- 2026-09-07：r4 产物暴露失败子委派不入账（`73bd7b92` 有 meta、不在 `usage.jsonl` 的 children 里），直接压在本票第一条 checkbox「全部用量记入同一账本」上，已开新票 23。Blocked by 已按用户 2026-09-08 拍板改成「05、08、23」。本票仍不派工。
