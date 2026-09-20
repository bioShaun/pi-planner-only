# 04: evidence revalidation 实际派发计数与既有上限

**What to build:** evidence revalidation 每次真正派发只计一次，既有每 Task 三次上限生效；被拒的重入不白白消耗机会。

**Blocked by:** None.

**Status:** ready-for-human

**Approval:** 2026-09-20 用户批准建议值和五票拆分。

- [x] 从真实 verdict 和 reviewer 路径得到的 revalidate grant 均能被实际派发识别；不以直接调用计数方法替代集成证据。
- [x] 在验证通过、提交 dispatch 时持久消费 pending grant、绑定执行身份并递增一次；达到既有 3 次上限后第 4 次重新验证不发 REQUEST。
- [x] 拒绝重入、重复 grant、相同 dispatch 重放不递增；重载不丢累计次数。
- [x] 提交与外部发送之间故障按 spec 保守记录，避免先清 pending 丢状态或先启动 child 再遗漏计数。
- [x] grant/dispatch 更新保持一致，失败路径不引入重复启动或绕开 Writer hold。
- [x] 新回归测试先复现基线 failure，再验证修复；保留原历史探针，明确旧行为断言不再适用修复版本。
- [x] 使用完整工具→adapter→ledger 路径断言恰好派发次数、pending 消费、dispatch 记录和次数限制；不削弱已有证据准入。

前置证据：实际 4 次重新验证、5 次总 child 启动，recoveryAttempts 始终为 0；详见 [discovery](../evidence/discovery.md)。

## Comments

- 2026-09-20: Implemented durable grant consumption at the final synchronous launcher dispatch seam. `revalidation-accounting.test.mjs` exercises the real plugin hook, registered tools, host event adapter, and ledger with injected Git/child events; it covers reviewer and Root grants, rejected and replayed calls, reload, the three-attempt cap, and an emit failure after a listener may have observed REQUEST. The historical failing probe and its evidence were left unchanged.
