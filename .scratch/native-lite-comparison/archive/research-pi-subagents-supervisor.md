# pi-subagents supervisor 回复工具调查

调查日期：2026-10-27。范围：本机会话、已安装 pi-subagents 0.83.0 的文档与源码、Pi 1.4.0 的包路径解析、此前运行目录修复记录。未修改运行配置，未重启 Pi，未进行阻塞式 supervisor 复现测试。

## 结论

不是缺少一个需要另装的 supervisor 插件。当前安装已包含请求和回复端，诊断显示 native supervisor channel available。当前会话的模型工具声明确实缺少 `subagent_supervisor`；精确原因仍需核对宿主构建模型请求时的工具选择/过滤，以及内存中实际加载的扩展版本。

“通过工具检索也找不到”不能作为未安装的证据：这些工具标记为 `model-only`，按设计不会出现在 codemode 的 `searchTools`、`ALL_TOOLS` 或 `tools.*` 中。之前的解释遗漏了这一点。

`interrupt`/`resume` 能在恢复时传递明确决定，但不等价于 supervisor reply，也不能证明缺失的回复工具已经恢复。启动脚本 755 权限修复与 supervisor 工具暴露是两个独立问题。

## 本机证据

1. `~/.pi/agent/npm/node_modules/pi-subagents/package.json:4` 显示版本 `0.83.0`。`~/.pi/agent/settings.json` 的 packages 包含 `npm:pi-subagents`，该项仅设置 `skills: []`，未设置 extensions 排除。禁用包技能展示与禁用扩展不是一回事。
2. Pi 1.4.0 的 `dist/core/package-manager.js:1769` 中 `getManagedNpmInstallPath()` 将用户级 npm 包解析到 `<agentDir>/npm/node_modules/<name>`。因此 release 自身 node_modules 内没有 pi-subagents 并非漏装；上面的用户级安装路径符合宿主设计。但磁盘上的包版本仍不等于已经运行的进程内存版本。
3. 当前模型直接提供的工具包含 `subagent`、`contact_supervisor`，不包含 `subagent_supervisor`。当前父会话 JSONL 的工具选择记录在 `2026-10-27T07:32:44.112Z` 添加了前两者，没有记录添加或移除后三者中的 `subagent_supervisor`、`subagents_enable`、`bg_wait`。此检查只摘取相关工具名，不导出会话正文。
4. 主代理调用 `subagent({action:"doctor"})` 返回：async support available；subagent process no；Intercom bridge active；supervisor channel available (`native:pi-subagents-supervisor-channel`)。这证明控制通道存在，不证明模型获得了 reply 工具声明。
5. `~/.pi/agent/extensions/subagent/config.json` 不存在；该文件是可选配置，并非必需文件。未发现需要用户补填的 supervisor 专用设置。
6. 当前 `doctor` 仍报告托管根目录 `/tmp/pi-subagents-uid-1000`，与此前“父进程尚未重启”的记录一致。新路径配置对当前进程尚未生效；这不能单独解释回复工具为何缺失。

## 一手源码与契约

以下相对路径均相对于 `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/`。

| 事实 | 固定的本机证据 |
| --- | --- |
| supervisor 原生通信无需另外安装 pi-intercom | `docs/configuration.md:613` |
| contact_supervisor 是请求端，subagent_supervisor 是父会话答复端 | `docs/configuration.md:83`、`src/intercom/native-supervisor-channel.js:16` |
| 工具是 model-only，不能通过 codemode 检索/调用 | `skills/pi-subagents/SKILL.md` 的 Rules；`src/shared/extension-context.js:1` 定义 `exposure: "model-only"` |
| loader 激活时应一起加入请求和回复工具 | `src/extension/tool-activation.js:18` 中 `setSelection()` |
| 收到需要答复的请求时，应先激活父回复工具再通知模型 | `src/intercom/native-supervisor-channel.js:718` 注册；`:723` 声明；`:791` 附近 pending.set 后调用 declareParentTool |
| 会话会恢复以前记录的工具选择 | `docs/configuration.md:85`；`src/extension/tool-activation.js:44` 起 |
| 有些 provider/bridge 固定整个 prompt 的工具清单 | `docs/configuration.md:87` |
| eager 可令新会话从开始就激活工具，修改需重启 | `docs/configuration.md:89` 起；它是可选激活策略，不是必填配置 |
| 真正 supervisor reply 按请求 ID 写回复并结清 pending | `src/intercom/native-supervisor-channel.js:577` 起的父工具定义 |

官方在线入口：[配置说明](https://github.com/nicobailon/pi-subagents/blob/main/docs/configuration.md)、[源码](https://github.com/nicobailon/pi-subagents/tree/main/src)。在线 main 可能变化，本次判断以本地 0.83.0 文件为依据。

## 对现场的判断

仅用“正常的延迟激活”不足以解释所有现象：本会话已经可以调用 subagent；按当前磁盘源码，该工具的激活会连带加入 supervisor，接到待答请求时还会再次确保回复工具激活。因此需要追查的范围是会话工具记录恢复、宿主/模型桥接层过滤或工具清单固定、其他扩展干预，以及内存版本与磁盘版本不一致。现有证据不能在这些候选原因中唯一归因。

当前仓库 `index.ts:36` 的 planner-only 隐藏集合只有 `subagents_enable` 与 `subagent`；不能从该集合直接推断它主动隐藏了 `subagent_supervisor`。也未把这一工作区源码视为已运行扩展的确定快照。

此前 `.scratch/native-runtime-path/execution.md:6` 记录：编辑工具将启动器权限改为 664，版本命令失败 126；Root 通过 resume 传达决定后恢复为 755，真实版本命令成功。该记录证明此次业务阻塞已绕开，不证明 supervisor reply 通道已修复。

## 下一步建议与验证边界

- 无需补装 supervisor/pi-intercom，也不应把“检索不到”作为安装失败诊断。
- 按此前运行目录切换计划重启后，在全新父会话核对直接工具声明；如果仍缺失，再在同版本受控场景测试子请求—父回复完整链路。
- 如需定位根因，应同时记录宿主的 registered/active tools、最终发给模型的 tools，以及实际加载扩展的路径/版本；比较这些层次才能判断工具在哪里丢失。
- 不建议在没有对比证据时先改 `toolActivation: eager` 并宣称解决；它只能处理部分激活时序问题，不能修复所有过滤或桥接问题。

本次后台 researcher 完成文档与源码初查；主代理检查报告后补齐 model-only、包解析路径、当前会话工具记录及 doctor 证据，并将复核后的报告写入本文件。未修改实现或测试；未运行 release 测试，因为本次只有调查文档。已有 README/package.json 等工作区改动已检查，保持原样。
