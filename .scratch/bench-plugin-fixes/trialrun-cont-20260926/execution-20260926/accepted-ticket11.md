# 11：native 守卫误判 pi-subagents 的"拒绝重复调用"回执

Status: ready-for-agent
Type: task
Execution: 修复已实现；当前版本完整验证受仓库外 TMPDIR 只读阻塞，暂不置 done。

## Problem

首轮试跑 `T3-native-pds-1` 任务质量 pass，但整条被标 INVALID/总额 null（见 `../trialrun-20260926/runs-log.md`
与 `../trialrun-20260926/report.md`）。Root 在同一轮发了两次 `subagent` 调用，pi-subagents 的单发守卫
（`executeWithSingleDispatchGuard`）拒绝了第二次。该拒绝回执经 JSON 模式 transport 后呈
`details={}`、无 `results` 数组，`bench/native_results.py::children` 把"无 results 数组"一律视为漏记用量的
费用缺口。实际上该调用未启动任何子任务、无用量、无计费。形状细节：
`{"type":"tool_execution_end","toolName":"subagent","result":{"content":[{"type":"text","text":"Rejected: a subagent call is already in progress. Issue exactly ONE subagent call per turn."}],"details":{}},"isError":true}`（注意 `isError` 在 event 层，不在 result/details 内）。

## Changes

- `bench/native_results.py::children`：结果同时满足 (1) event 层 `isError=true`、(2) content 文本含
  `a subagent call is already in progress`、(3) `details` 无 `runId`/`results`/`asyncId` 时，记为
  "被拒绝的重复调用"：单独计数返回（供机制指标），不计入 `launches`，不产生 problem，不污染完整总额判定。
- `bench/summarize.py`：把该计数作为 native 臂机制指标输出（这三项只用于解释结果；native 不支持的
  lite 专用 refused/detached/truncated 仍显示 NA，不显示成零）。
- `bench/runcheck.py`：同一形状不再产生 `native subagent` problem（有效性恢复），其他形状的
  "无 results 数组"判定保持不变。

## Acceptance

- `bench/test_native.py` 新增用例：用上方真实 transcript 形状（`details:{}` + event 层 `isError`）构造
  事件，断言 `check()` 有效且 `parse_run()` 总额等于 Root + 真实 child 费用；现有"launched subagent
  has no terminal child results"用例（`mode=single, results=[]` 且无拒绝文本）继续判无效。
  不删除、不 weaken 现有 12 项断言。
- `TMPDIR=<仓库外目录> python3 -B bench/test_native.py` 全过；仓库外 TMPDIR 下 `npm run test:release` 全过。
- 离线重算 `T3-native-pds-1`（不调用模型、不改 runs 文件）：`summarize.py`（opus 与 actual 双权重）
  给出完整总额（预期 opus $2.25891032 = Root $2.227005 + child $0.03190532；actual $0.11108864），`attempt_spend`
  不再是 `INCOMPLETE/UNPRICED`。重算只读 runs 目录，以下情况任一出现即停：runs 文件被修改、发起模型
  请求、总额与已校正的期望值不一致。child 恒按实际模型价格计算，仅 Root 随权重重算。

## Comments

- 2026-09-26 实现：`bench/native_results.py` 新增 `is_rejected_duplicate`（event 层 `isError=true` +
  拒绝标记文本 + `details` 无 runId/results/asyncId 三者同时满足才认），`children()` 返回四元组
  （新增 `rejected_duplicates` 计数，不计 launches、不产生 problem）；`bench/runcheck.py` 同形状不再
  报 `native subagent` problem；`bench/summarize.py` 输出 `rejected_duplicates` 机制指标（native 臂；
  lite 专用 refused/detached/truncated 仍为 NA）。`bench/test_native.py` 新增
  `test_rejected_duplicate_call_is_counted_not_a_billing_gap`（真实 transcript 形状 + lookalike
  对照：`mode=single, results=[]` 无拒绝文本仍判无效）；现有断言全部保留，仅把两处三元组解包更新为四元组。
- 验证：`TMPDIR=/project/tmp/ppo-bench/verify-20260926 python3 -B bench/test_native.py` 13 tests OK；
  仓库外 TMPDIR 下 `npm run test:release`（typecheck + 5 suites）全过。日志
  `/project/tmp/ppo-bench/verify-20260926/{native-tests,release}.log`。
- 离线重算 `T3-native-pds-1`（只读 runs，不调用模型；runs 三文件 sha 前后一致）：runcheck 有效；
  opus 总额 $2.2589（Root $2.2270 + child $0.0319），actual 总额 $0.1111；delegates=4、
  rejected_duplicates=1、pass=True。注意 child 恒按 actual 模型价是仓库长期口径（`summarize.py`
  第 79/97 行），仅 Root 随 `--weight` 重算；历史冒烟 $0.9248 也是同一口径。重算日志与 JSON 在
  `../trialrun-20260926/attempt-1-resummarize-{opus,actual}.{log,json}`。
- 待维护者确认：修复合入后，票 09 是否按"修复验证通过后重订试跑（另起 campaign 名）"推进；
  本票建议状态置为 done，剩余 5 次尝试的重订由票 09 承载。

- 2026-09-26 审核收尾（维护者已授权继续推进）：识别条件改为检查 runId/results/asyncId 的键不存在，
  并直接验证原始 details，避免把 null/false/空列表归一化成合法空对象。新增独立反例测试，修复前
  15 个 subtest 失败，修复后全部通过；原有正例补 actual/opus 的 Root、child、总额和委派数断言。
  当前 14 项测试中的新增纯内存反例已运行；完整离线套件与 test:release 未重跑通过，原因是当前会话
  无法写入 /project/tmp/ppo-bench（EROFS），不继承旧版本的全绿作为本次修改的通过证明。
  attempt 1 已再次只读重算，两个总额不变，8 个 runs 文件全部前后哈希一致。
  证据：[ticket11-closeout-20260926](../ticket11-closeout-20260926/)。
  票 09 续跑已获授权，不再等待维护者决定；待当前版本验证完成后关闭本票并执行剩余五次。

- 独立代码审查第 1 轮要求补充带 `results=[]`、event 层 `isError=true` 且缺失 mode 的
  回执处理。反例在修复前失败、修复后通过；这类空结果现在保留费用缺口，不会因缺少 mode
  绕过有效性检查。完整验证仍受同一目录权限阻塞，未新增付费试跑。

- 独立代码审查第 2 轮补充：缺少/未知 mode 的空 results 即使没有错误标志也不能认作
  零费用管理查询；非空非字典 details 不能导致解析崩溃。现已记录为费用缺口，明确
  mode=management 的健康空结果仍可通过。追加反例在修改前为 7 failures/3 errors，修改后通过。
  actual/opus 真实记录再核对不变，8 个原文件哈希一致；完整 14 项与发布测试仍待可写环境运行。
