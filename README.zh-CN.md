# pi-planner-only

[English](README.md) · 中文

[Pi](https://pi.dev) 扩展，目标是省 token：贵的 **Root** 模型负责规划和审核，大部分执行工作通过 [pi-subagents](https://github.com/nicobailon/pi-subagents) 交给便宜的子代理。

0.9+ 版本线默认使用 **lite** 模式。0.2–0.8 的完整审计编排（TaskSpec/WorkerReport、ledger、closeout、verdict 工具）保存在 tag `legacy-full-audit`；删减原因见 `docs/pi-planner-only-subtraction-plan.md`。

## 提供什么

| 工具 | 作用 |
|---|---|
| `delegate({role, task, cwd?})` | 启动一个子代理并等它结束。返回子代理的文字报告、宿主状态、实际模型和用量，以及 Git 变更摘要（新提交、diff stat、未跟踪文件）。 |
| `git_audit({operation, base?, path?, maxEntries?})` | 只读的 `status` / `diff-stat` / `diff` / `log`，argv 固定。 |
| `git_commit({message, paths?})` | 暂存并提交验收通过的改动。从不 push。 |

角色对应 pi-subagents 内置 agent：

| 角色 | Agent | 占用 cwd |
|---|---|---|
| `worker` | `worker` | 是 |
| `explorer` | `scout` | 是 |
| `validator` | `oracle` | 是 |
| `reviewer` | `reviewer` | 否（只读） |

agent 有 bash 或 write 权限就会占用 cwd：同一目录里第二个这样的子代理会被拒绝，直到第一个结束。停止请求得不到确认时，目录一直保持占用，直到迟到的终态到达。

Root 还会收到一段简短提示（约 400 token，估算）：小事自己做，大活委派；委派前自行决定公共接口和跨模块选择（事实不明时先派 explorer）；每次委派只交付一个可独立检查的成果；按 diff 和检查输出判断结果，不信子代理自述；返工时带上上次报告重新委派修正后的任务（补充上下文、确定接口，或仅在任务过大时拆分）。

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

## 模型

子代理模型由 pi-subagents 配置决定，本插件不管。在 `~/.pi/agent/settings.json` 里配置 `subagents.agentOverrides`：

```json
{
  "subagents": {
    "agentOverrides": {
      "worker":   { "model": "provider/cheap-model", "thinking": "medium" },
      "scout":    { "model": "provider/cheap-model", "thinking": "low" },
      "oracle":   { "model": "provider/mid-model",   "thinking": "medium" },
      "reviewer": { "model": "provider/mid-model",   "thinking": "high" }
    }
  }
}
```

delegate 的结果里会写出宿主实际使用的模型。

内置 `scout` 会写一个输出文件（`context.md`），其内容会替代它的最终回复成为 explorer 报告。explorer 的任务说明已考虑这一点；在 `scout` 的 override 里加 `"output": false` 可关闭该文件。

## 安装

```bash
pi install https://github.com/bioShaun/pi-planner-only       # 用户级
pi install https://github.com/bioShaun/pi-planner-only -l    # 项目级
pi install /path/to/pi-planner-only                          # 本地 checkout
```

装完重启 Pi 或执行 `/reload`。需要 pi-subagents `>=0.70 <1`。

## 开关

| 模式 | 行为 |
|---|---|
| `off` | 本扩展不工作；pi-subagents 自行管理自己的工具。 |
| `native` | 仅注入「实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。」；pi-subagents 自行管理原生工具。不启用 Lite 工具、strict 拦截、交接、上下文提醒或费用统计。 |
| `lite`（默认） | 启用上文的委派工具、提示、检查与费用状态栏。 |

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
| `/planner-only status` | 显示当前生效模式、新会话模式、保存的偏好，以及适用时的 Lite 费用合计。 |
| `PI_PLANNER_ONLY_MODE=off|native|lite` | 新会话模式，优先级最高。 |
| `/planner-only handoff [目标]` | 让 Root 写简报并在新会话里继续（`handoff drop` 丢弃失败的交接）。只有 `PI_PLANNER_ONLY_HANDOFF=confirm` 或 `auto` 时，Root 才能在上下文超过阈值后自行发起。 |
| `PI_PLANNER_ONLY=1` / `0` | 未设置 MODE 时，旧版即时强制 Lite/关闭；新会话优先于保存的偏好和标记。 |
| `PI_PLANNER_ONLY_STRICT=1` | 按名字禁止 Root 自己用 `edit`、`write`、`bash`。不拦截其他插件提供的写能力，不是安全边界。默认关闭，因为小任务直接做更省。 |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | 传给宿主的子代理时限（默认 600000）。 |
| `PI_PLANNER_ONLY_MAX_TOKENS` | 子代理上报的 token 超过此值就取消（默认 1500000）。计数取子代理进度事件里的累计 input+output token，不含缓存读取。 |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | 子代理迟迟不启动时放弃（默认 30000）。 |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | 等待取消被确认的时间（默认 5000）。 |
| `PI_PLANNER_ONLY_HANDOFF` | `off`（默认）仅允许用户请求交接；`confirm` 也允许 Root 超过阈值后自行发起，并把简报放入编辑框；`auto` 同样允许自行发起并自动提交（实验性：节省效果尚未测量，冒烟测试仅确认流程可运行）。 |
| `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` | Root 上下文超过此值时状态栏变红，并给 Root 发一条提示：委派、开新会话或 `/compact`（默认 150000）。 |

关闭或 Native 模式下，本扩展的四个 Lite 工具即使被直接调用也会拒绝执行。
Native 仅恢复先前被 Lite 隐藏的 pi-subagents 工具，不会强行启用上游未注册或未启用的工具。
子进程（`PI_SUBAGENT_CHILD=1`）不加载本扩展。偏好保存在用户 agent 目录的 `planner-only.mode`，适用于该目录下的新会话；不会修改 `settings.json`、模型配置或自动安装/重载扩展。
Lite 委派未结束或停止尚未确认时，新建、恢复、fork 与树导航会被拒绝。运行中的 `/reload` 不提供跨插件实例的锁隔离保证；应先确认子任务结束，再重载扩展。

## 开发

```bash
npm run typecheck
TMPDIR=/仓库外的目录 npm test
```

`contract.test.mjs` 用已安装的 pi-subagents 核对事件名、agent 名和实际发出的请求结构（位置可用 `PI_SUBAGENTS_DIR` 覆盖）；未安装 pi-subagents 时跳过。
