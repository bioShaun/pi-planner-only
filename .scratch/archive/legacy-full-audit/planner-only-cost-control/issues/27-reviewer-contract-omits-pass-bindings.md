# 27: reviewer 输出合同缺 pass 绑定字段，严格模式下构成死锁

**What to build:** `review.ts:145-152` 发给 reviewer 的输出合同逐字规定了 ReviewResult 的形状 —— `{"taskId","verdict","summary","evidenceFresh","findings":[...]}` —— **里面没有 `reportRevision`，也没有 `workspaceDigest`**。而 `review.ts:199-209` 的 `validateReviewResultBinding` 规定 `verdict === "pass"` 时这两个字段缺任一条就拒收。`roles.ts:523-525` 只把这两个值放进发给 reviewer 的 ReviewRequest **输入包**，从不要求回显。**结果：一个严格照合同办事的 reviewer 永远产不出一份能被记录的 PASS。** `root` 模式下这个洞看不见（Root 自签 verdict，不走 reviewer 记录路径）；工单 22 把严格模式默认切成 `fresh` 后，`rootVerdictRefusal` 又要求 pass 必须有已记录的 reviewer ReviewResult，两道门槛互相咬死，Task 只能以 `blocked` 收场。要求：合同与校验必须一致 —— 要么合同显式要求 reviewer 回显这两个字段并说明取值来自 ReviewRequest 包，要么校验改为由编排侧在记录时补齐绑定（reviewer 不该被要求复述它无法独立求证的值）。两条路都可以，但**不接受把 `validateReviewResultBinding` 的 pass 分支删掉了事** —— 那道校验存在的理由（FR-03/D09：pass 只对特定 report revision 与 workspace 有意义）没有消失。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** done

- [x] reviewer 收到的输出合同与 `validateReviewResultBinding` 的 pass 要求一致：按合同原样返回的 ReviewResult，其 `verdict: "pass"` 能被记录，不再报 `ReviewResult is missing reportRevision`。
- [x] 若采用「合同要求回显」方案：合同文本明写这两个字段取自 ReviewRequest 包里的同名值，且新增一条测试，用**合同模板本身**渲染出的示例串通过 `validateReviewResultBinding`（不是用手写 fixture）。
- [x] （n/a：本轮走的是「合同要求回显」方案）若采用「编排侧补齐」方案：补齐发生在记录前，且 reviewer 主动写了不一致的值时仍然按 mismatch 拒收（`review.ts:185-198` 的两条 mismatch 分支行为逐字不变）。
- [x] 新增一条端到端回归：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 下，reviewer 返回一份**只含合同规定字段**的 pass，Task 能走到 `completed`；修复前该用例必须失败，回执里贴出失败输出原文。
- [x] `request_changes` 与 `blocked` 两条路径的行为逐字不变。
- [x] 既有测试不改 fixture 来迁就实现：`reportRevision` 在测试里出现 15 次，全部是注入值；至少保留其中断言 mismatch 行为的那些。
- [x] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08，planner claude-pD）。该轮 4 次 reviewer 委派全部照合同返回，全部被绑定校验拒收；其中 `0f57e0c8` 的输出是一份格式完全合法、论证也扎实的 `verdict: pass`。Root 因此反复重派 reviewer 与 oracle 想让一次 PASS 落账，跑满 50.8 分钟、$0.782，终态仍是 `blocked`。产物：`.scratch/planner-only-cost-control/phase-a-08-run5/`。

**这是本专题目前唯一的阻塞级缺陷 —— 不修完不再重跑 08。**

单元测试没能拦住，因为 fixture 直接注入了这两个字段。这正是 herdr-pair 技能里记的那类事故：绿灯建立在「注入了真实链路上不存在的字段」之上，把一个不可满足的合同一路放行到发布。定验收条款时要求「用合同模板渲染出的示例串去过校验」，就是为了堵这个。

优先级最高，高于 26。

round_id=claude-pD-2026-09-08-open-27

2026-09-08 收口（planner claude-pD 逐条复现后接收，执行者 cursor `w2E:pE`）。

**先记一条事故，因为它比修复本身重要。** 第一次收口（round_id=p11-r053）写的是「采用方案一
合同要求回显」，并据此写了 commit `87549f8` 的说明。那份记述**与最终落地的代码不符**：
planner 在自己 pane 里核完 `review.ts` 的 +15/-7（方案一）之后、提交之前，执行者仍在写盘，
把方案一的合同改动整体回退、换成了方案二。commit 因此抓到了一个**中间态**
（方案二的 `bindReviewResultFromRequest` + 放宽后的校验，但合同文本仍是旧的），
而 commit message 描述的是方案一。根因是 planner 的流程漏洞：验证与提交之间没有冻结工作区，
也没有先确认执行者 pane 已 `done`。**新规矩：提交执行者产出之前，必须 (1) 确认 pane 状态为
`done`/`idle`，(2) 紧挨 `git commit` 重跑 `git diff --numstat` 并比对验证时记下的文件哈希，
不一致就中止提交。** 本条收口是重新验证后的记述，以它为准。

最终采用的是**方案二「编排侧在记录前补齐绑定」**（工单条款 11 授权的那条路）。
执行者改选方案二的理由成立：`reportRevision` / `workspaceDigest` 是编排侧写进 ReviewRequest 的值，
reviewer 无法独立求证，不该被要求当复读机；补齐还把「没说」与「说错了」分开处理。

净改动（相对修复前基线 `47036db`）：

```
review.ts            +23 / -1     放宽 pass 缺 digest 的条件 + 新增 bindReviewResultFromRequest
orchestrate.ts       +12 / -7     记录前先补齐再校验；拒收文案去掉「echo ...」那句
orchestrate.test.mjs  +7 / -4     唯一一处既有断言翻转（见下）
review.test.mjs      +65 / -0
roles.test.mjs       +40 / -0
index.test.mjs       +99 / -0
```

合同文本（`review.ts:145-152`）**一行未改** —— 方案二不需要 reviewer 回显。

**planner 自己复现的证据（不采信回执）：**

- `slot cpu` 重跑四条命令，全 exit 0：`npm run typecheck`、`npm test`（16 个套件全 PASS，
  与上一次已接收的运行逐行同构）、`npm run test:e2e`（只剩既有的「§F 预算宿主契约未验证」）、
  `git diff --check`。日志 `p12-r054-typecheck.log` / `-npm-test.log` / `-e2e.log`。
- **RED 由 planner 独立复现**：只把 `orchestrate.ts` 回退（`git checkout --`，先备份），
  `node --experimental-strip-types index.test.mjs` 退出码 1，报错正是
  `ReviewResult is missing reportRevision ... missing workspaceDigest`（`index.test.mjs:3518`），
  与回执贴出的原文一致；随后按字节还原（`md5sum` 相同，`--numstat` 仍是 12/7），
  `orchestrate.test.mjs` 单跑 PASS。日志 `p12-r054-red-index.log` / `-restored-orch.log`。
- 条款 11 的三项逐条核实：补齐发生在 `validateReviewResultBinding` 之前、`recordReview` 之前；
  `review.ts:185-198` 两条 mismatch 分支相对 `47036db` **一字未改**；
  `orchestrate.test.mjs` 里 T-20260905-996（revision mismatch）与 997（digest mismatch）两块未动、仍绿。
- 「无 snapshot 的 pass 不得完成 Task」这条工单 10 的既有用例未被改动且仍绿 ——
  放宽缺 digest 的校验没有把它放过去。

**唯一一处既有断言翻转**（条款 14 的例外，接受并记录理由）：`orchestrate.test.mjs` 里
T-20260905-998「A pass that names no revision or digest at all is refused, **not defaulted**」
被改成「补齐后 accept，并断言记录了 reportRevision=1 与 snapshot digest」。
这条断言编码的正是本票要修的行为本身，方案二无法在保留它的前提下成立；本票正文明确授权了这条路。
两条 mismatch 断言仍在，所以「说错了仍然拒收」的保护没有丢。

**遗留风险（不阻塞收口，已开工单 32）：** 补齐取的是**记录时**的 `task.reports.length`，
不是 reviewer 当初拿到的那份 ReviewRequest 里的值，而 `bindReviewResultFromRequest` 的注释
却写着「from the ReviewRequest the reviewer was shown」。今天两者必然相等，**只因为**
同一个 Task 一旦开启新的委派，未结的 reviewer 委派会被丢弃 —— planner 用探针实测过
（`p12-r054-probe.log`：reviewer 委派在新 worker 委派前 `true`、之后 `false`，
随后送达的 reviewer 结果被直接丢弃，`reviews.length` 为 0、状态仍是 `reviewing`）。
这层保护是隐式耦合，一旦允许同 Task 并发委派，补齐就会把 FR-03/D09 想堵的过期 PASS 放进来。

**工单 31 随本次修订作废** —— 它针对的是方案一合同示例里的字面量绑定值，那份合同改动已被回退。

round_id=p12-r054（重新验证后接收）
