# 27: reviewer 输出合同缺 pass 绑定字段，严格模式下构成死锁

**What to build:** `review.ts:145-152` 发给 reviewer 的输出合同逐字规定了 ReviewResult 的形状 —— `{"taskId","verdict","summary","evidenceFresh","findings":[...]}` —— **里面没有 `reportRevision`，也没有 `workspaceDigest`**。而 `review.ts:199-209` 的 `validateReviewResultBinding` 规定 `verdict === "pass"` 时这两个字段缺任一条就拒收。`roles.ts:523-525` 只把这两个值放进发给 reviewer 的 ReviewRequest **输入包**，从不要求回显。**结果：一个严格照合同办事的 reviewer 永远产不出一份能被记录的 PASS。** `root` 模式下这个洞看不见（Root 自签 verdict，不走 reviewer 记录路径）；工单 22 把严格模式默认切成 `fresh` 后，`rootVerdictRefusal` 又要求 pass 必须有已记录的 reviewer ReviewResult，两道门槛互相咬死，Task 只能以 `blocked` 收场。要求：合同与校验必须一致 —— 要么合同显式要求 reviewer 回显这两个字段并说明取值来自 ReviewRequest 包，要么校验改为由编排侧在记录时补齐绑定（reviewer 不该被要求复述它无法独立求证的值）。两条路都可以，但**不接受把 `validateReviewResultBinding` 的 pass 分支删掉了事** —— 那道校验存在的理由（FR-03/D09：pass 只对特定 report revision 与 workspace 有意义）没有消失。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] reviewer 收到的输出合同与 `validateReviewResultBinding` 的 pass 要求一致：按合同原样返回的 ReviewResult，其 `verdict: "pass"` 能被记录，不再报 `ReviewResult is missing reportRevision`。
- [ ] 若采用「合同要求回显」方案：合同文本明写这两个字段取自 ReviewRequest 包里的同名值，且新增一条测试，用**合同模板本身**渲染出的示例串通过 `validateReviewResultBinding`（不是用手写 fixture）。
- [ ] 若采用「编排侧补齐」方案：补齐发生在记录前，且 reviewer 主动写了不一致的值时仍然按 mismatch 拒收（`review.ts:185-198` 的两条 mismatch 分支行为逐字不变）。
- [ ] 新增一条端到端回归：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 下，reviewer 返回一份**只含合同规定字段**的 pass，Task 能走到 `completed`；修复前该用例必须失败，回执里贴出失败输出原文。
- [ ] `request_changes` 与 `blocked` 两条路径的行为逐字不变。
- [ ] 既有测试不改 fixture 来迁就实现：`reportRevision` 在测试里出现 15 次，全部是注入值；至少保留其中断言 mismatch 行为的那些。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08，planner claude-pD）。该轮 4 次 reviewer 委派全部照合同返回，全部被绑定校验拒收；其中 `0f57e0c8` 的输出是一份格式完全合法、论证也扎实的 `verdict: pass`。Root 因此反复重派 reviewer 与 oracle 想让一次 PASS 落账，跑满 50.8 分钟、$0.782，终态仍是 `blocked`。产物：`.scratch/planner-only-cost-control/phase-a-08-run5/`。

**这是本专题目前唯一的阻塞级缺陷 —— 不修完不再重跑 08。**

单元测试没能拦住，因为 fixture 直接注入了这两个字段。这正是 herdr-pair 技能里记的那类事故：绿灯建立在「注入了真实链路上不存在的字段」之上，把一个不可满足的合同一路放行到发布。定验收条款时要求「用合同模板渲染出的示例串去过校验」，就是为了堵这个。

优先级最高，高于 26。

round_id=claude-pD-2026-09-08-open-27
