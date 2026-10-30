# pi-planner-only

[English](README.md) · 中文

[Pi](https://pi.dev) 扩展，目标是省 token：贵的 **Root** 模型负责规划和审核，大部分执行工作通过 [pi-subagents](https://github.com/nicobailon/pi-subagents) 交给便宜的子代理。

0.9+ 版本线默认使用 **lite** 模式。0.2–0.8 的完整审计编排（TaskSpec/WorkerReport、ledger、closeout、verdict 工具）保存在 tag `legacy-full-audit`；删减原因见 `docs/pi-planner-only-subtraction-plan.md`。

## 提供什么

| 工具 | 作用 |
|---|---|
| `delegate({role, task, cwd?, timeoutSeconds?, base?})` | 启动一个子代理并等它结束。返回子代理的文字报告、宿主状态、实际模型和用量，以及 Git 变更摘要（新提交、diff stat、未跟踪文件）。 |
| `git_audit({operation, base?, path?, maxEntries?})` | 只读的 `status` / `diff-stat` / `diff` / `log`，argv 固定。 |
| `git_commit({message, paths?})` | 暂存并提交验收通过的改动。从不 push。 |

审查已提交的变更时，给 `reviewer` 传入 `base`，完整的 `base...HEAD` 文本 diff 会内嵌到任务中，上限为 32 KiB。每个变更 blob 最大为 1 MiB，才能检查。仓库必须已有提交且工作树干净；空 diff、二进制、非 UTF-8 和子模块变更会被拒绝。范围提交固定，但源码仍是实时工作树，无法排除并发修改。不传 `base` 时行为不变。

角色对应 pi-subagents 内置 agent 和本包的 validator agent：

| 角色 | Agent | cwd 锁 |
|---|---|---|
| `worker` | `worker` | 独占（单独运行） |
| `explorer` | `scout` | 共享（可与其他 explorer 并行） |
| `validator` | `planner-validator`（本包） | 独占（单独运行） |
| `reviewer` | `reviewer` | 无（只读） |

worker 和 validator 每个仓库独占运行；explorer 可以多个并行，但不能与 worker 或 validator 同跑；reviewer 或其他仓库可以并行。停止请求得不到确认时，目录一直保持占用，直到迟到的终态到达。

可选参数 `timeoutSeconds`（整数 1..86400，例如短任务 `120`，较长复杂实现 `900` 即 15 分钟）为该次委派单次设定子代理墙钟时限。未指定时默认使用环境变量 `PI_PLANNER_ONLY_TIMEOUT_MS`（毫秒；默认 600000 = 10 分钟）。单次覆盖不会改变全局默认或后续委派，其他限额（`PI_PLANNER_ONLY_MAX_TOKENS`、启动等待、取消宽限）保持不变。

Root 还会收到一段简短提示（不超过 1,500 字符，约 375 token）：小事自己做，大活委派；委派前自行决定范围、公共接口和跨模块方案（仅当未知事实可能改变这些决策或任务拆分时才先派 explorer）；每次委派只交付一个可独立检查的成果；按 diff 和检查输出判断结果，不信子代理自述；返工时带上上次报告重新委派修正后的任务（补充上下文、确定接口，或仅在任务过大时拆分）。

Worker 先检查提供的参考资料和现有代码模式；仅当必需的公共接口或跨模块决策仍未解决、任务与代码冲突，或需要修改范围外内容时停止并报告 `BLOCKED:`；这是文本约定，插件不会解析。任务包示例（仅供说明）：

```text
Goal: expired cache entries return a miss on read; unexpired ones return their value.
Scope: src/cache.ts and test/cache.test.ts only; do not change the storage interface or eviction policy.
Decided: keep get(key) and the injected clock.now(); an entry is expired when now >= expiresAt.
Approach: in get(), compare clock.now() with entry.expiresAt before returning; follow the existing has() check.
Acceptance: tests for a valid entry, one exactly at expiresAt, and one past it.
Check: npm test -- cache.test.ts, exit code 0; report the diff.
```

状态栏显示本会话 Root 与子代理的 token 和费用，以及 Root 在两者中各自的占比，例如 `root 4.17M $3.854 · children(3, 1 failed) 2.82M $0.103 · root share 60% tok · 97% $`。token 计数包含缓存读取。

### 等待子代理时的 Root 提示缓存

Native Root 异步等待子代理时，其提示缓存可能过期。本地测量中，Anthropic Claude Root 在至少等待 5 分钟后被子代理通知唤醒的每个回合都是冷启动，会重写整个前缀；使用 OpenAI responses 类型提供商的模型在等待 5–60 分钟后大多仍能命中缓存。Claude 样本量较小。

`PI_CACHE_RETENTION=long` 是 pi 进程的环境变量，不是本插件设置的选项。它将 Anthropic 缓存保留时间延长到 1 小时（直连 OpenAI 为 24 小时），但 Anthropic 缓存写入价格会从基础价格的 1.25 倍升到 2 倍。在该环境中启动的子代理通常也会继承它。

当 Root 使用 Claude 且经常异步等待子代理超过 5 分钟时，延长保留时间可能值得。若大多数回合连续且间隔较短，它会增加总缓存费用。请根据自己的用量决定；默认不会启用。

在本仓库的 checkout 中运行 `python3 bench/root_cache.py <sessions-dir>`，可以按提供商查看自己会话的缓存命中率和冷启动情况（`bench/` 不包含在已安装的包中）。

## 模型

子代理模型由 pi-subagents 配置决定，本插件不管。在 `~/.pi/agent/settings.json` 里配置 `subagents.agentOverrides`：

```json
{
  "subagents": {
    "agentOverrides": {
      "worker":   { "model": "provider/cheap-model", "thinking": "medium" },
      "scout":    { "model": "provider/cheap-model", "thinking": "low" },
      "planner-validator": { "model": "provider/mid-model", "thinking": "medium" },
      "reviewer": { "model": "provider/mid-model",   "thinking": "high" }
    }
  }
}
```

delegate 的结果里会写出宿主实际使用的模型。

请有意识地将原先用于 Lite 验证的 `oracle` 配置移动或复制到 `planner-validator`。`oracle` 配置现在仅影响 oracle/advisor 咨询，不作为 Lite 验证的后备配置。未配置 `planner-validator` 模型时，它继承 `subagents.defaultModel`，若后者也未配置则继承父模型。检查可能产生测试或构建产物；validator 不是操作系统沙箱。

内置 `scout` 会写一个输出文件（`context.md`），其内容会替代它的最终回复成为 explorer 报告。explorer 的任务说明已考虑这一点；在 `scout` 的 override 里加 `"output": false` 可关闭该文件。

## 安装

```bash
pi install https://github.com/bioShaun/pi-planner-only       # 用户级
pi install https://github.com/bioShaun/pi-planner-only -l    # 项目级
pi install /path/to/pi-planner-only                          # 本地 checkout
```

装完重启 Pi 或执行 `/reload`。需要 Pi **1.4.0**、Node **>=22.19.0** 和 pi-subagents `>=0.70 <1`。
宿主声明与开发依赖固定在同一验证版本，当前不声明支持其他宿主版本。

## 开关

| 模式 | 行为 |
|---|---|
| `off` | 本扩展不工作；pi-subagents 自行管理自己的工具。 |
| `native` | 注入「实现和跑测试优先交给子代理，自己负责拆分、检查 git diff 与测试结果。若你已掌握相关上下文，剩余修改与必要验证都明确、局部，且无需进一步调查、设计测试或独立复核，可直接完成修改与验证；否则继续委派。每次委派只交付一项可单独验收的成果，例如一个新模块或命令连同其测试；同一成果中共用一次验收或昂贵读取的步骤合并，互不依赖且可分别验收的成果分开委派。按审查意见修复时，需共同维护同一状态一致性或锁协议的修复优先合并；需等新事实或用户决定的项后派。子代理请求拆分或只交回部分结果时，先缩小本次交付范围再派，可续用原子代理，不要只要求它继续或在同一任务内分阶段；缩范围时沿用原模型，仍失败再换模型。改变并发行为、锁协议或持久化状态一致性的交付及其修复，检查 diff 与测试后先经独立 reviewer 审查，通过后再开展依赖这些改动的后续工作；自查与测试不能代替该审查。派 reviewer 前，写明待审范围和依据；其工具无法取得的 diff 或依据，先导出为可读文件并给出路径。」；pi-subagents 自行管理原生工具。显示用量，共享上下文提醒和交接，但不启用 Lite 委派、Git 工具或 strict 拦截。 |
| `lite`（默认） | 启用上文的委派工具、提示、检查与费用状态栏。 |

Native 子代理用量来自 pi-subagents 当前会话的 cost RPC，始终是已记录下限而非完整总额：工作流收据缺失、未完成或元数据不可用时可能遗漏。RPC 不可用时显示 unavailable。Root 用量按观察到的回合累计，在会话启动或 reload 时重置；子代理快照可从当前会话分支及可用产物恢复已记录用量。上下文提醒和颜色与 Lite 使用相同阈值。

档位不会更换模型；对比时应保持相同的 Root 和子模型配置。

**新会话**的优先级：非空 `PI_PLANNER_ONLY_MODE=off|native|lite` > 旧版
`PI_PLANNER_ONLY=1|0` > `~/.pi/agent/planner-only.mode` 保存的偏好 >
旧版 `planner-only.off` 标记 > `lite`。未知的非空 MODE 值按 `off` 处理，
空值视为未设置。未设置 MODE 时，旧版 `PI_PLANNER_ONLY` 仍会即时覆盖当前模式。
会话模式保存在会话历史中；`/reload` 和 `/resume` 延续该模式，`/new` 按当前
设置重新选择。尚无模式记录的旧会话建议新开会话。公平 A/B 对比应在每种模式
分别新开会话。Native 提示由扩展注入，不能保证与旧基准测试中用户消息前缀逐字节一致。

| 设置 | 作用 |
|---|---|
| `/planner-only native` / `lite` | 保存**下一个新会话**的模式偏好，不切换当前会话。 |
| `/planner-only on` / `off` | 旧版即时切换 Lite/关闭，同时修改标记和新会话偏好；Lite 子代理运行中或 cwd 仍被占用时拒绝切换。 |
| `/planner-only status` | 显示当前生效模式、新会话模式、保存的偏好、交接链长（`chain 当前/上限`，无法恢复时显示 `?`）及适用时的 Lite 费用合计，以及当前加载会话的角色统计（`calls`、完成终态、timed_out、未完成、refused、包含并发重叠的累计用时）。角色统计为当前会话的内存诊断，新会话时 reset，且在 `/reload` 后不保留。 |
| `PI_PLANNER_ONLY_MODE=off|native|lite` | 新会话模式，优先级最高。 |
| `/planner-only handoff [目标]` | 让 Root 写简报并在新会话里继续，confirm 模式下也自动提交。失败的交接可重试、用 `handoff drop` 丢弃或由 Root 的新简报替换。Root 在上下文超过阈值后自行发起取决于生效 handoff 模式（`confirm` 或 `auto`）。`auto` 下连续 Root 交接超过上限时，本次改为放入编辑框并提示「已连续自动交接 3 次，请检查简报后提交」；真实用户输入或用户发起的交接会把计数归零。优先级：非空 `PI_PLANNER_ONLY_HANDOFF` > `~/.pi/agent/planner-only.handoff` > 默认 `off`。 |
| `/planner-only handoff-mode [off|confirm|auto]` | 查看或保存 handoff 模式。优先级：非空 `PI_PLANNER_ONLY_HANDOFF` > `~/.pi/agent/planner-only.handoff` > 默认 `off`；状态会显示生效值和来源。 |
| `PI_PLANNER_ONLY=1` / `0` | 未设置 MODE 时，旧版即时强制 Lite/关闭；新会话优先于保存的偏好和标记。 |
| `PI_PLANNER_ONLY_STRICT=1` | 按名字禁止 Root 自己用 `edit`、`write`、`bash`。不拦截其他插件提供的写能力，不是安全边界。默认关闭，因为小任务直接做更省。 |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | 传给宿主的子代理时限（默认 600000）。 |
| `PI_PLANNER_ONLY_MAX_TOKENS` | 子代理上报的 token 超过此值就取消（默认 1500000）。计数取子代理进度事件里的累计 input+output token，不含缓存读取。 |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | 子代理迟迟不启动时放弃（默认 30000）。 |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | 等待取消被确认的时间（默认 5000）。 |
| `PI_PLANNER_ONLY_HANDOFF` | 非空时覆盖 `/planner-only handoff-mode` 保存的偏好。优先级为 env > 持久偏好 > 默认 `off`。`confirm` 允许 Root 超过阈值后自行发起，并把其简报放入编辑框；用户发起的交接自动提交。`auto` 同样允许自行发起并自动提交（实验性：节省效果尚未测量，冒烟测试仅确认流程可运行），但连续 Root 交接超过 `PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT` 时，本次退回编辑框。 |
| `PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT` | `auto` 模式下允许的连续 Root 发起交接次数（默认 3，正整数）；非法值回落默认值。超过上限的那次放入编辑框并提示用户检查简报；真实用户输入或用户发起的交接会把链长归零。 |
| `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` | Root 上下文达到此值时状态栏变红，并给 Root 发一条提示：委派、开新会话或 `/compact`（默认 150000）。状态栏颜色随上下文升温：空上下文用主题强调色，阈值一半用警告色，到阈值即红色。 |

关闭模式下，本扩展的四个工具即使被直接调用也会拒绝执行。Native 只启用 `handoff`，Lite 委派和 Git 工具仍不可用。
Native 仅恢复先前被 Lite 隐藏的 pi-subagents 工具，不会强行启用上游未注册或未启用的工具。
子进程（`PI_SUBAGENT_CHILD=1`）不加载本扩展。偏好保存在用户 agent 目录的 `planner-only.mode`，适用于该目录下的新会话；不会修改 `settings.json`、模型配置或自动安装/重载扩展。
Lite 委派未结束或停止尚未确认时，新建、恢复、fork 与树导航会被拒绝。运行中的 `/reload` 不提供跨插件实例的锁隔离保证；应先确认子任务结束，再重载扩展。

Native handoff 在接收简报和切换前各查询一次 pi-subagents status；提交时活动或不确定则拒绝且不保留简报，若新简报替换旧稿后被拒，新旧稿均不保留。派发时活动或不确定则保留简报供手动重试、`handoff drop` 或 Root 的下次 handoff 替换，不取消任务。这是尽力检查而非原子屏障，定时任务可能在最后一次检查与切换之间启动。一次隔离的 Pi 1.4.0 / pi-subagents 0.83.0 RPC 实测中，单任务在切换后继续并向新会话发送完成通知；运行中的 workflow 因 `runtime-replaced` 停止，但 child 继续运行。一个活动 run 在 reload 前后均可见，不能证明所有恢复时序都安全。用户自行执行 `/new` 的行为不变。

已验证的宿主为 Pi 1.4.0；不声明支持其他宿主版本。

## 开发

```bash
npm run typecheck
TMPDIR=/仓库外的目录 npm test
```

`contract.test.mjs` 用已安装的 pi-subagents 核对事件名、agent 名和实际发出的请求结构（位置可用 `PI_SUBAGENTS_DIR` 覆盖）；未安装 pi-subagents 时跳过。

先在根项目运行 `npm ci` 安装开发依赖。`TMPDIR` 必须指向已存在的仓库外目录。`TMPDIR=/仓库外的目录 npm run test:release:isolated` 在全新临时目录中安装锁定的 registry fixture（pi-subagents 0.83.0 和 pi-ai 1.4.0），检查源码并运行 `test:release`，在正常完成或报告失败后删除该临时目录；中断信号后的清理不作保证。此入口验证固定版本；默认 `npm run test:release` 仍验证本机安装版本。安装需要访问 registry。
