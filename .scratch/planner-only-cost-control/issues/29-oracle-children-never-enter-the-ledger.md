# 29: oracle 子代理从不入账，且进程退出时无兜底落账

**What to build:** 两个互相独立的账本缺口，都在 08 第五次重跑里量到了。

**(a) oracle 子代理一次都没进过 `usage.jsonl`。** run5 五条账本记录里 children 的 `(kind, agent)` 分布是 `{('worker','worker'): 22, ('reviewer','reviewer'): 3}` —— oracle 从未出现。不是时序问题：`588268d7` 与 `b288025c` 在第一次落账之前就结束了，仍然不在里面。6 次 oracle 委派花掉 **$0.25224**，账本认为它们不存在。

**(b) 最后一次落账之后跑的子代理全部丢失。** 账本最后一条写于 `01:09:36Z`，进程跑到 `01:30:33Z`。这 21 分钟里又跑了 7 个子代理（$0.02227），因为 Task 再没进入终态，`flushIfTerminal` 再没触发，**进程退出时也没有任何兜底落账**。

要求：oracle／validator 角色的子代理与 worker、reviewer 同等入账；会话结束时无论 Task 处于什么状态都写出一条最终账本记录（可以带明确的非终态标记），使「meta 里有的 runId，账本里都有」成为可检查的不变量。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] 一次含 oracle 委派的运行结束后，`usage.jsonl` 末条 children 里出现该 oracle 的 runId 与 costUsd。
- [ ] 会话在 Task 非终态下结束时，仍写出一条最终账本记录，且该记录的 children 覆盖本次会话产生的全部 `*_meta.json` runId。
- [ ] 不变量测试：`usage.jsonl` 末条 children 的 runId 集合 ⊇ 该会话 `<SA>` 中 `*_meta.json` 的 runId 集合。修复前该用例必须失败，回执贴出失败输出原文。
- [ ] 不重复计数：同一 runId 只出现一次（工单 23 的重复写修复不得回退，`index.test.mjs:3372-3427` 一行不改仍全绿）。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策，工单 13/23 同源）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。08 条款 14 是硬条件，实测差集 10 个 runId、漏记 **$0.27450360，占实际总支出 $0.78197 的 35.1%**（r4 是 30.1%，本次更差）。其中 (a) 占缺口的 92%。

工单 23 收的是「失败子委派有 meta 但不入账」，与本票两条都不是同一个洞 —— 23 的修复没有回退，这是它没覆盖到的两条路径。

对一个以「省 token」为核心目标的专题来说，**整整一个角色不在账本里**是要先修的：省下来的钱现在没法量。

round_id=claude-pD-2026-09-08-open-29
