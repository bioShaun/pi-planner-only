# 证据：11-27 薏苡项目 Native Root 会话与设计意图的差距

设计意图（用户原话）：Root 主要做编排 + 简单任务，规划交给 oracle。

## 被审会话
- 目录：`~/.pi/agent/sessions/--data_0-panel_design-projects-TC-GZAAS-Coix-50K-20261106--/`
- 4 个 Root session（11-27 09:25Z–13:33Z），模式均为 native，Root 模型均为 `opencode-go/deepseek-v4.1-flash`，handoff 链 3 次。
- 项目产物：`/data_0/panel_design/projects/TC-GZAAS-Coix-50K-20261106/`，计划文件 `.scratch/functional-loci/plan.md`（Root 自写，26 KB）。

## 当前 Native 提示（`index.ts` 的 NATIVE_PROMPT，行 30）与本问题相关的句子
- 「不能直做时按角色分流，不要一律先规划：找位置或补上下文派 scout；需要可被后续引用的方案契约（锁定公共接口、数据/权限或模块边界，或设计分叉会改这些及验证方式，或长任务/多轮交接需留下步骤与验收标准）才派 oracle 写方案，方案只作上下文、不扩大范围，实施须另派 worker 并写明范围；其余实现派 worker，由 Root 在任务包写短 Approach，这是标配。」
- 「实现路径差异由 Root 写入决定，不必派 oracle。」「不要因新任务、目标变化或既有方案卡住就自动进入规划。」
- 「worker 遇到验证连续失败两次、接口与预期不符、或计划未敲定的设计选择时，用纯文本交回 Root 并停止……由 Root 决定是否派 oracle 修计划」
- 「若你已掌握相关上下文，剩余修改与必要验证都明确、局部……可直接完成修改与验证」
- 全局 AGENTS.md：开工前把计划写入 `.scratch/<feature>/plan.md`（含威胁模型与 Non-Goals）并派 reviewer 审；改变行为的多文件改动收尾前派 reviewer；同一成果最多 1 次 review + 1 次复审。

## 实测事实（均来自 session JSONL 工具调用统计）
1. 子代理调用共 21 次：worker 18、reviewer 2、resume 1；**oracle 0、scout 0**。oracle 可用（`settings.json` 有 oracle 配置，pi-subagents 带 `oracle.md`）。
2. 计划全由 Root 自写：plan.md 10:47Z 写入、10:52Z 按 reviewer 的 4 个 P0 重写为 v2；§11–§15（S2a 口径、S3 裁剪规则、S4c 包布局、S5 QC 边界）由 Root 后续用 heredoc 追加。reviewer 只在 Root 写完后审一次。
3. Root 工具调用：bash 304、edit/write ~19；其中内联 `python3 - <<EOF`/`cat >` 约 92 次，部分是验收，部分是加工。Root 亲自实现：`diagnose_gt_forms.py`、`crosscheck_gt_evidence.py`、`test_s2a_exact_gwas.py`、改 `extract_candidates.py` 与 `s2a_exact_gwas.py` 的 GT 口径、写并执行 `s3c_merge_disposition.py`、`root_verify.py`。
4. S2a 连续两次同一断言失败：Root 自行只读诊断后改口径（有证据，结论合理），没有派 oracle 修计划。
5. S3c 选点（核心业务逻辑）未经独立 reviewer 就推进 S4a/S4b/S4c；最终 reviewer 才发现 P0：25 个共享簇目标中 24 个 `r2_n_samples` 被硬编码 558，需回滚重跑 S3c→S4→S4c→S5。
6. 收尾：最后一条消息称「已派第一施工单元修 P0」，但 13:23Z 之后无任何 subagent 调用，session 以 stop 结束；`run.toml` 已写 `status="completed"`，包里仍带 P0 错误。
7. ~19 次 `subagent_supervisor` 请求为 worker 中途 need_decision（内容未逐条分类），与「纯文本交回并停止」不完全一致。
8. 正面：任务包自包含、一次一成果、slot 使用、不用 /tmp、reviewer 意见三类处置留痕、handoff 带三行进度。

## 我（Root）的初步诊断，请 oracle 挑战
- 触发条件是「需要时才派」+「不要一律先规划」，Root 倾向自己写计划；Root 用的是便宜模型，自写计划质量与成本都不理想。
- 「若已掌握上下文可直接做」被扩大解释，导致 Root 做了加工类实现。
- 缺少「实现完成但未经复审就推进依赖步骤」的硬闸门；数据管线的关键选点逻辑不在「并发/锁/持久化」措辞覆盖范围内。
