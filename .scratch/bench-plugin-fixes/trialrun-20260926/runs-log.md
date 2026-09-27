# 逐条执行记录（native-pilot-t3）

约定：`attempt_spend` 口径见 `bench/summarize.py`（当前 runs 目录、含无效与未评测、排除 `void/` 归档）。
预算：opus 权重累计达 $10 即不再启动下一条。停止当时累计值未知，故触发停止；修复后累计 opus $2.25891032，不追改停止决定。

## 尝试 1/6：T3-native-pds-1（2026-09-26 13:19–13:37，wall 1063s）

- 启动前：`slot audit` 干净（`preflight-1-native.log`），`BENCH_SKIP_HEALTH=1`，`BENCH_MAX_ATTEMPTS=1`，`BENCH_KEEP_CLONE=0`（克隆已按约删除）。
- 原始记录：`/project/tmp/ppo-bench/results/native-pilot-t3/runs/T3-native-pds-1.{jsonl,meta.json,exit,wall,stderr,eval.json,eval-target.log,eval-suite.log}`；`STOP` 已由 run.sh 写入。
- pi 退出码：0。stderr 为空（0 字节）。
- 任务质量：**pass** — `target_failed=[]`，`new_failures=[]`（masked suite 14 failed 与基线 `T3.failures.txt` 逐项一致，无新增无缺失），`target_test_exit=0`，`files_changed=3`，`non_target_tests_changed=[]`。
- 转录完整性：30,011 行 JSONL，无畸形行；6 次 subagent 调用 start/end 全部闭合；transcript 中目标提交 sha 出现 0 次；`stopReason=error` 0 次。
- 有效性判定：**INVALID** — runcheck 唯一原因 `native subagent x1: subagent result has no child results array`（`eval.json` 的 `valid=false` 与之对应）。
- 原因定位（transcript 文件行 21293，0-based 21292）：Root 在同一轮发了两次 `subagent` 调用（`call_00` reviewer 仍在执行时又发起 `call_01` worker）；pi-subagents 的单发守卫（`executeWithSingleDispatchGuard`，`subagent-executor.js`）拒绝了第二个调用，返回 `isError=true`、文本 `Rejected: a subagent call is already in progress. Issue exactly ONE subagent call per turn.`，且该回执是传输层对象（`details={}`，**没有 `results` 数组**；这与在线文档中 `duplicateSubagentCallResult` 返回 `details:{mode, results:[]}` 的形状不一致——实际经 JSON 模式 transport 后 details 被清空）。
- 费用：修复前**总费用未知（null）**（守卫无法区分"无 results 数组"与"漏记用量"，整条标 INVALID）。
  票 11 修复后离线重算（只读 runs，不调用模型；runs 文件 sha 前后一致）：runcheck 有效，
  opus 口径总额 **$2.2589**（Root 按 opus 重算 $2.2270 + child 按 actual 模型价 $0.0319），
  actual 口径总额 **$0.1111**（Root $0.0792 + child $0.0319）。注意仓库长期口径是 child 恒按
  actual 模型价、仅 Root 随 `--weight` 重算；本票初版写的 opus 下界 $3.8223 是把 child 也按 opus
  表重算的数，与仓库约定不一致，以本次重算为准。child 均为 `tcuni/gpt-6-luna`（3×medium、1×high），
  全部 exitCode 0；被拒绝的调用未启动子任务，不贡献费用。重算日志 `attempt-1-resummarize-{opus,actual}.log`。
- 机制指标（attempt 1 原始值，供首轮报告引用）：Root 轮数 39，Root read 调用 10 次，bash 调用 42 次；native 臂按约定不报 lite 专用 refused/detached/truncated（报告中记 NA）。
- 人工介入：0（全自动；仅启动前 slot 预检与启动后复核）。
- 预算累计：停止当时总额未知，按 spec 第 89、96 条，**费用缺口本身即停止条件**，不再启动后续付费尝试。
  （事后离线重算总额 opus $2.2589，同样远低于 $10 检查点，但这不追认继续运行——停止判定的依据是
  当时的未知状态，符合"未知总费用不能参与比较"的规则。）
- 附带清理：在阶段 2 的 per-arm `BENCH_DRY_RUN=1` 检查中，run.sh 的 dry-run 路径在写 meta 后 `exit 0` 提前返回，留下两个不属于任何真实尝试的 stray 文件（`T3-direct-pds-1.meta.json`、`T3-lite-pds-head-1.meta.json`）；已删除。真实尝试目录现仅含 attempt 1 的 8 个文件。

## 后续尝试 2–6：未启动（停止条件触发）

停止触发项（对应冻结条件"立即停止"清单）：**费用缺口**（单次运行无法确认完整总额，`ATTEMPT SPEND … INCOMPLETE/UNPRICED`）。

其余停止项检查：API/额度错误无；质量验收通过；答案引用无；子任务终态 4 个真实 child 全部 `exitCode=0`、
`interrupted/detached/timedOut/stopped` 全无；日志/元数据/退出证据齐全；嵌套委派未出现；slot 无冲突。

## 停止时提出的最小修复方向（历史记录；现已由票 11 实施）

`bench/native_results.py::children` 与 `bench/runcheck.py` 对 `tool_execution_end` 的处理：当结果同时满足
(1) transport 层 `isError=true`、(2) 文本匹配 `Rejected: a subagent call is already in progress`、
(3) 该 `toolCallId` 无任何已启动子任务（`details` 无 `runId`、无 `results`、无 `asyncId`）时，
应将其记为"被拒绝的重复调用"（机制指标单独计数，不计 delegates），不污染该运行的完整总额判定。
必须同步在 `bench/test_native.py` 增加故障注入用例：用真实 transcript 中的该事件形状（`details:{}`、
`isError` 在 event 层）构造用例，断言修复后 `check()` 有效且 `parse_run()` 总额等于 Root + 真实 child 费用；
同时保留现有"launched subagent has no terminal child results"用例继续失败（`mode=single, results=[]`
且无拒绝文本的形状不受影响）。修复并通过 `test_native.py` + `test:release` 后，方可重订试跑。
注意：该拒绝本身说明 Root 在同一轮发起了两次 subagent 调用——修复守卫误判后，仍建议在报告中把
"每轮多次委派"记为行为观察（Root 轮数 39 也偏高，可与 opus 替身差距分析联动）。

## 2026-09-26 再次只读核对

审核收尾版本重算结果未变：opus $2.25891032、actual $0.11108864，delegates=4、
rejected_duplicates=1，runcheck 有效；8 个原始 runs 文件的完整 SHA256 清单前后相同。
证据：`../ticket11-closeout-20260926/attempt-1-*` 和 `runs-{before,after}.sha256.json`。
当前完整验证/续跑因仓库外目录只读暂停，新增付费尝试为 0。
