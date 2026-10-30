# Native 交接链路收敛：挂起简报替换与自动交接上限

日期：2026-10-30
状态：已实施（`be287c3`）。第 3.3 节默认值已确认：上限 3，配置项 `PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT`。
来源案例：`/data_0/panel_design/projects/内蒙古大学-SSR开发` 的 pi 会话链（2026-10-29 02:34 UTC 起，11 个 Root 会话、9 次自动交接）。会话位于 `~/.pi/agent/sessions/--data_0-panel_design-projects-内蒙古大学-SSR开发--/`。

## 1. 意图

让长任务在 Native/Lite 自动交接下仍有用户检查点，并防止上一任 Root 的临时决定经交接变成下一任的默认规则。不改变委派分工、子代理生命周期或 pi-subagents 的职责。

## 2. 问题一：挂起简报不可替换（已修复，只补回归）

### 2.1 案例事实

| UTC | 事件 | 证据 |
| --- | --- | --- |
| 06:13 | Root 调用 handoff，子代理仍运行，返回 “Native activity is busy; brief retained for /planner-only handoff retry” | 首会话 `2026-10-29T02-34-35…jsonl:131` |
| 06:37 | 子代理完成、作业 3150 已提交，Root 用新简报再次调用，返回 “one is already pending” | 同文件 `:148–149` |
| 06:45 | 用户问“现在是需要 handoff 了吗”后，旧简报才被投递 | 同文件 `:152`；新会话 `2026-10-29T06-45-30…jsonl:7` |

### 2.2 归因

进程启动时（02:34 UTC）加载的是安装树 `79a20e3`/`d9c44aa` 的 `handoff.ts`：调度时发现 Native 忙就保留简报（`manualOnly`），而 `#refusal` 对任何挂起简报都返回 “one is already pending”，因此新简报无法替换旧简报，挂起简报也只能靠下一次 `/planner-only handoff` 投递。

上游 `53499d7 feat: replace failed handoff briefs and honor their origin` 已改为：调度时 Native 忙则拒绝且不保留简报；投递失败或被取消而保留的简报可被 Root 下一次调用替换。安装树在 2026-10-29 14:02 +0800 更新到含该提交的 `daa1a53`，但当时运行中的进程仍使用旧代码。之后的交接会话均已加载新代码。

### 2.3 本规格要求

- 不重新设计该行为。
- 在 `handoff.test.mjs` 增加一条按本案例时序的回归：Native 忙时调度 → 被拒且无挂起简报 → Native 空闲后以新简报调度成功，投递内容为新简报；以及投递时 Native 忙而保留（`manualOnly`）的简报会被新简报替换。若现有断言已等价覆盖，记录对应断言位置即可，不重复添加。

## 3. 问题二：自动交接无上限，Root 决定被当作规则传递

### 3.1 案例事实

- 07:02 UTC 用户最后一次给出实质指令（“继续执行 docs/SSR诊断执行进度-20261029.md”）。此后至 23:48 UTC 无用户消息，连续 9 次 Root 发起的自动交接，每个新会话开场均为 “do the next step now”。
- 07:52 UTC Root 在调用中显式指定 worker `model: tcuni/gpt-6.1-sol`，绕过 settings 中 worker 的 `tcuni/gpt-6.1-terra`。09:05 起的交接简报写入 “后换同角色 worker 显式 model=tcuni/gpt-6.1-sol”，之后逐步变成 “worker/reviewer/scout 显式 tcuni/gpt-6.1-sol”，scout 也由 luna 改为 sol。用户未参与这一决定。
- 简报中用户授权（“步骤 0–5 已授权”）与 Root 自行决定（模型、拆包、范围）混写，新 Root 无法区分。

### 3.2 行为要求

**A. 自动交接链上限**

1. 定义“交接链长度”：自上一次真实用户输入以来，连续由 Root 发起（`origin: "root"`）并成功投递的交接次数。
2. 真实用户输入使链长归零。插件自己发送的交接提示、`/planner-only handoff` 投递消息、子代理完成通知及其他扩展注入消息都不算用户输入。
3. 用户发起的交接（`origin: "user"`）不受上限影响，照旧自动提交，并使链长归零。
4. `auto` 模式下，当本次投递会使链长超过上限时，本次按 `confirm` 处理：新会话打开后简报放入编辑器，不自动提交，并通知用户 “已连续自动交接 N 次，请检查简报后提交”。用户提交即视为真实输入，链长归零。
5. `confirm` 与 `off` 模式行为不变。
6. 链长须跨 `newSession` 传递，并在 pi 重启后可从会话记录恢复（例如在新会话写入一条插件自定义条目）；无法确定链长时按已达上限处理，即退回 confirm，不按 0 处理。

**B. 简报区分用户授权与 Root 决定**

1. 修改 `handoff` 工具 `brief` 参数说明，要求分开写：
   - 用户授权：目标、范围、验收标准，注明来源（用户消息或文档路径）；
   - Root 自行决定：如子代理模型覆盖、任务拆分、范围调整，每项附理由，标注为 Root 决定。
2. `handoffPrompt` 增加一句：简报中的 Root 决定是上一任 Root 的选择，不是用户指令；仍有依据才沿用，不得把它们当作用户规则继续传递。
3. 不对简报做结构校验或关键词拦截，仍只保留现有 200 字符下限。

### 3.3 待确认的默认值

- 上限默认 **3**（第 4 次 Root 发起的连续交接退回 confirm）。理由：本案例单次交接间隔约 1–2 小时，3 次约对应半个工作日无人检查；值过小会打断正常长任务。
- 配置项：`PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT`，正整数，沿用 `intEnv` 解析；非法值回落默认值。`/planner-only status` 显示当前链长与上限。

### 3.4 非目标

- 不限制交接总数、会话时长或子代理运行，不自动停止任务。
- 不在插件中锁定子代理模型；该问题用 pi-subagents 的 `subagents.watchdog.rules.roleModels` 配置处理。是否在 `NATIVE_PROMPT` 加入“不覆盖已配置模型”另行决定。
- 不引入阶段账本、验收门禁或“冻结验收标准”指导（见 `docs/diagnosis-om36-native-convergence-2026-10-29.md` 方案 B，单独评估）。
- 不改变 Lite/Native 委派指令、工具权限与交接的模型/思考等级恢复逻辑。

### 3.5 已知局限

- 上限只提供检查点，不能阻止第一次交接就写入不当的 Root 决定；B 只降低其被当作规则的概率，属于提示层约束，效果需自然会话观察。
- 用户在检查点直接提交而不修改简报时，链长归零但内容照旧。

## 4. 验证

按仓库与用户规则，先写测试并运行，确认失败原因是缺少目标行为，再实现。

- 契约测试（`handoff.test.mjs`）：
  1. 第 2.3 节回归时序。
  2. `auto` 下连续 3 次 Root 交接自动提交，第 4 次改为放入编辑器并通知（fault-injection：去掉上限判断后该断言必须失败）。
  3. 真实用户输入后链长归零；插件交接提示与子代理通知不归零。
  4. 用户发起的交接不受上限影响。
  5. 链长无法恢复时退回 confirm。
  6. `brief` 参数说明与 `handoffPrompt` 含第 3.2 B 节要求；预期文本独立于导出常量。
- 已有交接、模式隔离与工具断言不得删除或弱化。
- 运行 `npm run test:release`，`TMPDIR` 置于仓库外（`/project/tmp` 子目录）。
- 文档：更新 `CONTEXT.md` 的 Root handoff 条目，以及中英文 README 中 handoff-mode 的说明。

自动化测试只证明机制与文本注入正确，不证明模型行为改善。

## 5. 交付

由子代理实施并跑测试，Root 核对 diff 与红绿证据。仓库已有无关未提交的 bench 改动，不纳入本次提交。设计确认后再制定实施计划。
