# 44: 角色意图与宿主 tool plan 边界（backlog）

**What to build (later, not this filing):** 把「role 意图」从「选对宿主 builtin + 盖预算地板」再收紧成更显式的 capability 声明，并减少对 builtin 名字 / `ROLE_TOOL_PROFILES` 镜像表的依赖。本票先把**已拍板的边界**写死，防止后续 PR 在插件里复制 `resolvePiLaunchToolPlan()`。

**Current design (verified 2026-09-13 on `main` @ `eb03239`):**

- 插件**不**实现、**不**在产品路径调用 `resolvePiLaunchToolPlan`。该符号只允许出现在 `e2e.pi-subagents.test.mjs`：从公开子路径 `pi-subagents/child-tool-plan` 导入，用来断言宿主映射。
- 产品侧表达意图的方式：
  - `ROLE_AGENTS`：把 reviewer / validator / explorer remap 到宿主 builtin（`reviewer` / `oracle` / `reviewer`）；worker 不 remap。
  - `context: "fresh"`：worker / validator / reviewer 强制 fresh。
  - read-only 纠正：`readOnlyRepair` 把 worker 临时按 explorer builtin remap。
  - bounded：经 `resolveEffectiveLimits` 写 delegation 顶层 `toolBudget` / `usageBudget`（业务预算闸门），**不**拼 `tools` / `excludeTools` / `extensions` 列表。
  - model / thinking：走 delegation 顶层 + preflight（与 TaskSpec 分离；见票 43）。
- 扩展隔离靠宿主约定：前台 child 不加载 ambient extensions；后台可能加载，本扩展在 `PI_SUBAGENT_CHILD=1` 时 no-op。不要恢复已删除的 `--no-extensions` CLI 叙事（RF-3）。
- `ROLE_TOOL_PROFILES` 仅供写锁 / 能力判断 / 文案；**不**驱动 child launch。真正的 tool ceiling 由 builtin agent + 宿主 `child-tool-plan` 计算。
- 不要用父进程 `setActiveTools` 剥离 bash/edit/write 来「模拟」child 只读：同轮里 pi-subagents 会把父工具面当 child 上限。

**Approved invariant:**

> Task / role 意图（fresh、read-only、bounded）≠ 宿主展开（tools、excludeTools、extensions、model/thinking 的最终解析、runtime config、session launch）。上游 tool capability / MCP / nested subagents / permissions / extension loading 变化时，应先改 pi-subagents；planner-only 只调意图与预算闸门，不维护一份平行的 launch tool plan。

**Optional evolution (when scheduled):**

1. 显式 capability 声明（例如 readOnly / fresh / bounded），由宿主或薄适配层展开，而不是硬编码 builtin 名字。
2. 缩小或生成 `ROLE_TOOL_PROFILES`，避免与宿主 frontmatter 双源漂移。
3. 文档化「预算地板仍由插件写、tool 列表仍由宿主算」的分工，避免新人把 `toolBudget` 误做成自维护 allowlist。

**Out of scope for a future implement round unless explicitly expanded:** 重写 floors、重做 role-models、改 Oracle contract 文案。

**Blocked by:** 无（记账票；实现另排期）。

**Status:** backlog（2026-09-13 仅落档，不派实现轮）。

## Comments

2026-09-13 planner：用户确认「Reviewer 应只表达 fresh / read-only / bounded，由 pi-subagents 最终计算 tools / excludeTools / extensions / model / thinking / runtime / session launch；不要在 planner-only 复制 `resolvePiLaunchToolPlan()`」。现状核查结论：产品路径已符合「不复制 tool plan」；残留耦合是 `ROLE_AGENTS` 名字依赖与 `ROLE_TOOL_PROFILES` 镜像表。本票记录边界与可选演进，不阻塞当前 PR。
