# p18-r084 执行报告

## 基本信息
- round_id: `p18-r084`
- 开始 HEAD: `de76c3e4caba510fa71ed79b45bc19f2bbe832a0`
- 结束 HEAD: `de76c3e4caba510fa71ed79b45bc19f2bbe832a0`
- 未 commit、未 git add。

## 实现
- `index.ts:1123-1137`：策略开启时只给 `root:` 摘要追加冻结限定语；追加无条件真实 root 行，身份取 `rootModelIdentity(ctx.model) ?? selectedModel`；仅在已知且不一致时追加冻结不一致行。`rootRateWarning` 未改动。
- `index.test.mjs:763-802`：新增限定语、关闭策略真实 root、不一致、一致四类断言；既有断言未删除或改写。

## git status --short 原文
```
 M .scratch/planner-only-cost-control/deferred-backlog.md
 M .scratch/planner-only-cost-control/issues/05-bounded-delegation-default-floors.md
 M .scratch/planner-only-cost-control/issues/09-role-model-policy.md
 M .scratch/planner-only-cost-control/issues/18-cost-comparison-protocol.md
 M .scratch/planner-only-cost-control/issues/19-real-cost-comparison-experiment.md
 M .scratch/planner-only-cost-control/issues/25-host-contract-verification-gap.md
 M index.test.mjs
 M index.ts
?? .scratch/planner-only-cost-control/p18-r084-status-wording.md
```
这些 `.scratch` 变更均为 planner 既有变更，未触碰、未还原。

## diff stat 原文
```
.../planner-only-cost-control/deferred-backlog.md  | 14 ++++----
 .../issues/05-bounded-delegation-default-floors.md | 10 ++++++
 .../issues/09-role-model-policy.md                 | 10 ++++++
 .../issues/18-cost-comparison-protocol.md          | 21 +++++++++---
 .../issues/19-real-cost-comparison-experiment.md   | 11 +++++++
 .../issues/25-host-contract-verification-gap.md    | 23 +++++++++++---
 index.test.mjs                                     | 37 ++++++++++++++++++++++
 index.ts                                           | 20 ++++++++++--
 8 files changed, 127 insertions(+), 19 deletions(-)
```

## 验收
日志目录：`.scratch/planner-only-cost-control/`，所有命令均经 `slot cpu --`（slot 预检日志见 `p18-r084-slot-audit.log`、`p18-r084-slot-status.log`）。

1. `npm run typecheck`: exit `0`。尾部：`tsc --noEmit`，`EXIT_CODE=0`。详见 `p18-r084-typecheck-final.log`。
2. `npm test`: exit `1`，符合预期。`planner-only architecture: PASS`；唯一 AssertionError 为 `naming.test.mjs:26`：`extension install is missing ledger-store.ts`。详见 `p18-r084-npm-test-rerun.log`。
3. `PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e`: exit `0`；输出 `planner-only pi-subagents E2E: PASS`。详见 `p18-r084-e2e-final.log`。
4. `git diff --check`: exit `0`。详见 `p18-r084-diff-check-final.log`。
5. `git diff -- index.test.mjs | grep '^-.*assert'`: 空，grep exit `1`（无匹配）；未绕过或删除既有断言。

## 变异失败证明
每次均运行 `slot cpu -- node --experimental-strip-types index.test.mjs`，exit `1`，失败输出原文尾部保存在对应日志：

- `p18-r084-mutation-1.log`：限定语改为 `（错误限定语）`；原文含 `expected: /（策略配置值；root 不经委派，此值不改变实际运行的模型）/`、`operator: 'match'`。
- `p18-r084-mutation-2.log`：真实 root 行加入错误前缀；原文含 `expected: /实际运行的 root: 未知（宿主未提供 ctx\.model）/`、`operator: 'match'`。
- `p18-r084-mutation-3.log`：不一致提示改为 `错误不一致提示`；原文含 `expected: /root 策略配置与实际运行的模型不一致/`、`operator: 'match'`。
- `p18-r084-mutation-4.log`：反向变异一致性条件，使一致场景也输出提示；原文含 `expected: /root 策略配置与实际运行的模型不一致/`、`operator: 'doesNotMatch'`。

四次变异均已逐一恢复；最终 `git diff --check` 为 0。

## 假设、推迟与降级
- 假设策略 root 配置字符串与实际 display 字符串使用同一 `provider/id` 或 id 表示，符合现有 `configuredRoleModelSummaries` 与冻结规格。
- 假设 `ctx.model` 的类型继续由现有 `rootModelIdentity` 处理；未新增身份函数。
- 假设“策略关闭”通过 `PI_PLANNER_ONLY_ROLE_MODELS=0` 覆盖策略开启环境，符合现有解析逻辑。
- 没有推迟项；没有绕过的断言；没有降级实现或验收命令。
- 没有修改 `role-models.ts`、`spec.md`、issues、`deferred-backlog.md`、`package.json`、`architecture.test.mjs`。

## 数字测量命令
- HEAD/status：`git rev-parse HEAD`、`git status --short`。
- diff 行数：`git diff --stat`。
- 空白错误：`git diff --check`。
- 既有断言删除检查：`git diff -- index.test.mjs | grep '^-.*assert'`。
- 各验收 exit code：每个日志由 `code=$?` 与 `EXIT_CODE=%s` 记录。
- 变异 exit code：各 `p18-r084-mutation-{1..4}.log` 中的 `EXIT_CODE=1`。
