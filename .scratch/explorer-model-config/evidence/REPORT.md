# Explorer 配置验收复核报告

当前结论：**未通过最终验收，三个工单不作全部关闭。** 本报告更正此前“Acceptance complete / 全量测试通过”的结论；原始运行日志和账本保留不改。

## 历史真实宿主证据

历史环境为 Pi 0.85.1、pi-subagents 0.68.0，基于 HEAD `f57a4de309a5317dd4ecef6a52ba83c7d7d545ff` 加当时未提交修改。该运行不是本次收尾源码的验收。

- Root 实际为 `tcuni-luna/gpt-5.6-luna`；子会话为 `qwen-local/qwen3.8-27b`，thinking 为 low。子会话原始 session 的 model_change/thinking_level_change 事件、transcript、元数据和用量记录相互印证。
- 运行代理为 planner-scout，声明工具 read、grep、find、ls；实际使用 read、ls、structured_output。账本能力为 restricted-reader，依据 terminal+restricted-reader。
- 宿主 runId 为 `d8280241-8e7d-43e6-937a-67d2aaa91b67`，报告却填写 `explorer-model-config-T-20260918-001`。报告被拒收为 unacceptedReport，Task 为 **changes_requested**，**reports=[]**，后续 pass 被拒绝。子执行 completed 不能证明验收完成。

所装上游宿主生成 runId 后，没有通过受支持的子会话接口将其提供给报告作者。需上游补齐真实身份下发，再重跑当前版本；不猜测身份、不改写报告、不放松校验。相关契约记录见 `../../delegation-contract-incident-20260918/spec.md`。

## 本次收尾与验证

配置适配器已修复标准 scout 定义及 builtin 默认值、覆盖优先级、宿主模型字符串解析边界和非法字段校验。指纹覆盖新模块；测试临时文件落项目内；验收脚本按次隔离、清理敏感配置、脱敏保留证据并核对实际 execution.runId。历史保留的凭据副本已清理，运行目录已忽略。

适配器仍是有限的 pi-subagents 0.68 兼容投影：复杂代理定义、包贡献 plain scout、额外扫描来源及部分有效模型相关设置会明确拒绝。原票 01 的完整宿主兼容性未完成，声明依赖范围中的其他版本未验证。

- 当前独立定向验证：Explorer 集成、delegate、rs01、TypeScript 全部 exit 0，见 [final-focused-report.md](../../explorer-model-config-closeout/final-focused-report.md)。源码指纹见 [after-config-correction2.json](../../explorer-model-config-closeout/after-config-correction2.json)。
- 完整 `npm run test:release`：exit 1，停于未改动的 `task.test.mjs:287`，两个子进程的管道 console 输出均为空。独立探针证明子进程实际创建了不同的 claim；直接写 stdout 或写常规文件可工作。后续测试未运行，不能声明 31 模块全过。见 [完整验证和诊断](../../explorer-model-config-closeout/final-validator-report.md)。
- 当前源码未重跑真实 Pi。slot 状态目录写入与 socket 权限也阻塞需排队的宿主运行和 strict 独立只读审查；行为约束下的复核不替代 strict gate。

## 证据索引

- [修订概要 JSON](summary.json)
- [历史宿主 stdout](pi-host-stdout.jsonl)
- [子代理元数据](subagent-artifacts/d8280241-8e7d-43e6-937a-67d2aaa91b67_planner-scout_0_meta.json)
- [子代理 transcript](subagent-artifacts/d8280241-8e7d-43e6-937a-67d2aaa91b67_planner-scout_0_transcript.jsonl)
- [原始 Task 账本](planner-only/ledger/T-20260918-001.json)
- [用量记录](planner-only/usage.jsonl)
- [初次红测试](../red-evidence.log)
- [收尾说明](../../explorer-model-config-closeout/CLOSEOUT.md)

后续关闭条件：实现剩余宿主兼容性；恢复可用的发布测试/slot 环境并通过完整检查和 strict gate；补齐真实 runId 下发，在同一最终源码上取得已接纳 WorkerReport 的真实宿主验收。
