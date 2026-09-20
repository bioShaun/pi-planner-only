# 工单 07 第一步交付

状态：第一步完成，完整 release exit 0，独立 ordinary review PASS。未提交。

## 实现范围

- 执行账本记录原始 Request ID、REQUEST 出站时刻、STARTED 本地接收时刻、结束时刻和单调时钟耗时。耗时口径为 `request-outbound-to-finalization`，包含现有 quiescence 停止确认，排除前置 Git 采样。
- 没有 STARTED 时 `startedAt = null`；旧账本和未收到终态的取消不补猜时间或最终耗时。已有 `endedAt` 语义保留。
- 委派返回 `details.request` 和 `details.executionTiming`；Task 诊断的实际入口是 `planner_tasks`。Request 观测包含身份、截止、剩余毫秒和观测时刻；观测不会关闭 Request、刷新截止或改变计时器。
- Request 到期取消保持 `operator_cancel` 等原有终态语义，附原始 Request 的关闭原因和时刻；晚到终态保持原始归属。

未实施第二步钳制、预留值或 ADR-0010，也未启动 P3 大任务测量。

## 改动与验证

生产文件：`types.ts`、`delegate.ts`、`request-control.ts`、`index.ts`、`orchestrate.ts`、`ledger-store.ts`。

测试文件：`p1-delegation.test.mjs`、`request-control.test.mjs`、`delegate.test.mjs`、`ledger-store.test.mjs`、`diagnostics-regression.test.mjs`、`index.test.mjs`。文档：`README.md`。

本轮产品及测试 diff：13 files changed, 393 insertions(+), 29 deletions(-)。详见 [diff-stat.txt](diff-stat.txt) 和 [implementation.patch](implementation.patch)。既有断言删除行数为 0。既有用户改动保存在基线记录中，未回退或提交。

命令与结果：

1. Worker 的 typecheck、语法检查及 Request/ledger/diagnostics 定向测试均 exit 0，命令和输出见 [focused-checks.txt](focused-checks.txt)。
2. `bash .scratch/stability-next-20260920/run-execution-terminal.sh release`，内部执行 `slot cpu -- npm run test:release`：首轮 exit 1，见 [release-run-LQKWmo](../release-run-LQKWmo/test-release.log)。新增实时观测使既有“重复诊断完全相等”测试失败；Root 固定这两次调用的观测时钟，保留全部既有断言并增加时刻断言。
3. 同一 release 命令复跑 exit 0，见 [release-run-kB3SJj](../release-run-kB3SJj/test-release.log) 和 [退出码](../release-run-kB3SJj/exit-code.txt)。使用非沙箱普通终端，重任务前 slot audit/status 已落盘；临时文件使用 /project/tmp。测试前后源码哈希一致。

真实入口测试使用实际插件、注册工具、事件传输和账本，Git 与 child 来源为 fixture；本轮未运行付费模型或新增真实 TUI 场景，不把 fixture 证据冒称端到端模型测量。

## 审查与边界

[ReviewRequest](ReviewRequest.md) 为本轮 ordinary review 中性审查包，[review-source.sha256](review-source.sha256) 固定审查范围。[独立审查](ordinary-review.md) verdict 为 PASS，无需修正项；Root 再次核对 13 项哈希均匹配。本轮不宣称 strict 权限隔离。

新增时间口径支持后续测量，不代表已证明省 token，也不自动为验证或评审预留 Request 时间。第二步仍需单独裁决及 ADR。
