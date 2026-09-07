# 01: 委派结果按宿主 details 分类，异步回执带 runId

**What to build:** Root 以 `async:false` 委派 Validator 或 Explorer 时，父进程阻塞到子进程完成，返回的散文结果直接按该角色的完成路径处理，Root 不再收到「Async delegation has started」也不需要重试。只有宿主 details 明确标记为异步启动的委派才被当作回执；回执文案告诉 Root 这次 run 的 id 和用 id 等待的方式，并提醒无 id 等待在启动后短时间内可能报空。调用方显式 `async:false` 时，任何基于结果文本的猜测都被禁用。前台完成结果里出现的 `Mission:` 和 `Run fan-out:` 行不再被当作异步标记。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [x] 用 pi-subagents 0.65.1 真实前台结果文本（首行 `Run fan-out: …`、尾行 `Mission: … (completed)`，details 含 runId 不含 asyncId）分别以 validator、explorer、worker 角色返回：三种都走完成路径，Validator 结果被记录为验证结论，Explorer 结果原样返回，Worker 结果进入 WorkerReport 解析。
- [x] 同一文本在调用方 `async:false` 时无论内容如何都不被判为回执。
- [x] details 含 asyncId 的真实异步回执：插件回复包含 runId 与 `bg_wait id=<runId>` 指引，以及无 id 等待可能短时报空的提示。
- [x] 散文标记列表不再包含 `Mission:` 与 `Run fan-out:`；保留的标记各自单独具有唯一异步语义。
- [x] 上述真实宿主文本固化为扩展集成测试夹具，并注明来源是 2026-09-07 探测。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（Problem Statement 问题 1，User Stories 1–2，阶段 A 决策第 1–2 条）。证据：`.scratch/kimi-timing-probe/analysis-2026-09-07.md` P1。

Planner verified `p04-r017` (2026-09-07): `npm test` 与 `npm run typecheck` 由 Planner 重跑均为 exit 0。散文 Oracle 夹具走既有「judge it directly」路径，不产生结构化 validation entries；分类已离开回执路径。
