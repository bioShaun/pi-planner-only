# 权限调整后的推进结果

本轮没有修改生产代码、提交、推送或发布；按用户裁定修改了全局 ~/.codex/review-readonly.sh 与 astra-planner.md（issue06/global-budget.patch）。模型按用户选择固定为 Kimi Root（kimi-coding/kimi-for-coding）、Luna child（tcuni-luna/gpt-5.6-luna），thinking=low。

| 项目 | 结果 | 原始证据 |
|---|---|---|
| 宿主权限与资源预检 | PASS：stdout、PTY、/project/tmp、slot | host-preflight.json |
| 当前源码 release | PASS：复用已通过且 60 个文件哈希仍一致的第五次运行 | ../release-run-dWGu9v/ |
| 真实模型路由 smoke | PASS，首轮 exit 0，正确答案与关联终态/usage | ../study-run-D1Lacq/；command-results.json |
| 真实 TUI 停止 | PASS，首轮 exit 0；关闭后调用为 0，3 秒静默后自然退出 | ../study-run-g9NOIF/；host-validation.md |
| 严格代码审查 | PASS，fresh astra_reviewer，实际只读 | strict-attempt-1-reviewer.md；strict-prior-proof.json |
| 独立验收核验 | PASS，核实首轮来源、无漂移及原始验收证据 | strict-attempt-3-reviewer.md；strict-attempt-3-result.json |
| strict launcher 完整退出 | PASS（第 5 轮，全局入口已按工单 06 修订：父 low effort、420 秒、子软预算）：exit 0，父子各自 EROFS，child PASS，253 秒；前三次 124 与第 4 轮 BLOCKED 原样保留 | ../strict-run-Y59nSS/、strict-attempt-5-*；../strict-run-qE6emR/、../strict-run-snUQhK/、../strict-run-jYl0O1/、../strict-run-IGfEci/ |
| 工单 06 归因与修法验证 | 归因完成：父 max-effort 延迟 + child 固有时长；父 effort=low 实验两轮仍 124（child >200 s 截断）；全局预算草案待用户裁定 | ../issue06/diagnosis.md、../issue06/strict-run-WKrCon/、../issue06/strict-run-baWBGu/、../issue06/global-entry.patch、../issue06/global-budget.patch |

已保存三次失败和所有实际退出状态；首轮、第三轮 child 的 PASS 均在各自外部截止前产生。父/子只读均有实际 EROFS 与不变哈希证明，没有以角色配置或口头拒绝代替。每次重任务先记录 slot audit/status，再进入 slot cpu；最终无自有测试/审查进程残留。

审查冻结范围为 66 个 source 项和 11 个 harness 项，含 ADR-0008；旧清单保留在 before-*。本轮更新了审查入口、证据索引、验收记录和工单状态。最终文件核验见 final-integrity.json。

未闭环项：P1-B partial/report-only repair、P3 完整对照/价格/默认值校准、Request 剩余时间可见性及更广的 scheduled continuation 场景。一个 smoke 与一个 TUI 场景不足以证明费用节省或所有宿主模式正确。

2026-09-20 清单第 0 步：实现已提交为 `83a0ad4351300e4537435ce637a995207e221ed0`；磁盘 77 项冻结哈希零漂移。提交树包含其中 75 项；另 2 项是 2026-09-18 明确排除的旧 explorer-model 原型，已按原字节归档至 execution-20260920/ignored-freeze/，未恢复为产品源码。见 execution-20260920/baseline-freeze.json；未提交 tmp/。
