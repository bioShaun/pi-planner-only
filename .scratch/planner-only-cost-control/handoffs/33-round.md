[轮次] round_id=PENDING

# 工单 33：worker 合同示例现在可以被照抄成一次伪造的 npm test 通过

**先丢弃你上一轮的一切假设。** 这一轮与你之前做过的任何工单无关，下面写到的就是全部上下文。
不要凭记忆认为某个文件"应该是"什么样，一律现读。

## 你的身份与返回地址

你是执行者。planner 在 pane `w2E:pD`。做完之后把回执发回给 planner，不要只写在自己的 pane 里。

## 环境规则（逐字遵守，不要跳过）

- Never create or place intermediate files, scratch files, temporary directories, caches, build
  staging output, or task artifacts under `/tmp` or its subdirectories.
- Put task-local intermediate files in the current working directory, preferably in a clearly
  named disposable subdirectory. 本轮日志一律写
  `.scratch/planner-only-cost-control/p12-r0NN-33-*.log`（`NN` 用本轮真实 round_id 的数字）。
- When intermediate files should be kept outside the current working directory, use `/project/tmp`。
- 预计跑超过 1 分钟、或吃超过 2G 内存、或大量读写 `/data_0` 的命令，一律用 `slot` 提交。
  本轮四条验收命令全部走 `slot cpu -- <命令>`。
- **每次启动重任务前必须先运行 `slot audit` 和 `slot status`，并把输出写入项目日志。**
- `slot audit` 若发现绕过 slot 的其他重进程，**不得擅自终止**；应等待、降低本任务并发或报告资源冲突。
  禁止先启动重活、事后再补查。（当前已知 `pbbwa` 与若干 `agy` 绕过了 slot，**不要动它们**，照常跑你的测试即可。）
- 不要用 `slot slots` 调大槽位数给自己插队。
- **不要读、不要打印、不要提交 `.agent-dir/models.json` 与 `.agent-dir/auth.json`** —— 里面是 API key。

## 工作区规则

- 代码基线：`32c8a0a`（工单 28 的落地提交）。其后只有文档提交，源码与该 commit 一致。分支 `planner-only-cost-control`。
- **不要 commit、不要 push、不要切分支、不要 stash。** planner 自己提交。
- **送出报告之后就不要再动工作区。** 上一次有执行者在报告发出后继续改文件，
  导致 planner 提交了一个中间态。想换方案、想补一笔，**先把想法写进回执问 planner**，不要直接改。

## 背景：这是我（planner）的工单造成的缺陷，不是你的锅

工单 28 刚刚落地。它把 `report.ts:448` 的 `workerReportShapeReminder` 从一份"取值图例"
改成了**一份可照抄的合法实例**（那个选择是对的：worker 会整段复制合同 JSON，图例形态过不了
`validateWorkerReport`）。同时 28 的条款要求示例的 validation 元素带上门槛读取的
`command` 与 `exitCode`。两条叠加，示例现在长这样：

```json
{"command":"npm test","type":"test","status":"passed","exitCode":0,"summary":"npm test passed"}
```

而 `roles.ts:59-70` 的 `wrapWorkerContract` 把这份实例放在
`Return only a WorkerReport JSON object:` 后面，**周围没有任何一句话让 worker 把值换成真值**。

后果是**严重度反转**。planner 实测（`.scratch/planner-only-cost-control/p12-r055-verify-28-copy-verbatim.log`）：

```
照抄之后：lastWorkerValidationPassed = true   missingTaskSpecValidationCommands(["npm test"]) = []
          → ORACLE_SUITE=bounded. ... Do not run npm test, npm run test:e2e, or the full suite.
28 修复之前（validation: []）：lastWorkerValidationPassed = false
          → ORACLE_SUITE=full. Re-run the listed validation commands.
```

一个一行命令都没跑、只把合同示例复制回来的 worker，现在能让 oracle **跳过全量套件**，
并让 TaskSpec 要求的 `npm test` 被记成已覆盖。28 修复之前，这份照抄会被 `status` 枚举挡下、
整份报告拒收 —— 吵闹但安全。现在是安静且危险。

**本仓库自己的记录证明 worker 确实会照抄形状串**，所以这不是理论风险。

## 要你做什么

让"照抄示例"的失败方向重新落回保守的那一侧：照抄要么被看出来，要么退化成**更多**验证，
绝不能退化成更少。三条路，**自己判断选哪条，并在回执里说明理由**：

- **① 示例仍是合法实例，但 validation 元素取一个不满足门槛的组合**
  （例如 `"status":"not-run"`，或 `"status":"failed","exitCode":1`），
  使照抄后 `lastWorkerValidationPassed` 为 false、oracle 走 full；
  `command`/`exitCode` 仍出现在示例里以说明形状。
  **planner 已实测这条可满足**（`p12-r055-verify-33-opt1-check.log`），三种写法都仍过 `validateWorkerReport`：

  ```
  {command,type,status:"not-run",summary}              validate [] | gatePassed false | missing ["npm test"]
  {command,type,status:"not-run",exitCode:0,summary}   validate [] | gatePassed false | missing ["npm test"]
  {command,type,status:"failed",exitCode:1,summary}    validate [] | gatePassed false | missing ["npm test"]
  ```

- **② 保留当前的 passed/0 示例，但在合同里加一句机器可检的祈使句**
  （例如 "Replace every value above with what you actually ran; copying this block verbatim is a false report."），
  并新增测试断言该句存在。选这条要论证：为什么"多一句散文"挡得住一个本来就在照抄的 worker。
- **③ 让示例里的值自我暴露**（`"command":"<the command you actually ran>"` 之类）。
  注意这会让串本身过不了校验，与工单 28 的条款直接冲突，选它必须给出如何两全的方案。

## 验收条款（逐条都要在回执里给证据）

1. 把 `JSON.parse(workerReportShapeReminder(id))` 原样当作 WorkerReport 时，
   `lastWorkerValidationPassed`（`roles.ts:118`）为 **false**，或该报告被明确判为不可接受。
   新增一条测试**直接用 `JSON.parse(workerReportShapeReminder(id))` 做输入**断言这一点 ——
   不许手写 fixture，不许把期望值抄成字面串。
2. `missingTaskSpecValidationCommands`（`roles.ts:89`）不再因为照抄而把一条 TaskSpec 要求的命令
   记成已覆盖；同样用渲染串做输入断言。
3. **工单 28 的这几条不变量逐字保住：**
   - `JSON.parse(workerReportShapeReminder(id))` 仍然过 `validateWorkerReport`（返回 `[]`）；
   - `report.test.mjs` 里 run5 四份样本的断言**一行不改**仍然全绿：
     `68b5f76e` / `a5b8f153` / `e567653d` 三份仍失败且错误含 `picked candidate with keys [`
     与 `validation[i] must be an object`；`74f164e8` 仍抽出 `status=completed`。
   - `extractWorkerReport` 的候选挑选逻辑（`isCanonicalReportShape` 那段）**不要动**。
4. `orchestrate.test.mjs` 的 I-2 用例仍然通过调用 `workerReportShapeReminder` 派生期望串，
   不许回退成硬编码字面量。
5. 不勾 08 的 checkbox、不改 08 的 Status、不改 `spec.md`、不改工单 33 正文。

## 围栏

- **可以改：** `report.ts`、`report.test.mjs`、`roles.ts`、`roles.test.mjs`。
- **可以改但必须在回执里说明为什么非改不可：** `orchestrate.test.mjs`。
- **只读，一个字都不要动：** `orchestrate.ts`、`types.ts`、`review.ts`、`task.ts`、`index.ts`、
  `usage.ts`、`evidence.ts`、`notify.ts`、`.scratch/**`（新建你自己的 `p12-r0NN-33-*.log` 除外）。
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
2. 你选了①②③哪条，**为什么**。
3. `git diff --numstat` 全文。
4. **修复前的 RED 原文**：新增的那条测试在改 `report.ts` 之前必须失败，把失败输出原文贴出来
   （含文件名与行号）。没有 RED 就等于没证明这条测试在测东西。
5. 四条命令的退出码与日志名。
6. `slot audit` / `slot status` 预飞日志名，以及是否发现绕过 slot 的进程（发现了也不要杀）。
7. 围栏：动了哪些文件，其中"要说明的"那一档说明理由；确认只读文件一个字没动。

**不要在报告里复述你没有实际跑过的结果。** 我会在我的 pane 里逐条复现你贴的证据，
对不上的部分会打回重做。
