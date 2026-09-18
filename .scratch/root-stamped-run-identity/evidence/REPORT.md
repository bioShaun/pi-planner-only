# Root-Stamped Run Identity (0.8.0) 真实宿主验收报告

**结论：通过最终真实宿主验收。全部 4 个工单及 Spec 要求已全部满足。**

---

## 1. 基线环境记录

- **插件版本**：`0.8.0`（`package.json`）
- **源码 Git HEAD**：`84cced4372700cac3051312b4867615820c696b2`
- **加载源码指纹 (`loadedFingerprint`)**：`ca5d30b14b5b486513592835a32773d98292a8bafd136771bd36982ea654fcbe`
- **Pi Host**：`@earendil-works/pi-coding-agent@0.85.1`
- **Launcher**：`pi-subagents@0.68.0`（未修改已安装上游）
- **隔离环境**：
  - 项目基路径：`/home/tcuni-claw/pi/pi-planner-only`
  - 隔离临时目录：`.scratch/root-stamped-run-identity/acceptance/tmp-*`（严格遵守项目内隔离规则，不使用 `/tmp`）
  - 隔离账本及配置：`.scratch/root-stamped-run-identity/acceptance/agent-*`
- **并发与资源封套**：
  - 调度队列：`slot cpu`（Ryzen 9 7950X，`heavy.slice`）
  - 启动前 `slot audit` + `slot status` 完整保存至 `evidence/slot-preflight.txt`

---

## 2. 真实宿主场景观察结果

| 场景 | 测试目标 | 预期行为 | 实际观察结果 | 判定 |
| :--- | :--- | :--- | :--- | :--- |
| **场景 A**<br>(Explorer, 非 Git, 自然 Prompt) | 验证 0.8.0 Root 盖印身份链路完全翻转 0.7.0 的 `reports=[]` 历史缺陷 | - child 正常启动<br>- child runId 为 UUID<br>- Root 在 admission 阶段将 child runId 盖印至 report<br>- `reports.length === 1`<br>- `unacceptedReport: false`<br>- capability 为 `restricted-reader`<br>- 无 `LAUNCHER_CAPABILITY_UNSUPPORTED`<br>- 最终 verdict `pass` → `completed` | **实录 3 次 execution（含 2 次 `worker_runaway` 及自主恢复序列）**：<br>1. Execution 1: Root 给定 `maxTokens: 2000` → child 消耗 8072 tokens 触发 `worker_runaway` 熔断被 cancel（runId: `df3ddf82-030e-4518-b4d3-199ce352e0c9`）；<br>2. Execution 2: Root 自主调用 `planner_redelegate.recovery` (`retry_same_plan`) 提高至 `maxTokens: 12000` → child 消耗 17027 tokens 再次 `worker_runaway` 被 cancel（runId: `ffbe1911-5130-40a8-8c50-588a72e08ebd`）；<br>3. Execution 3: Root 再次自主 recovery 提高至 `maxTokens: 30000` → child 顺利完成（消耗 17085 tokens（input 16583 + output 502，另 cacheRead 7680；来源 `A/meta.json`），runId: `1a505c38-41b2-48cd-9032-6b9b46e22c8d`）；<br>- Root 在 admission 层成功将第 3 次 runId 盖印至 report；<br>- `reports.length === 1`，`reports[0].evidence.workerRunId === "1a505c38-41b2-48cd-9032-6b9b46e22c8d"`；<br>- Task capability 为 `restricted-reader`（basis: `terminal+restricted-reader`）；<br>- 无 launcher capability 报错；<br>- 最终状态：`completed` | **PASS** |
| **场景 B（指令式宿主集成验证）**<br>(Worker, Git 目录, 纠正轮) | 验证多轮纠正中 runId 独立性与重新盖印、无身份误拒（遵循 2026-09-17 审计标准定性） | - 首轮 delegate 生成 runId 1<br>- 报告被接纳后状态转为 reviewing<br>- request_changes 转为 changes_requested<br>- redelegate 生成不同 runId 2<br>- 纠正轮报告被接纳<br>- `reports` 记录的 workerRunIds 分别匹配两次 `executions[].runId`<br>- runId 1 ≠ runId 2<br>- 最终 verdict `pass` → `completed` | - 首轮 runId: `b5609fb4-c8a6-417c-a7db-221b7a3afe4b`<br>- 首轮 report 接纳，verdict `request_changes`，Task 状态 `changes_requested`<br>- 第二轮 redelegate 成功启动 worker<br>- 第二轮 runId: `69482789-6408-472f-87c3-ea30ed9de33f`<br>- 第二轮 report 接纳，`evidence.workerRunId` 为 `69482789...`<br>- 两次 runId 严格不同<br>- 账本中 `reports.map(r => r.evidence.workerRunId)` 严格等于 `executions.map(e => e.runId)`<br>- 未触发 `reportIdentityRefusal`<br>- 最终状态：`completed` | **PASS** |
| **场景 C**<br>(负向校验) | 验证对未知 Task ID 的守卫依然生效，未整体放松 | - 对未知 taskId（如 `T-99999999-001`）调用 `planner_verdict` 会被拒绝并返回 `TASK_UNKNOWN / unknown task`<br>- 不污染或影响已有工作区账本 | - 调用 `planner_verdict` (`taskId: "T-99999999-001"`)<br>- 宿主直接拒绝：`planner_verdict: unknown task T-99999999-001`<br>- 结果 `isError: true`<br>- 工作区已有账本保持不变，未发生非法覆盖 | **PASS** |

### 2.1 场景 A 实录分析：Root 自主 Envelope 调整与 WRC Recovery 验证

在场景 A 的实际宿主运行中（详见 `evidence/A/ledger.json` 与 `evidence/A/toolcalls.json`），并非单次直接干净结束，而是完整经历了 **3 次 execution**：

1. **第 1 次执行 (`df3ddf82-030e-4518-b4d3-199ce352e0c9`)**：
   - Root 模型初次调用 `planner_delegate` 时，自主给出了极度保守的 `envelope: { maxTokens: 2000, maxWallMs: 120000 }`。
   - 子代理（`planner-scout`）在执行探索、加载与环境工具时实际消耗 8072 tokens，越过了 2000 token 门限。
   - 宿主 Worker Runaway Controller (WRC) 准确触发熔断，状态置为 `worker_runaway`，取消任务并置 `terminationConfirmed: true`（confirmationBasis: `terminal+restricted-reader`）。
2. **第 2 次执行 (`ffbe1911-5130-40a8-8c50-588a72e08ebd`)**：
   - Root 收到带有 `anomaly: tokens observed=8072 limit=2000` 的中止结果及 recovery 要求。
   - Root 自主调用 `planner_redelegate`，传入 `recovery: { action: "retry_same_plan", executionId: "call_wMrhdblaz5dj601TfpQUKttD|fc_0cbdbdc86fa46eb7016aad5017912887d08e69bcd92eabd0a5", reason: "The initial read-only explorer was cancelled solely because the token envelope was too low for the delegation protocol; retry with a bounded but sufficient envelope.", worktreeDecision: "keep" }`，并将封套调大至 `maxTokens: 12000`。
   - 子代理实际消耗 17027 tokens，再次越过 12000 token 门限，再次触发 `worker_runaway` 熔断。
3. **第 3 次执行 (`1a505c38-41b2-48cd-9032-6b9b46e22c8d`)**：
   - Root 再次收到 recovery 指引，继续自主调用 `planner_redelegate.recovery`（`action: "retry_same_plan"`，`executionId: "call_YJiuscNLw4SJzftyXQ7bH9WC|fc_0cbdbdc86fa46eb7016aad5026cdf087d098696dc3d36a8971"`），将封套进一步提高至 `maxTokens: 30000`。
   - 子代理消耗 17085 tokens（input 16583 + output 502；cacheRead 7680 不计入 envelope 口径；来源 `A/meta.json`），顺利完成读取并产出 WorkerReport。
   - 三次 explorer 执行的实际模型均为 `tcuni-luna/gpt-5.6-luna`（`A/meta.json:14`、账本 `usage.children[].model`），与 Root 相同；`settings.json` 里的 `subagents.agentOverrides.scout` 未生效——符合预期，0.8.0 不含 explorer 模型路由（`4fa55e3` 已回退），见 `baseline.md` §3 更正。
   - Root 在 Admission 层单向将第三次分配的 UUID runId 盖印至 report，报告无阻碍接纳进入 reviewing，最终 `planner_verdict pass` 转为 completed。

**关键说明**：
- 这两次 `worker_runaway` 是 Root 在自然 prompt 下自主选择的 envelope 过小导致的正常资源熔断，**与身份链路实现完全无关**。
- 这条真实轨迹**恰好额外证明了 WRC recovery 机制**（`planner_redelegate.recovery.retry_same_plan`，且 `executionId` 采用完整的 `call_...|fc_...` 形态）在 0.8.0 上完全正常运作，证明了身份机制单向盖印改造未对既有异常恢复链路造成任何负面回归。

### 2.2 场景 B 定性说明：指令式宿主集成验证（遵循 2026-09-17 审计标准）

在测试脚本 `run-scenario-b.mjs:72-78` 中，对 Root 给予的 prompt 为明确的分步指令：
```text
Execute these exact steps in order:
1. Call planner_delegate with role='worker', objective='Change hello.txt to contain exactly the line hi', validation={required:true, commands:['cat hello.txt']}, envelope={maxTokens:50000, maxWallMs:180000}.
2. When round 1 completes, call planner_verdict with taskId, verdict='request_changes', summary='Need trailing newline'.
3. Call planner_redelegate with taskId, role='worker', objective='Ensure hello.txt contains hi with trailing newline', instructions='Add trailing newline to hello.txt', validation={required:true, commands:['cat hello.txt']}.
CRITICAL RULE: In step 3, you MUST NOT include the 'recovery' argument in your tool call. The 'recovery' argument is ONLY for blocked tasks; passing 'recovery' on changes_requested will be immediately refused with RECOVERY_NOT_APPLICABLE. Your tool call arguments object must only have: { taskId, role, objective, instructions, validation }.
4. When round 2 completes, call planner_verdict with taskId, verdict='pass', summary='All verified'.
```

按照 `.scratch/wrc-incident-followups/issues/02-abort-recovery-own-surface.md`（2026-09-17）确立的审计纠正标准，明确将场景 A 与场景 B 做出**定位区分**：
1. **场景 A 是“自然 Prompt 验证”**：
   - 验证自然语言提示下，大模型自主选取角色（explorer）、自主选取验收模式（observation）、并在遭遇 2 次 `worker_runaway` 资源限制时，完全自发地分析原因、自主发起 `planner_redelegate.recovery` 调整 token envelope，最终成功恢复。它证明了真实宿主环境下大模型与插件交互的端到端自主性与鲁棒性。
2. **场景 B 是“指令式宿主集成验证”**：
   - 脚本通过分步指令直接驱动多轮流转，并不用于宣称“模型自主发起了 request_changes 或 redelegate”。
   - 它的**专有价值**在于：在真实宿主及确定性的纠正轮次下，严格验证**插件层身份逻辑的确定性行为**——首轮与纠正轮由宿主分配完全独立的 UUID runId、准入层重新盖印 `evidence.workerRunId`、两轮报告均被正常准入（无 `reportIdentityRefusal` 误报）、账本 `reports[].evidence.workerRunId` 与 `executions[].runId` 严格一致。

---

## 3. 对照组分析（对比 0.7.0 缺陷样本）

在 0.7.0 历史样本（见 `.scratch/explorer-model-config/evidence/REPORT.md:11`）中：
- 上游宿主分配了 UUID runId (`d8280241-8e7d-43e6-937a-67d2aaa91b67`)，但 child 产出的报告填入了构造的 taskId 字符串；
- 0.7.0 尝试比对两者一致性，导致报告全部被拒收为 `unacceptedReport`，任务停留在 `changes_requested`，账本最终 `reports=[]`。

在 0.8.0 中（ADR-0004 & Ticket 01）：
- 契约明确 **Run identity 由 Root 在准入层（Admission Layer）单向盖印**；
- 子代理不再声明或上报 `workerRunId`（子代理报告即使传入也静默剥离并保留 warning）；
- Root 在准入时直接执行 `response.runId ?? executionId` 盖印；
- 场景 A 和场景 B 均确认：`reports.length > 0` 且 `reports[i].evidence.workerRunId === executions[i].runId`，彻底翻转了 0.7.0 的历史缺陷。

---

## 4. 全量发布门禁 (`npm run test:release`)

- 执行环境：普通终端（`BypassSandbox: true`，规避沙盒 child_process stdio EPERM 环境已知缺陷）
- 退出码：`0`
- 测试模块覆盖：30 个测试文件全部通过
- 完整日志：`evidence/release.log`

---

## 5. 证据文件清单

- 基线配置：[`evidence/baseline.md`](baseline.md)
- 资源预检：[`evidence/slot-preflight.txt`](slot-preflight.txt)
- 全量门禁日志：[`evidence/release.log`](release.log)
- 场景 A 真实宿主证据：
  - 会话元信息：[`evidence/A/session-head.txt`](A/session-head.txt)
  - 任务账本：[`evidence/A/ledger.json`](A/ledger.json)
  - 子代理元数据：[`evidence/A/meta.json`](A/meta.json)
  - 工具调用记录：[`evidence/A/toolcalls.json`](A/toolcalls.json)
- 场景 B 真实宿主证据：
  - 会话元信息：[`evidence/B/session-head.txt`](B/session-head.txt)
  - 任务账本：[`evidence/B/ledger.json`](B/ledger.json)
  - 子代理元数据：[`evidence/B/meta.json`](B/meta.json)
  - 工具调用记录：[`evidence/B/toolcalls.json`](B/toolcalls.json)
- 场景 C 真实宿主证据：
  - 会话元信息：[`evidence/C/session-head.txt`](C/session-head.txt)
  - 任务账本：[`evidence/C/ledger.json`](C/ledger.json)
  - 负向测试记录：[`evidence/C/meta.json`](C/meta.json)
  - 工具调用记录：[`evidence/C/toolcalls.json`](C/toolcalls.json)
