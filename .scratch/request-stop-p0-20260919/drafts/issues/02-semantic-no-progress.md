# 02: 同类无进展有限停止且保留真实参数纠正机会

**What to build:** Root 改写 summary/reason、换 Task 或用新 executionRef 恢复同类失败时仍达到有限停止；真正修复结构问题可以在既定额度内继续。

**Blocked by:** 01 — 请求总额度耗尽后持久封锁并停止活动 child。

**Status:** needs-info

**Draft:** 尚未发布执行；默认值随 [spec](../../spec.md) 确认。

- [ ] 从工具名、操作与结构化失败类别生成语义稳定的事件，不把自由文本/字段顺序/新 ID 当成进展。
- [ ] 连续同类失败达到批准边界时触发 01 的同一 stop；跨 Task、recovery、模式切换不能获得新额度。
- [ ] 两类恢复都占总 child 额度；同一失败换 executionRef 不清无进展计数。交替失败类别仍受总 attempts/launch/deadline 边界约束。
- [ ] 非法字段真正减少时才消耗有限结构修复机会；不增加全局额度，重复状态查询和 reads 不抵销失败。
- [ ] 按 spec 的结果表处理 typed failed/blocked、未验收 partial/completed、重复 request_changes、budget/cancel、environment、stop-unconfirmed 和 transient；typed 合法性或新 report revision 不清 streak。
- [ ] 每 family 的失败链跨 Task 持久累计；纠正/recovery 的可信前序关系与 dispatch 一起持久化。完整验收仅解决同 Task、同 family 的全部因果前序失败（包含间接前序）；全部成员解决后才清链，无关完成不清链。
- [ ] 结构修复不清已有 streak，修复后仍失败则照常计数。验证 A 失败两次→无关 B completed→A 同类失败触发停止。
- [ ] 验证 A/e1 失败→A/e2 纠正失败→A/e3 纠正成功时，e1/e2 均被解决；其他 Task、其他 family、unbound 和缺少可信因果边的成员保留。重载不丢因果边，也不把无关成员一并清除。
- [ ] 确定性契约失败、暂态错误、环境、质量、budget/cancel、stop-unconfirmed 分开呈现；不引入自动无限 retry。
- [ ] 真实插件 fixture 覆盖相同参数、只改文案、跨 Task/recovery、有效修复、失败类别交替和查询穿插；断言封锁后 child launch 为 0。
- [ ] 普通成功结果仍能推进；typed contract、Root-stamped identity、Writer hold 没有放宽。
