# Root 新批次启动门禁

Root 已检查恢复报告 `/project/tmp/pi-native-lite-reopen-control/worker-report.c68dae91.md`（SHA256 `01b22c03123ea3bf3274103359b0c00f918ec29a3e83b4b63d1cc7fe4a88a00c`）、全部表列文件实际hash、四臂最终offline probe原日志/exit、最终9/9配置检查和6/6预算fixture检查、补充no-op行为故障复现、brief身份字段及原控制器逐字节一致性。`git diff --cached --quiet`实际exit0；aggregate检查null/undefined误断不构成候选失败，其原始exit1保留。无产品代码改动；原run timeout和非test-first补充证据的局限保留。

## 新费用事实与精确预算方案

Root 找到本主会话日志：`/home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/2026-10-28T01-01-24-531Z_01a18006-b0b3-7502-9676-97119c750425.jsonl`。按message entry id去重46条assistant usage，模型实际 `tcuni/gpt-6-astra`，截至 `2026-10-28T01:44:38.767Z`，reported cost USD **4.82762800**，无缺失cost条目。它是此次主会话新核实费用，不代表更早主会话、后续增量或provider发票。不可再将它作为unknown排除。

恢复worker同一session检查点reported cost **0.27738370**（后续增量仍需结算），不能与原117条费用重复相加。

批准以旧plan为基础仅修改第二条control reserve金额：
- 第一条control-overage：保持 **1.58301852**。
- 第二条control-reserve：由 **1.00000000** 改为 **5.82762800** = 本主会话已知4.827628 + 本轮其他控制/后续增量预留1。
- 两条其他字段、旧账本完整hash和19事件prefix约束不变；保存新plan及hash和原plan历史，不篡改旧事件。
- 控制seed的model字段沿用既有行政预留schema标签；此处不是provider请求，更不是将主会话误归因为Luna，真实主会话模型是Astra，须在费用记录分列。
- 新增总预留 **7.41064652**，账本预计 **12.01688027**，距USD16停止线 **3.98311973**。继续保留USD20上限下至少USD4余量。

该US$1预留覆盖worker已知0.27738370及主会话检查点后的增量；执行前重新核对二者合计，若已超1或账本漂移，停止回报，不自行扩大预算。更早历史主会话未知继续单列。

## 放行动作

授权恢复worker按上述精确两事件方案，用已审查 budget-transfer.mjs 原子承接真实旧账本一次，核对原19项不变，再仅刷新manifest预算前缀；候选/brief/controller/settings/runtime源码不变。核对版本指纹、输出不覆盖、实际ledger门，重新slot audit/status留日志后，通过既定RPC harness启动 **S1-native一次**，20分钟deadline。不启动其他臂、不自动重试、不修控制器绕过失败。完成或失败后保存原始证据和实际费用，交Root决定后续。

verify-freeze.mjs硬编码旧19事件及输出为空，只适用于承接前。承接后/执行后须独立比对已冻结runtime manifest及候选/config哈希与追加后的账本前缀，不可原样运行此脚本后误报失败，亦不可重写旧冻结证据。
