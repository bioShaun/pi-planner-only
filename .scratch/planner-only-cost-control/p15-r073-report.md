# p15-r073 执行报告（工单 15-a）

来自执行者 pane `w2E:pE`。请据此收尾（checkbox / 工单批注由你写）。不要改已落地的补丁和测试，除非你认为验收不成立。

## 结论

冻结补丁已逐字落地；X1–X12 测试已追加；四条验收通过（typecheck 0 / npm test 1 且仅 naming 预期失败 / e2e 0 / git diff --check 0）。未 commit。

## 改了哪些文件

- 补丁（与 `p15-r073-proto.diff` 实现部分逐字一致）：`index.ts` `orchestrate.ts` `reservations.ts` `types.ts` `usage.ts`，以及 `orchestrate.test.mjs` 里那一条既有断言
- 新增测试：`usage.test.mjs`（X1–X6）、`orchestrate.test.mjs`（X7–X10）、`architecture.test.mjs`（X11；X12 沿用既有断言未重复）
- 日志：`.scratch/planner-only-cost-control/p15-r073-*.log`

`git status --porcelain` 原样：

```
 M architecture.test.mjs
 M index.ts
 M orchestrate.test.mjs
 M orchestrate.ts
 M reservations.ts
 M types.ts
 M usage.test.mjs
 M usage.ts
?? .scratch/planner-only-cost-control/15a-round1.md
?? .scratch/planner-only-cost-control/p15-probe/r073-debt-baseline.mjs
?? .scratch/planner-only-cost-control/p15-r073-proto.diff
```

（`p15-r073-*.log` 在 scratch 下，porcelain 未列出，多半被 ignore。）

`git diff -- usage.ts orchestrate.ts index.ts types.ts reservations.ts` 与 proto 去掉 `orchestrate.test.mjs` 后的实现 hunk **逐字相等**。

## 四条验收

1. `slot cpu -- npm run typecheck` → **0**
   ```
   > tsc --noEmit
   TYPECHECK_EXIT:0
   ```
2. `slot cpu -- npm test` → **1**
   前 15 个套件全 PASS：policy / roles / floors / role-models / task / report / review / notify / usage / orchestration / evidence / git_audit / extension / workspace snapshot / architecture
   唯一失败：
   ```
   AssertionError [ERR_ASSERTION]: extension install is missing reservations.ts
   ```
   来自 `naming.test.mjs:26`
3. `slot cpu -- bash -c 'PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e'` → **0**
   ```
   planner-only pi-subagents E2E: PASS
   E2E_EXIT:0
   ```
4. `slot cpu -- git diff --check` → **0**

## X12

`architecture.test.mjs` 既有三条仍在：`doesNotMatch(orchestrate, /UsageLedger|recordRootTurn|recordChild/)`。architecture 套件 PASS，未新增重复断言。

## X1–X11 逐条失败证明

破坏的都是实现。Usage 用隔离 snippet，避免 X1 吞掉 X2。完整正文在 `.scratch/planner-only-cost-control/p15-r073-x-fail.log`。

| 断言 | 破坏 | AssertionError 首行 |
|---|---|---|
| X1 known===0.12 | costKnown 不加 costDebt | `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` → `0 !== 0.12` |
| X1 debt===0.12 | cost 维 debt 传 0 | `0 !== 0.12` |
| X1 remaining===0.38 | remaining=limit | `0.5 !== 0.38` |
| X2 tokens.known===39000 | tokenKnown 忽略 childTokens | `0 !== 39000` |
| X2 tokens.debt===0 | 已解析孩子仍上报 leftover tokensDebt | `40000 !== 0` |
| X2 costUsd.debt===0.12 | costDebt 只在 pending 时计 | `0 !== 0.12` |
| X2 unknownParts===1 | 未知费用只在 pending 时计 | `0 !== 1` |
| X3 length===1 | 只在 existing.pending 时 replace | `2 !== 1` |
| X3 tokens.known===39000 | resolved→resolved 把 token 字段相加 | `78000 !== 39000` |
| X3 tokens.debt===0 | 二次 resolved 把 leftover tokensDebt 累加并计入 debt | `80000 !== 0` |
| X3 costUsd.known===0.12 | 二次 resolved 把 costDebtUsd 相加 | `0.24 !== 0.12` |
| X3 costUsd.debt===0.12 | 同上，隔离到这一条 | `0.24 !== 0.12` |
| X3 unknownParts===1 | resolved→resolved 追加第二行 | `2 !== 1` |
| X4 known!==0.12+0.0731 | upsert 把旧 cost/debt 加到 0.0731 | `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly unequal to:` → `0.1931` |
| X4 known===0.0731 | costKnown 忽略 child.costUsd | `0 !== 0.0731` |
| X4 debt===0 | 把 costKnown 当成 debt 上报 | `0.0731 !== 0` |
| X4 unknownParts===0 | unknownParts=children.length | `1 !== 0` |
| X5 remaining<0 | Math.max(0, limit-known) | `false !== true` |
| X6 tokens.debt===0 | costUsd 已知时仍计 leftover tokensDebt | `40000 !== 0` |
| X6 costUsd.debt===0 | costUsd 已知时仍计 leftover costDebtUsd | `0.12 !== 0` |
| X7 费用行含估算注记 | debt>0 的注记清空 | `false !== true` @ orchestrate.test.mjs:5358 |
| X8 不含 `剩余 $0.3700（其中` | 已用注记保留，行尾再拼一段 `剩余 $0.3700（其中` | `true !== false` @ 5360 |
| X9 含 `剩余 -$0.0300` | 负数走 `$${value.toFixed(4)}` | `false !== true` @ 5380 |
| X9 不含 `$-0.0300` | 正确 `-$0.0300` 后再拼一个 `$-0.0300` | `true !== false` @ 5381 |
| X10 by-role 含负债 | by-role 不加 debt | `false !== true` @ 5400 |
| X11 不再含两参数 `toolCallId: undefined` | 恢复两参数 `pendingChild(record.kind, { agent, toolCallId: undefined })` | `true !== false` @ architecture.test.mjs:93 |
| X11 每个调用都带 key | 第一处改成 `{ agent: delegation.agent }` | `AssertionError [ERR_ASSERTION]: pendingChild call is unkeyed: pendingChild(` |
| X11 仍有调用 | `pendingChild(` 全部改名 | `AssertionError [ERR_ASSERTION]: pendingChild must still be called from the adapter` |

## slot audit / status

发现绕过 slot 的重进程，**没有杀**：

- 启动前：`htvc` PID 45086 RSS 20.8G CPU% 1441；`agy` PID 119930 RSS 0.2G
- 验收前：`pbbwa` PID 159090 RSS 47.4G CPU% 1599；`agy` PID 119930 RSS 0.1G

cpu 池当时没有 running 作业，本轮单槽串行。完整输出：`.scratch/planner-only-cost-control/p15-r073-slot-audit.log`

## 工单里有问题的地方（照直说）

1. **X11 指定的字面量是空转的，除非连第三参一起拆掉。** 补丁后调用是 `pendingChild(record.kind, { agent, toolCallId }, grantedDebt(record))`。把 `toolCallId` 改成 `undefined` 得到的是 `..., { agent, toolCallId: undefined }, grantedDebt(record)`，**并不包含** 工单写的两参数字符串 `pendingChild(record.kind, { agent, toolCallId: undefined })`（`)` 紧跟在对象后面）。要让那条 includes 失败，必须恢复成两参数调用。正则那条才咬得到三参数带 `undefined` 的形态。我两条都留了。

2. **X7 和 X8 在同一行上打架。** X7 的 needle 含 `剩余 $0.3700，未知项 1 项`。把注记真的挪到「剩余」后面时，X7 先失败，X8 根本跑不到。X8 只能靠「已用注记仍在 + 行尾再复制一段 `剩余 $0.3700（其中`」来单独失败。若你要 X8 在全文件顺序里对「注记挂错位置」过敏，X7 的 needle 不该包含剩余那一段。

3. **X3 的「与 D2 逐一相等」在 upsert 是真替换时，和 X2 是同一份 summarize 形状。** 不把 upsert 改成 merge/append，这些数字断言不会先于 X2 失败。我用 merge/append 破坏证明它们不是空转，但全文件顺序下 X2 会先倒。这不是实现 bug，是验证点重叠。

4. **X4 的 `known !== 0.12+0.0731` 对「清记录到达」默认不会被「累加 leftover debt」打到**（到达记录没有 leftover 字段）。它咬的是 upsert **相加**（得到 0.1931）。`=== 0.0731` 才是替换后的值。两条一起才证明「替换不是叠加」，单独 notEqual 在「记 0」时也会过。

5. `orchestrate.test.mjs` 的 `console.log("planner-only orchestration: PASS")` 在 3715 行，X7–X10 在文件末尾。这是原文件结构，不是我引入的。失败时会先打印 PASS 再抛；exit code 仍对。

没有自己发明「一有负债就拒绝」。没有 commit。
