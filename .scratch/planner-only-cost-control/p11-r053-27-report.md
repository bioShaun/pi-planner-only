[轮次] round_id=p11-r053（围栏修订后重做）
Executor pane: w2E:pE (cursor)
HEAD: 87549f86c097350673e928d3a9dd6b8bb5559012
branch: planner-only-cost-control
未 commit / 未 push / 未切分支。工作区相对 HEAD 未提交的是 orchestrate.ts 与 orchestrate.test.mjs。

## 1. 选了哪条修法、为什么

改选方案 2：编排侧在记录前补齐绑定。

上一版选方案 1 是因为当时 orchestrate.ts 整文件只读，unbound pass 只能靠合同回显才能过校验。那是围栏逼出来的，不是更站得住的设计。

方案 2 更站得住的理由：
- reportRevision / workspaceDigest 是编排侧写入 ReviewRequest 的值，reviewer 无法独立求证，不该被要求当复读机。
- 08 第五次重跑里 0f57e0c8 那份就是格式合法的 pass、合同里没有这两个字段所以没写。补齐才能让「照合同办事」产出可记录的 PASS。
- 合同回显仍可能漏抄或抄错；补齐把「缺省」和「说了但说错」分开：缺则填，说错仍走 mismatch。
- validateReviewResultBinding 的 pass 缺失校验仍保留，作为未走补齐路径时的安全网。mismatch 两条分支一字未改。

## 2. 改了哪些文件

orchestrate.ts（本修订未提交，git diff --numstat）：+12 / -7

实际改动（相对记录 ReviewResult 那一段）：
- 约 L59：import 增加 bindReviewResultFromRequest
- 约 L1751：const review → let review（补齐后写回，供随后 recordReview 用同一对象）
- 约 L1785–L1811：validateReviewResultBinding 调用前构造 expectedBinding，先 bindReviewResultFromRequest，再校验；校验失败的回报句去掉「and echo its reportRevision and workspaceDigest」
- 约 L1811：review = boundReview
未改 verdict/accept 门槛、usage 落账、worker 报告处理。

其余（多已在 HEAD 87549f8）：
- review.ts：新增 bindReviewResultFromRequest；prompt 合同恢复为不含绑定字段的原示例；pass 缺 workspaceDigest 仅在 expected 携带时才拒
- review.test.mjs：补齐 / 不覆盖不一致值 / 无 snapshot 不填 digest；mismatch 与 request_changes/blocked 锁定
- roles.test.mjs：无 snapshot 时 ReviewRequest 不含 workspaceDigest
- index.test.mjs：REQUIRE_REVIEW=1 下合同字段 pass（显式不含 reportRevision/workspaceDigest）→ completed
- roles.ts：未改
- e2e.pi-subagents.test.mjs：未改

围栏外例外（必须说明）：orchestrate.test.mjs +7 / -4，只改了 T-20260905-998 那条「unbound pass 应拒收」——它编码的是本票要修的缺陷。改成补齐后应 accept，并断言记录了 reportRevision=1 与 snapshot digest。同文件 mismatch 两条（T-20260905-996 / 997）未动。不改这条 npm test 无法绿。

## 3. 端到端回归修复前失败输出原文

（方案切换前已跑过，日志 p11-r053-27-e2e-red.log，exit 1。当时 reviewer 只返回合同字段。）

AssertionError [ERR_ASSERTION]: The input did not match the regular expression /decision: accept/. Input:

'[PLANNER-ONLY] Reviewer verdict was rejected: ReviewResult is missing reportRevision; a pass must name the report revision it reviewed; ReviewResult is missing workspaceDigest; a pass must name the workspace summary it reviewed.
The verdict was not recorded and no task state changed.
Re-delegate review for task T-20260908-027 so the reviewer receives the current ReviewRequest, and echo its reportRevision and workspaceDigest.

{"taskId":"T-20260908-027","verdict":"pass","summary":"meets acceptance","evidenceFresh":true,"findings":[]}'

## 4. 四条命令退出码（本修订后重跑）

- slot cpu -- npm run typecheck     0   p11-r053-27-typecheck.log
- slot cpu -- npm test              0   p11-r053-27-npm-test.log
- slot cpu -- npm run test:e2e      0   p11-r053-27-e2e.log
- git diff --check                  0   p11-r053-27-diff-check.log

## 5. 围栏外文件

orchestrate.ts：仅上述记录段。orchestrate.test.mjs：仅 unbound-pass 断言（见上）。
未改 task.ts / index.ts / usage.ts / spec.md / 08。未勾工单 checkbox、未写工单 Comments。

## 6. slot audit 预飞

本轮重跑前：PID 3181570 pbbwa RSS 39.6G CPU% 617 绕过 slot，未杀。gpu 池有 pea-core62-gvcf-production-hold-oom 在跑。测试走 slot cpu。日志 p11-r053-27-slot-audit-r2.log / p11-r053-27-slot-status-r2.log
