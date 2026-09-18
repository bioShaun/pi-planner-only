# 06: 无需委派即可查询失败 Task

**What to build:** 即使 Delegation 已失败且 Root 处于 Idle，也能直接按 Task/Execution 查询停止证据、真实写入占用、报告状态、恢复前提和已知日志位置，不必委派另一个日志定位任务。

**Blocked by:** 01 — Git 采样失败提供具体原因；02 — 受限 Explorer 正确停止，恢复时不生成写入占用；05 — 保存已收到但未验收的终态报告。

**Status:** needs-triage

**Resolution:** Implementation complete; acceptance pending final independent review.

**Parent:** [停止证据失败规格](../spec.md)，实施决策 §6、§4 人工恢复指引、§7 工具兼容。

- [x] 扩展现有 planner_tasks：无 taskId 保持 live Task 列表行为；有 canonical taskId 返回当前 workspace 的指定 Task 详情，可选 executionId 精确定位该 Task 的一次执行。
- [x] 查询覆盖 blocked、failed、completed、仅在账本中及超过正常恢复条数上限的 Task；权威内存记录优先，未加载时读该 Task 的确定性账本，不为了查询而恢复进内存。
- [x] 返回 cwd、role、Task/Execution 状态、身份和能力依据、宿主终态与 endedReason、停止确认依据、01 的各阶段错误、真实 hold、RecoveryDecision 前提、05 的报告收到/接纳状态，以及 Usage 完整性。
- [x] 缺少字段或历史明细时如实显示未知/未记录；不存在、损坏、无法读取的账本分别返回明确诊断，不根据旧数据猜测原始错误。
- [x] 严格校验 taskId、executionId 归属及 workspace，拒绝路径穿越、错配执行和其他 workspace 数据；不开放任意路径读取。
- [x] 日志位置只来自宿主当前会话元数据或已持久记录，必要时保存可信位置来源；分别标记已验证文件、已知但不可访问的位置、默认目录提示和未知，不将当前 Root 会话路径冒充历史 run 的精确日志。
- [x] 不遍历会话目录、不读取会话正文、不扫描报告产物；没有确切文件名时不拼出一个声称已存在的文件。
- [x] 诊断展示真实 Writer hold 及其执行依据；区分 runId 与恢复动作要求的 executionId。仅在 recovery.required 等实际前提满足时给出匹配的 planner_abort 或 planner_redelegate.recovery 指引，manual 必须有操作者已处理残留执行的依据。
- [x] 对缺少恢复元数据的历史 hold，明确说明未满足的前提及人工处理方向，不构造必然被拒的动作，不伪造恢复历史，不建议批量删除账本。
- [x] 查询全程不发出 Delegation、不采样 Git、不运行通用 shell、不合成/清除 hold、不消费 RecoveryDecision；查询前后内存 Task、并发状态和磁盘账本保持一致。
- [x] 文本与结构化详情共用事实来源，输出有固定上限并披露截断；敏感值遮蔽，不返回完整报告正文、transcript、环境转储或任意文件内容。
- [x] Idle 与 live 状态都可使用 planner_tasks 和 git_audit；Root 指引先查已有 Task，再以其 cwd 使用 Git-read，不要求新建 Explorer，也不默认关闭守卫。
- [x] 通过注册到 Pi 的工具 execute 入口和实际账本验证上述场景、无参数兼容及零写入副作用；类型检查、受影响测试、工具说明和公开 schema 发布约定同步完成。

**边界：** 本票是只读故障查询，不创建新恢复系统，不新增通用 shell/日志搜索权限。03 的观察模式和 04 的 writer 前置阻塞不决定查询本身是否可实现，故不添加相应阻塞边。

## Comments

- 2026-09-17 审核修订：writerHold.active 修复为按存活 reservation（含 writerhold:<id> 重启重登记）判定；新增 sessionLog 位置状态（verified-file / known-unavailable / default-directory / unknown）；损坏账本返回 TASK_LEDGER_CORRUPT / TASK_LEDGER_UNREADABLE / TASK_ID_INVALID 而非 TASK_UNKNOWN；executions、probeFailures、guidance 与渲染文本均有固定上限并披露 truncated。
