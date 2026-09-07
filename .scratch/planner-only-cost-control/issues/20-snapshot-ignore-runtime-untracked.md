# 20: PASS 快照不含 scope 外的 untracked 运行时目录

**What to build:** `planner_verdict` PASS 比较的 workspace snapshot 只覆盖 TaskSpec scope 与 Git 报告的 **验证输入**。scope 之外的 untracked 路径（会话目录、隔离 agent-dir、`.pi/` 等）即使出现在 `git status` 里，也不得进入 snapshot digest。scope 内的 untracked 仍算验证输入（既有 E02）。空 scope 不得扩大成「整棵 untracked 树」。tracked 文件内容变化仍必须让 digest 变化。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] 报告已绑定 snapshot 之后，仅修改 scope 外 untracked 目录中的文件：`planner_verdict` pass 仍完成 Task，原因不得含 `workspace snapshot changed since the report`。
- [ ] 既有 E02：scope 内 untracked 文件在报告后内容变化 → 仍 stale。
- [ ] 空 scope 的占位 Task：untracked 运行时目录变化不得单独把 PASS 打成 stale；tracked 的票文件变化仍 stale。
- [ ] Gitignored 路径继续不扫（workspace-snapshot 文件头已有的规则）。
- [ ] 不改 DEFAULT_FLOORS、不改 spec、不勾 08 checkbox。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md` 阶段 A 验收（08 重跑 FAIL）。证据：`.scratch/planner-only-cost-control/phase-a-08-run/comparison.md` §6 第 2 条。

08 第三次 `planner_verdict`：`state: blocked`，`evidence: stale (revalidate): workspace snapshot changed since the report (ec7d2d6acbba8844 -> 397e1f5aeb61f178) base 9921446`。当时 tracked 树干净，HEAD 已是实现提交；digest 变化来自 `.scratch/phase-a-08-session/`、`.agent-dir/`、`.pi/` 每次委派都在写。

接缝：`captureWorkspaceSnapshot` / `snapshotPathsFor` / `recordRootVerdict` 的公开行为。不要为测试新增专用接口。`workspace-snapshot.ts` 文件头：「Sampling covers the declared verification inputs: the task's exact scope paths plus the paths Git reports changed. Ignored files are not swept.」本票把「Git reports changed」收窄为验证输入，不是把 porcelain 从 status 文案里删掉。

若只滤 snapshot 路径后，`gitStatusHash` 仍会因同一批 untracked 目录把 PASS 打成 stale，则 PASS 路径上用于 snapshot 的 changed 集必须同样排除这些路径；不要削弱 E02，不要把未知 snapshot 当成 fresh。

p06-r025: snapshotPathsFor 排除 scope 外 untracked（parseUntrackedPaths + untrackedPathsOf WeakMap 侧信道）；npm test / typecheck / test:e2e 均 exit 0。
