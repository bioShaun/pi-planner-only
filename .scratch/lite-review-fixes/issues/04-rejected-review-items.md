# 04：复核后不做的评审项

Status: wontfix
Type: task

Source: `../spec.md`（复核结论）。这里记录不做的条目和理由，避免以后重复提出。

| 原评审项 | 不做的理由 |
|---|---|
| 关闭时只恢复 `subagents_enable`，会永久丢失 `subagent` | 不成立。pi-subagents 通过加载器 `subagents_enable` 在需要时激活 `subagent`（`src/extension/tool-activation.js`），恢复加载器就是对称恢复。pi-subagents 自己的 `before_agent_start` 也会把加载器加回来。 |
| `before_agent_start` 把插件工具加回 `selectedTools`，盖掉操作者的禁用 | 没有实际的禁用途径。`syncTools` 本来也会加回；做法与 pi-subagents 自己的钩子一致。 |
| 本地后备 wall-clock timer | CONTEXT 已经决定墙钟上限由宿主执行，不是硬预算。宿主确实执行 `timeoutMs`（`src/runs/foreground/execution.js`），Root 取消（abort）也会走停止和宽限期。只有宿主丢事件时才会悬挂，收益太小。 |
| 终态用量也受 token 上限约束 | 终态到达时 child 已经结束，没有可停止的东西。进度快照每一轮都更新（`progress.tokens = input + output`），基本不会漏检。 |
| README 与状态栏的 token 口径打架 | 两处说的是两个不同的量：状态栏合计含缓存读，取消上限不含。各自都写对了，没有矛盾。 |
| 交接拒绝只看本 cwd | 有锁未释放，只发生在停止没被确认、child 可能仍在写的时候。这时全局拒绝交接是合理的保守做法，放宽只会增加风险。 |
| 开关在会话启动时缓存 | `existsSync` 只是一次 stat 调用，耗时在微秒级。缓存还会让中途改开关文件不再立即生效，属于行为退化。 |
| 异步读 transcript 尾部并加文件适配器接缝 | 只在 child 失败时读一次，同步读 8MB 大约几十毫秒。为此新增接缝不划算。 |
| strict 下"其他名字的写工具可调用"的锁定测试 | 用测试固定一个已知的漏洞没有价值；改在文档里写明（票 01）。 |
