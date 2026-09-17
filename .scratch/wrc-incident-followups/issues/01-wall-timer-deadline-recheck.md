# 01: wall 定时器到期复查 elapsed，observed 不得小于 limit

Status: done（2026-09-17 落地，见 Comments）
Type: bug
Blocked by: —
来源：../spec.md §1；R1 §结论第三段、§先复现.末段、§当前实现.5、§建议「wall保持独立保护有价值」

**What to build：** `maxWallMs` 的 `setTimeout` 回调到期后先复查实际 elapsed；不足 limit 则按剩余时间重新调度，达到 limit 才 `breach("wall", observed, limit)`。保证 `anomaly.observed >= anomaly.limit` 恒成立。

## 现状（写票时核过）

1. `delegate.ts:817–820`：`launchStartedAt = Date.now()` 后 `setTimeout(() => breach("wall", Date.now() - launchStartedAt, maxWallMs), maxWallMs)`。回调无条件 breach，`observed` 只是事后算出来的展示值。
2. `delegate.ts:660–667` `breach` 幂等，只记第一条异常并 abort 一次。
3. 真实事故：S:121 `wall observed=179999 limit=180000`，文案写 exceeded。R1 用真实 `runDelegation` + 虚拟 `Date.now` + 定向 timer 复现（`/tmp/opencode/envelope-boundary.mjs`，输出 `REPRO wall: timer callback at observed=179999 still cancels for limit=180000`）。1ms 差值的宿主根因（时钟量化/调度/系统时间变化）未取证，本票不追。
4. `Date.now` 是 wall clock，系统时间回拨会让 elapsed 变小甚至为负；`deps.now?: () => Date`（`delegate.ts:398`）目前只用于 ISO 时间戳（639）。
5. 现有测试：`delegate.test.mjs:1835–1857`（无 heartbeat 的 wall 越线，`maxWallMs: 10` 真实等待）、`2036–2048`（launch 前 Evidence 时间不计入 wall）。均不触边界。

## 设计

- elapsed 用单调时钟（`performance.now()`）计算，不受系统时间调整影响；`deps.now` 继续只管 ISO 时间戳。
- 回调：`elapsed = monotonicNow() - launchStartedAt`；`elapsed < limit` → `wallTimer = setTimeout(cb, Math.ceil(limit - elapsed))`（保持 `stopWallTimer` 能清掉新 timer）；否则 `breach("wall", Math.floor(elapsed), limit)`。
- `stopWallTimer` 语义不变：launcher 返回或抛错即清。
- 为可测性给 deps 增可选注入（例如 `clock?: { now(): number; setTimeout; clearTimeout }`，命名随现有 deps 风格），生产默认 `performance.now`/全局 timer。若判断注入面过大，可沿用 R1 harness 的做法（替换全局 `Date.now`/`setTimeout` 并定向拦截目标 timer），但要在测试内还原。
- 文案：`stateReason`/anomaly 展示保持「exceeded」，因为修复后 observed ≥ limit 恒真；不另加「timer deadline fired」分支。

## 测试

- 确定性边界：limit=180000，虚拟时钟让回调在 179999 触发 → 不 breach、重新调度；推进到 180000 → breach，`anomaly.observed >= anomaly.limit`。
- 时钟回拨：回调时 elapsed 为负 → 不 breach、按 limit 重新调度（不可无限 re-arm：每次重调度都以 limit 为上界）。
- launcher 在 re-arm 期间返回 → `stopWallTimer` 清掉新 timer，无 late breach（`runaway` 仍为 undefined，`termination.reason` 为正常值）。
- 现有 1835–1857、2036–2048 保持绿。

## 验收

1. `npm run typecheck && npm test` exit 0；`git diff --check` 空。
2. 新增回归里显式断言 `observed >= limit`。
3. 不改变 tokens 监控路径（`delegate.ts:823–830`）和 breach 幂等语义。

## Comments

- 2026-09-17 开票。R1 明确此项是「wall 计时/措辞问题，不是第二次 token 熔断」，修它不解释 C 轮约两分钟的 `find /`——那是 ../spec.md「不在范围」的 launcher 侧问题。
- 2026-09-17 落地。`delegate.ts`：`DelegationDeps` 新增可选 `wallClock {now,setTimeout,clearTimeout}`（生产默认 `performance.now` + 全局 timer，`deps.now` 仍只管 ISO 时间戳）；到期回调先复查单调 elapsed，不足 limit 按 `min(limit, ceil(limit-elapsed))` 重新调度（回拨时上界收敛到 limit，不会拉长），达到 limit 才 `breach("wall", floor(elapsed), limit)`——`anomaly.observed >= anomaly.limit` 恒成立。`stopWallTimer` 语义不变。`delegate.test.mjs` 新增三个确定性用例（179999 早触发→重调度→180000 breach、负 elapsed 回拨上界、re-arm 期间 launcher 返回清 timer），两处显式断言 `observed >= limit`。验收：`npm run typecheck && npm test` exit 0、`git diff --check` 空；R1 的 `/tmp/opencode/envelope-boundary.mjs` REPRO 路径不再 breach（前三条 PASS 仍成立，末段断言因 bug 已修而按预期不再成立）。
