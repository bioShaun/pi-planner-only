# 2026-09-18 复审收尾

本轮修复上轮确认的三项代码缺陷及文档状态问题。完整发布与宿主验收仍未完成。

## 修改范围

- `ledger-store.ts`：存在的 probe failure 必须包含字符串 operation/kind/cwd；缺失时返回精确字段路径。历史记录缺少可选 probeFailures 仍兼容。
- `index.ts`：预算收缩保留最新 execution，结构化引导与文本中的 latest-N 数量一致。
- `orchestrate.ts`：补齐 hold/recovery 身份、时间及其他字符串截断；披露 truncated，历史缺字段安全显示 unknown。
- 新增 `diagnostics-regression.test.mjs` 并接入 npm test，覆盖真实账本和注册工具入口。
- 01–06 改为 needs-triage；07 改为 ready-for-agent，新增评论移到底部。四项宿主证据缺口仍未勾选。

本轮增量见 [closeout.diff](closeout.diff)。执行前后 SHA256 见 before.json、after-worker.json；原有未提交内容保留。本轮未提交或发布。

## 独立验证

| 命令 | 结果 |
| --- | --- |
| npm run test:release | exit 1；tsc 通过，task.test.mjs:287 子进程输出为空而失败 |
| node --experimental-strip-types diagnostics-regression.test.mjs | exit 0 |
| node --experimental-strip-types ledger-store.test.mjs | exit 0 |
| node --experimental-strip-types diffstat-acceptance.test.mjs | exit 0 |
| node --experimental-strip-types /tmp/planner-re-review-20260918/additional-probes.mjs | exit 0 |

原探针结果：缺少 operation/cwd 返回 TASK_LEDGER_CORRUPT；百万字符 hold ID 被截为 200 字符，构造结果 1,018 字符且 truncated=true；20 次 execution 经预算收缩后保留 15–19，返回 details 12,263 UTF-8 字节。

新回归先红后绿的原始输出保留在 diagnostics-regression-*.typescript。独立验证 stdout/stderr/退出码见 [validation](validation/)。初次类型检查的类型错误修正后通过；Worker 自测与独立验证区分记录。

## 验收限制

完整测试受当前执行环境限制：先前最小子进程探针已返回 EPERM，相关 Git/Node 子进程测试无法完整运行；本轮没有绕过权限或改写测试以伪造通过。

项目规定的独立只读审核入口已尝试，exit 1，应用服务初始化报 Read-only file system，见 strict-review.stderr。不能将原生会话中的行为只读复审冒称为 strict gate 通过。

票 07 的四项真实宿主证据缺口保留；本轮未做实际宿主验收。测试生成的临时 Git 目录已保存到 /tmp/planner-closeout-20260918/test-generated-git-fixture，未遗留在工作区。

## 独立复审与最终状态

- 新建、无历史继承的 Spec Reviewer：本轮限定代码/规格复审 PASS，无可操作缺陷；核对冻结哈希、原缺陷修复、真实入口回归和文档状态。
- 新建、无历史继承的 Standards Reviewer：PASS，无明确规范违规或需处理的代码异味。
- 两者均明确：上述结果是本轮代码复审结果，不是强隔离 strict gate、完整发布或真实宿主验收通过。
- Root 最终核对 20 个冻结文件均无漂移，见 final.json；测试夹具已移出工作区。

本轮三项代码修复及文档修正已完成。完整发布、strict gate 和票 07 宿主证据仍待可用环境完成。
