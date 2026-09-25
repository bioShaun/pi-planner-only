# lite 评审修复（2026-09-25 代码评审 12 项，已复核）

来源：2026-09-25 对 lite 版插件做的代码评审，共 12 条发现。
同日复核时，对照了本仓库代码和已安装的 pi-subagents
（`~/.pi/agent/npm/node_modules/pi-subagents`）。背景测量见《lite 大任务测量结果（2026-09-24）》：
lite 总体通过门槛（约 0.47），但小任务 T3 反而更贵（1.12）。

范围：只改本插件的运行时模块、测试和 README。不改上游 pi-subagents，
不改 `legacy-full-audit` 标签，也不恢复已经删除的整块机制（ledger、verdict、closeout 等）。

词汇：Root、Worker、Explorer、Validator、Delegation 的含义都按根目录 `CONTEXT.md` 的定义。

## 复核结论

原稿把 3 条装配问题列为 P0。复核后，只有交接事实这一条是真 bug，而且后果写错了：
- `gatherGitFacts` 里的 `split("\\n")` 用的是字面量，但真实换行原样保留了，
  所以交接事实本来就是多行、可读的。实际问题是"只取前 30 行"的截断从未生效。
- "关闭后永久丢失 `subagent`"不成立。pi-subagents 的设计是先暴露加载器
  `subagents_enable`，调用后才激活 `subagent`（见 `src/extension/tool-activation.js`）。
  关闭时只恢复加载器，本来就是对称的。
- "启动钩子盖掉操作者的禁用"没有实际触发途径，而且这种做法和 pi-subagents 自己的钩子一致。

12 条的最终处置：

| 原评审项 | 处置 | 票 |
|---|---|---|
| 交接 git 事实的分隔符 | 修，按截断失效处理 | 01 |
| cwd 锁的键 | 修，改为 git toplevel 的 realpath（原稿漏掉了子目录绕过） | 01 |
| strict 语义 | 只补文档 | 01 |
| 小任务阈值指引 | 改工具描述的措辞 | 01 |
| `git_commit` 默认 `add -A` | 问题属实，原方案有缺陷，需要重新定方案 | 02 |
| 只读角色共享锁 | 前提有误，缩小范围后待评估 | 03 |
| 关闭时恢复宿主工具、启动钩子回加插件工具、本地后备 timer、终态 token 上限、README 口径、交接拒绝范围、开关缓存、异步读 transcript | 不做 | 04 |

## Problem Statement

复核后确认的问题：
1. 交接给新会话的 git status 没有截断。工作区很脏时，整份 porcelain 都会进入新 Root 的首条提示。
2. cwd 锁只按 `resolve()` 后的路径去重。同一仓库的根目录和子目录（`/repo` 与 `/repo/src`）
   会拿到两把锁，经 symlink 的写法也会；这样两个 worker 能同时写同一个仓库。
3. README 没写清 strict 只按名字拦截 `edit`、`write`、`bash`，不拦截其他插件提供的写能力。
4. "小事自己做"只写在系统提示里，`delegate` 工具描述里没有；T3 小任务的开销比是 1.12。
5. `git_commit` 不带 paths 时会把本次无关的脏文件一起提交（见票 02，方案待定）。
6. 同一目录下的两个 explorer 会互相排队（见票 03，收益待评估）。

## Solution

- 票 01（ready-for-agent）：交接事实截断、锁键规范化、strict 文档、小任务措辞四处小改动。
- 票 02（needs-triage）：由维护者在两个替代方案里选一个，选定后改为 ready-for-agent。
- 票 03（needs-triage）：先评估收益，再决定做不做。
- 票 04（wontfix）：记录不做的条目和理由，避免以后重复提出。

## Testing Decisions

- 只测外部行为：工具返回的文本、git argv、锁与拒绝语义、工具描述文本。
- 可复用的先例：`index.test.mjs` 的入口 harness、`delegate.test.mjs` 的假 EventBus / 假时钟 / 假 git、
  `git.test.mjs` 的假 runner。
- 每个新守卫都配故障注入：超过 30 行的 status、同一仓库的子目录、symlink 写法。
- 约束：跑 `npm run test:release` 时 `TMPDIR` 设在仓库外；不删改既有断言，
  交付前用 `git diff | grep '^-.*assert'` 确认。

## Out of Scope

- 上游 pi-subagents 的任何改动。
- 模型选择与 thinking 档（运营者配置）。
- 跨 reload 持久化，以及委派之间的状态（CONTEXT 约束）。
- 参数面扩张（例如给 delegate 加 hint 参数）。
- 票 04 里列出的条目。

## Further Notes

- 验收门：`npm run test:release` 全绿，没有删除任何断言，并满足票 01 的验收清单。
- 后续测量（不在本 spec 内）：票 01 合入后重测 T3，看小任务开销比能否回到 1 以下。
