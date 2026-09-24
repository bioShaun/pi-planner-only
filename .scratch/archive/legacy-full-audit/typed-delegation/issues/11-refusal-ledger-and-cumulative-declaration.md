# 11: 票 10 宿主验收留下的两处账本/证据缺陷 —— 被拒的 Root verdict 不再混进 `reviews`；修正轮累计声明的 changedFiles 不再算 over-reported

Status: done（2026-09-16；三轮；交回 ../11-handback.md）
Blocked by: 10（done，6db47b0）
Type: bug

**What to build：** 两处独立的小修，各一轮，最后一轮宿主复验。(D) `planner_verdict` 被 `rootVerdictRefusal` 拒绝时，`recordRootVerdictRefusal`（orchestrate.ts:971）把一条 `verdict: <被拒的值>`、`source: "root"` 的行写进 `task.reviews`。`reviews` 的三个读者都把它当成真 verdict：orchestrate.ts:1095 用 `reviews.at(-1)` 判断 Root 是否在推翻 reviewer（被拒行挡在前面 → 推翻记录 `overrides` 丢失）；usage.ts:1548 取最后一条 root/operator 行当 `statuses.rootVerdict`（host-10/16b-p1-ledger.json：Root 从未落过 verdict，导出却记一条 `pass`）；usage.ts:1543 把它计入 `statuses.reviewResult`。改法：拒绝记录搬到 TaskRecord 新数组 `verdictRefusals`，`reviews` 只留被应用的 ReviewResult。(E) `compareEvidence`（evidence.ts:1190）忽略 `options.priorTruthPaths`——该字段在 CompareEvidenceOptions 里已有 E01 注释「restating them is not an over-report」，`compareExecutionTruth` 也已按它豁免（evidence.ts:1682、:1693），但 `compareEvidence` 既不消费它，delegate.ts:496 也没把已算好的 `priorTruthPaths`（:484）传进去。结果：修正轮 worker 把 changedFiles 报成任务累计集合就触发「over-reported / unreliable declaration」→ unexplained → revalidate（host-10/26-n1-status.txt:15；票 10 第三跑靠 packet constraint 绕过）。改法：`compareEvidence` 消费 `priorTruthPaths`，两个调用点都传。

## 现状（写票时核过的事实）

1. `recordRootVerdictRefusal`（orchestrate.ts:970-983）写 `{taskId, verdict, summary: "refused: …", findings: [], evidenceFresh: false, requestedVerdict, refusedReason, refusalKind, executionId?, source: "root"}` 到 `store.recordReview`。`ReviewResult.refusedReason` / `refusalKind`（types.ts:547-548）的唯一写者是这里，唯一读者是 usage.ts:1545。`requestedVerdict` 另有写者 orchestrate.ts:1251，保留。
2. `reviews` 读者：task.ts:1743 `annotateReviewDecision`（只在 advanceReview 后调用，拒绝路径 throw 在前，不受影响）；orchestrate.ts:862 `renderTaskStatus` 的 Reviews 行；orchestrate.ts:1023 `some(source === "reviewer")`（不受影响）；orchestrate.ts:1095 `previous = reviews.at(-1)` 推翻判定（受影响）；usage.ts:1539-1549 导出（受影响）。
3. `TaskRecord`（task.ts:1114 `reviews: ReviewResult[]`）由 `create`（task.ts:1282）初始化；账本恢复走 `store.restore(record)`（orchestrate.ts:367）直接采用账本 JSON，没有逐字段补默认值——旧账本没有新字段，读者必须容忍 `undefined`。
4. `CompareEvidenceOptions`（evidence.ts 约 :1095-1130）已含 `reportOnly`、`additionalWorktreeRoots`、`priorTruthPaths`、`readOnly`；`compareEvidence` 只用了前两个和 readOnly / scope / superseded。`compareExecutionTruth`（:1491）在 :1647 归一化 priorTruth，:1682 从 extraDeclaredPaths 豁免，:1693 从 missingPaths 豁免。
5. delegate.ts:484-493 为 `compareExecutionTruth` 算了 `priorTruthPaths`（排除本 execution、auxiliary、reportOnly、空 truthPaths），:496 的 `compareEvidence` 没传；delegate.ts:776（review 路径）的 `compareEvidence` 同样没传，且那里没有算 priorTruthPaths。
6. 单测现状：`recordRootVerdictRefusal` 零覆盖（`grep -n recordRootVerdictRefusal *.test.mjs` 为 0）；evidence.test.mjs:360/913/982 覆盖 over-reported 的既有行为，必须保持；delegate.test.mjs:520-537 有 request_changes 修正轮用例。
7. README.md:270 / README.zh-CN.md:166 列了导出 `statuses` 的键名（含 refusalKind）——键名不变，不用改。

## 范围

**改**（D）：types.ts、task.ts、orchestrate.ts、usage.ts、orchestrate.test.mjs、usage.test.mjs、ledger-store.test.mjs（若加恢复用例）；（E）：evidence.ts、delegate.ts、evidence.test.mjs、delegate.test.mjs、README.md、README.zh-CN.md。
**不改**：policy.ts、index.ts（planner_verdict handler 的 throw 文案不变）、review.ts、floors.ts、concurrency.ts、报告 schema（delegate.ts:128 附近的 Type 定义）。
**新建**：`.scratch/typed-delegation/host-11/`（第 3 轮宿主证据）、`../11-handback.md`。

## 设计

### D1 拒绝记录单独成表
- types.ts：新增 `export interface RootVerdictRefusalRecord { taskId: string; requestedVerdict: ReviewVerdict; kind: RootVerdictRefusalKind; reason: string; executionId?: string; at: string }`；从 `ReviewResult` 删 `refusedReason` 与 `refusalKind` 两个字段（保留 `requestedVerdict`、`appliedDecision`）。
- task.ts：`TaskRecord` 加 `verdictRefusals?: RootVerdictRefusalRecord[]`（可选，兼容旧账本）；`create` 初始化为 `[]`；`TaskStore` 新增 `recordVerdictRefusal(taskId, record)`（`(record.verdictRefusals ??= []).push(...)` + `touch`），`at` 由 store 的 `now()` 填。
- orchestrate.ts：`recordRootVerdictRefusal` 改调 `store.recordVerdictRefusal`，不再写 `reviews`；`renderTaskStatus` 在 Reviews 行后加一行 `Refused verdicts: <n> (<kind>, …)`（只在 n>0 时输出）。
- usage.ts:1539-1549：`statuses.refusalKind` 改从 `task.verdictRefusals ?? []` 的 `kind` 计数；`reviewResult` / `rootVerdict` 只看 `reviews`（代码不变，行为自然修正）。
- 测试：orchestrate.test.mjs 加一段——(a) strict task + reviewer `request_changes` 行 → `recordRootVerdictRefusal(task, "pass", {kind: "fresh-review-pending", reason: "x"})` → `reviews.length` 仍为 1、`verdictRefusals.length === 1` 且 `kind === "fresh-review-pending"`、`renderTaskStatus` 含 `Refused verdicts: 1`；(b) 紧接着 `recordRootVerdict(task, "pass", "override")` → `overrides.length === 1`（修前会因 at(-1) 是被拒行而为 0）。usage.test.mjs 加一段：一个 task 带 `reviews: [reviewer pass]` + `verdictRefusals: [terminal-state]` 导出 → `statuses.reviewResult.pass === 1`、`statuses.refusalKind["terminal-state"] === 1`、`statuses.rootVerdict` 为空对象。ledger-store.test.mjs（或 orchestrate.test.mjs）加一条：restore 一个没有 `verdictRefusals` 字段的记录后 `renderTaskStatus` 与 usage 导出都不抛。

### D2 `compareEvidence` 消费 priorTruthPaths
- evidence.ts `compareEvidence`：在 `extraDeclaredPaths` 循环（:1367-1371）前按 :1647-1650 同样方式归一化 `priorTruth`；`extraDeclaredPaths` 增加 `!priorTruth.has(path)` 条件；`missingPaths` 循环（:1385-1392）增加 `if (priorTruth.has(path)) continue;`。:1183 的注释补一句：restating paths attributed to earlier executions of the same Task is not an over-report。
- delegate.ts:496：加 `...(priorTruthPaths.length > 0 ? { priorTruthPaths } : {})`。delegate.ts:776 前：按 :484-486 同样的过滤从 `fresh.executions` 算 `priorTruthPaths`（排除 `latest.executionId`、auxiliary、reportOnly、空 truthPaths），传给 `compareEvidence`。
- 测试：evidence.test.mjs 加一段——base 干净、current 只有 `src/greet.test.js` 新脏；report.changedFiles = `["src/greet.js", "src/greet.test.js"]`；不传 priorTruthPaths → `reasons` 匹配 /over-reported/、`fresh === false`（既有行为）；传 `priorTruthPaths: [<abs>/src/greet.js]` → 无 /over-reported/、无 /no longer present/、`fresh === true`。delegate.test.mjs：若 :520-537 的修正轮骨架能追加第二次 worker 执行，加一条累计声明不再 revalidate 的用例；骨架不够就在报告里说明，不强求。
- README.md / README.zh-CN.md：在讲 attribution / over-reported 的段落加一句（中英各一）：修正轮 changedFiles 可以复述本 Task 早前执行已归因的路径，只有从未归因给本 Task 的路径才算 over-reported。

### D3 宿主复验（第 3 轮）
按 ~/.claude 记忆里的 host-run 配方，`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`：(a) P1 重跑到 completed 后 Root 再发一次 `planner_verdict pass` → 账本 `reviews.length === 1`（reviewer 那条）、`verdictRefusals.length === 1`（terminal-state）、`/planner-only status`（或 render-status）含 `Refused verdicts: 1`、usage export `statuses.rootVerdict` 为空；(b) N1 重跑，修正 packet **不带**「changedFiles 只列本轮」constraint，worker2 累计声明时 `lastComparison.reasons` 不含 over-reported，流程到 completed、git_commit 成功。

## 验收（全票）
1. `npm run typecheck && npm test` exit 0。
2. `git diff -- '*.ts' | grep -E '^\+.*(JSON\.parse|\.match\(|new RegExp|\.split\()'` 0 行。
3. `git grep -nE 'refusedReason|refusalKind' -- '*.ts' ':!.scratch'` 只剩：types.ts 的 `RootVerdictRefusalRecord`/`RootVerdictRefusalKind` 定义、orchestrate.ts 的写者、usage.ts 的导出键 `refusalKind`。
4. `git grep -n 'store.recordReview' -- orchestrate.ts` 只剩 :1257 那一处（recordRootVerdict）。
5. `git grep -n priorTruthPaths -- delegate.ts evidence.ts` 显示 compareEvidence 的两个调用点都传、compareEvidence 体内有消费。
6. D3 两个宿主断言成立，证据在 host-11/。
7. `git diff --check` 空。
