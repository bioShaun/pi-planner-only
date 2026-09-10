# 02: Review loop 重试分类与无进展止损

**Status:** ready-for-agent

**Blocked by:** 01

**What to build:** 实现 [主 spec](../spec.md) 的 Implementation Decisions 02。基于结构化原因、拟执行动作与恢复条件区分 Worker 纠正、report-only、Validator 和 blocked；停止无效重派并保留可信恢复路径。Reviewer 证据闭环已经移入 01，本文件名保留以兼容链接。

- [x] 代码/报告/验证/环境及证据缺口进入正确动作；不能统一提示再委派 Validator。
- [x] 环境与契约失败不挤占代码纠正轮次，同时进入明确 blocked；工具缺失自报只作诊断，不能绕过验收。
- [x] 同 Task、报告 revision、Evidence 和环境状态下，无进展自动验证最多一次；同一 Task 自动恢复重试累计最多三次，与代码纠正计数分离并持久化，改文案或重启不清零。
- [x] 读取上一比较发生在覆盖之前；reason 文本相等不充当重试判据。
- [x] 工具确已恢复、可信 Evidence 变化或新报告修复满足恢复条件后，可进行显式有界验证；即使文案相同也不永久阻断。
- [x] 正常 Worker 可修复失败仍使用原纠正轮次上限；达到上限不自动继续，保留此前失败与 Usage。
- [x] 所有停止重试路径给出具体原因和恢复动作；未验证 Evidence、旧 ReviewResult、陈旧 snapshot 不可 PASS。
- [x] 生命周期测试证明“无无限免费重试”和“恢复条件成立后可完成”；真实宿主跑成功与无进展失败各一例。
- [x] 记录总 Task Usage、Root token、角色调用/重验证次数和完成状态；无真实 Usage 不宣称 Astra/Luna 固定省额。

## Comments

2026-09-10 修订：替代原 identical-verifiable-reasons 不计轮次逻辑。免计轮次必须伴随停止自动重派和可核验恢复条件，否则会成为无限循环。01 的全部 Evidence 门槛继续适用。

2026-09-11 实现（E02 完成，依赖 E01 的 per-execution Evidence）：

- 结构化分类：`ReviewDecision` 增加 `failureClass`（implementation / environment / contract / evidence）与 `reasonCode`（如 `worker-failed`、`report-invalid`、`evidence-stale`、`evidence-no-progress`、`recovery-limit`、`evidence-unverifiable`、`evidence-missing-materials`）；决策块新增 `failure:` 行，task status 新增 `Recoveries: n/3`。
- 计数与持久化：`TaskRecord.recoveryAttempts` / `recoveryStates` / `lastRecovery` 随 ledger 持久化；`evidenceStateKey()` 以报告 revision + 比较的结构化事实（路径集合、verifiable、drift、headChanged、boundary ref）为键，刻意排除 reason 文案。同一状态只授予一次自动重验证；Task 累计上限 `MAX_RECOVERY_ATTEMPTS = 3`；工作区真实变化（boundary ref 改变）即视为新状态。attempt 在授予时写入（覆盖比较之前读取历史），重启/改文案不清零。
- 轮次分离：revalidate 不再消耗代码纠正轮次（consumesRound=false），由恢复计数约束；contract（report-only 修正）同样不再消耗 reviewRound，仅消耗 reportCorrections；environment（git 不可用 / probe 失败 / 声明根不可读，以 `environmentFailure` 结构化判定，不做文案匹配）直接 blocked 不计轮。Worker 可修复失败仍走原 request_changes 轮次上限。
- 判据顺序：missingMaterials → 环境 blocked → 无进展/上限 blocked →（新状态）有界 revalidate → findings request_changes → 复核裁决。Root/reviewer 的 request_changes 裁决即使证据过期也照常记录（保守动作，不进重试预算）；PASS 仍然被过期证据覆盖为 revalidate/blocked。
- 测试：新增 E02 生命周期块（无进展止损全序列：request_changes 不耗预算 → 首次过期 revalidate → 同状态 blocked → 新 HEAD 新尝试 ×2 → 上限 blocked；契约失败零轮次；worker blocked 零轮次），并更新 probe-failure（environment → blocked）与 revalidate consumesRound 两条既有断言。全量 17 个测试模块通过，`tsc --noEmit` 干净。
- 未验证项：真实宿主（live Pi host）各跑一条成功与无进展失败用例仍未执行——本机无可用宿主会话，按主 spec 标记为未验证；`npm run test:e2e` 合同测试保留为宿主可用时的验收入口。Usage 统计沿用既有 usage.jsonl / Budget by role 渲染，未宣称任何固定节省比例。
