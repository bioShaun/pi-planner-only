# Native 上下文提醒与 Root handoff

状态：设计交接稿；尚未实施。用户要求先提交方案，再在 herdr 新 worktree 中处理 Native handoff。本提交不启用功能或改变运行配置。

## 目标与边界

将上下文提醒与 Root handoff 从 Lite 专属能力中拆出，使 Native 也能使用。切换 Root 会话前确认本会话关联的子任务已经终止，避免交接导致运行中的任务中断。Native 委派及 child 生命周期继续由 pi-subagents 管理。

本项不包含 Native/Lite 对照实验控制器修复、实验重启、费用账本改写、supervisor 工具暴露修复或全局安装更新。实现与测试交给子代理，Root 负责拆分、检查实际 diff 和原始测试结果。

## 当前契约与代码入口

以提交前产品基线 `27c316574a02c17c877c75d4b34437ca53920bee` 为核对起点；实施者须在新 worktree 复核实际 HEAD。

- `index.ts` 的 `syncTools` 与 `before_agent_start` 工具筛选在 Native 隐藏包括 handoff 在内的插件工具；上下文阈值提醒目前只用于 Lite。两处工具筛选必须同步修改。
- `handoff.ts` 的 `schedule`、`command`、`settled` 只允许 Lite。活动保护读取 Lite 的 locks 和 delegationsInFlight，不能证明 Native 空闲。
- `handoff.ts` 的 `#dispatch` 在异步收集 Git facts 后调用 `ctx.newSession`；仅在准备简报时检查活动不足以覆盖期间的新启动。
- `index.ts` 已注册 `session_before_switch`；需核对该边界与宿主启动、取消和终态的真实顺序，不能仅假设最后再查询一次就消除了竞态。
- 既有 handoff 保存完整简报、源模型和已知 thinking 档位，恢复失败或取消后保留材料供手动重试。`CONTEXT.md` 与中英文 README 目前描述 Native 没有 handoff；功能实施时一并更新。

## 设计决定

### 共享能力与偏好

| 模式 | 上下文提醒 | handoff | 委派工具 |
| --- | --- | --- | --- |
| Off | 不启用 | 不启用 | 保持既有 Off 契约 |
| Native | 复用现有阈值和提醒去重 | 手动入口及偏好允许的阈值触发 | 保持原生工具，额外开放 handoff |
| Lite | 保持既有行为 | 复用同一交接流程 | 保持既有 Lite 工具 |

保留 handoff 偏好解析：非空环境变量 > 持久偏好 > 默认 off。handoff off 禁止自行发起，但仍允许用户手动请求；confirm 将简报放入新会话编辑框供提交，auto 自动提交。手动请求不受上下文阈值限制，不擅自把默认 off 改为 auto。Native 不启用 Lite 的 delegate、git_audit、git_commit 或 strict 约束。

交接保持源会话的 Native/Lite 模式、源模型、已知 thinking 档位和完整简报；不能因新会话重新读取全局模式偏好而意外切成另一模式。模式恢复方式和失败处理需通过现有宿主入口验证。

### 子任务活动判定

在交接逻辑与宿主之间建立一个小的活动查询边界，语义区分 `idle`、`busy`、`unknown`。这只是本项目的设计语义，不代表宿主已有同名 API。

- Lite 继续依据既有锁及委派生命周期；Native 使用宿主受支持的活动/终态契约，绑定当前父 session 身份。
- 覆盖排队、运行、暂停但未终止、async 与 workflow 的关联任务；取消请求或工具返回不能单独证明任务终止。
- 关联范围不明确、查询失败、接口缺失或终态冲突均为 unknown，不能当作 idle。
- 费用聚合、没有完成通知、Root 的 stop/agent_settled、管理工具返回都不是 Native 空闲证明。`subagent(action:"guide")` 等管理查询也不是 child 启动；必须按真实操作语义区分。
- 不维护第二份自行推断的 child 账本，不扫描任意临时目录冒充宿主契约，不通过取消任务满足交接前提。

先完成宿主契约核对，记录接口位置、版本、父会话关联与终态定义。若没有可靠能力，记录具体缺口并保持 Native 切换不可用；不要用 mock 中存在的接口冒充宿主支持。

### 交接流程和竞态

1. 手动请求或有效阈值触发后，准备完整简报；复用既有长度及来源检查。
2. 在 handoff 接收、settled 延迟派发、实际创建新会话三个入口核对活动与源 session，不能只检查一次。
3. busy 或 unknown 时不切换；已接收的简报保留为手动重试状态，明确提示原因。首版不实现后台自动轮询或自动恢复队列；用户可在任务确认结束后重新运行 `/planner-only handoff`，或用 `handoff drop` 放弃。
4. Git facts 等异步准备完成后，重新核对源 session、模式及活动。对检查到新会话切换之间的新启动，须使用并验证宿主提供的切换守卫/串行化机制；没有此保证就不能声称防竞态已完成。
5. 新会话先恢复模式、模型和 thinking 并验证，再按 confirm/auto 或既有手动语义传递简报。失败保留材料，不在配置恢复失败后提交任务。
6. 重复 settled、重复完成通知、延迟旧 session 事件不得重复派发或创建多个新会话。模式切换、reset、drop 和扩展实例替换的所有权沿用现有流程并补回归。

## 实施顺序与验收

实施票：[01-share-context-handoff.md](issues/01-share-context-handoff.md)。

1. **宿主契约核对**：先确认本机实际 pi-subagents/Pi 版本及受支持的活动查询、父 session 关联、workflow 汇总、确认终止和切换守卫。提交具体证据及调用顺序，再将实施票从 needs-triage 改为 ready-for-agent。此阶段可在新 worktree 直接开展，不需再询问是否允许阅读源码。
2. **测试先行**：子代理先仅写测试并运行，保留因缺少目标行为而失败的原始输出；语法或导入失败不算红灯。覆盖 Native/Lite/Off、off/confirm/auto、手动与阈值入口，以及 busy/unknown/终止后重试。
3. **实现与故障注入**：覆盖取消未确认、workflow 残留子任务、其他父 session、旧/重复通知、查询失败、检查后新启动、Git facts 等待期间启动、重复派发及模式恢复失败。受阻时必须断言没有调用 newSession，任务未被取消且已有简报可恢复。
4. **真实宿主集成**：使用相关真实宿主查询/事件与会话切换入口，验证运行中任务不会因 handoff 被切断、确认终止后可以交接。纯状态 mock、产品 release 绿灯或配置探针不能单独证明这一点；报告须说明替身边界及仍未覆盖的部分。
5. **回归与审查**：保持已有断言；增加守卫必须有故障注入。运行相关聚焦检查及 `npm run test:release`，TMPDIR 放仓库外。Root 读取实际 diff、红绿日志、精确代码版本和集成证据后验收。

## herdr 新 worktree 交接

从包含本设计提交的本地 main 创建独立分支/worktree；不要只从未包含此提交的旧 origin/main 分叉。当前仓库还有其他未提交实验材料，新 worktree 不应依赖或复制它们。

新会话先读 `AGENTS.md`、`CONTEXT.md`、本设计和实施票，再核对 `index.ts`、`handoff.ts`、`host.ts` 及相关测试。首个交付是宿主契约证据与收敛后的实现方案，不要直接把所有 `mode !== "lite"` 条件机械放宽。

一个 worktree 只有一个写入者。临时文件使用 worktree 子目录或 `/project/tmp`，禁止 `/tmp`；完整 release 使用仓库外 TMPDIR。预计超过一分钟、超过 2G 内存或大量读写 `/data_0` 的操作，先读 `~/.config/agents/slot.md`，记录 `slot audit` 和 `slot status`，通过 `slot` 执行。对子代理同样传递这些约束。
