[轮次] round_id=PLACEHOLDER

你是本轮的 **Executor**。Planner 是 **`w2E:pD`**（claude，同一目录）。
**做完必须用 `herdr agent prompt w2E:pD '<完整报告>'` 把报告送回给我** —— 你的 pane 里写的东西我看不到，
不送回来我会一直等一个已经做完的任务。

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

`/home/tcuni-claw/pi/pi-planner-only`，分支 `planner-only-cost-control`，基线提交 `ab0f9be`。
**不要 commit，不要 push，不要切分支。** 改动留在工作区，我来验收后自己提交。

## 任务：修工单 27 —— reviewer 输出合同缺 pass 绑定字段，严格模式下死锁

工单原文：`.scratch/planner-only-cost-control/issues/27-reviewer-contract-omits-pass-bindings.md`
**先完整读一遍**，它是本轮的权威；下面是要点复述，冲突时以工单为准。

### 缺陷

`review.ts` 的 `REVIEWER_PROMPT` 里发给 reviewer 的输出合同逐字规定了 ReviewResult 的形状：

```
  {"taskId":"{TASK_ID}","verdict":"pass|request_changes|blocked",
   "summary":"...","evidenceFresh":true,
   "findings":[{"severity":"...","category":"...","description":"...","requestedChange":"..."}]}
```

**里面没有 `reportRevision`，也没有 `workspaceDigest`。**
而同文件的 `validateReviewResultBinding` 规定 `verdict === "pass"` 时这两个字段缺任一条就报错拒收：

```
"ReviewResult is missing reportRevision; a pass must name the report revision it reviewed"
"ReviewResult is missing workspaceDigest; a pass must name the workspace summary it reviewed"
```

`roles.ts` 的 `buildFreshReviewerTask` 调用处只把这两个值放进发给 reviewer 的 **ReviewRequest 输入包**，从不要求回显。

**结果：一个严格照合同办事的 reviewer 永远产不出一份能被记录的 PASS。**
工单 22 把严格模式（`PI_PLANNER_ONLY_REQUIRE_REVIEW=1`）默认切成 `fresh` 之后，
`rootVerdictRefusal` 又要求 pass 必须有已记录的 reviewer ReviewResult，两道门槛互相咬死，Task 只能以 `blocked` 收场。
2026-09-08 的第五次真实重跑就是这么烧掉 50.8 分钟、$0.78 的：4 次 reviewer 全部照合同返回、全部被拒收，
其中 `0f57e0c8` 那份是格式完全合法、论证也扎实的 `verdict: pass`。

### 可选的两条修法（**二选一，你决定，但要在报告里说明为什么选它**）

1. **合同要求回显**：合同文本明写这两个字段取自 ReviewRequest 包里的同名值。
2. **编排侧补齐**：在记录 ReviewResult 前由编排侧补齐绑定（理由：reviewer 不该被要求复述它无法独立求证的值）。
   走这条路时，reviewer 主动写了**不一致**的值仍然必须按 mismatch 拒收 —— `validateReviewResultBinding`
   里那两条 mismatch 分支（`reportRevision mismatch` / `workspaceDigest mismatch`）行为逐字不变。

**不接受把 `validateReviewResultBinding` 的 pass 分支删掉了事。** 那道校验存在的理由（FR-03/D09：
pass 只对特定 report revision 与 workspace 有意义）没有消失，删掉等于把一个真实的失效保护换成绿灯。

### Planner 已定的一个语义（不要自行改动，按它实现并覆盖测试）

`roles.ts` 里 `workspaceDigest` 是**条件写入**的：只有 `report && target.task?.snapshot?.digest` 同时存在才进包。
也就是说 Task 没有绑定快照时，ReviewRequest 里根本没有这个值，reviewer 无从回显。
**因此：当本次 ReviewRequest 未携带 `workspaceDigest` 时，pass 不得因缺该字段被拒收**
（否则「照合同办事的 reviewer 必须能产出可记录的 pass」这条不变量在无快照场景下仍然不成立）。
`reportRevision` 没有这个问题，它总是有值（缺省 0）。这条要有独立测试。

### 验收（工单的 7 条，逐条做到）

1. reviewer 收到的输出合同与 `validateReviewResultBinding` 的 pass 要求一致：按合同原样返回的 ReviewResult，
   其 `verdict: "pass"` 能被记录，不再报 `ReviewResult is missing reportRevision`。
2. 若选方案 1：合同文本明写这两个字段取自 ReviewRequest 包里的同名值，且新增一条测试，
   **用合同模板本身渲染出的示例串**（即从 `reviewerPrompt()` 的返回里取出那段 JSON 示例去解析）通过 `validateReviewResultBinding`
   —— **不许用手写 fixture**。这条是本票最容易糊弄过去的地方：单元测试当初没拦住，正是因为 fixture 直接注入了真实链路上不存在的字段。
3. 若选方案 2：补齐发生在记录前，且 reviewer 主动写了不一致的值时仍按 mismatch 拒收，两条 mismatch 分支行为逐字不变。
4. 新增一条**端到端回归**：`PI_PLANNER_ONLY_REQUIRE_REVIEW=1` 下，reviewer 返回一份**只含合同规定字段**的 pass，
   Task 能走到 `completed`。**修复前该用例必须失败** —— 先写用例、先跑一次、把失败输出原文贴进报告，再动实现。
5. `request_changes` 与 `blocked` 两条路径的行为逐字不变。
6. **既有测试不许改 fixture 来迁就实现。** `reportRevision` 在测试里出现 15 次，全是注入值；
   其中断言 mismatch 行为的那些必须保留。
7. 不勾 `08-phase-a-acceptance-rerun.md` 的 checkbox、不改它的 Status、不改 `spec.md`。

### 改动范围围栏

**只许改**：`review.ts`、`roles.ts`、`review.test.mjs`、`roles.test.mjs`、`index.test.mjs`、`e2e.pi-subagents.test.mjs`
（后两个仅用于加端到端回归）。
**只读不许改**：`.scratch/planner-only-cost-control/**`（工单与 spec 都是我的，包括工单 27 自己 —— 不要往里写 Comments，
我来写）、`orchestrate.ts`、`task.ts`、`index.ts`、`usage.ts` 以及其余任何文件。
确实需要动围栏外的文件，**停下来问我**，不要自己扩大范围。

### 通过条件（四条命令全绿，报告里贴出退出码）

```
slot cpu -- npm run typecheck
slot cpu -- npm test
slot cpu -- npm run test:e2e
git diff --check
```

日志约定：把上面每条命令的输出存到 `.scratch/planner-only-cost-control/p11-r0NN-27-<名字>.log`
（`NN` 用本轮 round_id 的编号），`slot audit` / `slot status` 的预飞输出存
`p11-r0NN-27-slot-audit.log` 与 `p11-r0NN-27-slot-status.log`。

## 报告要求（送回 `w2E:pD`）

必须包含：① 选了哪条修法、为什么；② 改了哪些文件、每个文件改了什么（净增删行数）；
③ 端到端回归**修复前**的失败输出原文；④ 四条命令各自的退出码；⑤ 有没有碰围栏外的文件（应为「没有」）；
⑥ 预飞 `slot audit` 是否发现绕过 slot 的重进程。

**不要在报告里复述你没有实际跑过的结果。** 我会在我的 pane 里逐条复现你贴的证据，
对不上的部分会打回重做。
