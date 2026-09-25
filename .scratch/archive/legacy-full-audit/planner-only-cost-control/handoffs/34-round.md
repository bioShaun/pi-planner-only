[轮次] round_id=PENDING

# 工单 34：漏写 status 的 validation 被推断成 passed，于是 oracle 不再跑全量套件

**先丢弃你上一轮的一切假设。** 这一轮与你之前做过的任何工单无关，下面写到的就是全部上下文。
不要凭记忆认为某个文件"应该是"什么样，一律现读。

## 你的身份与返回地址

你是执行者。planner 在 pane `w2E:pD`。做完之后把回执发回给 planner，不要只写在自己的 pane 里。

## 环境规则（逐字遵守，不要跳过）

- Never create or place intermediate files, scratch files, temporary directories, caches, build
  staging output, or task artifacts under `/tmp` or its subdirectories.
- Put task-local intermediate files in the current working directory, preferably in a clearly
  named disposable subdirectory. 本轮日志一律写
  `.scratch/planner-only-cost-control/p12-r0NN-34-*.log`（`NN` 用本轮真实 round_id 的数字）。
- When intermediate files should be kept outside the current working directory, use `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。
  本轮四条验收命令全部走 `slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志。**
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
  禁止先启动重活、事后再补查。（当前已知 `bowtie2-align-l`、`sort`、若干 `agy` 绕过了 slot，
  **不要动它们**，照常跑你的测试即可。）
- 不要用 `slot slots` 调大槽位数给自己插队。
- **不要读、不要打印、不要提交 `.agent-dir/models.json` 与 `.agent-dir/auth.json`** —— 里面是 API key。

## 工作区规则

- 代码基线：`c0aede1（工单 33 的落地提交；其后只有文档提交，源码与之一致）`。分支 `planner-only-cost-control`。
- **不要 commit、不要 push、不要切分支、不要 stash。** planner 自己提交。
- **送出报告之后就不要再动工作区。** 之前有执行者在报告发出后继续改文件，
  导致 planner 提交了一个中间态。想换方案、想补一笔，**先把想法写进回执问 planner**，不要直接改。

## 缺陷

`report.ts:227-232` 的 `normalizeWorkerReport` 在 validation 元素的 `status`
**缺失、为 null 或为空串**时，按 `exitCode` 推断：

```ts
let inferred: ValidationStatus = "not-run";
if (item.exitCode === 0) inferred = "passed";
else if (Number.isInteger(item.exitCode) && item.exitCode !== 0) inferred = "failed";
item.status = inferred;
repairs.push(`${label}.status missing → ${inferred}`);
```

推断本身不离谱。问题是**推断出来的 `passed` 与 worker 明写的 `passed` 被门槛同等对待**：
`roles.ts:93` 的 `missingTaskSpecValidationCommands` 和 `roles.ts:121` 的
`lastWorkerValidationPassed` 只看 `item.status === "passed" && item.exitCode === 0`，
不问这个 `passed` 是谁写的。

planner 实测（走完整条 `extractWorkerReport` 管线，
`.scratch/planner-only-cost-control/p12-r056-33-verify-inference.log`）：

```
status 整个字段不写，exitCode 0   repairs ["...status missing → passed"]  gatePassed true   missing []  → ORACLE_SUITE=bounded
status 写成空串，exitCode 0       repairs ["...status missing → passed"]  gatePassed true   missing []  → ORACLE_SUITE=bounded
status 明写 not-run，exitCode 0   repairs []                              gatePassed false  missing ["npm test"] → ORACLE_SUITE=full
```

**worker 一个字都没说自己通过，只要漏写 `status` 且带了 `exitCode: 0`，
就能让 oracle 不再重跑全量套件。** oracle 存在的理由是独立复核 worker，
让 worker 的沉默来放松这道复核，方向是反的。

**这不是假设。** planner 扫了 run5 全部 worker 输出
（`p12-r056-33-verify-run5-repairs.log`）：

```
75d7ae1c  ["validation[0].status missing → passed", "validation[1].status missing → passed"]
e63c7583  ["validation[0].status missing → passed", ... 共 3 条]
```

两份真实报告、五条 validation，全部被推断成 `passed`。

## planner 的倾向（你可以反驳，但要给理由）

**推断出来的状态不应该满足门槛。** 推断可以保留（它对 repairs 与渲染有用），
但要能区分来源，让两道门槛只认 worker 明写的 `passed`。机制自选，例如：

- 给元素打一个来源标记（`inferred: true` 之类），门槛跳过带标记的；
- 让门槛消费归一化前的原始值；
- 让 `normalizeWorkerReport` 在 `status` 缺失时一律推断成 `not-run`（最简），
  在 repairs 里说清楚 exitCode 是多少。

**不接受直接删掉推断逻辑** —— 那会让今天能被接受的报告变成不可接受，是另一类回归。

## 验收条款（逐条都要在回执里给证据）

1. validation 元素**没写 `status`**、只带 `exitCode: 0` 的报告，归一化后不再满足
   `lastWorkerValidationPassed`，也不再让 `missingTaskSpecValidationCommands` 把该命令记成已覆盖。
   **新增测试直接用 run5 的两份真实输出做输入**：
   `.scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts/75d7ae1c-*_output.md`
   与 `e63c7583-*_output.md`（只读）。不许手写 fixture。
2. worker **明写** `status:"passed"` + `exitCode:0` 的既有行为逐字不变，两道门槛仍然放行。
3. `status` 写成空串、写成 null 的情形与"缺失"同等处理，各有测试覆盖。
4. 推断结果仍出现在 `repairs` 里。渲染函数是 `renderValidationResults`（`report.ts:664-674`，
   打印 `[${item.status}]`）：**worker 明写 status 的报告，渲染输出逐字不变**；
   推断类报告的渲染文本允许变化。
5. 工单 33 的不变量保住：`roles.test.mjs` 里那一块
   （`JSON.parse(workerReportShapeReminder("T-copy"))` → `validateWorkerReport` 为 `[]`、
   `lastWorkerValidationPassed` 为 false、`missingTaskSpecValidationCommands` 为 `["npm test"]`）
   **一行不改**仍然全绿。
6. 工单 28 的不变量保住：`report.test.mjs` 里 run5 四份样本
   （`68b5f76e` / `a5b8f153` / `e567653d` 失败含 `picked candidate with keys [`，
   `74f164e8` 抽出 `status=completed`）的断言**一行不改**仍然全绿；
   `extractWorkerReport` 的 `isCanonicalReportShape` 不要动。
7. 不勾 08 checkbox、不改 08 Status、不改 `spec.md`、不改工单 34 正文。

## 围栏

- **可以改：** `report.ts`、`report.test.mjs`、`roles.ts`、`roles.test.mjs`。
- **可以改但必须在回执里说明为什么非改不可：** `types.ts`（只有在你选"来源标记"路线时才可能需要
  给 `ValidationResult` 加字段；加字段要说明为什么不会破坏既有消费者）、`orchestrate.test.mjs`。
- **只读，一个字都不要动：** `orchestrate.ts`、`review.ts`、`task.ts`、`index.ts`、`usage.ts`、
  `evidence.ts`、`notify.ts`、`.scratch/**`（新建你自己的 `p12-r0NN-34-*.log` 除外）。
- `.scratch/planner-only-cost-control/phase-a-08-run5/**` 是回归输入，**只读**。

## 验收命令（四条都要跑，贴出退出码与日志名）

```
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

四条必须全 exit 0。`npm run test:e2e` 里既有的
`§F 预算宿主契约未验证 (pi-subagents 未暴露无模型调用的 budget 契约公开接口)`
是已知项，不算失败。

## 回执要写什么

1. `round_id` / pane / HEAD / 分支 / 是否 commit（应为否）。
2. 你选了哪条路线，**为什么**；如果反驳了 planner 的倾向，说清理由。
3. `git diff --numstat` 全文。
4. **修复前的 RED 原文**：新增的那条测试在改实现之前必须失败，把失败输出原文贴出来
   （含文件名与行号）。没有 RED 就等于没证明这条测试在测东西。
5. 四条命令的退出码与日志名。
6. `slot audit` / `slot status` 预飞日志名，以及是否发现绕过 slot 的进程（发现了也不要杀）。
7. 围栏：动了哪些文件，其中"要说明的"那一档说明理由；确认只读文件一个字没动。

**不要在报告里复述你没有实际跑过的结果。** 我会在我的 pane 里逐条复现你贴的证据，
对不上的部分会打回重做。
