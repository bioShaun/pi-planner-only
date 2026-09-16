# Ticket 11 交回 — 拒绝账本 verdictRefusals、修正轮累计声明豁免、D3 宿主复验

基线 6db47b0（票 10 提交）；执行于 2026-09-16，herdr-pair 第 3 期前两轮（规划/审核 wM:pF claude，执行 wM:pC devin）+ 第 3 轮由 devin 本 pane 直接执行（用户指示不交接）。全部改动在工作树，**未提交**（提交留给操作者）。

## 0. 需操作者知道的事

1. **发现 F-11-1（新票候选）：`usage export` 的 `statuses` 段在宿主上是死代码。** `exportSessionEvidence`（usage.ts:1530）按 `task.rootSessionId ?? task.sessionId === rootSessionId` 选 Task，而 `TaskRecord` 从 create/restore/persist 全链路没有这两个字段——`selectedTasks` 恒空，`statuses` 各桶恒 `{}`（host-11/18-p1-usage.txt 原值）。票 11 D3(a) 要求的 `rootVerdict` 为空**成立**（空集语义）；但 `reviewResult`/`refusalKind` 的宿主断言不可满足，目前只有单测覆盖（usage.test.mjs:1032 注入合成 `rootSessionId`）。修复方向：TaskRecord 补 session 归属字段，或选择器改读 `usage.children[].ownerRootSessionId`。
2. **D2（累计声明豁免）在宿主上未被实际触发**：N1 修正轮 worker2 的 `changedFiles` 只报了本轮 `["src/greet.test.js"]`，没做累计声明，over-reported 豁免路径没走到。按票面规则记「D2 仅单测覆盖」，不算 FAIL（host-11/22-n1-worker2.json、27-n1-ledger.json `lastComparison.reasons === []`）。
3. **N1 reviewer 首跑 `structured_output_failed`**（子运行未调 structured_output 收尾，run=a6e3222d，host-11/23-n1-reviewer.json），Task 停 reviewing 未 park；按 10-r3 的一次重试先例重派后 pass → completed（23b）。pi-subagents 侧的偶发收尾失败，本次一单，复发再开观察票。
4. **两处一行级清理随本轮落地**：evidence.ts compareEvidence docstring 里 10-r6 已删比较块的过期段落（原 :1188-1191 含分隔空行）；freeze-mn-fixtures.mjs:150 的 `details.refusalKind` 搬运行（该字段已无写者）。注意 `git grep status-hash evidence.ts` 仍剩 :1853 一处——那是 `checkReportFreshness` 现存机制的注释，非过期内容。
5. 一次越界都没有；三轮无 commit / stash / push。

## 1. 承接项逐项

| 项 | 裁定 | 落点 |
|---|---|---|
| D 被拒 Root verdict 混入 reviews | 已收 | `RootVerdictRefusalRecord` + `task.verdictRefusals`（types.ts / task.ts）；`recordRootVerdictRefusal` 改写新表（orchestrate.ts）；`renderTaskStatus` 加 `Refused verdicts:` 行；usage.ts `statuses.refusalKind` 改读新表，`reviews` 只含被应用的 ReviewResult |
| E 修正轮累计声明 over-reported | 已收（单测级） | `compareEvidence` 消费 `priorTruthPaths`（evidence.ts）；delegate.ts 两个调用点都传；README 中英各一句；宿主未触发，见 §0.2 |
| nx-04 refusal-kind-enum 状态 | 补翻 done | `.scratch/nx-followups/issues/04-refusal-kind-enum.md` Status 行 |

## 2. 宿主验收（host-11/，`PI_PLANNER_ONLY=1 PI_PLANNER_ONLY_REQUIRE_REVIEW=1`）

| 例 | 结果 | 关键原值 |
|---|---|---|
| P1 完整生命周期 + 终态拒绝 | PASS | T-20260916-004：worker completed → reviewer pass → accept → `state=completed`；随后 Root `planner_verdict pass` 被 `planner_verdict refused (terminal-state, …)` 拒；账本 `reviews.length===1`（reviewer）、`verdictRefusals.length===1`（kind=terminal-state, requestedVerdict=pass, at=2026-09-16T02:59:25.154Z）；render-status `Refused verdicts: 1 (terminal-state)`；`git_commit` 293866f 只含 src/greet.js + src/greet.test.js，porcelain 空 |
| N1 request_changes → 修正 → pass | PASS（一次 reviewer 重派） | T-20260916-005：`changes_requested`（round 1/3）→ 修正后 `reviewing`、`executions=2`、`lastComparison.reasons=[]` → reviewer pass → `completed`（reviewRound 终值 1）→ `git_commit` 69e8188 只含两文件；reviews = `[request_changes (root), pass (reviewer)]` |
| D3(a) usage export | 票面成立 / 加强断言不可满足 | `statuses` 全 `{}`（rootVerdict {} ✓；reviewResult/refusalKind 空因 F-11-1） |
| D3(b) D2 累计声明 | 未触发 | worker2 `changedFiles=["src/greet.test.js"]`（仅本轮）→ 豁免路径未走，仅单测覆盖 |

账本 md5：本轮只新增 T-20260916-004 / T-20260916-005 两个 Task 文件，已有 138 个文件零变化（host-11/01↔03）。

## 3. 新票候选

- **F-11-1「usage export statuses 宿主死路径」**（见 §0.1）：export 选择器与 TaskRecord 字段脱节；不修则 statuses 段永远是空表。
- 观察项（不开票）：reviewer `structured_output_failed` 偶发（一票一例证）；N1 两 worker 共 ~3.80M tokens 完成小任务——恰是票 12 WRC 的目标形态，供 envelope 校准参考。

## 4. 票面验收清单

1. `npm run typecheck && npm test` exit 0 —— PASS
2. parse-grep（`JSON.parse|.match(|new RegExp|.split(` 新增行）0 —— PASS
3. `git grep -nE 'refusedReason|refusalKind' -- '*.ts'` 只剩定义/写者/导出键 —— PASS（types.ts RootVerdictRefusal*、orchestrate.ts 写者、usage.ts 导出键）
4. `git grep -n 'store.recordReview' -- orchestrate.ts` 只剩 recordRootVerdict 一处 —— PASS
5. `priorTruthPaths` 两调用点都传 + compareEvidence 体内消费 —— PASS
6. D3 两宿主断言 —— (a) PASS（rootVerdict 空；Refused verdicts: 1；verdictRefusals 一条 terminal-state）；(b) 流程 PASS、D2 未触发记「仅单测覆盖」
7. `git diff --check` 空 —— PASS

## 5. 每轮产物

- 11-r1（p03-r011）：D1 落地——verdictRefusals 新表、三个 reviews 读者修正、orchestrate/usage/ledger-store 测试。报告 handoff/11-r1.report.md。
- 11-r2（p03-r012）：D2 落地——compareEvidence 消费 priorTruthPaths、delegate 两调用点、README 双语一句、11-r1 遗留注释一处。报告 handoff/11-r2.report.md。
- 11-r3：D3 宿主复验（P1 + N1 双例）+ 两处一行级清理；证据 host-11/（22 个编号文件 + probe-p1/probe-n1 探针仓库）。报告 handoff/11-r3.report.md。

## 6. git diff --stat（未提交）

14 files changed, 203 insertions(+), 24 deletions(-)：README.md、README.zh-CN.md、delegate.ts/.test、evidence.ts/.test、orchestrate.ts/.test、task.ts、types.ts、usage.ts/.test、scripts/freeze-mn-fixtures.mjs、.scratch/nx-followups/issues/04-refusal-kind-enum.md，外加待跟踪新文件 issues/11、issues/12、本 handback、spec.md。

建议提交（plan §2 原文）：

```
git add -u
git add .scratch/typed-delegation/issues/11-refusal-ledger-and-cumulative-declaration.md \
        .scratch/typed-delegation/issues/12-worker-runaway-controller.md \
        .scratch/typed-delegation/11-handback.md \
        .scratch/worker-runaway-controller/spec.md \
        .scratch/nx-followups/issues/04-refusal-kind-enum.md
git commit   # host-11/ 证据与 handoff/ 不入
```
