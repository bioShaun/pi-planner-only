# 05：委派时关闭 intercom 桥

Status: ready-for-agent
Type: task

## Problem

子 agent 第一轮就调用 `contact_supervisor` 请示（例如"任务说不要修改，但运行时要求写 artifact"）。pi-subagents 随后把这次运行 detach，delegate 返回 `failed · Detached for intercom coordination`，Root 要额外花约 2 轮去回复、等待。插件把 detach 当成终态，会提前释放仓库锁，而子 agent 其实仍在运行。在 cpass-ds 和 gemini 两组里共发生 56 次。

## Changes

- `delegate.ts` 发出的请求加上 `intercomBridge: { mode: "off" }`，同步更新 `subagent-delegation-contract.ts` 里的类型。按 pi-subagents 的实现，桥关掉后子 agent 拿不到 `contact_supervisor`，也就不会 detach。
- 子任务文本里 explorer 的结尾说明加一句：运行时指定的报告输出文件可以写，"不修改"只针对仓库文件。
- CONTEXT.md 的 Decisions 里记一条：子 agent 不能中途请示，任务必须自包含。

## Acceptance

- 测试断言请求里带有 `intercomBridge.mode === "off"`；故障注入：去掉这个字段时测试会失败。
- `contract.test.mjs` 对照已安装的 pi-subagents，确认结构化请求能接受 `intercomBridge`。
- `npm run test:release` 全绿，没有删除任何断言。
