# 20: PASS 快照不含 scope 外的 untracked 运行时目录

**What to build:** `planner_verdict` PASS 比较的 workspace snapshot 只覆盖 TaskSpec scope 与 Git 报告的 **验证输入**。scope 之外的 untracked 路径（会话目录、隔离 agent-dir、`.pi/` 等）即使出现在 `git status` 里，也不得进入 snapshot digest。scope 内的 untracked 仍算验证输入（既有 E02）。空 scope 不得扩大成「整棵 untracked 树」。tracked 文件内容变化仍必须让 digest 变化。

**Blocked by:** None (can start immediately).

**Status:** done（2026-09-08 planner 独立核验，代码在 p06–p11 各轮已落地）

- [x] 报告已绑定 snapshot 之后，仅修改 scope 外 untracked 目录中的文件：`planner_verdict` pass 仍完成 Task，原因不得含 `workspace snapshot changed since the report`。
- [x] 既有 E02：scope 内 untracked 文件在报告后内容变化 → 仍 stale。
- [x] 空 scope 的占位 Task：untracked 运行时目录变化不得单独把 PASS 打成 stale；tracked 的票文件变化仍 stale。
- [x] Gitignored 路径继续不扫（workspace-snapshot 文件头已有的规则）。
- [x] 不改 DEFAULT_FLOORS、不改 spec、不勾 08 checkbox。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md` 阶段 A 验收（08 重跑 FAIL）。证据：`.scratch/planner-only-cost-control/phase-a-08-run/comparison.md` §6 第 2 条。

08 第三次 `planner_verdict`：`state: blocked`，`evidence: stale (revalidate): workspace snapshot changed since the report (ec7d2d6acbba8844 -> 397e1f5aeb61f178) base 9921446`。当时 tracked 树干净，HEAD 已是实现提交；digest 变化来自 `.scratch/phase-a-08-session/`、`.agent-dir/`、`.pi/` 每次委派都在写。

接缝：`captureWorkspaceSnapshot` / `snapshotPathsFor` / `recordRootVerdict` 的公开行为。不要为测试新增专用接口。`workspace-snapshot.ts` 文件头：「Sampling covers the declared verification inputs: the task's exact scope paths plus the paths Git reports changed. Ignored files are not swept.」本票把「Git reports changed」收窄为验证输入，不是把 porcelain 从 status 文案里删掉。

若只滤 snapshot 路径后，`gitStatusHash` 仍会因同一批 untracked 目录把 PASS 打成 stale，则 PASS 路径上用于 snapshot 的 changed 集必须同样排除这些路径；不要削弱 E02，不要把未知 snapshot 当成 fresh。

p06-r025: snapshotPathsFor 排除 scope 外 untracked（parseUntrackedPaths + untrackedPathsOf WeakMap 侧信道）；npm test / typecheck / test:e2e 均 exit 0。

2026-09-08（planner claude-pD，纯核验，未改代码）：**五条全勾。** 干净 HEAD `23d10a4` worktree，`npm test`=0（含 `planner-only workspace snapshot: PASS`）。

- 第 1–3 条：`orchestrate.test.mjs:3147` 起的「Ticket 20」具名测试块，三个子段依次覆盖：①报告绑定后只有 scope 外 untracked 运行时目录变动 → PASS 完成且 reason 不含 `workspace snapshot changed since the report`（`:3199`）；②空 scope 占位 Task：运行时噪声单独不打 stale，tracked 票文件变动仍 stale（`:3233` 与 `:3260`）；③E02 保留：scope 内 untracked 文件报告后变内容仍 stale（`:3294`）。
- 第 4 条：`workspace-snapshot.ts` 文件头「Ignored files are not swept」。实现上是**结构性保证而非显式过滤**：采样口径只有「TaskSpec scope 路径 + Git 报告的变更路径」，而 git 报告的变更本就不含 ignored 文件，所以 ignored 路径没有入口。这里记明它靠的是口径而不是一次 `check-ignore` 调用，免得以后有人找那个不存在的过滤器。
- 第 5 条：`floors.ts` 的 `DEFAULT_FLOORS` 仍是冻结值（bounded 20/40000/0.10，workerInitial 100000/0.50），spec.md 未动，08 的 checkbox 未动。

round_id=claude-pD-2026-09-08-note-20
