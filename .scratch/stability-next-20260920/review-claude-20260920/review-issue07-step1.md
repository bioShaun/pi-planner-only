# Claude 审核记录：工单 07 第一步（2026-09-20，未提交工作树，基线 df199f8）

| 项 | 结果 | 依据 |
|---|---|---|
| 改动范围 | 6 个产品文件 + 6 个测试 + README，393 增 29 删；无删除断言 | `git diff --stat`、`git diff \| grep '^-.*assert'` 为空 |
| 纯观测 | diff 里没有钳制、预留、刷新截止或额度改动；observe() 不写状态，closure() 只读；两个新 hook 均 try/catch 包裹，失败不影响启动与终态 | delegate.ts、request-control.ts diff |
| 口径 | launchedAt = REQUEST 出站（排除前置 Git 采样）；startedAt = 身份匹配的 STARTED 本地接收，缺失为 null；durationMs = 单调时钟差，endedAt 保留墙钟语义 | types.ts 注释与 delegate.ts finalTiming |
| 到期归因 | 仅 operator_cancel 且关闭记录属于同一原始 Request 时附 requestClosed/requestClosedAt；晚到终态保留原锚点 | requestClosurePatch；测试"late terminal retains the original Request closure" |
| 跨 Request | 旧 Request 进入 history，history 不封顶，observe(旧 id) 不会抛；重入不能刷新截止 | request-control.ts openNext/record；测试"re-entry cannot refresh an earlier Request deadline" |
| 账本 | 新字段有形状校验，非法 durationMs 拒绝；旧账本无 closedAt 保持未知 | ledger-store.ts、validRecord |
| 独立复跑 | `npm run test:release` exit 0（slot cpu，TMPDIR=/project/tmp），跑前后产品 diff 哈希一致 | test-release-07.log、exit-code-07.txt、diff-07-before/after.sha |
| 独立审查 | fresh astra_reviewer ordinary review PASS，13 项哈希固定 | issue07-step1/ordinary-review.md |

结论：PASS，可以提交。规划中的验收项（普通执行、等待启动、取消、晚到终态、恢复账本、跨 Request 重入、墙钟回拨）在新增断言里都有对应。

备注：真实入口测试用 fixture 的 Git 与 child，没有付费模型；这一步是观测字段，不需要真实模型验收。第二步（钳制/预留，ADR-0010）属于行为变化，实施后走 strict gate。
