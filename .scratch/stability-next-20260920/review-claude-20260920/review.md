# Claude 审核记录（2026-09-20，对 HEAD df199f8）

审核对象：83a0ad4（P1-A/stop/P2 冻结提交）、9dd6175（P1-B 实现与验收）、df199f8（文档回填）。方法：读 diff、核对交接清单各项证据、独立复跑 release、核对提交树与最终 strict 冻结清单。

## 核对结果

| 项 | 结果 | 依据 |
|---|---|---|
| 提交树 vs 最终 strict 冻结清单 | 66 源码项 + 25 harness 项对 HEAD 零不匹配 | strict-run-dihsWK/source-manifest.json、harness-manifest.json 逐项 `git show HEAD:` 哈希比对；executor 自己的 committed-freeze-check.json 结论一致 |
| 独立复跑 release | `npm run test:release` exit 0（slot cpu，TMPDIR=/project/tmp） | test-release.log、exit-code.txt、head.txt；跑后工作树无变化 |
| 删除断言 | 仅 evidence.test.mjs 28-A 两条，改为更严格断言（unexplained=true、revalidate），assertion-audit.json 有解释，新增 95 条 | `git show 9dd6175 -- '*.mjs' '*.ts' \| grep '^-.*assert'` |
| P1-B 机制 | 零预算方案被真实探针否定（xMGYAr：hard 0 连 structured_output 也拦），改为 tools:[] 专用 agent + hard 1/block "*"；真实 child active tools 恰为 ["structured_output"]，一次成功提交，工作区无变化 | report-only-run-3zZ7ry/child-tools.jsonl、result.json；ADR-0009 |
| P1-B 代码 | grant 为持久 Task 状态，spawn 前重读防并发双消费；validator/reviewer 不能消费；origin 缺 cReport 拒绝；truthPaths 强制空；rawTerminal 入账；`tool_budget_exhausted` 映射 report_only_tool_budget；review 侧把修正轮绑定到 origin 并检查修正窗口新鲜度 | delegate.ts、evidence.ts、orchestrate.ts diff |
| strict 链 | 2FEEMJ 广泛审查 REQUEST_CHANGES（只读声明可伪造）→ 修正 → ed0kfI PASS（仅三文件变化）→ Bg1P0s 宿主/P3 证据 child PASS、外层 124 未改写 → dihsWK 最终 PASS exit 0 | 各 run 的 child-verdict.md、result.json；父 low、子 gpt-5.6-sol/high、双方 EROFS |
| 真实 TUI 三场景 | queued / scheduled / combined 均 PASS，forcedCleanup=false | study-run-vsHbSx、TupxIs、2VtAyF 的 optimized-stop-pty.json |
| P3 | 3 组 × 3 任务 × 3 重复，27/27 完成；direct 54.5k、baseline 815k、optimized 847k token；monetaryCost 全 null，未作费用结论 | study-run-yL4RzS/study-summary.md |
| 残留 | 各 strict run 无自有残留；result.json 里两条 residue 是其他项目 cwd 的 codex（summarize-run.mjs 未按 cwd 过滤，误报） | ps lstart + /proc/cwd |
| release-run-GJqscr | 60 文件中 explorer-model.ts、explorer-model-config.test.mjs 不在 HEAD：它们在 .git/info/exclude 里，是旧原型，未进产品且不在 test:release 脚本内 | git check-ignore |

审核结论：PASS。三个提交与最终 strict 门禁一致，交接清单各项均有原始证据。

## 发现的剩余事项

1. 外部时限默认 420 秒对广泛审查仍不够：今天 8 次 strict child 耗时 166–524 秒，420 默认下两次（HRTA2r 362 s、ONdoZZ 371 s）无 verdict 被截断，闭环的四次里三次靠 `REVIEW_READONLY_TIMEOUT=600`。建议协议默认改 600，同时保留按运行记录 child 耗时的要求。
2. 工单 07（执行时长与 Request 剩余时间可见性）未开始。
3. P3 结论的含义：这组小任务上委派比直接 Root 多用约 15 倍 token，完成率与质量相同。文档没有作省 token 的宣称，所以不构成矛盾，但项目的核心目标需要在更大、真实项目任务上重新测量才能成立。
4. 杂项：summarize-run.mjs 的残留检查应按 cwd 过滤；仓库根有大量 `.planner-only-lock-*` 空目录（已 ignore）可清理；本审核目录未提交。

本次 slot audit 输出误写到同一文件（slot-audit.txt 同时作为 stdout/stderr 传给 gate），gate 因此打印了提示但 exit 0；不影响结果。
