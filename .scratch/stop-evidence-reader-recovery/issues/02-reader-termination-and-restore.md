# 02: 受限 Explorer 正确停止，恢复时不生成写入占用

**What to build:** 受宿主工具面约束的 Explorer 收到匹配终态后能正常结束停止协调，不因 Git 缺失或其他 writer 的活动被误认为仍在写入；恢复和重启也不为它合成 Writer hold。真实 writer 和历史未知执行继续隔离。

**Blocked by:** None (can start immediately).

**Status:** implemented

**Parent:** [停止证据失败规格](../spec.md)，实施决策 §1、§2 停止协调、§4 恢复、§5 hold 展示、§7 契约说明。

- [x] 在启动前依据插件控制的实际 agent 绑定分类执行能力，并将可写、受限只读或未知的分类及依据持久化到本次 TaskExecutionRecord；不能以 Task 初始 role 或模型自报替代。
- [x] Worker 和具有 shell 的 Validator 按 writer 隔离，即使归因标志 readOnly=true 也不能降级。Explorer 只有可信 scout 工具绑定排除 shell/edit/write 等变更入口时按受限只读处理；无法证明绑定约束时启动前返回可操作错误。
- [x] 先在票内统一能力分类，再贯通 admission、正常/取消/超时终态、迟到终态、持久化和恢复，避免各入口独立判断 role。不得虚构上游 capability 遥测。
- [x] 受限只读执行收到身份匹配终态后采用“匹配终态 + 受限只读绑定”的确认依据，不假称工作树静止；Git 不可用、status 失败或外部持续变化不单独生成其停止失败或恢复要求。
- [x] 无匹配终态仍不得声称停止已确认；受限只读执行可保留停止未知和适用恢复要求，但不生成 writer reservation/hold。取消、runaway、失败不因此成为成功，迟到和重复事件不重复记账。
- [x] Worker、Validator 和能力未知执行继续要求匹配终态与有效静止证据；completed terminal 不能绕过隔离，第二 writer 在停止未确认时仍被拒绝。
- [x] 对可信 reader 新记录，正常恢复、超恢复上限记录发现及惰性加载均不因 stop 状态合成 hold。混合执行历史中不遗漏真正待隔离的 writer；已确认停止的记录不重新占用。
- [x] 已存在的 hold 与缺少可信能力信息的历史未确认执行保持保守处理，不根据 readOnly、展示文本或当前 role 自动清除；不批量删除历史错误 hold。
- [x] 在满足既有恢复前提且操作者确认残留执行已处理时，匹配 executionId 的 manual 恢复能解除对应真实占用；保持既有 abort/重执行分离、一次消费和重复决策拒绝规则。
- [x] 屏幕和工具文本仅在账本或并发控制确有 hold 时显示保留占用；reader 无 hold 时如实显示无写入占用。
- [x] 通过生产 Delegation 入口及真实账本恢复重建非 Git Explorer 失败、错误 hold 展示和重启合成 hold 的回归，覆盖无终态、取消、迟到/重复、混合历史及 Validator 反例。
- [x] 类型检查、受影响测试和停止/恢复域契约说明同步更新，明确本票确认的是执行结束依据，不代表报告验收通过；真实宿主能力证据由 07 汇总验收。

**边界：** 本票使停止与恢复行为正确，不承诺非 Git Task 已可最终 completed。默认 worktree 验收仍可因 Git 不可验证而阻塞；03 负责 observation 模式的完整交付。01 的丰富错误信息和 05 的未验收报告保全不是本票前置条件。
