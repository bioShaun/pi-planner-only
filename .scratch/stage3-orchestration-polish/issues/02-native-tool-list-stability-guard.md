# 02: Native 同会话多轮工具声明稳定性守卫

Status: done
Type: task
Blocked by: none

Source: `../spec.md` W3a。

## Scope

- 在 `index.test.mjs` 覆盖 `native`、`lite`、`off` 三种模式同会话连续至少 3 轮 `before_agent_start`：无模式切换时活动工具元素与顺序恒等，第 2 轮起 `setActiveTools` 调用为 0。
- 覆盖宿主传入相同顺序 `systemPromptOptions.selectedTools` 且 `handoff` 原本位于中间位置时，输出顺序恒等且保持幂等。
- 在 `host-runtime.test.mjs` 用真实 Pi 1.7.0 宿主做 Native 连续两轮离线流式回归，断言请求间工具定义列表无增删、无重排。
- 增加漂移故障注入检查；若发现 handoff 被无谓搬到末尾，做最小保序修正。

## Acceptance

- 连续多轮工具集与顺序稳定；漂移注入可被守卫捕获。
- `TMPDIR=/project/tmp npm run test:release`（或 `:isolated`）通过。

## Comments

- 2026-11-28：已完成。`index.test.mjs` 覆盖 native / lite / off 连续 3 轮工具顺序恒等、第 2 轮起不再重写 active tools，并含重排漂移故障注入；`host-runtime.test.mjs` 用真实 Pi 1.7.0 离线流式宿主验证 Native 连续两轮请求工具定义完全一致。红灯证据：`/project/tmp/stage3-orchestration-polish/index-red.log` 显示 handoff 原为第 2 位却被移到末尾（actual `['read','bash','edit','write','handoff']`，expected `['read','handoff','bash','edit','write']`）。最小实现修正为 `index.ts` 在 Native 下保留宿主已有 handoff 相对位置，仅缺失时追加。绿灯证据： targeted `index.test.mjs` / `host-runtime.test.mjs` 通过，完整 `slot cpu -- env TMPDIR=/project/tmp npm run test:release:isolated` 退出码 0，日志 `/project/tmp/stage3-orchestration-polish/release-green.log`。
