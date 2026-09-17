# WRC 事故后续：2026-09-17 T-20260917-002 调查中可根治的四项

**Status:** done（2026-09-17 四票全落地；复审一轮 REQUEST_CHANGES 已修复：orchestrate 残留文案、planner_abort 拒绝面/解 hold 测试、文档补 RECOVERY_NOT_APPLICABLE、宿主 e2e 验收见 `evidence/`）

## 来源

- `.scratch/planner-envelope-incident-research-20260917.md`（envelope 事件调查，下称 R1）
- `.scratch/planner-verdict-recovery-research-20260917.md`（recovery 连续拒绝调查，下称 R2）
- 上游阶段：`.scratch/worker-runaway-controller/`（P0-B，handback 2026-09-16 已关闭）
- 仓库 HEAD 开票时：`de2cdbd`

## Problem Statement

R1/R2 对同一 Root 会话（`01a0ac7f`）的两个现象做了诊断，结论是**两份报告都只诊断、未修复**。诊断里有四项是"改代码即根治、可测试"的，本目录逐项开票；其余属于缓解或需要先做设计决策的部分列入「不在范围」。

四项：

1. **wall 定时器到期不复查 elapsed**——真实日志 `observed=179999 limit=180000` 仍写 exceeded（R1 §结论、§当前实现.5）。
2. **`planner_verdict` 上 `verdict` 与 `recovery` 的非法组合可表达**——平坦 schema、可选 recovery、free-string action；同一 Root 会话跨 T-002/003/006 六次精确重复 `requires verdict=blocked`（R2 §结论、§schema）。ADR-0002 已证明"拒绝文字挡不住模型重复构造错误参数，只有结构性不可表达才行"。
3. **`planner_redelegate` 对非 final Task 的多余 recovery 静默放行**——同一错误模板在 verdict 被拒、在 redelegate 成功，强化错误行为（R2 §实际约束.5，S:119/121）。
4. **`requires verdict=blocked` 分支无真实测试**——现有 `index.test.mjs`/`delegate.test.mjs` 全绿但未覆盖该组合；且全新 runaway Task 上测 non-blocked 到不了这个分支，必须用事故序列 fixture（R2 §最小复现）。

## 票

| # | 文件 | Status | 阻塞 |
|---|---|---|---|
| 01 | `issues/01-wall-timer-deadline-recheck.md` | done（2026-09-17） | — |
| 02 | `issues/02-abort-recovery-own-surface.md` | done（2026-09-17；方案 A，`planner_abort`） | — |
| 03 | `issues/03-redelegate-stray-recovery.md` | done（2026-09-17；拒绝 `RECOVERY_NOT_APPLICABLE`） | 02 |
| 04 | `issues/04-verdict-recovery-boundary-tests.md` | done（2026-09-17） | — |

建议顺序：04（锁现状基线）→ 01（独立小修）→ 02（结构改造，翻转 04 的部分断言）→ 03（对齐 02 的文案与语义）。

## 不在范围（R1/R2 提出但本目录不接）

- **worker 无界搜索的机械约束**（工具输出体积预算、单命令超时、`toolBudget` 接线）：属 launcher（pi-subagents）职责域或 P1 ExecutionControls，本仓库只能转发参数。R1 §建议.1/6。
- **token 预算口径**（非缓存 input+output vs 经济成本 vs runaway 指标；缓存是否计入）：设计决策，需先在同类任务采样。R1 §建议.3/4。
- **采样式取消的单消息跳过阈值**（本次 8226 / 6.9%）：宿主 `message_end` 才有 usage，本层无法根治。R1 §当前实现.4。
- **breaker 语义去重**（换 summary/reason 绕开参数 hash）：有误封合法恢复的风险；02 落地后重复模式本身消失，再评估。R2 §建议.6。
- **prompt/description 文案与术语消歧**（automatic recovery 两义、executionId vs runId）：随 02/03 顺带改，不单独开票。R2 §建议.2/7。
- **预算默认值**：样本 n=1，任何数值无依据。R1 §不确定性。
