# P0 前置验证

基线：`3991c5c762584cbbc235576359734259f69931ce`。实测时间：2026-09-19 UTC / 2026-09-19 至 20 Asia/Shanghai。

## 结论及其范围

P0 可以以“持久关闭新委派 + 取消活动 child + 保留未确认 Writer hold”为保底交付。完整 Root 请求停止必须逐宿主模式证明，不能只检查是否调用了 abort。现有 evidence revalidation 三次上限也存在已动态复现的计数接线缺口。

| 对象 | 当前固定版本 |
|---|---|
| 插件源码 | 0.8.0 / `3991c5c` |
| 仓库本地 Pi 测试依赖 | 0.84.4 |
| 全局 `pi` 命令对应 Pi host | 0.85.1 |
| 当前已安装 launcher | pi-subagents 0.69.0 |
| 历史模型证据的 launcher | pi-subagents 0.68.0 |

## 宿主动态探针

[host-probe.mjs](../host-probe.mjs) 在进程内加载实际全局 Pi 0.85.1 SDK 的 AgentSession、ExtensionRunner、Agent loop；模型使用宿主自带 faux provider，资源与会话隔离。它不加载本插件或真实 launcher，不运行 OS child process，也不是自然语言 TUI/CLI 验收。

命令：`node .scratch/request-stop-p0-20260919/host-probe.mjs`。六场景的实现者运行 exit 0，原始结果见 [host-six-scenarios.log](host-six-scenarios.log)。初版前三场景的独立验证见 [validation.md](validation.md)；扩展六场景也已独立通过，见 [validation-v2.md](validation-v2.md)、[validated-host-v2.log](validated-host-v2.log) 及该版本的前后哈希。

| 第一条用户输入的场景 | 模型调用数 | 含义 |
|---|---:|---|
| 普通响应 | 1 | 对照 |
| agent_end 安排 custom followUp，再 ctx.abort | 2 | abort 后仍发生续跑 |
| 同上，但先通过 AgentSession.clearQueue 清队列 | 1 | 对照仅证明 session API；插件 ctx 无此接口 |
| 单个工具被 block + terminate | 1 | 当前全终止批次能阻止下一次模型调用 |
| terminate 前已有 custom followUp | 2 | terminate 也不是整个请求的硬停止 |
| 一个终止工具和一个正常工具的混合批次 | 2 | 不是所有 finalized results 都 terminate 时仍继续 |

每个场景另验证下一条 extension input 和独立 interactive input，输入来源顺序均为 `interactive, extension, interactive`；最终能到达 `agent_settled`。被封锁的 probe 工具 execute 为 0；混合批次的允许工具执行一次。

静态来源以全局安装包 `.../@earendil-works/pi-coding-agent/` 为根：

- `dist/core/agent-session.js:772`：agent_end 后可能因队列、重试、compaction 继续；`:1195` 清队列，`:1222` abort 不清队列。
- `dist/core/extensions/types.d.ts:209`：ExtensionContext 没有 clearQueue；`:555` agent_end 是 loop 边界；`:559` agent_settled 才涵盖自动后续工作；`:655` input source 包含 interactive/rpc/extension。
- `dist/core/agent-session.js:2064`：默认 ctx.abort 是非等待的 session.abort。`dist/modes/interactive/interactive-mode.js:1402,3615` 的 TUI binding 会先恢复/清空队列；这只是源码证据，未运行真实 TUI。
- `dist/core/extensions/types.d.ts:818` 与 agent-core `dist/agent-loop.js:137,158,330,375,417`：terminate 为真实工具批次控制；队列及混合批次限制不能忽略。此契约在本地 0.84.4 也存在，未据此外推完整行为兼容。
- `dist/core/extensions/runner.js:820`：before_provider_request 修改 payload，handler 异常被捕获；不能将抛异常当成可靠的模型 admission 拦截。

`hasPendingMessages()` 在 custom followUp 的探针中仍可返回 false，因此不得把它单独作为“自动工作已清空”的证明。下一请求的自动解锁需已观察到可信 settled，再出现受支持来源的新输入；未知宿主能力保持封锁并提供 operator-only 路径。

初次宿主探针误把 ExtensionAPI.sendUserMessage 当可等待方法，随后新 prompt 与尚在启动的 extension prompt 竞态，产生 `Agent is already processing a prompt`。保留 [失败日志](host-probe-attempt-1.log)；改为等待真实 session.sendUserMessage 后通过。没有修改宿主来适配探针。

## evidence revalidation 动态探针

[revalidation-probe.mjs](../revalidation-probe.mjs) 加载真实插件的 hook、注册工具、事件 adapter、生命周期和磁盘 ledger，注入 Git 返回与 child terminal。初始委派后，每轮改变模拟 HEAD，使 Root 的真实 pass verdict 产生 `revalidate`，然后使用 canonical taskId 调真实 planner_redelegate。没有直接调用计数方法或伪造 ledger。

- 初始执行 1 次 + 实际重新验证 4 次 = 5 次 child REQUEST。
- 每次 `recoveryAttempts === 0`，`recoveryDispatches` 为空，`pendingRevalidationKey` 未被消费；`reviewRound === 0`。
- 基线复现命令 exit 0；加 `--assert-counter-wired` exit 1，明确 `RECOVERY_COUNTER_UNWIRED`。见 [validated-revalidation.log](validated-revalidation.log)、[validated-counter-required.log](validated-counter-required.log)。独立 Validator 已核实哈希与输出。

静态解释：`types.ts:52` 定义上限 3；`review.ts:650` 读取计数；`task.ts:1907` 保存 grant，`:1920` 的 takePendingRevalidation 与 `:1934` 的 recordRecoveryAttempt 没有生产调用方；`orchestrate.ts:2883` 和 reviewer 路径保存 grant，实际 redelegate 派发没有消费/计数。

失败尝试保留：attempt-1 缺少 fixture UI stub；attempt-2 仅改物理文件但模拟 Git 仍报告完全未变，没有触发期望的 revalidate。最终探针明确改变模拟 HEAD，完整走通受支持的 stale evidence 路径。第二次尝试不作为文件漂移安全性的证明或否定，也未为本轮扩大修复范围。

## 模型身份核验

[audit-models.py](../audit-models.py) 只读取已有历史 meta/ledger/baseline，按 runId 关联；结果见 [validated-models.json](validated-models.json)。

- 历史 A 的 3 个 Explorer execution 实际均为 `tcuni-luna/gpt-5.6-luna`。baseline 的 scout override 意图是 `qwen-local/qwen3.8-27b`；当时 planner-scout 无路由能力，应标为 routing-absent，不标为接线错误。
- 历史 B 的 2 个 Worker execution，requestedModel 与实际 provider/model 匹配；实际标识里的 `:high` 保留为 thinking suffix。
- 历史 C 没有启动 child；其复制的 B ledger 不算第三组独立样本。
- 当前 0.69.0 的实际运行模型身份未知。本轮没有新真实 launcher 运行，不能外推历史通过；不估算费用。

当前源码仍只在状态显示使用 role-model policy，delegate launch 没有把该配置接为模型选择；这次核验不恢复路由功能。

## 证据等级

已通过的是基线复现、SDK 宿主探针和历史记录核验。未完成的是 P0 产品修复、真实 0.69.0 transport/CLI/TUI 验收、正常终端 release、生产变更的独立 strict review，以及新阈值的正常任务测量。所有生成物在本任务目录；未使用 /tmp，无重任务所以未启动 slot 作业。
