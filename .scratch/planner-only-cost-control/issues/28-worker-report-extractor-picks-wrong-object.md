# 28: worker 合同没写 `validation` 元素形状，且提取器把报错归给了别的对象

**What to build:** 两个缺陷叠在一起，先后关系是「A 造成拒收，B 让人查错方向」，必须一起修。

**A（真正的拒收原因）：合同与校验对 `validation` 元素形状的规定不一致。**
`report.ts:444` 的 `workerReportShapeReminder` 发给每个 worker 的形状串里，`validation` 只写成 `"validation":[]`
—— **对元素形状一个字都没说**。而 `report.ts:55-58` 的校验要求每个元素必须是对象（真实形状见 `types.ts:149-155`：必填 `type`/`status`/`summary`，选填 `command`/`exitCode`），
worker 往里塞字符串就报 `validation[i] must be an object`。这与工单 27 是同一类缺陷：合同欠定义，校验严格，
照合同办事的子代理产不出可被接受的产物。

**B（掩盖 A 的原因）：`extractWorkerReport` 用「错误最少」挑候选，而归一化先把不相干的小对象修得几乎无错。**
`report.ts:509-526` 的循环对每个 JSON 候选先跑 `normalizeWorkerReport(parsed, context)` 再跑校验，
全失败时保留 **`errors.length` 最小**的那份当作对外错误
（`report.ts:523`：`if (!bestErrors || errors.length < bestErrors.length)`）。
worker 输出里除 WorkerReport 外通常还有一个小 JSON（`{taskId,head,lockfileDiff}` 之类），
`looksLikeReport`（`report.ts:486`）只要求有 `taskId` **或** `status`，所以它也进了候选；
归一化会给它补上 `version` / `summary` 等字段，把它从 8 条错误修到**只剩 1 条**
（`status must be one of ...`），于是它赢过了真正的 WorkerReport（2–4 条 `validation[i] must be an object`）。

planner 实测（`p12-r055-candidates.log`，2026-09-08，逐候选先归一化再校验）：

```
68b5f76e  真报告 4 条 validation[i] must be an object   小对象 {taskId,head,lockfileDiff} 归一化后 1 条  → 小对象胜出
a5b8f153  真报告 4 条                                   小对象 {taskId,head,branch,ticket,statusLine,tests} 1 条 → 小对象胜出
e567653d  真报告 2 条                                   小对象 {taskId,repoHead,ticketsDone,readyForAgent} 1 条 → 小对象胜出
```

（同一份数据不做归一化时真报告反而胜出 —— 所以「归一化把噪声修得比真货干净」是本缺陷的机制，
不是「小对象天生错得少」。定位时不要只看原始 JSON。）

要求：报错必须指出它挑中了哪个对象、以及那个对象为什么被判为最接近的候选；
候选排序不应让一个明显不是 WorkerReport 的小对象盖过一个有 `version`+`taskId`+顶层合法 `status` 的对象。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] `workerReportShapeReminder` 里 `validation` 的元素形状写明白。**元素的真实契约是
      `types.ts:149-155` 的 `ValidationResult`：`type`（必填，取值 test|build|lint|typecheck|manual|other）、
      `status`（必填，取值 passed|failed|not-run）、`summary`（必填非空）、`command` 与 `exitCode` 选填。**
      示例元素必须同时带上校验器要求的 `type`/`status`/`summary` **和**门槛读取的 `command`/`exitCode`
      —— 只写后四个（漏 `type`）会被 `report.ts:59` 拒收。
- [ ] 新增一条测试：**用 `workerReportShapeReminder()` 渲染出的串本身**解析后过 `validateWorkerReport`（不许手写 fixture）。
      **注意这条今天不可满足，且原因不止 `validation`：** planner 实测，
      `JSON.parse(workerReportShapeReminder("T-..."))` 过 `validateWorkerReport` 返回
      `["status must be one of completed, partial, blocked, failed"]` ——
      因为串里的 `status` 写的是选项枚举 `"completed|partial|blocked|failed"`、`summary` 写的是 `"..."`。
      所以要先决定这个串是**「取值图例」还是「一份可照抄的合法实例」**，二选一并在回执里说明理由：
      ① 改成合法实例（`status` 取一个具体值、`summary` 写一句真话），图例信息移到旁边的散文里；
      ② 保留图例形态，但测试改为断言「由图例派生出的示例」过校验 —— 若选这条，
      必须说明派生过程为什么不是变相的手写 fixture。**不接受放宽 `validateWorkerReport` 来迁就图例。**
- [ ] 决定并实现字符串数组写法的归宿，二选一，在回执里说明理由：
      ① 校验放宽为接受字符串元素并归一化成 `{summary: <字符串>}` 一类的对象；② 保持只接受对象，但合同必须先写清楚。
      **无论选哪条，`missingTaskSpecValidationCommands`（`roles.ts:89`）与 `lastWorkerValidationPassed`（`roles.ts:118`）
      对 `item.command` / `item.status` / `item.exitCode` 的读法必须仍然成立** —— 不能把一个无 `exitCode` 的元素喂进去让门槛静默变松。
- [ ] 提取器全失败时的报错指明挑中了哪个候选对象（例如打印它的键名或前若干字符），不再只报一句字段值非法。
- [ ] 候选挑选不再让不相干小对象盖过真正的报告：一个同时有 `version`、`taskId` 和顶层合法 `status` 的候选，
      其错误优先于只有 1 条错误的小对象对外呈现。
- [ ] 回归用例直接用 run5 的三份真实输出做输入：`phase-a-08-run5/artifacts/subagent-artifacts/68b5f76e-*_output.md`、
      `a5b8f153-*_output.md`、`e567653d-*_output.md`。修复前用例必须失败，回执贴出失败输出原文。
- [ ] `74f164e8-*_output.md`（`validation` 为对象数组）行为逐字不变 —— 它现在就能正常提取出 `status=completed`，不许被改回归。
- [ ] 不勾 08 checkbox、不改 08 Status、不改 `spec.md`。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（阶段 A 验收决策）。

来源：08 第五次重跑 `phase-a-08-run5`（2026-09-08）。该轮 `grep -c 'not a valid WorkerReport'` 为 **6**（08 条款 8 要求 0）。

**2026-09-08 本票被推翻重写一次，原因值得记下来。** 初版（`round_id=claude-pD-2026-09-08-open-28`）写的是
「`validation` 用**对象数组**写法会触发拒收，字符串数组本来就能过」，并指定用 `74f164e8-*_output.md` 当回归输入。
派活前 planner 在自己的 pane 里实跑了一遍 `extractWorkerReport`，结论**正好相反**：

```
74f164e8  ok status=completed          ← 初版指定的"失败样本"其实是通过的
68b5f76e  ERR: status must be one of…  ← 真实报告的真实错误是 validation[0..3] must be an object
a5b8f153  ERR: status must be one of…  ← 同上
e567653d  ERR: status must be one of…  ← 同上（2 条）
```

逐候选跑校验后才看清：真报告（`version,taskId,status,summary,changedFiles,validation…`）错的是
`validation[i] must be an object`（4/4/2 条），对外呈现的那句 `status must be one of …` 来自同一份输出里的
另一个小对象（`{taskId,head,lockfileDiff}` / `{taskId,head,branch,ticket,statusLine,tests}` /
`{taskId,repoHead,ticketsDone,readyForAgent}`），它只错 1 条，被「错误最少」的规则选中。
**初版工单是被这个错误文案骗了的 —— 缺陷 B 的代价，第一个受害者就是这张票本身。** r4 当时归因不清也是同一原因。

另外澄清两份被误算进来的样本：`52e07540` 与 `bf04bce7` 报的是 `worker output did not contain a WorkerReport object`，
两者输出都是散文，起因是「Root 没有嵌入 TaskSpec，objective/scope/acceptanceCriteria 全空」——
那是**工单 30** 的范围，不是本票的。本票只管上面 A、B 两条。

优先级低于 27，但同属 08 重跑的阻塞项。

round_id=claude-pD-2026-09-08-open-28
round_id=p11-r053（重写）

2026-09-08 派活前 planner 二次核验（round_id=p12-r055），改了两处条款，理由如下：

- 条款 1 原文要求示例元素带 `command`/`status`/`exitCode`/`summary`，**漏了校验器必填的 `type`**。
  照原文写出来的示例会被 `report.ts:59` 判 `validation[0].type must be one of ...`，
  也就是同一条条款的两半互相打架 —— 与工单 27 是同一类「合同欠定义」的错误，只是这次出在工单自己身上。
- 条款 2（渲染串过校验）原文默认「只要补上 validation 元素形状就能过」。实测不成立：
  `status` 与 `summary` 两个占位符本身就会让校验失败，必须先决定这个串的性质。这条不在原票范围内，
  但它决定条款可不可满足，所以写进条款而不是留给执行者撞。
- 缺陷 B 的机制补上了归一化这一步（原文只说「小对象错得少」，实测是归一化把它修干净的）。

- 条款 2 里引用的门槛函数名原文写的是 `workerValidationAllPassed`，**这个函数不存在**；
  实际是 `roles.ts:118` 的 `lastWorkerValidationPassed`。已改。

round_id=p12-r055（派活前核验）
