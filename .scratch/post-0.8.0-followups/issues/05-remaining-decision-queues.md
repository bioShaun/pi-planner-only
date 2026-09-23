# 05: 剩余决策/分诊队列索引（不直接派实现）

**Status:** backlog / ready-for-human（索引票）
**Type:** tracker
**Blocked by:** 各子票的人类决策
**来源：** 2026-09-23 planner 巡检

## 目的

汇总「不是今晚就能自信修」的队列，避免和已开 PR 的确定项混淆。

## 队列

### A. request-stop（`.scratch/request-stop-p0-20260919/issues/`）

- `01` durable request-stop — `ready-for-human`
- `02` semantic no-progress — `ready-for-human`
- `03` trusted request resume — `ready-for-human`
- `04` revalidation dispatch accounting — `ready-for-human`

需要产品拍板后再派实现；drafts/ 下另有 `needs-info` 草稿，勿当可派票。

### B. stop-evidence reader recovery（`.scratch/stop-evidence-reader-recovery/issues/`）

- `01`–`06` 多为 `needs-triage`
- `07` host e2e acceptance — `ready-for-agent`（依赖分诊结果）

### C. runaway 上游（同战役 `05-upstream-update-usage-breakdown.md`）

- `ready-for-human`：usage breakdown 上游提案，见 `UPSTREAM-PROPOSAL.md`

### D. 环境门禁（长期）

- 沙箱 spawn `EPERM`：当环境故障报，禁止为迁就弱化断言（`AGENTS.md` / 既有 testing rule）。
- `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`：peer/`pi-tui` 布局问题 → 正式 release 环境或本机终验，不作「单测绿=release 绿」。

### E. 旧 cost-control backlog

- 票 44（意图 vs 宿主 tool plan）仍 backlog；冲突读 `deferred-backlog.md` 最新 G 节。

## 期望

维护者按 A→B→C 排期决策；本票只做索引，不替代子票正文。

## Comments

- 2026-09-23 planner 开票。确定项（清 stateReason、测试 TMPDIR）另 PR，不在本票范围。
