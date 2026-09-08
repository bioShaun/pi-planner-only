# 28: worker 合同没写 `validation` 元素形状，且提取器把报错归给了别的对象

**What to build:** 两个缺陷叠在一起，先后关系是「A 造成拒收，B 让人查错方向」，必须一起修。

**A（真正的拒收原因）：合同与校验对 `validation` 元素形状的规定不一致。**
`report.ts:444` 的 `workerReportShapeReminder` 发给每个 worker 的形状串里，`validation` 只写成 `"validation":[]`
—— **对元素形状一个字都没说**。而 `report.ts:57` 的校验要求每个元素必须是对象（`{command,status,exitCode,summary}`），
worker 往里塞字符串就报 `validation[i] must be an object`。这与工单 27 是同一类缺陷：合同欠定义，校验严格，
照合同办事的子代理产不出可被接受的产物。

**B（掩盖 A 的原因）：`extractWorkerReport` 用「错误最少」挑候选，导致报错文案指向一个不相干的对象。**
`report.ts:497` 起的循环对每个 JSON 候选跑校验，全失败时保留 **`errors.length` 最小**的那份当作对外错误
（`if (!bestErrors || errors.length < bestErrors.length)`）。worker 输出里除 WorkerReport 外通常还有一个小 JSON
（`{taskId,head,lockfileDiff}` 之类），它只错 1 条（`status must be one of ...`），而真正的 WorkerReport 错 2–4 条
（`validation[i] must be an object`）。于是对外只看得到那句 **`status must be one of completed, partial, blocked, failed`**，
真实原因被完全掩盖。要求：报错必须指出它挑中了哪个对象、以及那个对象为什么被判为最接近的候选；
候选排序不应让一个明显不是 WorkerReport 的小对象盖过一个有 `version`+`taskId`+顶层合法 `status` 的对象。

**Blocked by:** None（源码在 `0fe04df`）。

**Status:** ready-for-agent

- [ ] `workerReportShapeReminder` 里 `validation` 的元素形状写明白（至少给出一个带 `command`/`status`/`exitCode`/`summary` 的示例元素），
      且新增一条测试：**用 `workerReportShapeReminder()` 渲染出的串本身**解析后过 `validateWorkerReport`（不许手写 fixture）。
- [ ] 决定并实现字符串数组写法的归宿，二选一，在回执里说明理由：
      ① 校验放宽为接受字符串元素并归一化成 `{summary: <字符串>}` 一类的对象；② 保持只接受对象，但合同必须先写清楚。
      **无论选哪条，`missingTaskSpecValidationCommands`（`roles.ts:89`）与 `workerValidationAllPassed`（`roles.ts:120`）
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
