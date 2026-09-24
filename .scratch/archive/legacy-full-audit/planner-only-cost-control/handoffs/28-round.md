[轮次] round_id=PLACEHOLDER

**这是一轮全新的任务，与上一轮（工单 27 / `review.ts`）无关。**
你的 pane 没有被清空（pairctl 不认识 cursor 的新会话命令），所以请**主动丢弃上一轮的一切上下文**：
围栏、基线提交、验收条款全部以本文件为准，不要沿用 27 那轮的任何假设。

你是本轮的 **Executor**。Planner 是 **`w2E:pD`**（claude，同一目录）。
**做完必须用 `herdr agent prompt w2E:pD '<完整报告>'` 把报告送回给我** —— 你的 pane 里写的东西我看不到，
不送回来我会一直等一个已经做完的任务。

**送出报告之后就不要再动工作区了。** 上一轮（27）出过一次事故：报告送回之后执行者继续改盘，
把我已经核完的状态换掉了，我提交时抓到的是一个中间态。**如果送完报告又想换方案，先问我，不要直接改。**

## 环境规则（你的 agent 不读全局规则文件，所以逐条写在这里，必须遵守）

- **不要**在 `/tmp` 或其子目录下创建任何中间文件、临时目录、缓存、构建产物。`/tmp` 是 62G tmpfs，写进去直接占物理内存。
  任务局部的中间文件放当前工作目录下清晰命名的一次性子目录；需要放到工作目录之外时用 `/project/tmp`。
- **预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交**：
  `slot cpu -- <命令>`（CPU 重 IO 轻）／`slot io -- <命令>`（重读写 `/data_0`）。
  本轮的 `npm test` / `npm run test:e2e` / `npm run typecheck` 都属于「超过 1 分钟」，**必须走 `slot cpu`**。
- **启动重任务前必须先跑 `slot audit` 和 `slot status`，并把输出写进项目日志文件**（见下面的日志约定）。
  禁止先启动重活、事后补查。`slot audit` 如果发现有绕过 slot 的其他重进程，**不得擅自 kill**，
  应等待、降低并发或在报告里写明资源冲突。
- 不要用 `slot slots` 调大槽位数给自己插队。

## 工作目录与分支

`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，基线提交 `c38d925`。
**不要 commit，不要 push，不要切分支。** 改动留在工作区，我来验收后自己提交。

## 任务：修工单 28 —— worker 合同没写 `validation` 元素形状，且提取器把报错归给了别的对象

工单原文：`.scratch/planner-only-cost-control/issues/28-worker-report-extractor-picks-wrong-object.md`
**先完整读一遍**，它是本轮的权威；下面是要点复述，冲突时以工单为准。
工单末尾有我在派活前做的二次核验，两处条款被我改过，**读那一段，不要照旧版理解**。

### 缺陷 A（真正的拒收原因）：合同欠定义，校验严格

`report.ts:444` 的 `workerReportShapeReminder()` 发给每个 worker 的形状串里，`validation` 只写成 `"validation":[]`
—— **对元素形状一个字都没说**。而 `report.ts:55` 起的 `validateValidationResult` 要求每个元素必须是对象。
worker 往里塞字符串就报 `validation[i] must be an object`。
这与工单 27 是同一类缺陷：**合同欠定义、校验严格，照合同办事的子代理产不出可被接受的产物。**

元素的真实契约在 `types.ts:149-155`（`ValidationResult`）：

```
command?: string          // 选填；但 roles.ts:89 的门槛靠它匹配 TaskSpec 里的命令
type: ValidationType      // 必填：test | build | lint | typecheck | manual | other
status: ValidationStatus  // 必填：passed | failed | not-run
exitCode?: number         // 选填；但 roles.ts:89 与 roles.ts:120 都读它，且要求 === 0
summary: string           // 必填非空
```

**示例元素必须同时带上校验器必填的 `type`/`status`/`summary` 和门槛读取的 `command`/`exitCode`。**
只写 `command`/`status`/`exitCode`/`summary`（漏 `type`）会被 `report.ts:59` 拒收 —— 工单旧版就是这么写错的。

### 缺陷 B（掩盖 A 的原因）：归一化把不相干的小对象修得比真报告还干净

`report.ts:509-526` 对每个 JSON 候选**先 `normalizeWorkerReport` 再校验**，全失败时保留 `errors.length`
最小的那份当作对外错误（`report.ts:523`）。`looksLikeReport`（`report.ts:486`）只要求有 `taskId` **或** `status`，
所以 worker 输出里那个不相干的小 JSON 也进了候选；归一化给它补上 `version`/`summary` 等字段之后，
它从 8 条错误变成**只剩 1 条**，赢过真报告的 2–4 条。

planner 实测（日志 `p12-r055-candidates.log`）：

```
68b5f76e  真报告 4 条 validation[i] must be an object   {taskId,head,lockfileDiff} 归一化后 1 条  → 小对象胜出
a5b8f153  真报告 4 条                                   {taskId,head,branch,ticket,statusLine,tests} 1 条 → 小对象胜出
e567653d  真报告 2 条                                   {taskId,repoHead,ticketsDone,readyForAgent} 1 条 → 小对象胜出
```

于是对外只看得到 **`status must be one of completed, partial, blocked, failed`**，真实原因被完全掩盖。
**这个错误文案骗过的第一个受害者就是工单 28 自己**（初版把成因写反了），所以修它的优先级不比 A 低。

（提醒：同一份数据**不做归一化**时真报告反而胜出。定位时不要只看原始 JSON，要走 `normalizeWorkerReport` 之后的结果。）

### 验收（工单条款，逐条做到）

1. `workerReportShapeReminder` 写明 `validation` 元素形状，示例元素同时带
   `type`/`status`/`summary`（校验器必填）与 `command`/`exitCode`（门槛读取）。
2. 新增一条测试：**用 `workerReportShapeReminder()` 渲染出的串本身**解析后过 `validateWorkerReport`（不许手写 fixture）。
   **这条今天不可满足，且原因不止 `validation`：** planner 实测
   `JSON.parse(workerReportShapeReminder("T-..."))` 过 `validateWorkerReport` 返回
   `["status must be one of completed, partial, blocked, failed"]` ——
   串里的 `status` 是选项枚举 `"completed|partial|blocked|failed"`、`summary` 是 `"..."`。
   **先决定这个串是「取值图例」还是「一份可照抄的合法实例」**，二选一，在报告里说明理由：
   ① 改成合法实例（`status` 取具体值、`summary` 写一句真话），图例信息移到旁边的散文里；
   ② 保留图例形态，测试改为断言「由图例派生出的示例」过校验 —— 选这条必须说明派生过程为什么不是变相的手写 fixture。
   **不接受放宽 `validateWorkerReport` 来迁就图例。**
3. 决定字符串数组写法的归宿，二选一并说明理由：① 校验放宽为接受字符串元素并归一化成对象；
   ② 保持只接受对象，但合同必须先写清楚。**无论选哪条，`missingTaskSpecValidationCommands`（`roles.ts:89`）
   与 `lastWorkerValidationPassed`（`roles.ts:118`）对 `item.command` / `item.status` / `item.exitCode` 的读法必须仍然成立**
   —— 不能把一个无 `exitCode` 的元素喂进去让门槛静默变松。
4. 提取器全失败时的报错指明挑中了哪个候选对象（例如打印它的键名或前若干字符），不再只报一句字段值非法。
5. 候选挑选不再让不相干小对象盖过真正的报告：一个同时有 `version`、`taskId` 和顶层合法 `status` 的候选，
   其错误优先于只有 1 条错误的小对象对外呈现。
6. 回归用例直接用 run5 的三份真实输出做输入（**只读**）：
   `.scratch/planner-only-cost-control/phase-a-08-run5/artifacts/subagent-artifacts/68b5f76e-*_output.md`、
   `a5b8f153-*_output.md`、`e567653d-*_output.md`。
   **修复前用例必须失败** —— 先写用例、先跑一次、把失败输出原文贴进报告，再动实现。
7. `74f164e8-*_output.md`（`validation` 为对象数组）行为逐字不变 —— 它现在就能正常提取出 `status=completed`，
   不许被改回归。
8. 不勾 `08-phase-a-acceptance-rerun.md` 的 checkbox、不改它的 Status、不改 `spec.md`。

### 改动范围围栏

**只许改**：`report.ts`、`report.test.mjs`。
**可以改，但必须在报告里单独说明为什么非改不可**：`orchestrate.ts` / `orchestrate.test.mjs`
（仅当把「挑中了哪个候选」透出到 Root 看到的文案确实需要动编排侧时）、`roles.test.mjs`（仅当为条款 3 补门槛覆盖）。
上一轮我把围栏画得太死，逼出了一个次优设计，所以这次把这两处写成「可以动但要说明」。
**只读不许改**：`.scratch/planner-only-cost-control/**`（工单与 spec 都是我的，包括工单 28 自己 —— 不要往里写 Comments，
我来写；run5 产物只读）、`types.ts`、`roles.ts`、`review.ts`、`task.ts`、`index.ts`、`usage.ts` 以及其余任何文件。
`types.ts` 的 `ValidationResult` **不许改** —— 本票要修的是合同文本与提取器，不是数据结构。
确实需要动围栏外的文件，**停下来问我**，不要自己扩大范围。

### 通过条件（四条命令全绿，报告里贴出退出码）

```
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

日志约定：把上面每条命令的输出存到 `.scratch/planner-only-cost-control/p12-r0NN-28-<名字>.log`
（`NN` 用本轮 round_id 的编号），`slot audit` / `slot status` 的预飞输出存
`p12-r0NN-28-slot-audit.log` 与 `p12-r0NN-28-slot-status.log`。

## 报告要求（送回 `w2E:pD`）

必须包含：① 条款 2 与条款 3 各选了哪条、为什么；② 改了哪些文件、每个文件改了什么（净增删行数）；
③ 回归用例**修复前**的失败输出原文；④ 四条命令各自的退出码；⑤ 有没有碰「可以改但要说明」的两处、
以及有没有碰围栏外的文件；⑥ 预飞 `slot audit` 是否发现绕过 slot 的重进程。

**不要在报告里复述你没有实际跑过的结果。** 我会在我的 pane 里逐条复现你贴的证据，
对不上的部分会打回重做。
