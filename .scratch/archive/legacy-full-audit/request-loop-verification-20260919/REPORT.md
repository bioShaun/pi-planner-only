# 整个请求的无进展停止验证

日期：2026-09-19。源码基线：`3991c5c762584cbbc235576359734259f69931ce`。

结论：当前插件的实际工具入口允许连续无进展调用及子执行恢复；单次调用拦截、单次子执行取消没有升级为整个 Root 请求的停止。复现通过，“请求停止”断言失败。没有修改生产代码。

## 方法与边界

`probe.mjs` 加载真正的 `index.ts`，依次经过 `tool_call`、注册工具的 `execute`、`createHostLauncher` 事件适配器、生命周期以及磁盘账本。替换的是宿主事件总线、Git 返回值及 child 事件源。故障 child 每次报告 101 tokens，触发真实 100-token envelope；收到 CANCEL 后返回匹配的 cancelled terminal。Root 的 `ctx.abort` 被记录。

没有调用真实模型、网络或子进程。这个实验是确定性的插件集成验证，不是自然语言驱动的真实 Pi 会话。12 次是实验主动设定的停止点，不是产品自动停止点；不能把有限复现表述为观察到了无限运行，也不能据此断言所有真实模型都必然循环。

## 实测

| 场景 | 结果 |
|---|---|
| 同一不存在 Task 的完全相同 verdict 调用 12 次 | 前 3 次执行后拒绝，后 9 次在 hook 拦截；Root abort 为 0 |
| 同一不存在 Task，仅逐次改变 summary，调用 12 次 | 12 次执行后拒绝，0 次重复拦截；Root abort 为 0 |
| 同一 Task，child 每次无报告且超限取消，恢复引用上一轮真实 executionId | 12 次启动、12 次 CANCEL、停止均确认；reports=0，reviewRound=0，recoveryHistory=11，recovery.required=true |
| 对照：恢复时只改变 reason，复用已消费的 evidenceRefs | 正确拒绝 equivalent recovery decision，未启动第 13 个 child |

第三场景中每轮 `evidenceRefs` 是最新执行的引用，失败性质、目标和预算保持不变。它说明运行级恢复去重不能替代任务级无进展次数上限；不是声称仅改 reason 就能绕过恢复去重。

## 可重复命令与独立复核

从仓库根执行：

```sh
node --experimental-strip-types .scratch/request-loop-verification-20260919/probe.mjs
node --experimental-strip-types .scratch/request-loop-verification-20260919/probe.mjs --assert-request-stop
```

独立 Validator 实际执行：

- 第一条 exit 0，见 [validation-observed.log](validation-observed.log)，证据目录 `run-2z9A6F/`。
- 第二条 exit 1，明确 `REQUEST_STOP_MISSING`，见 [validation-stop-assertion.log](validation-stop-assertion.log)，证据目录 `run-JIk2T9/`。
- 每个证据目录保留 `trace.json`、`results.json` 和隔离的 Task ledger。
- 执行前后脚本 SHA-256 相同：`691886dd5be589171f876c2ff01d0a0438f24426a4574d546a816988a6bf3d7d`。
- `git diff --stat` 为空，全部新增物位于本验证目录。

校准记录：第一次 Root 试跑 exit 1，因为 fixture 在 redelegate 重传了只允许创建时指定的 acceptanceMode，收到 ACCEPTANCE_MODE_IMMUTABLE。这是测试输入错误；移除重入参数中的该字段后通过（`run-4Yt24b/`），再冻结脚本交独立 Validator。没有修改产品来放宽约束。

## 代码解释

- `refusal-breaker.ts:128` 按工具名和全部参数的规范化 hash 区分调用；summary 改变产生新计数项。
- `index.ts:519` 的拒绝包装器仅追加提示、通知并抛错；`index.ts:1489` 仅返回 block，没有调用 Root abort。
- `delegate.ts:275` 的恢复去重比较 action、worktreeDecision 和 evidenceRefs，明确忽略 reason；新的执行引用改变去重依据。
- `delegate.ts:915` 取消的是单次 child 的 AbortController。`MAX_REVIEW_ROUNDS` 限制审核纠正轮，不覆盖本实验的 runaway 恢复，账本中的 reviewRound 一直为 0。
- `index.ts:1584` 明确说明旧启动时累计预算硬门禁随旧委派链移除，当前只剩通知。不能依靠配置名中的 hard 推断它终止 Root 请求。此项是静态发现，本实验没有测试各种预算配置。

另有只读检查线索：`recordRecoveryAttempt`（`task.ts:1934`）在当前生产 TypeScript 中没有调用方，可能影响另一条 evidence revalidation 计数。这不属于本次 runaway 复现，不作为已动态验证缺陷。

## 后续修复应满足的性质

以整个用户请求为范围记录连续无进展，并覆盖参数改写、恢复和新建 Task；达到界限后由宿主实际结束自动尝试。保留合法参数修正机会、现有单次 child 取消和写入隔离。修复后应让停止断言通过，同时调整脚本以验证具体停止边界，不能仅让重复调用返回另一条错误文字。
