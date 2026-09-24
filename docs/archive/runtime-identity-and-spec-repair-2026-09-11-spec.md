# Task 身份分配与 TaskSpec 修复保真 Spec

Status: ready-for-implementation
Version: 1
Date: 2026-09-11
Repository: `/public/pi/pi-planner-only`
Baseline: `a9167a6a8ddb9a231b54d7776c726c4ea76e645d`，含审计时正在开发的未提交运行可靠性改动

## 1. 目标与范围

本 Spec 补充本次运行分析中新发现的两项问题：

| ID | 优先级 | 问题 |
|---|---|---|
| IS-01 | P0 | 恢复历史 ledger 后重新分配已有 Task ID，新任务静默复用旧 Task |
| IS-02 | P1 | TaskSpec 修复示例将执行任务改成 Explorer，并将不可解析的验证定义降为非必需 |

本文 MUST/必须为验收要求。完成定义是：新 Task 的身份分配不会污染已有 Task，修复模板不会因修正格式错误而静默改变角色或放宽验证要求。

相关文档：

- [既有运行审计](./runtime-audit-2026-09-11.md)
- [既有运行可靠性 Spec](./runtime-reliability-2026-09-11-spec.md)
- [当前实施交接](./runtime-reliability-2026-09-11-progress.md)

上述文档已有的输出摄取、通知匹配、TaskPacket 正文保留、resume、恢复指引等需求继续适用，不在本文重复立项。IS-01 应作为运行可靠性发布的附加阻断项；已有 RunRecord 身份设计不能替代 Task ID 分配与创建语义的修复。

本次审计只进行了源码分析及离线复现，没有修改实现、历史 ledger 或 session，没有执行在线模型任务。

## 2. 证据口径

### 2.1 主会话

本文 L 指以下文件的物理行号，区别于既有 audit 使用的上一场会话：

```text
/home/tcuni/.pi/agent/sessions/--project-glx-panel_design-TC-Uni-Triticum-durum-100K-260903--/2026-09-11T06-17-34-197Z_01a08f1d-40f4-76c7-85ed-7ee32659b3f5.jsonl
```

子代理产物目录：

```text
/home/tcuni/.pi/agent/sessions/--project-glx-panel_design-TC-Uni-Triticum-durum-100K-260903--/subagent-artifacts/
```

Task ledger：`/home/tcuni/.pi/agent/planner-only/ledger/`。

源码行号为审计时位置；工作区正在并行修复，实施时以函数名和行为为定位依据。当前 ledger 可被后续会话更新，历史事实优先由原 session 工具返回和对应 run 产物证明。

### 2.2 报告样本校正

- `184a406f-8e6b-4eff-93af-ac52e021c860_worker_output.md` 只有准备收尾的自然语言，没有 WorkerReport；当前 `extractWorkerReport()` 返回 `worker output did not contain a WorkerReport object`。不能将其标为合法报告摄取 fixture。
- `cea1f395-b32b-4e2d-9aef-f29bfcf932da_worker_output.md`、`05999d74-310d-4a4e-ab5d-3b8211a9f8aa_worker_output.md`、`320de048-a51f-44a6-a4a3-f2f6a1fcdc56_worker_0_output.md`、`ba644e0a-c2b3-4b5c-8b90-d552b3ad0e37_worker_output.md` 均能被当前解析器解析。
- 可解析不等于身份正确、验证全部通过或可以正式 pass。例如 `320de048` 包含一个 `not-run`、exitCode 128 的 Git 检查。

## 3. IS-01：全局 Task 身份分配与创建语义

### 3.1 已观察故障

| 本次业务任务 | 分配 ID | verdict 中的历史 alias | 证据 |
|---|---|---|---|
| 冒烟前复核 | `T-20260911-001` | `T-explore-bt2-50k-snp` | L17、L46 |
| 冒烟执行 | `T-20260911-002` | `T-explore-bt2-50k-snp-v2` | L49、L478 |
| 完成报告写作 | `T-20260911-003` | `T-explore-tcprobe-v2-snpeff-cli` | L481、L575 |

这些 alias 错配已经存在于当时的工具返回中，不是仅由当前 ledger 推测。

源码链路：

1. `TaskStore.sequence` 初始化为 0，`nextTaskId()` 直接递增生成日期编号（`task.ts:709–722`）。
2. `TaskStore.restore()` 恢复记录，但没有推进计数器（`task.ts:811–820`）。
3. `TaskStore.create()` 遇到同名 ID 直接返回旧记录（`task.ts:725–727`）。
4. `Orchestrator.begin` 的自动编号分支生成新 ID 后调用 `create(storedSpec, alias)`（`orchestrate.ts:1799–1806`）。
5. `restoreFromLedger()` 会恢复全局历史记录，且有恢复数量上限（`orchestrate.ts:753–777`）。

离线复现：创建旧探索 Task，恢复到新的 TaskStore，再为不同 cwd 创建执行 Task，返回值仍为旧记录：

```json
{
  "allocated": "T-20260911-001",
  "objective": "OLD exploration",
  "cwd": "/old",
  "aliases": ["T-old"]
}
```

同项目跨会话串用由运行日志证明；跨 workspace 串用由离线复现证明，不能宣称本次现场已发生跨项目污染。

### 3.2 与报告身份校验的关系

`05999d74` 输出的 taskId 为 `T-step2-snpeff52-handoff-report`。报告可以解析，使用正确登记的 alias 集合时也能通过身份校验；但审计读取的 T-003 ledger 仅有历史 alias `T-explore-tcprobe-v2-snpeff-cli`，校验报 taskId 与 evidence.taskId 不匹配。

`validateWorkerReportIdentity()` 已允许 canonical ID 和已登记 alias（`report.ts:407–408`）。修复应保证分配、登记和下发一致，不得通过接受任意 alias 或跳过身份校验掩盖碰撞。本证据不把所有报告丢失都归因于碰撞；摄取链路故障仍按既有 Spec 修复。

### 3.3 必须满足的不变量

1. **全局唯一**：共用同一 ledger 根的会话和进程，创建不同 Task 必须取得不同 canonical ID。session/workspace 字段不能使同一文件路径下的重复 ID 变得安全。
2. **创建不复用**：创建遇到已占用 ID 必须返回明确冲突，不能返回旧 Task，也不能覆盖旧快照。
3. **继续须显式关联**：继续已有 Task 必须通过明确的 canonical ID 或已登记 alias 解析，并校验 workspace；不得将自动生成 ID 碰撞解释为继续任务。
4. **持久占用有效**：未加载、超过恢复上限、终态、隔离或不可解析但文件名有效的历史记录，其 ID 均不能被重新分配。
5. **并发安全**：两个独立 Pi 进程同时启动时仍满足唯一性。仅恢复最大编号、进程内 Set 或普通先查后写不足以保证这一点。
6. **失败不污染**：分配/持久化冲突不得改变已有 Task 的 spec、cwd、aliases、状态、报告、证据、review 或 usage，也不得遗留本次启动的 writer/预算预留。
7. **身份原子关联**：新 Task 的 canonical ID、alias、初始 spec 和 execution 关联必须一致；失败时不得留下指向另一 Task 的部分关联。

### 3.4 实现方向

具体接口可沿用仓库风格，但必须在语义上分离：

- `allocateTaskId`：在持久命名空间内保留未占用身份。
- `createTask`：只创建新对象，重复 ID 明确失败。
- `continueTask`：明确关联已有对象，校验 workspace 后进入既有生命周期规则。

若保留 `T-YYYYMMDD-NNN`，应使用跨进程锁/原子保留等机制，定义锁失效与崩溃恢复；编号允许有空洞。也可采用兼容的唯一后缀设计，但须验证 SAFE_TASK_ID、ID 提取器、显示、alias 解析与历史格式兼容。

分配失败应返回结构化、可操作错误，例如 `TASK_ID_CONFLICT`、`TASK_ID_ALLOCATION_FAILED`、`TASK_WORKSPACE_MISMATCH`；不得继续宿主启动。

### 3.5 历史数据处理

- 不按 alias 相似度自动拆分或迁移已经混合的 Task。
- 历史碰撞记录应标为需核对，利用原启动收据、session 和 run 关联建立可验证映射。
- 修复 ID 分配不意味着已污染 ledger 自动可信；历史恢复继续遵守既有 Spec 的证据未知与正式 verdict 限制。
- 不自动修改原 session JSONL 或批量重跑原业务任务。

## 4. IS-02：TaskSpec 修复示例的语义保真

### 4.1 已观察故障

1. L13：Root 调用 `agent: "worker"`，请求运行冒烟测试并写完成报告，TaskSpec 的 validation 形状错误。
2. L14：插件指出格式错误，但给出的可复制示例写入 `role: "explorer"` 和 `validation.required: false`。
3. L16：Root 复制示例重新委派；L17 启动 `c18db534`。
4. 实际 `c18db534-f3d3-4ba8-884b-0e085dcfc9cd_reviewer_output.md` 明确报告：没有 shell/exec 或写文件能力，无法运行测试或写完成报告。

源码链路：

- `buildTaskSpecExample()` 缺少显式合法 role 时默认 Explorer，没有继承此次有效的 Worker 委派角色（`task.ts:331–338`）。
- 不合法 validation 被降为 `{required:false}`（`task.ts:361–372`）。
- Explorer 映射到 reviewer（`roles.ts:32`）。

离线输入 `toolName=subagent`、`input.agent=worker`、submitted title 为执行/写报告任务且 validation 为数组，稳定输出 Explorer 和非必需验证。

### 4.2 必须满足的不变量

1. **修格式不改角色**：合法的 submitted.role 优先；缺失时使用宿主适配/现有角色解析得到的有效委派角色，不能统一默认 Explorer。
2. **角色不靠自然语言猜测**：没有可信角色信息时明确要求补充。不得仅凭 objective 中出现“测试”“写入”等字样扩大工具权限。
3. **验证不静默降级**：不能因为 validation 形状非法，就把原验证意图当作不存在并输出非必需验证的“完整修复”。
4. **可保留字段不丢失**：合法 objective/title、cwd、scope、约束、验收条件及可可靠保留的验证定义，修复时继续保留；涉及权限的冲突须明确提示。
5. **修复状态可区分**：区分可无损修正的模板与仍需用户/Root 补充的草稿。schema-valid 不等于任务语义已完整。
6. **最终能力一致**：修复后的最终 child launch payload 必须匹配确认后的角色，不因中间模板的默认值变成只读 Reviewer。

### 4.3 结果契约

建议在现有错误详情中增加等价于以下内容的信息：

```ts
interface TaskSpecRepairResult {
  status: "repairable" | "needs-input";
  example?: Record<string, unknown>;
  changes: Array<{ field: string; reason: string }>;
  unresolvedFields: string[];
}
```

具体类型名可调整，但必须：

- 在可复制模板附近显示字段变更摘要与待补项。
- 只有可以保真生成有效 TaskSpec 时，才称为可直接重新提交的修复示例。
- 若 validation 无法无损转换，返回 `needs-input`，指出需要对象形状、required 及适用的验证定义；不虚构命令或结果。
- 本次输入原本非法，可以保持拒绝直到补齐；不得以降低验证要求换取模板校验通过。
- 共享模板服务于直接工具拒绝和子代理 TaskSpec 拒绝时，必须保留各自可信的角色来源，不能统一以 Explorer 覆盖。

## 5. 验收矩阵

| ID | 场景 | 必须断言 |
|---|---|---|
| I01 | 同日恢复 T-001 后创建新 Task | ID 不同；新 spec/alias/cwd 正确；旧记录不变 |
| I02 | 同一 ledger 下两个 workspace 创建 Task | ID 唯一；无跨 workspace 绑定 |
| I03 | 两个独立进程并发分配 | 无重复成功创建；冲突可重试；旧文件不被覆盖 |
| I04 | 超恢复上限、终态及未加载历史记录 | 全部仍占用原 ID |
| I05 | 隔离/损坏快照、分配或提交阶段崩溃 | 不复用占用 ID；失败可恢复；无错误关联 |
| I06 | 显式创建重复 ID | 明确冲突；旧 spec/state/report/evidence/usage 均不变 |
| I07 | 显式继续 canonical ID/alias | 同 workspace 按既有规则继续；跨 workspace 拒绝 |
| I08 | 本次三个旧 Task 与三个新业务 Task 的精简回放 | 新任务均独立；下发 canonical、alias、报告身份正确关联 |
| S01 | 重放 L13 原始非法 TaskSpec | 修复保留 Worker；不能生成 Explorer 完整修复 |
| S02 | submitted.role 合法、缺失及未知 agent | 优先级明确；未知不猜测权限 |
| S03 | 非法 validation 且存在验证意图 | 保真修复或 needs-input；不静默 required=false |
| S04 | 有效 required/commands 及其他合法字段 | 全部保留；变更摘要准确 |
| S05 | 无法可靠转换的 validation | 原输入仍被拒绝；待补字段明确；不启动宿主 |
| S06 | 修复后重新提交，检查最终 child launch payload | 实际 agent/role/工具能力仍满足确认的 Worker 任务 |
| S07 | 直接工具拒绝与 subagent 格式拒绝的共享模板 | 各角色来源处理一致；现有只读角色限制仍有效 |

测试要求：

- fixture 精简脱敏，保留本次触发故障的身份、缺失 role 和非法 validation 特征；不依赖用户目录或真实生信数据。
- I03 必须使用独立进程及共享测试 ledger，不能只用两个内存 TaskStore 代替。
- I05 使用故障注入，不只验证正常序列化。
- S06 必须检查最终宿主调用参数，不能只检查中间示例 JSON。
- 报告解析 fixture 区分“缺少报告”“结构合法”“身份合法”“正式验收通过”，不能互相替代。

## 6. 实施任务与验证

| 任务 | 主要位置 | 依赖 |
|---|---|---|
| 建立精简现场 fixture 和失败回放 | task/ledger/orchestrate/roles 测试、runtime fixtures | 无 |
| 全局 ID 分配、冲突创建与显式继续 | task.ts、ledger-store.ts、orchestrate.ts、相关身份调用方 | fixture |
| 修复模板角色来源与验证语义 | task.ts、policy.ts、orchestrate.ts、角色解析适配 | fixture |
| 最终 launch、并发、崩溃恢复验证 | 集成测试、宿主契约测试 | 两项实现 |
| 用户可见行为文档与验证摘要 | README、README.zh-CN、CHANGELOG | 实现及验收 |

实施前检查最新工作区及既有 runtime reliability 改动，沿用已新增的接口，避免覆盖正在进行的修复。新增测试必须接入标准测试命令。

定向测试后运行：

```bash
npm run typecheck
npm test
PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e
git diff --check
```

本 Spec 的完成清单：

- [ ] I01～I08、S01～S07 均通过。
- [ ] 多进程分配与崩溃恢复具有实际测试证据。
- [ ] 三个现场新任务不会复用旧探索 Task，alias 与 canonical 关联正确。
- [ ] L13 修复回放不再导致只读 Reviewer 误派。
- [ ] 无法保真修复的验证定义明确阻塞，不静默放宽要求。
- [ ] 既有报告身份、证据和正式 verdict 限制继续生效。
- [ ] 标准检查结果、实际宿主契约版本、未完成项已记录。

仅将本文件写入 docs 不代表上述实现或验收已经完成。
