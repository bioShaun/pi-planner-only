# 交接检查点：区分插件消息来源，并在检查点展示目标进展

日期：2026-10-31
状态：计划，已经 reviewer 审查并按意见修订（审查原文：`~/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/subagent-artifacts/f4f1f25f-147e-45d3-9c45-bc7cba02965b_reviewer_output.md`）

## 来源案例

om36 `/project/glx/app/deliver-workspace-ai` 的 pi Native 会话链：2026-10-30 11:17 到 10-31 00:49，共 7 个 Root 会话、6 次交接。插件版本为 `e1d0ab6`，10-30 11:17:02 安装，`be287c3` 和 `f363b30` 都已生效。会话在 om36 的 `~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--/2026-10-30T*.jsonl`。分析脚本和中间结果在 `evidence/`，可复现命令：`ssh om36 'python3 -' < evidence/verify.py`。

已核对的事实：

1. **自动交接上限按设计生效。** 链长依次记为 1、2、3；17:51 第 4 次交接转为放进编辑器，并通知"已连续自动交接 3 次，请检查简报后提交"。20:42（2h51m 后）用户原样提交。`verify.py` 确认 21,689 字的简报被逐字包含在提交消息里，链长随即归零，之后又自动交接了 2 次。用户 00:42 才追问方向，最后一轮 Root 自己承认"新增真实模型回答为 0、连续多轮集中在评测基础设施"。
2. **插件的上下文警告被写进了"用户授权"。** `sendContextWarning` 以 `deliverAs: "steer"` 注入。这是模型写交接文本时搞混了来源；运行时并没有把警告当成真实用户输入（`index.ts:697` 已排除 `source === "extension"`）。6 份简报的用户授权一节都把它当成用户指令，原文举例：
   - "最后用户 [planner-only] 指令：Root上下文超过阈值……完成当前有界操作后调用handoff"
   - "当前用户最新实质指令原文：[planner-only] Root context is about 153k tokens"
   - "本Root已完成用户planner-only阈值指令所要求的当前有界操作"

   Root 还在简报里写"不要再次handoff……应立即继续未竟工作"。于是插件提醒加上 Root 自己的决定，被当作用户授权一路传下去。
3. **警告与交接提示的措辞把 Root 推向继续交接，而不是向用户汇报：**
   - 警告（`index.ts:373-374`）：`even when continuing the same large task`
   - 交接提示（`handoff.ts:70`）：`do the next step now` 和 `the brief is authoritative`
4. **检查点没有方向信息。** 通知只说"请检查简报后提交"，而简报有 2 万多字，用户无从快速判断方向是否偏了。
归因说明：原始用户确实授权"继续处理"，E 评测集也在未竟清单上，所以不能说是措辞单独导致了偏航。更准确的说法是：来源混淆、无条件继续的措辞、检查点缺少方向摘要，三者叠加，让优先级漂移难以及时被发现。D1 和 D2 降低这个风险，但不能根治，因为摘要仍是上一任 Root 自己写的。

5. **其他观察（插件外）：** Root 把 worker 从 terra 换成 sol、scout 从 luna 换成 sol 之后，后续约 70 次子代理都沿用。om36 的 `subagents.watchdog` 是 `null`，`roleModels` 缓解措施（见 `docs/superpowers/specs/2026-10-30-native-handoff-chain-convergence-design.md` 第 3.4 节）并未配置。另外，内置 reviewer 没有 bash，向 Root 请求"机械复算"21 次，Root 因此自己跑了 77 次 bash 和 73 次 codemode，上下文涨得很快。

## 交付项

### D1 插件消息标明来源；警告不再默认交接（插件，行为变更）

改动：

1. `sendContextWarning`（`index.ts`）：
   - 内容前缀改为 `[planner-only extension notice, not a user message]`，保留 token 数和阈值。
   - `confirm` 与 `auto` 两种建议文本去掉 `even when continuing the same large task`。改为：先完成当前有界操作；只有在用户要求的全部工作已完成、用户明确要求暂停，或继续确实需要用户决定时，才向用户汇报目标进展并停下；已授权且仍推进目标的工作（含必要的前置工作）照常交接。基础设施类工作占比高时应在 progress 里如实说明，但这本身不构成停下的理由。两种模式各自保留现有的提交方式说明。
   - `off` 模式文本不变，只加前缀。
2. handoff 工具 `brief` 参数说明（`index.ts:619`）追加：插件自动生成的通知（上下文警告、子代理完成通知、交接包装文本）本身不产生新的用户授权；其中转述的授权，必须归因于原始用户请求或用户指定的文档。不因 `[planner-only` 前缀就否定用户真实提交、修改或确认的内容（例如用户在检查点提交的简报，或 `/planner-only handoff [goal]` 转述的目标）。
3. `handoffPrompt`（`handoff.ts:70`）追加同义的来源说明，放在进展段和 `## Brief` 之前，并保留开头的 `[planner-only handoff]` 标识（链长恢复靠它识别交接会话，见 `handoff.ts:186`）。`do the next step now` 改为 `continue with the next step that still advances the user's goal`。`the brief is authoritative` 改为：把 brief 当作接续状态的记录，保留其中的不确定性和验证边界；授权按所引的真实来源继承，Root 决定不构成新的授权。

测试（先红后绿；预期文本写在测试里，独立于导出常量）：

- `index.test.mjs`：警告文本带前缀；`confirm`/`auto` 不再含 `even when continuing`，并含收窄后的停下条件和"已授权工作照常交接"两句；`brief` 参数说明含来源归因句。
- `handoff.test.mjs`：投递的提示含排除句，且不再含 `do the next step now`。
- 不删除、不弱化已有断言。现有断言里依赖旧措辞的，在报告中逐条列出并说明替换理由。

文档：同步 `CONTEXT.md`（Root handoff 条目）和 `CHANGELOG.md`。原设计第 3.4 节写的是"不自动停止任务"，现在加了停下条件，要在原设计文档末尾追加一条指向本计划的后续修订说明，不改写其中的历史事实。

### D2 检查点展示目标进展（插件，行为变更；依赖 D1，两项都改 `handoff.ts`/`index.ts`，串行执行）

改动：

1. handoff 工具新增必填参数 `progress`：`Type.String({ minLength: 1, maxLength: 600 })`，说明是"写给用户的三行：本会话用户可见的成果（没有时如实写，例如'暂无新增用户可见成果，完成了必要前置工作'）；对照用户原始目标还剩什么；下一步是否仍直接推进该目标"。600 是为了便于阅读的取舍，不是从案例推出来的最优值。不做关键词或结构校验。内部 `schedule` 允许缺省，这只是内部默认行为：缺省时不输出进展段，也不能出现空标题或 `undefined`。工具入口测试一律传有效的 progress，另设一条专门测内部缺省的用例。
2. `PendingHandoff` 携带 `progress`，失败重试或替换时随简报一起保留或替换。
3. `handoffPrompt` 在 `## Brief` 之前插入 `## Progress against the user's goal (previous Root's account)`。
4. 进入编辑器的投递（confirm 模式，以及 auto 模式被上限拦下）在通知里附上 progress 原文。现有通知文本保持为前缀，因此已有断言 `/已连续自动交接 3 次，请检查简报后提交/` 仍成立。

测试（先红后绿）：

- 被上限拦下时，通知含 progress 原文，编辑器提示含进展段。
- confirm 模式的通知含 progress。
- 自动提交的提示也含进展段。
- `progress` 参数在工具 schema 中必填，空字符串被拒，600 字通过、601 字被拒（`index.test.mjs`）。
- prompt 中进展段位于 `## Brief` 之前，开头仍是 `[planner-only handoff]`。
- 取消或恢复失败后重试，仍保留原 progress；新简报替换旧简报时 progress 一并替换，不残留旧摘要。
- 内部缺省时没有空标题，也不出现 `undefined`。
- Native 入口：`native-handoff.test.mjs` 的工具调用改为传 progress，并断言投递内容含进展段。
- fault-injection：去掉通知中的 progress 拼接后，对应断言必须失败。

文档：`README.md` 和 `README.zh-CN.md` 的 handoff 说明都要写明必填的 progress 和检查点摘要，另同步 `CONTEXT.md` 与 `CHANGELOG.md`。

### D3 om36 配置（不改插件，Root 直接执行）

1. 先备份 `~/.pi/agent/settings.json`，在 `subagents.watchdog` 下只加 `rules`：`action: "warn"`；`roleModels.worker.allow = ["tcuni/gpt-6.1-terra"]`；`roleModels.scout.allow = ["tcuni/gpt-6-luna"]`。这两个 ID 与 om36 现有 `agentOverrides` 中的配置一致。裸 `provider/id` 同样能匹配带 thinking 后缀的写法，因此不加尾部 `*`。
   - 用 `warn` 而不是 `block`：按现有 Native 指令，"缩范围后仍失败再换模型"是允许的；warn 只在每次偏离时提醒，不阻止启动。
   - 不开启 `watchdog.enabled`（模型复查），launch rules 不需要它也会生效。
   - 生效时机：每次启动子代理都会重新读取配置（`rules.js:44`、`settings.js:375`），所以运行中会话的后续子代理也会受影响，不只是新会话。规则只会发警告，可以接受。
   - 验证：在 om36 的实际 launch cwd 上解析最终配置，确认没有项目级配置覆盖。
2. ~~reviewer 加 bash~~ 本次不做。内置 reviewer 的角色指令（`pi-subagents/agents/reviewer.md:26`）明文禁止 shell，只改工具列表不会改变这一点；工具覆盖是整体替换，还会丢掉 `watchdog_diff`；而且 bash 总是透传，无法限制为只读。机械复算和测试应交给有执行职责的子代理，reviewer 只审导出的证据。可执行的 reviewer 如果以后需要，单独设计角色指令、权限和运行目录。

### 暂不做

- "只是提问的用户输入不清零链长"：现有契约（原设计第 3.2 A.2 节、`handoff.ts:175`）明确规定真实用户输入就清零。改动需要另行设计输入分类。D2 只提高检查点的可读性，并不解决这个问题。

## 执行顺序与验收

1. reviewer 审本计划。
2. D1 委派 worker：先写测试并贴出红灯，再实现并贴出绿灯。Root 核对 diff。
3. D2 同上，基于 D1 的结果。
4. 形成完整的本地候选提交（D1 + D2，不含 bench/ 下与本任务无关的未提交改动），派 reviewer 审该提交相对 `81929c9` 的 diff；修复后收敛为最终候选提交。
5. 完整门禁只对最终候选提交跑一次：`git worktree add --detach <dir> <候选SHA>`，在该检出中运行 `TMPDIR=/project/tmp/... npm run test:release`；缺少 pi-ai 时改跑 `test:release:isolated`，并在报告中说明。日志记录前后 SHA 与 tree。候选再变就要重跑。
6. 推送。om36 在下次启动 pi 时拉取更新；扩展代码不会热加载到运行中的会话。
7. D3.1 由 Root 直接执行，与仓库改动互不冲突。

## 执行记录

- 2026-10-31 D3.1 已完成：om36 `~/.pi/agent/settings.json` 已备份为 `settings.json.bak-20261031-roleModels`，新增 `subagents.watchdog.rules`（warn，worker 只允许 `tcuni/gpt-6.1-terra`，scout 只允许 `tcuni/gpt-6-luna`，各带 note）。
  - 验证：用 om36 上 pi-subagents 0.84.0 的 `resolveWatchdogConfigStrict` 和 `evaluateLaunchRule`，在 `/project/glx/app/deliver-workspace-ai`、`/project/glx/app/deliver-workspace`（有项目级 settings，但只覆盖 worker 工具）、`/home/glx/scripts/tc-skills` 三个 cwd 上解析。结果都是 `enabled=false`、无配置错误，rules 生效：worker terra 和 scout luna 通过，worker sol 和 scout sol 触发警告，reviewer sol 不受影响。
