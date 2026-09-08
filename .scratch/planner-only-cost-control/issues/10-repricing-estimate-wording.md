# 10: 换价文案改为同 token 用量换价估算

**What to build:** Usage 展示中「子进程用量按 Root 费率换价」的结果改称「同 token 用量换价估算」，并说明假设是子进程用量不变、仅替换费率；不再出现 upper bound，也不称其为实测 Root-only 成本或已实现节省。缺少必要用量或费率时显示不可估算而不是数字。费用来源、未知部分与分项继续可审计。

**Blocked by:** 08。

**Status:** done（2026-09-08 planner 独立核验，代码在 p06–p11 各轮已落地）

- [x] Usage 输出不含 upper bound 字样；估算行带假设说明。
- [x] 子进程模型或 Root 模型缺费率：该行显示不可估算及缺失项。
- [x] 未知值不显示为零；失败尝试的费用仍出现在分项中。
- [x] 分项合计与已知覆盖范围一致。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Story 21，阶段 B 决策第 3 条）。

- 2026-09-07 进入阶段 B（用户「下一步」，以 08 r3 为 A 门槛）。本票先派 `round_id=p06-r027` executor pi `w2E:pG`。checkbox 与 Status 未动。
- 2026-09-07 Planner 独立验收 `p06-r027`：`npm test=0`（15 files PASS）、`typecheck=0`、`test:e2e=0`（仅 §E/§F 宿主契约未验证，无 skip）、`git diff --check=0`、HEAD=`bc7bb4e858c77843f3b643250638e4b2d94a0e38`。fence 仅 `usage.ts` / `usage.test.mjs`。规格「同 token 用量换价估算」与「不可估算」已落地；`usage.ts` 无 upper bound。`finish-round accepted`。checkbox 与 Status 仍未动。

2026-09-08（planner claude-pD，纯核验，未改代码）：**四条全勾。** 证据在干净 HEAD `23d10a4` 的独立 worktree 上复跑（`npm run typecheck`=0、`npm test`=0）：

- 第 1 条：`usage.ts:841` 估算行为「同 token 用量换价估算：<金额>（假设子进程用量保持不变、仅替换费率）」；`usage.test.mjs:481/493` 两处 `assert.doesNotMatch(..., /upper bound/)` 分别守住有价与不可估算两条路径。
- 第 2 条：`usage.ts:837/843` 打印「不可估算（<缺失项>）」，缺失项逐条累积；`usage.test.mjs:491/504` 覆盖缺 Root 费率与缺子进程费率（含具体 model 名 `volcengine/glm-5-3`）两种。
- 第 3 条：`usage.test.mjs:493/506` 两处 `assert.doesNotMatch(..., /\$0\.00/)` —— 不可估算时**不显示为零**。失败尝试仍进分项：`usage.ts:797` 的 `for (const child of taskUsage.children)` **无任何按 outcome 的过滤**，`childOutcomeFromExitCode` 只记录不筛选。
- 第 4 条：`usage.ts:806-822` —— Root 费用未知时打印 `Total <金额> excluding Root (Root cost unknown, not included)`，全知时打印 `Root share of cost: N%   (cost unknown for 0 components)`。合计的口径与已知覆盖范围显式对齐，不把未知当零加进去。

round_id=claude-pD-2026-09-08-note-10
