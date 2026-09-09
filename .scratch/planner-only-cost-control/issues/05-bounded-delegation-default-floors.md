# 05: 有界委派默认 toolBudget 与 usageBudget 地板

**What to build:** 报告修正、纠偏、Validator、Explorer 这类有界委派在调用方和 TaskSpec 都没有给预算时，也带着默认的工具调用硬上限与用量（token、费用）硬上限启动；实现 Worker 首轮不设默认工具上限但必须有默认用量上限。调用方或 TaskSpec 有更严格限制时取更严者。默认值可在配置中覆盖但不能为空。委派结果里能看到本次生效的上限来自默认地板、调用方还是 TaskSpec。一个在已通过的测试上反复执行同一命令的纠偏 Worker 会在上限处被宿主停止，Root 收到停止原因而不是等到人工 kill。

**Blocked by:** None (can start immediately).

**Status:** done（p05-r021 + p14-r065，planner 复核后逐条勾选）

- [x] 无任何预算的报告修正委派：宿主实际启动参数含默认 toolBudget.hard 与 usageBudget（公开分发包内、有导出符号的模块验证；措辞经用户 2026-09-08 拍板放宽，见文末）。
- [x] 无任何预算的 Validator 与 Explorer 委派：同上；实现 Worker 首轮只含默认 usageBudget。
- [x] 调用方给出比默认更严的 usageBudget：生效值是调用方的；TaskSpec budget 比默认更严：生效值是 TaskSpec 的；两者都更宽松：生效值是默认地板。
- [x] 委派结果说明生效上限及来源。
- [x] 子进程因工具上限被停止时，Root 收到的结果包含停止原因，Task 状态不停留在 executing。
- [x] 默认数值集中在一处配置，可覆盖，设为空时启动报错。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 5，User Story 7，阶段 A 决策第 6 条）。证据：analysis P5（210 轮、207 次同一命令、约 $0.98、零护栏）。阶段 D 的 14 要在此基础上叠加累计余额。

Round `p05-r021`: 落地默认 toolBudget / usageBudget 地板。集中配置在 `floors.ts`，有界委派（纠偏/修正/Validator/Explorer）默认 toolBudget.hard=20, tokens.hard=40000, costUsd.hard=0.10；Worker 首轮仅默认 tokens.hard=100000, costUsd.hard=0.50；Reviewer 不设默认地板。更严者胜并在委派结果中注明来源 (floor/caller/taskSpec)。子进程因工具/用量上限停止时 Task 状态转 failed 并向 Root 报告原因。空或非法配置启动报错。E2E 显式核查并标记 §F 预算契约未验证。全部 15 组单测及类型检查均 PASS。

2026-09-08 planner 核对（claude-pD，只读审计，未改代码）：第 3–6 条已勾，证据是 `floors.test.mjs` 的 13 组用例（1 冻结常量、3 env 覆盖、4 非法值启动报错、5 Reviewer 无地板、6 Explorer/Validator 有界地板、7 Worker 首轮仅用量地板、9/10 更严者胜、11 更宽松者不能抬高地板、13 来源摘要）与 `orchestrate.test.mjs:4581`（工具上限停止时 Task 离开 executing 并报出停止原因）。

**第 1、2 条不勾**：这两条明写要「真实公开宿主入口验证」，而 `e2e.pi-subagents.test.mjs:290-313` 的 §F 段落在 `installedManifest.exports["./budget"]`／`["./preflight"]` 不存在时直接跳过，并打印「§F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)」。也就是说宿主实际启动参数里是否真的带上 `toolBudget.hard` / `usageBudget`，目前**没有任何测试证明**，只证明了插件这一侧算出了正确的值。这不是实现缺陷，是宿主没有可无模型调用的公开契约入口。要闭合这两条，得等 pi-subagents 暴露该入口，或改用一次真实子进程运行去读启动参数。

对 08 的影响：08 的「每次委派均在默认地板内」是从运行回执核对的，不依赖这两条，**不阻塞 08 重跑**。但 08 的 Blocked by 里写着 05，需在重跑前明确：05 按「插件侧已闭合、宿主侧待宿主支持」计。

2026-09-08（planner claude-pD）：**第 1、2 条继续留空，且这次能确定原因不是本机装配问题。** 同一天把 `@earendil-works/pi-tui` 装进宿主后，e2e 的 §E 与 §G 都从「未验证」转成真跑通过（详见工单 25），唯独 §F 原样打印「预算宿主契约未验证」。查 `e2e.pi-subagents.test.mjs:290-313`：§F 找的是 `installedManifest.exports["./budget"] ?? ["./preflight"]` 里的 `resolveSubagentBudgetContract`，而 pi-subagents 0.66.0 的 `exports` 共 14 个入口（`.`、`./background-work`、`./external-job-provider`、`./external-runs`、`./agents`、`./delegation`、`./capability-ceiling`、`./workflow-resources`、`./preflight`、`./control-channel`、`./intercom-bridge`、`./child-tool-plan`、`./shared-types`、`./project-panes`），**没有 `./budget`**，`./preflight` 也不导出该函数。

所以 §F 是**真正的 API 面缺口**，与 §E/§G 那种「依赖没装」不同类，装任何东西都不会变。要闭合这两条只有两条路：等 pi-subagents 暴露可无模型调用的 budget 契约入口，或改成起一次真实子进程去读它收到的启动参数（后者要花模型钱，需另行拍板）。**不因为单测全绿就勾。**

另注：`npm run test:release` 目前在 §F 未验证的情况下仍退出 0，与文件头 C01 的承诺不符 —— 已另开工单 26，本票不动。

round_id=claude-pD-2026-09-08-note-05

2026-09-08（planner claude-pD）：**第 1、2 条勾上，靠的是用户拍板的 F1，不是宿主新开了公开入口。**

用户 2026-09-08 就工单 36 拍板走 F1：断言 pi-subagents **公开分发包内、有导出符号、但不在 `exports` 映射里**的模块 `src/extension/schemas.ts`，并把本票这两条的「真实公开宿主入口验证」放宽为「公开分发包内、有导出符号的模块验证」。原措辞在 pi-subagents 0.66.0 下不可满足——14 个 `exports` 子路径没有一个能到达委派参数 schema。

p14-r065（pi `w2E:pG` 落地，planner 复跑核验并自行修正后提交 `a89c2ca`）之后，§F 实际证明了：

1. 宿主的委派工具参数 schema **确实声明**了 `toolBudget`（`hard` 必填、整数、`minimum: 1`、禁额外键）与 `usageBudget`（`tokens` / `costUsd` 各自 `hard` 必填、数值、`exclusiveMinimum: 0`、两层都禁额外键）——即宿主**接受**每次委派带的预算参数；
2. 由本插件 `applyRoleDelegation` 真造出来的 validator 载荷与 bounded worker 载荷（`toolBudget.hard=20`、`tokens.hard=40000`、`costUsd.hard=0.1`），在 `stripDelegationKeys` 之后、也就是**真正发出去的那个状态**下，通过宿主 schema 的 `Check`；四条否定用例（缺 `hard`／`hard=0`／`tokens` 缺 `hard`／多未知键）全部被拒；
3. 上游把这个内部路径挪走或改形状时，闸门**变红而不是变绿**：planner 把路径改名后 `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` 退出 1 并逐字打出 `FAIL — release gate requires §F contract coverage: 内部 schema 文件不存在: …`。

**仍未证明（不要读成已闭合）**：子进程运行时是否真的在 `hard` 处被宿主停下来。那需要一次真实子进程运行去读它收到的启动参数并跑到上限，要花模型钱，用户当时没选（工单 36 里的 F3），本轮不做。本票这两条按「宿主接受该参数形状」计，不按「运行时强制执行已验证」计。

`npm run test:release` 从 §F 的红转绿；§E / §G 的闸门分支与 `markContractUnverified`（工单 26）一字未动。

round_id=p14-r065

---

2026-09-09 cursor planner（w2E:pE）：F3 已闭合，补在「仍未证明」那句后面，**不改本票 checkbox**。

契约实跑（A2/A3，证据在 `p18-contract-run/evidence-extract.md`）：宿主接受 `usageBudget` 但不执行。tokens.hard=1 时子进程跑完 9.3k token；costUsd.hard=0.0001 时子进程花掉 $0.0022（22 倍）。第 1、2 条仍按 F1「宿主接受该参数形状」计，**不要读成运行时强制**。运行途中越线仍未专测。

`floors.ts` 的 hard 上限实际约束力全部来自本插件自己的记账。`PI_PLANNER_ONLY_HOST_ENFORCES_*` 保持默认 false。

round_id=cursor-pE-2026-09-09-note-05
