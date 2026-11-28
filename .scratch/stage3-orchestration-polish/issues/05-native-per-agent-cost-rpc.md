# 05: Native cost RPC 可选 byAgent 分角色用量

Status: ready-for-human
Type: task
Blocked by: none

Source: `../spec.md` W3b。

## External precondition

先与上游 `pi-subagents` 对齐并落地向后兼容的 `cost` RPC `byAgent` 可选字段；本仓不读取其私有内部模块或未公开收据格式。

## Scope after upstream support

- `refreshNativeCost` 继续以合法 `childTotal` 为主开关；`byAgent` 存在且字段为非负有限数时存入会话内存态，旧版或局部脏字段无损回退。
- 底部状态栏保持单行紧凑，不加入分角色文本。
- 仅在 `/planner-only status` 通知中追加分角色调用数、token 与成本下界。

## Acceptance

- 补齐旧版无 `byAgent` 回退、脏字段忽略、状态栏不膨胀、跨会话重置与旧请求丢弃故障注入。
- `index.test.mjs` 与 `contract.test.mjs` 通过；README、README.zh-CN、CONTEXT 同步。

## Comments
