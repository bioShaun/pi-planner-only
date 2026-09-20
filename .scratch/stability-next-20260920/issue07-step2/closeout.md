# 工单 07 第二步交付

完成时间：2026-09-21（Asia/Shanghai）。第二步已实现并通过最终 strict gate，已提交为 `eb941ca`；第一步已提交为 `a96559b`。P3 大任务测量未启动。

## 裁决与结果

采用 [ADR-0010](../../../docs/adr/0010-request-remaining-execution-envelope.md) 的“钳制并记录”方案。普通 worker、explorer、validator（含 report-only correction）在前置 Git 采样后读取原 Request 剩余时间；预留常量 60,000 ms，标为 provisional。剩余大于预留时，将墙钟 envelope 钳到可用时间；不足或观测不可用时，持久化 Task 级拒绝记录，不启动 child、不消费执行/修复/恢复授权。Reviewer 保持 Request 边界，可使用预留窗口。

原 envelope、有效 envelope、钳制标记和 Request 观测保留在账本与 details/diagnostics；钳制时向 Root 返回警告。显式 token-only envelope 获得 Request 墙钟上限，不补 token 默认值。Request 截止与额度不刷新，Writer hold 不放宽。60 秒只提供尽力预留，不保证完成结果或节省 token，后续由 P3 校准。

## 修改范围

产品：`delegate.ts`、`execution-defaults.ts`、`index.ts`、`ledger-store.ts`、`orchestrate.ts`、`request-events.ts`、`task.ts`、`types.ts`。

测试：`delegate.test.mjs`、`ledger-store.test.mjs`、`p1-delegation.test.mjs`、`request-stop.test.mjs`。

文档：`CONTEXT.md`、`README.md`、`README.zh-CN.md`、新增 `docs/adr/0010-request-remaining-execution-envelope.md`。

15 个已有文件相对 `a96559b`：645 additions / 50 deletions，另加新 ADR。完整差异见 [implementation.patch](implementation.patch)，16 个审核文件哈希见 [source-manifest.json](source-manifest.json)。既有 token-only envelope 断言改为检查 originalEnvelope，并新增有效上限断言；其余已有断言保留，见 [assertion-audit.json](assertion-audit.json)。提交批次同时包含工单 06 的 600 秒 strict 默认、按 cwd 过滤残留进程修订，以及工单 05/07 文档更新；临时目录和执行中间态未提交。

## 验证

正常终端执行 `bash .scratch/stability-next-20260920/run-execution-terminal.sh release`，内部保存 `slot audit/status` 后以 `slot cpu` 运行 `npm run test:release`。

- 最终完整 release：[release-run-B278Uu](../release-run-B278Uu/)，exit 0，包含顺序及两个交错顺序的手动恢复回归；运行前后源码哈希一致。
- 对应完整命令/日志：[execution-20260920/release-run-20260920T152852Z.log](../execution-20260920/release-run-20260920T152852Z.log)。此前两轮 release `release-run-PotBZh`、`release-run-aRYYOy` 也为 exit 0；修正代码后均重新验证。
- 最终独立 strict：[review.md](../strict-run-ah68GJ/review.md)，`PASS (final)`；[result.json](../strict-run-ah68GJ/result.json) 核实子角色实际 `gpt-5.6-sol/high`、read-only，耗时 222.4 秒，launcher exit 0。
- 父子分别进行 O_WRONLY（无创建、截断、写入）探针，均 errno 30 EROFS 且哈希不变；原始工具证据在 final run 的 `parent-probe-records.json` 和 `child-probe-records.json`。宿主进程检查未发现本轮残留。
- Root 最终对照所有 16 个审核文件，无漂移；开始时已有的 8 处工单 05/06 改动与 `baseline.patch` 完全一致。

P1 与 Request-stop 走真实插件/工具/事件传输/账本入口，Git 和 child 使用 fixture。本轮不声称新增付费模型/TUI 测量。

## 审核修正与失败记录

1. `strict-run-TDoRaQ`：缺失新审查契约字段，返回裸 BLOCKED，记为 contract_error；未当作有效 verdict。
2. `strict-run-lQ7JYw`：slot preflight 检出其他未排队重进程，exit 4，未启动审核；等待后重新检查通过，没有终止其他进程。
3. [strict-run-D4Tfpi](../strict-run-D4Tfpi/review.md)：REQUEST_CHANGES，时间不足的手动恢复提前解除 Writer hold。改为准入成功后处理，补顺序回归。
4. [strict-run-Kzag8r](../strict-run-Kzag8r/review.md)：REQUEST_CHANGES，异步 Git 采样前保存的 hold/预留快照可过期。改为采样后重读 Task、校验原 hold 与恢复授权，再同步获取当前预留并更换；新增并发回归，验证只有一次启动/执行/恢复消费且无幽灵预留。
5. [strict-run-ah68GJ](../strict-run-ah68GJ/review.md)：fresh Reviewer 确认上述两项已关闭，PASS (final)。

原 sandbox 中 orchestrate 子进程检查的 EPERM 保留在 `orchestrate-sandbox-failure.log`；正常终端完整 release 已覆盖通过。最终审核跨日，issue06 汇总脚本现已修复为按实际 sessions 日期树查找，不再硬编码 `2026/09/20`；默认 strict 外部时限为 600 秒。

机器可读最终状态见 [acceptance.json](acceptance.json)：validation PASS、final_acceptance PASS、review_kind final、review_verdict PASS、strict、contract_error null。失败轮次的原快照、ReviewRequest、diff、结论均保留。
