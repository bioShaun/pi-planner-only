# 04: 阶段三真实会话六项指标离线取证

Status: needs-info
Type: task
Blocked by: none

Source: `../spec.md` W2b。

## Blocking input

等待 W1 落地后的真实阶段三 Native 会话积累到可统计窗口；这不是代码实现阻塞，但不能用零样本或旧阶段会话冒充取证。

## Scope

- 待 01 落地并积累阶段三真实 Native 会话后，在本机私有证据目录或 `/project/tmp` 下扩展只读扫描脚本；禁止写入 `/tmp`。
- 统计 architect 触发率、方案跨 handoff 续用率、高风险方案 reviewer 复核轮数、worker 三类摩擦交回频次、Root 轮数、Root 与子代理 token / 成本占比。
- 脱敏汇总回填 `docs/pi-planner-only-subtraction-plan.md` §0.1 第 46 至 49 行证据指针及 `CHANGELOG.md`。

## Acceptance

- 全程只读扫描本地 jsonl，零模型 API 调用。
- 入仓文本不含客户路径或业务代码片段，时间窗、分母与排除规则可复算。

## Comments

- 2026-11-28：01 已完成，流程性前置解除；但仍需等待落地后的真实阶段三 Native 会话积累到可统计窗口。当前未启动扫描，未调用模型。
