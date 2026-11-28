# 07: Native 可选禁写护栏与 Lite 维护冻结裁决

Status: ready-for-human
Type: task
Blocked by: 03, 04

Source: `../spec.md` W5。

## Scope

- 先固化触发门槛与决策树，不改动现行默认模式或 `tool_call` 行为。
- 若自然会话中中等模型 Root 越界自写大改与目标漂移极少发生，直接结案，不新增开关也不运行付费配对实验。
- 仅当观测到真实越界返工事故时，另立票按对照协议做 2 至 3 个代表性任务配对实验。
- 连续两个扫描窗口 Native 占比 ≥95% 且无因缺少 Lite 独占锁或 `git_audit` 引发的高代价事故，并且 04 证明 Native 覆盖日常场景时，向用户提交 Lite 维护冻结提案。

## Acceptance

- 评估期不切换默认模式、不新增工具层开关。
- 后续任何配对实验或默认模式切换均单独立票并获用户批准。

## Comments
