# 编排方式的演进

记录插件“谁规划、谁编排、谁干活”的三次转向。日期取自 git 提交；细节证据见各阶段末尾的链接，不在此重复。

## 前史：v0.2 结构化编排层（2026-08-31 起）

早期版本有任务账本、证据新鲜度、typed delegation 契约等重型机制（legacy ADR-0001–0007、0009、0010）。维护成本高，2026-09-24 随 Lite 重写整体让位；旧 scratch 归档在 `.scratch/archive/`。这不是下面三阶段之一，但解释了为什么后来每一步都在做减法（见 `pi-planner-only-subtraction-plan.md`）。

## 阶段一：Lite——省 token（2026-09-24，`e8ad415`）

- **动机**：省 token。贵模型的 token 只花在规划与验收上，实际改动交给便宜的 worker。
- **分工**：Root（贵模型）规划、委派、看 Git 摘要和检查输出后验收、提交；worker / explorer / validator / reviewer 在便宜模型上干活。
- **机制**：插件自带 `delegate` / `git_audit` / `git_commit` 工具，子代理以 in-process 方式经 pi-subagents 的结构化委派运行；子代理返回纯文本，没有结构化报告契约，也不落任务账本。
- **取舍**：Root 兼任规划和编排，所以仍需贵模型；并发只支持锁兼容的有限形态（同 cwd 单写者）。
- 依据：`lite-direction-review-2026-09-25.md`、`lite-measurement-2026-09-24.md`、`worker-tiers-*`。

## 阶段二：Native——借 pi-subagents 做调用与并行（2026-09-27，`b4db558`）

- **动机**：Lite 自己维护的委派工具与锁协议重复了 pi-subagents 已有的能力；直接用它的调用、并行、async、resume/steer，更好也更省维护。
- **变化**：Native 模式下生命周期归 pi-subagents，插件只保留观测式用量统计、上下文告警和 Root handoff；不再提供 Lite 的 delegate/git 工具和严格控制。Off / Native / Lite 是单个 Root 会话的模式选择。
- **遗留**：Root 仍同时承担规划和编排；Native 提示词里靠“按角色分流”和任务尺寸规则约束 Root（`native-week-2026-11-18.md` 记录了一周实际运行的缓存与异常观测）。
- 依据：`native-lite-execution-plan-2026-10-27.md`、`research-native-workflow-concurrency-2026-10-27.md`、`.scratch/native-mode-20260927/`。

## 阶段三：规划抽离——最强模型只规划，Root 只编排（2026-11，`6a3834f` 起）

- **动机**：把“想清楚”和“调度”拆开。规划需要最强的模型，但只在需要时才用；编排（拆分、派活、查 diff 与测试、验收）用中等模型即可，常驻的 Root 成本因此下降。
- **分工**：
  - **Root（中等模型）**：编排。拆成可单独验收的交付、派 scout/worker/reviewer、检查 diff 和测试结果；小而局部且已掌握上下文的改动可直接做。
  - **规划者（最强模型，只读的 `architect`；早期叫 oracle）**：只在需要可被引用的方案契约时才派（锁定公共接口、数据/权限/模块边界，或长任务需要步骤与验收标准）。方案写明何时重新规划；首份方案不由 Root 自写，实施另派 worker。
  - **worker**：按 Root 写的短 Approach 实施；验证连续失败两次、接口与预期不符、或遇到计划未敲定的设计选择时，纯文本交回 Root，不自行改口径。
- **约束**：不是每个新任务都先规划；位置不清先派 scout；高风险方案先经 reviewer 审；同一成果连续 2 轮审查未过，或修复需引入计划外持久化/新协议时，停止并交回用户。
- **提示词预算**：`NATIVE_PROMPT` 受 1,200 字符上限约束（`index.test.mjs`），约定尽量写在 brief 和 `.scratch/native-root-dispatch/` 的 dispatch 表里，不堆进系统提示。
- 依据：`.scratch/native-root-dispatch/spec.md`、`CHANGELOG.md` 0.9.0-lite.0 中 Native dispatch / re-plan / architect 各条、`pi-planner-only-subtraction-plan.md` §0.1 账本。

## 同类做法对照

阶段三与 Aider、Claude Code opusplan、omo、Roo、OpenCode 及 2026 年 Cursor、Factory、Amp 的对照，以及可借鉴项：`research-planner-split-prior-art-2026-11-28.md`。

## 一句话

Lite：贵 Root + 便宜 worker → Native：把调用与并行交给 pi-subagents → 规划抽离：最强模型只规划，中等模型 Root 只编排。
