# 09: 角色模型策略（含 thinking）与 requested/resolved/actual 记录

**What to build:** 使用者可显式开启角色模型策略，为 Root、Reviewer、Worker、Explorer、Validator 分别声明模型与 thinking level。策略开启后，任一角色缺配置、模型无法解析或与调用方参数冲突，委派在启动前被拒绝并给出具体原因，不静默继承 Root 模型。每次委派记录请求模型、解析后模型、宿主实际模型（含 thinking）三者；实际不可观测记未知；实际与策略不匹配时记录不匹配并停止后续受控启动。Root 自身配置只在宿主允许范围内校验，不伪称已切换。策略未开启时状态明确显示没有模型成本保证。工具能力不随模型改变。

**Blocked by:** 04、08。

**Status:** ready-for-agent

- [ ] 五种角色配置不同模型与 thinking：宿主实际启动参数与之一致（真实公开宿主入口验证）。
- [ ] Worker 缺配置：委派前拒绝，原因指明角色与缺项；不发生子进程启动。
- [ ] 模型名无法解析：委派前拒绝并给出解析错误。
- [ ] 调用方显式传入与策略冲突的模型：拒绝并指出冲突双方。
- [ ] 实际模型未知：记录未知，不阻断；实际模型或 thinking 与策略不符：记录不匹配，后续受控启动被拒绝并说明。
- [ ] 策略未开启：status 显示「无模型成本保证」。
- [ ] 角色工具能力在所有模型配置下保持不变。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 11–17，阶段 B 决策第 1–2 条）。

- 2026-09-07 工单 10 已 `p06-r027 accepted`。本票切轮：第一刀只做「策略未开启时 status 显示『无模型成本保证』」（`p06-r028`，pi `w2E:pG`）。其余 checkbox 本轮不做。checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p06-r028`：`/planner-only status` 输出含产品句「无模型成本保证」；`npm test`/`typecheck`/`test:e2e`/`git diff --check` 均为 0；HEAD=`bc7bb4e858c77843f3b643250638e4b2d94a0e38`；fence 仅 `index.ts` / `index.test.mjs`。未实现策略开启与其余 checkbox。`finish-round accepted`。checkbox 与 Status 仍未动。
- 2026-09-07 round p07-r029：新增显式角色模型策略开启闸门与纯模块测试；checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p07-r029`：产品闸门已落地，但 `npm test` **exit 1**（`naming.test.mjs`：本机 Pi 安装目录缺少 `role-models.ts`）。执行者回报「15 passed」是 naming 之前的 PASS 行数，不是命令成功。`finish-round failed`。checkbox 与 Status 仍未动。
- 2026-09-07 p07-r030：补齐本机 Pi 安装目录 `role-models.ts`；checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p07-r030`：安装目录 `role-models.ts` 与仓库 `cmp` 为 0；`npm test`/`typecheck`/`test:e2e`/`git diff --check` 均为 0，且含 `planner-only naming: PASS`；HEAD=`bc7bb4e858c77843f3b643250638e4b2d94a0e38`。与 `p07-r029` 的闸门一并 `finish-round accepted`。checkbox 与 Status 仍未动。未做 requested/resolved/actual 与真实五角色宿主 e2e。
- 2026-09-07 round p07-r031：补充策略开启时每次委派的 requested/resolved/actual（含 thinking）记录、未知/不匹配判定与不匹配后续受控启动停机；未做真实五角色宿主 e2e，checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p07-r031`：实现已接入，但要求的 orchestrate/index 接缝测试未写。`finish-round failed`。
- 2026-09-07 round p07-r032：补齐 role-models/orchestrate/index 的 requested/resolved/actual、未知不阻断与不匹配后停机接缝测试；checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p07-r032`：生产文件 mtime 未动；新增断言覆盖 `requested=`/`resolved=`/`actual=`、`未知` 不阻断、`不匹配` 后冻结停机句；工单 04 的 `unknown` 行与「无模型成本保证」仍在。`npm test`/`typecheck`/`test:e2e`/`git diff --check` 均为 0，含 `planner-only naming: PASS`。HEAD=`bc7bb4e858c77843f3b643250638e4b2d94a0e38`。与 r031 实现一并视为本切片已锁定。`finish-round accepted`。checkbox 与 Status 仍未动。未做真实五角色宿主 e2e。
- 2026-09-07 round p07-r033：通过公开 `pi-subagents/./preflight` 设计并执行五角色模型/thinking 契约核对；当前宿主 peer 缺少 `@earendil-works/pi-tui`，因此 E2E 明确打印 §G「角色模型启动契约未验证」并以 PASS 结束，未将插件 input 字段视为宿主生效；Root 仅验证 status requested 配置且未切换 `ctx.model`。checkbox 与 Status 未动。