# Worker 能力分档建议

日期：2026-10-06。状态：建议稿，**暂缓实施**。先满足第 2 节的实施前提，再决定是否实现。

适用范围：pi-planner-only 的 Lite 模式。本文中的 `tier` 参数、强 worker 配置项均为拟新增能力，现有插件尚不支持。

## 1. 结论

- 方向：可以考虑增加可选的两档 worker。默认档处理方案明确的执行任务，增强档处理推理要求较高的任务。Root 选择档位，并继续负责范围、公共接口、跨模块决策和最终验收。
- 现在不实现。目前既没有对照数据，也没有「默认 worker 反复返工、最后由 Root 接手」的真实案例。按 [删减计划](pi-planner-only-subtraction-plan.md) 的判断标准，新机制要说清楚：它让哪个真实任务少了几轮 Root，或者防住了哪个真实发生过、代价很大的事故。本建议暂时回答不了这个问题。
- 收益要按整个任务计算。删减计划的实测显示，成本主要来自 Root 轮数乘以 Root 上下文，执行 token 不是大头。所以增强档的价值主要看它能否减少 Root 轮数，例如更少的返工、纠正和接手，而不是看 child 本身的费用。分档也有长期成本：Root 每次委派都要多判断一次档位，工具说明也会变长。
- 如果确认要实现，推荐用请求级模型覆盖（第 6.1 节），不新建独立 agent。

## 2. 实施前提：需要的证据

按顺序进行，前一步结论为否时停止。

### 2.1 盘点现有日志

从 `.scratch/` 下已有的委派记录（如 `worker-time-20260929`、`om*-usage-*`、`om09-run*`）中统计：

- worker 委派总数；
- 因推理或实现能力不足而失败、需要重新委派的次数，需与缺上下文、任务描述错误、环境故障、超时分开计；
- Root 放弃委派、亲自接手的次数；
- 上述失败带来的额外 Root 轮数和费用（估算即可）。

能力不足导致的失败很少，或者额外成本远小于一次强模型执行的差价时，搁置本建议，并在本文记录结论。

### 2.2 整体换模型试运行（不改代码）

把 pi-subagents 的 `agentOverrides.worker` 整体换成强模型，在正常工作中运行一段时间，与换之前同类任务对比：

- 首次通过率、返工次数、Root 接手次数；
- 每个任务的总费用（Root + 所有 child + 失败尝试）和端到端耗时。

可能出现三种结果：

| 结果 | 后续 |
|---|---|
| 强模型没有明显减少返工或 Root 轮数 | 搁置分档，换回原模型 |
| 强模型明显更好，且总费用可接受 | 直接保留整体强模型，无需分档 |
| 难任务明显受益，简单任务只增加费用 | 进入第 6 节，实现分档 |

试运行期间记录模型名、thinking 级别和起止时间，便于与日志对应。

## 3. 如何判断任务难度

按推理需求选择档位，文件数量和运行时长只作辅助信息。几十个文件的机械替换可能很简单，一个函数的并发语义修改可能很难。

| 任务特点 | 建议处理方式 |
|---|---|
| 方案明确、已有模式可参考、机械修改、普通脚本 | 默认 worker |
| 复杂状态转换、并发或取消逻辑、多个关联约束需要同时成立 | 强 worker |
| 普通 worker 已暴露推理或实现能力不足 | Root 分析失败后，升级强 worker |
| 缺少事实、日志或代码背景 | 先补充资料，必要时使用 explorer |
| 需求、公共接口或跨模块决策未确定 | Root 先确定决策，再委派 |
| 依赖故障、凭据问题、长计算或等待队列 | 先解决环境或作业安排 |

明显复杂的任务可以直接交给增强档。普通 worker 失败后，Root 应先判断原因，再决定补充上下文、修正任务、缩小范围或升级档位，不要机械地重复执行同一个任务。

## 4. 当前实现与接入位置

当前 Lite 的 `delegate` 接受 `role`、`task` 和可选的 `cwd`。`worker` 固定映射到同名 agent，具体模型由 pi-subagents 的 `subagents.agentOverrides` 配置；README 也写明「子代理模型来自 pi-subagents 设置，不由本插件决定」。

相关实现：

- [delegate.ts](../delegate.ts)：`ROLE_AGENTS` 管理 agent 映射、锁和角色提示；`runDelegation` 管理委派生命周期；`buildRequest` 组装宿主请求（目前不带 `model`/`thinking`）。
- [index.ts](../index.ts)：注册 `delegate` 工具，提供参数说明和 Root 提示。
- [config.ts](../config.ts)：集中解析所有 `PI_PLANNER_ONLY*` 配置。
- [CONTEXT.md](../CONTEXT.md)：模型由用户配置、Root 验收、同一仓库 writer 独占等现有约定。

pi-subagents 的委派请求 `SubagentDelegationRequest` 本身支持可选的 `model` 和 `thinking` 字段（本机 0.76.0：`src/api/delegation.d.ts`）。适配层会把它们分别传给执行参数 `model` 和 `delegatedThinkingOverride`（`src/slash/delegation-adapters.js`）。

## 5. 建议接口

保留 `worker` 职责，新增可选参数 `tier: "default" | "strong"`。省略时使用 `default`，现有调用保持兼容。

```ts
// 默认档：现有调用保持有效
delegate({
  role: "worker",
  task: "按既定规则修改配置并验证"
})

// 增强档：由 Root 显式选择
delegate({
  role: "worker",
  tier: "strong",
  task: "修复取消与完成事件竞态，保持现有状态转换约束"
})
```

第一版只支持 worker 分档，其他角色带 `tier` 时明确拒绝，避免参数被静默忽略。工具参数不接受任意模型名，模型只能来自用户配置。

## 6. 实现方案

### 6.1 推荐：请求级模型覆盖

两档使用同一个 `worker` agent，增强档只在请求中附加用户配置的模型和 thinking 级别。

拟新增配置：

```bash
PI_PLANNER_ONLY_STRONG_WORKER_MODEL=provider/strong-model
PI_PLANNER_ONLY_STRONG_WORKER_THINKING=high   # 可选
```

| 调用 | 目标 agent | 模型来源 |
|---|---|---|
| `worker`，省略档位或 `default` | `worker` | `subagents.agentOverrides.worker`（不变） |
| `worker`，`strong` | `worker` | 请求中的 `model` / `thinking`，取自上述配置 |

优点：

- 不需要另建 agent，也不需要维护一份会和上游 worker 提示逐渐走样的模板。
- 两档的提示、工具权限和报告要求天然一致，效果差异只来自模型，便于归因。
- 改动集中在 `config.ts`、`buildRequest` 和工具参数说明。

与现有约定的关系：模型仍由用户配置，只是增强档的配置位置从 pi-subagents 设置移到插件环境变量。README 和 CONTEXT.md 中「模型不由本插件决定」的表述需要相应更新。默认档仍完全由 pi-subagents 决定。

实施前需要验证：

1. 宿主确实按请求中的 `model` 启动 child，结果中的实际模型与配置一致。
2. pi-subagents 的模型范围限制（model scope）会不会拒绝或改写该模型；被拒绝时，插件要保留明确的失败原因。
3. `delegatedThinkingOverride` 的实际效果，以及它与 `agentOverrides.worker.thinking` 的优先级。
4. 插件声明支持 pi-subagents `>=0.70 <1`。需要确认最低版本已提供 `model`/`thinking` 请求字段；否则提高最低版本，或在不支持时拒绝增强档。

### 6.2 备选：独立 agent

只有当第 6.1 节的验证项不成立时才考虑。做法是：增强档映射到用户定义的 `worker-strong` agent（配置项如 `PI_PLANNER_ONLY_STRONG_WORKER_AGENT`），模型写在 `agentOverrides.worker-strong`。

注意：只在 `agentOverrides` 里加一项不会创建 agent，还要在 `~/.pi/agent/agents/` 或项目 `.pi/agents/` 下定义 `worker-strong`，并维护一份以普通 worker 为基准的模板。上游更新时，模板与普通 worker 的提示可能逐渐走样，需要定期核对。这是本方案的主要维护成本。

### 6.3 共同的失败处理

- 请求增强档但未配置时，在启动前返回明确错误。
- 模型或 agent 不可用、被拒绝时，保留宿主给出的诊断信息，不静默改用默认 worker。

## 7. 实现范围与运行约束

| 位置 | 建议改动 |
|---|---|
| `config.ts` | 解析可选的增强档模型与 thinking 配置 |
| `index.ts` | 增加 `tier` 参数及简短的选择说明；未配置增强档时不在说明里提供该档 |
| `delegate.ts` | 集中解析角色与档位；`buildRequest` 按档位附加 `model`/`thinking`；锁模式和职责提示仍由角色决定 |
| 委派结果 | 增加所选档位，保留宿主报告的实际 agent、实际模型及用量 |
| 文档 | README、CONTEXT.md 中关于模型来源的表述；配置说明、选择规则、失败处理和版本要求 |

后续的启动、取消、终态处理和 Git 摘要沿用同一条执行路径。

两档 worker 共用现有的仓库独占锁：普通 worker、强 worker 和 validator 之间继续互斥，也不能与持有共享锁的 explorer 同时运行。停止未确认时，仓库继续保持占用，不能借升级档位启动第二个 writer。

升级通过一次新的委派完成。Root 要带上原报告、失败证据、已有改动状态和剩余验收要求，因为 `fresh` 上下文不会继承上一个 child 的会话。启动升级前，须确认原 child 已结束并释放占用。

第一版沿用现有时限和 token 限制，不加自动重试、自动升级或自动降级。长作业继续按现有作业管理规则处理。

Root 提示中的选择规则保持简短：普通任务用默认档，复杂推理任务用增强档，失败后先判断原因。尽量把说明放在工具参数描述里，并遵守现有的提示长度约束。

## 8. 验收与效果评估

实现时应覆盖以下行为，并保留现有测试断言。新增的拒绝条件要有对应的故障注入检查。

- 省略 `tier` 或指定 `default` 时，请求与现在完全相同（不带 `model`/`thinking`）。
- 指定 `strong` 时，宿主收到配置的 `model`/`thinking`；agent、任务、cwd 和现有执行约束传递正确。
- 未配置增强档、档位无效、非 worker 角色携带档位时，明确拒绝；宿主报告模型不可用或被拒绝时，保留诊断信息。
- 普通档与增强档之间的仓库锁互斥；取消未确认时，不能启动另一档 worker。
- 结果能区分所选档位和实际执行的模型；成本统计继续覆盖所有委派。
- Off、Native 模式和其他角色的原有行为不受影响。

完成实现后运行 `npm run test:release`，按项目规则把 `TMPDIR` 设在仓库外。本文只是建议，不涉及实现，也不代表这些测试已经执行。

实现后的效果评估沿用第 2.2 节的指标：首次通过率、返工次数、Root 接手、端到端耗时，以及包含 Root、所有 child 和失败尝试的总费用。按任务类型分别报告，不要凭单次增强档成功就推广到所有任务。后续是否给其他角色分档、是否加自动选择，由实际收益决定。
