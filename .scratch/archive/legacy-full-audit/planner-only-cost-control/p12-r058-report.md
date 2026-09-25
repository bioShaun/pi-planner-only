[轮次] round_id=p12-r058
pane: w2E:pE (cursor / executor)
HEAD: 76689a34c981cf8ea0bb30b610a067eb39deccc7 (unchanged; no commit)

## 判据（占位串三种来源）

选 **合成串**：仅当 `placeholder === \`unbound-validator-${toolCallId}\`` 时写入 `accountingTaskId`。
- `specId` 与单个 `named[0]` 都是委派声明的 Task id，**不得改挂**（即使 store 里没有这条 id）。
- 若按 `store.get(placeholder)`：声明了 `T-002` 但 store 没有它时，会被改挂到 cwd 活动 Task，正好是工单禁止的路径。
- 合成串与 store.exists 不等价；本轮选合成串，因为「声明了真实 id」必须压过「当前 cwd 碰巧有活动 Task」。

已绑定 validator（`resolveValidatorReviewedTask` 返回了 Task）未改：`taskId = reviewed.taskId`，不设 `accountingTaskId`。

## 同 cwd 无活动 Task

只查 `store.activeForCwd(cwd)`，**不**抄 explorer 的 `?? active`。
无同 cwd 非终态 Task 时：**不写 `accountingTaskId`**，费用键仍是合成 `taskId`。
理由：工单禁止挂到别的 cwd；fence 也不许改 `index.ts`/`usage.ts` 去给幽灵 id 单开 jsonl 行。`writeUsageLog` 对 store 里不存在的 id 本就会 no-op。这不是静默丢弃委派记录（delegation 仍在、ledger 仍按合成 id 记 child），而是拒绝错挂。29(b) 会话兜底落账不在本轮。

## git diff --numstat（完整）

```
13	1	.scratch/planner-only-cost-control/issues/09-role-model-policy.md
37	0	.scratch/planner-only-cost-control/issues/29-oracle-children-never-enter-the-ledger.md
69	0	index.test.mjs
154	0	orchestrate.test.mjs
11	1	orchestrate.ts
```

我改过的只有后三份。前两份 `.scratch/issues/` 进工作区时已是脏的，本轮未碰（fence：工单文件只读）。`usage.test.mjs` 未改。未提交。

## RED（修复前，原文）

orchestrate.test.mjs:1106
断言：`assert.equal(orch.getDelegation("call-v-acct-synthetic")?.accountingTaskId, taskA.taskId)`

```
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
+ actual - expected

+ undefined
- 'T-20260908-581'

    at file:///home/tcuni-claw/pi/pi-planner-only/orchestrate.test.mjs:1106:9 {
  generatedMessage: true,
  code: 'ERR_ASSERTION',
  actual: undefined,
  expected: 'T-20260908-581',
  operator: 'strictEqual'
}
```
ORCH_EXIT=1

index.test.mjs:3435
断言：`assert.equal(oracleChildren.length, 1, JSON.stringify(failed[0].children))`

```
AssertionError [ERR_ASSERTION]: [{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"kind":"worker","pending":true,"source":"unavailable","agent":"worker"}]

0 !== 1

    at file:///home/tcuni-claw/pi/pi-planner-only/index.test.mjs:3435:9 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: 0,
  expected: 1,
  operator: 'strictEqual'
}
```
INDEX_EXIT=1

日志：`.scratch/planner-only-cost-control/p12-r058-red.log`

## 验收命令退出码

| 命令 | exit |
|---|---|
| npm run typecheck | 0 |
| npm test | 0 |
| npm run test:e2e | 0 |
| git diff --check | 0 |

日志：`.scratch/planner-only-cost-control/p12-r058-accept.log`
`index.test.mjs` 的 p11-r052 块一行未改，suite 全绿。

## slot 预检（未终止绕过进程）

`.scratch/planner-only-cost-control/p12-r058-slot-audit.log` / `p12-r058-slot-status.log`

绕过 slot（未杀）：
- PID 3821263  RSS 18.3G  CPU% 1729  COMM htvc
- PID 3239052  RSS 0.4G   CPU% 66.1  COMM agy

gpu 池当时有 1 个 running（pea-core62-gvcf-production-hold-oom），未动。cpu 池有空槽，验收走 `slot cpu`。

## Fence

想改但没改：无。`index.ts` / `usage.ts` / `task.ts` / `types.ts` / `report.ts` / `roles.ts` / `review.ts` / `package.json` / `spec.md` / 08 checkbox 均未动。
未做 29(b)（session_shutdown / flushIfTerminal）。
