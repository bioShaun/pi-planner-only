# 06: 周边上下文降噪协同与大范围 diff 分页审查分流

Status: ready-for-human
Type: task
Blocked by: none

Source: `../spec.md` W4。

## Scope

- 跨仓部分分别归属 `/public/scripts/pi-todo`、`pi-subagents` 与 Pi 宿主 `codemode`；本票不授权在本仓重复造轮子或直接提交跨仓代码。
- 本仓可执行部分：在 `.scratch/native-root-dispatch/spec.md` 第 3、7 节试用分层 diff 验收约定；小范围改动 Root 直接读完整 diff 与测试输出，大体积或多文件改动先看 stat 与退出码，再委派挂载 `reviewer-git.ts` 的独立 reviewer 分页通读，Root 定点核实关键接口与可疑切片。

## Acceptance

- 跨仓改动在各自仓库闭环；pi-todo 20 份历史状态形状回放通过。
- 本仓约定试用满一个自然窗口后，结合 04 的扫描复核 handoff 触发间隔与漏检情况，证实有益则保留，否则撤回。

## Comments

- 2026-11-28：本仓零代码部分已随 01 落地：`.scratch/native-root-dispatch/spec.md` 第 3、7 节已写入分层 diff 验收与 `reviewer-git` 分页审查任务包约定。跨仓 `pi-todo`、`pi-subagents`、宿主 `codemode` 部分未越权执行；效果仍需在一个自然窗口后结合 04 扫描复核。
