# pi-planner-only

[English](README.md) · 中文

[Pi](https://pi.dev) 扩展，目标是省 token：贵的 **Root** 模型负责规划和审核，大部分执行工作通过 [pi-subagents](https://github.com/nicobailon/pi-subagents) 交给便宜的子代理。

这是 **lite** 版本线（0.9+）。0.2–0.8 的完整审计编排（TaskSpec/WorkerReport、ledger、closeout、verdict 工具）保存在 tag `legacy-full-audit`；删减原因见 `docs/pi-planner-only-subtraction-plan.md`。

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

Root 还会收到一段约 300 token 的提示：小事自己做，大活委派；按 diff 和检查输出判断结果，不信子代理自述；返工时带上上次报告和具体修改意见重新委派。

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

## 安装

```bash
pi install https://github.com/bioShaun/pi-planner-only       # 用户级
pi install https://github.com/bioShaun/pi-planner-only -l    # 项目级
pi install /path/to/pi-planner-only                          # 本地 checkout
```

装完重启 Pi 或执行 `/reload`。需要 pi-subagents `>=0.70 <1`。

## 开关

| 设置 | 作用 |
|---|---|
| `/planner-only on` / `off` | 通过标记文件 `~/.pi/agent/planner-only.off` 开关。 |
| `/planner-only status` | 显示状态和本会话费用合计。 |
| `/planner-only handoff [目标]` | 让 Root 写简报并在新会话里继续（`handoff drop` 丢弃失败的交接）。Root 上下文超过警告阈值后也可以自己调用 `handoff` 工具；新会话带着简报和 git 状态自动开始工作。 |
| `PI_PLANNER_ONLY=1` / `0` | 强制开 / 关，优先于标记文件。 |
| `PI_PLANNER_ONLY_STRICT=1` | 按名字禁止 Root 自己用 `edit`、`write`、`bash`。不拦截其他插件提供的写能力，不是安全边界。默认关闭，因为小任务直接做更省。 |
| `PI_PLANNER_ONLY_TIMEOUT_MS` | 传给宿主的子代理时限（默认 600000）。 |
| `PI_PLANNER_ONLY_MAX_TOKENS` | 子代理上报的 token 超过此值就取消（默认 1500000）。计数取子代理进度事件里的累计 input+output token，不含缓存读取。 |
| `PI_PLANNER_ONLY_START_TIMEOUT_MS` | 子代理迟迟不启动时放弃（默认 30000）。 |
| `PI_PLANNER_ONLY_CANCEL_GRACE_MS` | 等待取消被确认的时间（默认 5000）。 |
| `PI_PLANNER_ONLY_HANDOFF` | `auto`（默认）在新会话里直接提交交接简报；`confirm` 放进编辑框等你确认。 |
| `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` | Root 上下文超过此值时状态栏变红，并给 Root 发一条提示：委派、开新会话或 `/compact`（默认 150000）。 |

关闭时三个工具从 active 工具集中移除，也不注入提示。子进程（`PI_SUBAGENT_CHILD=1`）不加载本扩展。

## 开发

```bash
npm run typecheck
TMPDIR=/仓库外的目录 npm test
```

`contract.test.mjs` 用已安装的 pi-subagents 核对事件名、agent 名和实际发出的请求结构（位置可用 `PI_SUBAGENTS_DIR` 覆盖）；未安装 pi-subagents 时跳过。
