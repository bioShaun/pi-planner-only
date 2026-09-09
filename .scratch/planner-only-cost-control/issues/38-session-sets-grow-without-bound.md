# 38: 会话级去重集合没有上限

**What to build:** `processedRunIds` 与 `confirmedNotLaunchedIds` 两个会话级 `Set` 都只增不减。
要么给出明确的有界策略，要么把「无界是有意的」写进注释并说明内存上界。

**Blocked by:** 无。

**Status:** done

Evidence: PR #1 / `bea8b47` / p21-r100 report.

- [ ] 两个集合采用同一套有界策略（或同一句「有意无界」的理由）。
- [ ] 若加上限，重复事件在被逐出之后不会被重复结算。

## Comments

2026-09-08（planner claude-pD）：这条是 p16-r074 的执行者提出来的，**它是对的，是我工单自相矛盾**。
我在 15-b 的工单里写「集合要有界，不能无限增长（跟 `processedRunIds` 同等对待即可）」，
而 `processedRunIds`（`orchestrate.ts:515`）本身就是无上限的会话级 Set，没有 prune 也没有 max。
执行者按「同等对待」实现（`confirmedNotLaunchedIds`，`orchestrate.ts:520`，同样无上限）是正确的；
凭空发明一个 FIFO N 才是编造。

**要加上限就两个一起加**，而且必须先回答：逐出之后重复的完成通知会不会被重复结算？
`processedRunIds` 正是防这个的，所以「有界」和「幂等」在这里是对立的，不能只挑一边。
在没想清楚之前，无界是更安全的一侧。
