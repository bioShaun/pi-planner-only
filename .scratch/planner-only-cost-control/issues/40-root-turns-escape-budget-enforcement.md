# 40: untasked root 回合逃逸预算强制

**What to build:** 为没有活跃 Task 的 root 回合建立会话级预算累计与委派闸门。当前 `index.ts` 的 `message_end` 对所有 root 回合调用 `ledger.recordRootTurn`，这里只做记账；预算强制（floors/reservations）只发生在 `beginDelegation` 委派闸门。无活跃 Task 的 root 回合（untasked）完全不受预算约束。2026-09-09 会话实测 untasked 累计 `$1.19` / 54 turns，期间没有预算闸门。

**Design direction (approved):** 增加会话级 root 累计上限。接近软顶时向操作者发出警告；达到硬顶时拒绝新的付费委派并提示操作者。root 当前回合本身不能被中途掐断，因此可执行的强制点是“禁止再开新的付费委派”，而不是终止正在进行的 root 回合。上限应可配置，并按“单 Task 委派预算 × N”推导。

**Approved parameters (2026-09-09):**

- 软顶 = 单 Task 委派预算 ×3：触发警告，但不阻止新委派。
- 硬顶 = 单 Task 委派预算 ×5：拒绝新的付费委派，但不掐断当前会话或当前 root 回合。
- 硬顶触发时必须向操作者明确披露，沿用 E1/E2 的披露原则：预算已被闸门阻止必须在状态/拒绝信息中可见。

**Design basis:** 病态日实测 root 总计约 `$2.36`（Task root `$1.17` + untasked root `$1.19`，包含协议故障税）；正常日应远低于软顶，软顶用于提示异常，硬顶用于限制继续派发。

**Blocked by:** 无（参数已由用户 2026-09-09 拍板；实现仍待 agent）。

**Status:** ready-for-agent
