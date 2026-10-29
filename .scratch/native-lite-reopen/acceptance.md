# Root 验收：新批次首臂失败并停止

状态：**stopped；S1-native失败，其他三臂取消；累计0个有效样本、0对有效pair。** 本批 `20261028T010659/reopen-a1` 不重试。用户追加USD10授权保留（总上限30），本批实际guard仍16。

## 直接原因

Root独立读取真实 `results/reopen-a1/S1-native/session.jsonl`、control.jsonl、fingerprints及实际controller源码。实验Root调用：`subagent({action:"guide",options:{topic:"tool-reference/execution-parameters"}})`。指南工具成功返回；它不是child launch。

`.scratch/native-lite-lifecycle/run-rpc-arm.mjs:322` 对所有Native subagent调用都要求agent/只读acceptance；未区分guide管理调用，触发native-launch-policy-rejected。其后工具结果分支同样将指南结果当作launch receipt，触发native-launch-failed。属于实验控制器误分类，不能据此判Native模式或provider/child运行失败；实际child尚未创建。

slot3660，2026-10-28 09:54:41至09:54:54 +08:00，runner exit1，Pi subprocess exit0。无child、无Root acceptance、无报告哈希。两次Terra/high模型请求指纹与ledger新增事件逐条一致，实际reported usage USD0.00805180；请求保守预留0.25721875不退款。候选tracked diff0，workspace hash保持门禁值。

## 证据与费用检查点

外部批次根 `/project/tmp/pi-native-lite-20261028T010659/`；子代理报告 `/project/tmp/pi-native-lite-reopen-control/worker-report.c68dae91.md`（包含准备、测试和启动记录）。Root已检查代码、实际日志、manifest、同字节controller和预算承接结果，不仅采信子代理结论。

已审查准备证据：配置/probe policy最终9/9；budget transfer最终6/6；四臂离线probe exit0；758个pi-subagents及337个Pi文件指纹。原worker超时与3次冻结脚本语法失败保留；预算行为失败复现为实现后no-op补证，不能冒充原始test-first。以上离线绿灯没有覆盖真实guide调用，不能当有效实验样本。

账本已按批准追加两项控制预留，随后新增两条真实请求：23事件，reserved USD13.27409902，SHA256 `6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`。旧19事件JSON prefix SHA256仍 `1813f01d1d4f3e5313dfea6d346357151544ad1c82fffe825446f89f858aae70`。

Root费用快照（非最终账单，仍可能有本轮收尾增量）：
- 既往已知合计4.64232222（既往control4.58301852、历史实验0.05930370）。
- 本主会话63条assistant usage：7.32197000，真实模型Astra。
- 本控制worker同一session163条assistant usage最终：0.43589992，恢复不重复计数。session SHA256 `d8cf9a25a3f6840b4e4d744f434dea99b6c97531187249ff55b93612cb9b981e`。
- 本次S1实验Root：0.00805180。
- 已知合计 **12.40824394**。更早未知主会话费用仍不包含；本主会话最终答复费用及后续收尾尚未结算。

本次control实际快照7.75786992已超新control reserve6.827628，差额 **0.93024192**；保守有效占用至少 **14.20434094**（账本13.27409902+该差额），不能只用账本余额声称可用余量。由于本批停止，Root不继续写账本；下一次任何付费启动前必须承接该差额和后续增量。新增USD10为授权上限，不是费用或预留；未改变本批guard。

## 后续边界

本批已停止，不继续其余臂、不自动重试、不修改已冻结controller或全局安装。若继续目标，先单独修正controller对management call与launch call的分类，用本次真实事件做离线失败复现及通过验证，保留真正launch的角色/acceptance/身份限制，然后重新冻结新批次和预算。不要通过禁止Root查指南来掩盖分类缺陷。

当前产品未提交/推送/安装。新增准备材料在 `.scratch/native-lite-reopen/`，原用户改动保留。Root已核对恢复worker的process-terminal为observed、exit0、session lease已释放，控制任务完成；原首轮timeout记录不变。实验本身仍失败。
