# 07: Root 模型无费率时启动与 status 警告

**What to build:** Root 使用的模型在 pricing 表里没有费率时，扩展启动时和 `/planner-only status` 都显示一条警告，说明 Root 费用将记为未知、不会计入合计，并指出费率文件位置与覆盖方式。Usage 记录继续标记未知，不把未知按零显示。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Root 模型无费率：启动通知与 status 输出各含一条警告，内容包含模型名与费率文件路径提示。
- [ ] Root 模型有费率：不出现警告。
- [ ] 会话中途 Root 切换到无费率模型：下一次 status 出现警告。
- [ ] Usage 汇总里 Root 费用显示未知，合计标明不含 Root。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 7，User Story 9，阶段 A 决策第 9 条）。证据：analysis P7。

- p06-r024 (pi, w2E:pG): 实现完成。`pricingPath()` 抽成与 `loadPricingTable` 共用；`hasUsableRate()` 复用 `lookupRates`+`tableCost` 判定；`session_start` / `model_select` / `/planner-only status` 接入冻结警告文案；`renderUsage`/`renderUsageLine` 在 Root 费用未知时显示 `cost unknown` 且合计标 `excluding Root`。验收 `npm test`、`npm run typecheck`、`npm run test:e2e` 三组均 exit 0。checkbox 与 Status 未动。
