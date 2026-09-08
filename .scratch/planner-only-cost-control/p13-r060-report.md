[轮次] round_id=p13-r060
pane: w2E:pE (cursor / executor)
HEAD: 88a4eb69841a8015330421d5bb6f2f0b67bdbaba（未提交）

## 1. 落账时机

挂在已有 `session_shutdown`（改成接收 `event, ctx`）。宿主 `emitSessionShutdownEvent` 会 await handler，异步写 jsonl 能跑完。
流程：按 reason 决定是否落账 → harvest 本会话 artifact 目录里尚未入账的 `*_meta.json` → persist session entries → 先写幽灵/未归属行 → 再写 store 里非终态 Task（`store.active()` 放最后，让「末条」是活动 Task）。
非终态行带 `incomplete: true`，`state` 仍是真实 Task 状态，不改成 completed/failed/blocked。
`flushIfTerminal` 路径保持每次进入终态就追加一行（blocked 后再 completed 仍写 completed）；shutdown 用 `terminalUsageLogged` 跳过「已经终态落过账」的 id。

## 2. 条款 5：reason 论证（读过 0.84.4 源码，不是猜）

`shouldFlushUsageOnShutdown`: **落账** `quit` / `new` / `fork` / `resume`；**不落账** `reload`；缺 reason 也不落账。

- `quit`：`agent-session-runtime.js` `dispose()` emit `reason: "quit"`。进程/会话结束，没有后继实例，不写 jsonl 就是 run5 那个洞。
- `new` / `fork` / `resume`：同文件 `teardownCurrent(reason, targetSessionFile)` 先 shutdown 再 `session.dispose()`，后继 `createRuntime` 打开的是**另一份 session file**。后继的 `session_start` → `loadSessionUsage` 读的是新文件，读不到本会话已经 persist 的 `planner-only-usage`。不在这里写 jsonl，本会话最后一段 children 就只活在即将被丢掉的实例里。
- `reload`：`agent-session.js` `reload()` emit `reason: "reload"`（**没有** `targetSessionFile`），`oldRunner.invalidate()`，再 `_buildRuntime`，然后对**同一** `sessionManager` emit `session_start` `reason: "reload"`。后继实例会 `loadSessionUsage` 把已 persist 的 entries 装回内存；之后的 quit/终态仍会写 jsonl。若 reload 也写 incomplete 快照：`terminalUsageLogged`/`openUsageLogged` 是实例内 Set，reload 后清空，后继再 quit 会再写同一份 incomplete —— 这是重复行，不是「我认为不会」。所以 reload 不写 jsonl，只 `restoreSuppressedTools()`（这正是原注释考虑的替换）。
- 缺 reason：本套 `index.test.mjs` 早段 `session_shutdown({}, ctx)` 只测还工具。宿主 `.d.ts` 里 `reason` 是必填，我 grep 到的 emit 点都带了 reason。缺省不落账以免把那条现有测试变成中途刷账。

## 3. RED 原文（最终用例，修复前）

用例：`index.test.mjs` p13-r060 invariant（`expectedMetaRunIds.every((id) => childRunIds.has(id))`）。
日志：`.scratch/planner-only-cost-control/p13-r060-red.log`

```
AssertionError [ERR_ASSERTION]: usage.jsonl last children runIds [] does not cover meta runIds ["r060-inv-meta"]
    at file:///home/tcuni-claw/pi/pi-planner-only/index.test.mjs:3668:9 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '=='
}
```
INDEX_EXIT=1

该断言修复后未改字。动手前 `grep -n "p11-r052" index.test.mjs` → **3462**（与派活钉死的 3462-3517 一致）。29(a) 未绑定 validator 块仍在其上方，一行未改。

## 4. git diff --numstat（完整）

```
10	1	.scratch/planner-only-cost-control/issues/35-no-final-ledger-flush-when-the-session-ends-non-terminal.md
146	1	index.test.mjs
97	10	index.ts
11	0	usage.test.mjs
12	0	usage.ts
```

我改的是后四份。issue 35 进工作区时已脏，本轮只读，未改。

## 5. 验收退出码

| 命令 | exit |
|---|---|
| slot cpu -- npm run typecheck | 0 |
| slot cpu -- npm test | 0 |
| slot cpu -- npm run test:e2e | 0 |
| git diff --check | 0 |

日志：`.scratch/planner-only-cost-control/p13-r060-accept.log`（各文件 PASS，e2e 有既有的 §F 预算宿主契约未验证提示，仍 PASS）。

## 6. slot 预检（未终止）

验收前 `.scratch/planner-only-cost-control/p13-r060-slot-audit.log`：
- PID 3917509  RSS 42.8G  CPU% 1694  COMM **pbbwa**  << 绕过了 slot
未杀。RED 前一次 audit 曾见 htvc，同样未杀。

## 7. 想改但没改

- 未改 `orchestrate.ts` / `task.ts` / `types.ts` / `notify.ts` / `spec.md` / 08 checkbox。
- 未把 `reload` 也落账（见 §2）。
- 未给幽灵行编造 TaskState；用 `unattributed: true` + `incomplete: true`，不写 state。

## 8. 条款 1–8 自评

1. 做到：非终态 shutdown 写 jsonl，`incomplete: true`，state 不是终态。
2. 做到：shutdown 前 harvest `*_meta.json`；invariant 用 `r060-inv-` 前缀的 meta runId 做 ⊇。
3. 做到：修复前该 invariant 失败，原文见 §3。
4. 做到：p11-r052 与 29(a) 块未改，全绿；ledger 仍按 runId upsert。
5. 做到：§2。
6. 做到：终态已 `flushIfTerminal` 的 id 进 `terminalUsageLogged`，shutdown 跳过。用例：abandon 后 quit，该 taskId 仍一行。
7. 做到：无活动 Task 的 unbound validator 写 `unattributed: true` 行，含 runId/cost，不静默消失。
8. 做到：未勾 08、未改 spec.md。
