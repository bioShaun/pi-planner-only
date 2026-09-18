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
| :--- | :--- | :--- | :--- | :---: |
| **场景 A**<br>(Explorer, 非 Git) | 验证 0.8.0 Root 盖印身份链路完全翻转 0.7.0 的 `reports=[]` 历史缺陷 | - child 正常启动<br>- child runId 为 UUID<br>- Root 在 admission 阶段将 child runId 盖印至 report<br>- `reports.length === 1`<br>- `unacceptedReport: false`<br>- capability 为 `restricted-reader`<br>- 无 `LAUNCHER_CAPABILITY_UNSUPPORTED`<br>- 最终 verdict `pass` → `completed` | - child 启动 runId: `1a505c38-41b2-48cd-9032-6b9b46e22c8d`<br>- report 成功接纳，`evidence.workerRunId === "1a505c38-41b2-48cd-9032-6b9b46e22c8d"`<br>- `reports.length === 1`<br>- `executions[0].unacceptedReport` 为空<br>- Task capability 为 `restricted-reader`（basis: `terminal+restricted-reader`）<br>- 无 launcher capability 报错<br>- 最终状态：`completed` | **PASS** |
| **场景 B**<br>(Worker, Git 目录, 纠正轮) | 验证多轮纠正中 runId 独立性与重新盖印、无身份误拒 | - 首轮 delegate 生成 runId 1<br>- 报告被接纳后状态转为 reviewing<br>- request_changes 转为 changes_requested<br>- redelegate 生成不同 runId 2<br>- 纠正轮报告被接纳<br>- `reports` 记录的 workerRunIds 分别匹配两次 `executions[].runId`<br>- runId 1 ≠ runId 2<br>- 最终 verdict `pass` → `completed` | - 首轮 runId: `b5609fb4-c8a6-417c-a7db-221b7a3afe4b`<br>- 首轮 report 接纳，verdict `request_changes`，Task 状态 `changes_requested`<br>- 第二轮 redelegate 成功启动 worker<br>- 第二轮 runId: `69482789-6408-472f-87c3-ea30ed9de33f`<br>- 第二轮 report 接纳，`evidence.workerRunId` 为 `69482789...`<br>- 两次 runId 严格不同<br>- 账本中 `reports.map(r => r.evidence.workerRunId)` 严格等于 `executions.map(e => e.runId)`<br>- 未触发 `reportIdentityRefusal`<br>- 最终状态：`completed` | **PASS** |
| **场景 C**<br>(负向校验) | 验证对未知 Task ID 的守卫依然生效，未整体放松 | - 对未知 taskId（如 `T-99999999-001`）调用 `planner_verdict` 会被拒绝并返回 `TASK_UNKNOWN / unknown task`<br>- 不污染或影响已有工作区账本 | - 调用 `planner_verdict` (`taskId: "T-99999999-001"`)<br>- 宿主直接拒绝：`planner_verdict: unknown task T-99999999-001`<br>- 结果 `isError: true`<br>- 工作区已有账本保持不变，未发生非法覆盖 | **PASS** |

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
