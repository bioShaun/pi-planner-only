# 02: Review loop 重试分类与无进展止损

**Status:** ready-for-agent

**Blocked by:** 01

**What to build:** 实现 [主 spec](../spec.md) 的 Implementation Decisions 02。基于结构化原因、拟执行动作与恢复条件区分 Worker 纠正、report-only、Validator 和 blocked；停止无效重派并保留可信恢复路径。Reviewer 证据闭环已经移入 01，本文件名保留以兼容链接。

- [ ] 代码/报告/验证/环境及证据缺口进入正确动作；不能统一提示再委派 Validator。
- [ ] 环境与契约失败不挤占代码纠正轮次，同时进入明确 blocked；工具缺失自报只作诊断，不能绕过验收。
- [ ] 同 Task、报告 revision、Evidence 和环境状态下，无进展自动验证最多一次；同一 Task 自动恢复重试累计最多三次，与代码纠正计数分离并持久化，改文案或重启不清零。
- [ ] 读取上一比较发生在覆盖之前；reason 文本相等不充当重试判据。
- [ ] 工具确已恢复、可信 Evidence 变化或新报告修复满足恢复条件后，可进行显式有界验证；即使文案相同也不永久阻断。
- [ ] 正常 Worker 可修复失败仍使用原纠正轮次上限；达到上限不自动继续，保留此前失败与 Usage。
- [ ] 所有停止重试路径给出具体原因和恢复动作；未验证 Evidence、旧 ReviewResult、陈旧 snapshot 不可 PASS。
- [ ] 生命周期测试证明“无无限免费重试”和“恢复条件成立后可完成”；真实宿主跑成功与无进展失败各一例。
- [ ] 记录总 Task Usage、Root token、角色调用/重验证次数和完成状态；无真实 Usage 不宣称 Astra/Luna 固定省额。

## Comments

2026-09-10 修订：替代原 identical-verifiable-reasons 不计轮次逻辑。免计轮次必须伴随停止自动重派和可核验恢复条件，否则会成为无限循环。01 的全部 Evidence 门槛继续适用。
