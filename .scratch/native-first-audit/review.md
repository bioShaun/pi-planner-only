# Native 优先：仓库审查与待定项

基线 `4f38194`。覆盖 Native、Lite、Off 的模式与切换契约、用量/交接、Lite 委派与 Git 工具、测试和发布入口、基准运行/计费工具、打包清单、双语说明和现行文档链接。清点了 4,854 个跟踪文件；其中 `.scratch/archive/` 下 3,597 个按项目约定属于旧版本证据，未逐个复演或逐行审阅。没有跑付费模型、修改用户配置、清除旧会话或部署扩展。

## 已证实的问题

- **交接失败丢稿。** `handoff.ts` 的 `settled()` 在派发命令同步抛错时清除已接受的简报。现在保留原稿、进度与发起方，只允许手动重试、替换或丢弃，不会自动重发。故障注入验证了用户发起与 Root 发起的区别。
- **基准认错代码版本。** `bench/campaign.sh` 和 `bench/run-body.sh` 各有一份过时的源文件列表，漏掉 `handoff.ts`、`status-color.ts` 和 agent 定义。直接运行可能记录为 clean，campaign 可能冻结为不包含本地改动的 HEAD。现在共用同一个检查；有离线脏工作区回归。
- **Lite 测量受操作员环境影响。** `bench/overhead.mjs` 只设置低优先级的旧开关；在 `PI_PLANNER_ONLY_MODE=native` 下曾把两个 Lite prompt 都量成 443 字符。相同的优先级问题也存在于 `bench/run-body.sh` 的 Lite 启动命令。模式应属于被测 arm，而不是运行基准的人。
- **文档误导。** `CHANGELOG.md`、三份历史评估文档的证据链接分别改指归档路径或保有原件的具体提交。`bench/README.md` 区分 dry-run 的本地 Pi 探测与付费模型调用。

## 请审阅

| 优先级 | 位置与证据 | 建议与验收依据 |
|---|---|---|
| 高（对照结果） | `bench/run-body.sh`：历史 `native` arm 只加载 pi-subagents；日常 Native 还加载本扩展的提示、状态和 handoff。 | 保留历史定义。若目标是衡量当前生产模式，另设带插件的对照臂；同模型、同任务、同版本比较。不要给旧数据换标签。 |
| 高（基准复现） | `bench/overhead.mjs` 的 `snapshotPath()` 与 `bench/run-body.sh` 都把缓存里存在 `index.ts` 当作整个 SHA 快照可用。没有完整性检查，多个首用者也可能共享正在解包的目录。 | 两个入口一起决定缓存策略：每次隔离展开，或完整验证后原子发布。验收覆盖中断解包和并发首用；本轮未发现已损坏的真实历史结果。 |
| 中（Native 性能） | `index.ts` 在 assistant `message_end`、`agent_settled`、同会话子任务完成时发 cost RPC；本机 pi-subagents 的实现读取当前分支与产物。旧响应被忽略不等于宿主取消了计算。 | 对长会话记录一次实际 RPC 次数、耗时与状态刷新延迟，再决定是否合并刷新；不能由代码静态推算节省幅度。 |
| 中（交接边界） | `handoff.ts` 的最后一次 Native 活动查询与 `newSession()` 不是原子操作，README 已披露。`deactivate()` 清简报但不像 `reset()` 那样清除未消费的显式请求。 | 如需保证绝无切换竞态，需要宿主提供原子接口。另需定义用户发出 `/planner-only handoff`、尚未生成简报就切 Off 再 On 时，旧请求是否仍有效。 |
| 中（基准价格） | `bench/summarize.py` 每次读取当前 `bench/prices.json`；摘要无价表指纹/生效时间。 | 区分按当时价格重现和按新价格重算；先定口径，再将价表版本写入输出。现有数字不是经账单验证的实际支出。 |
| 中（release） | `package.json` 与 `scripts/test-release-isolated.mjs` 验证检出源码与依赖 fixture，不从 npm tarball 启动扩展。固定 fixture 是 pi-subagents 0.83.0，不是声明范围 `>=0.70 <1` 的全版本证明。 | 若以打包形式分发，增加 tarball 安装/加载冒烟测试并选择受支持版本矩阵；若只用 Git checkout，则按实际分发风险决定优先级。 |
| 低（兼容旧基准） | `bench/run-body.sh` 模型预检查 worker/scout/oracle/reviewer；当前 Lite 验证角色是 `planner-validator`。旧 `pluginRef` 又可能确实使用 oracle。 | 按固定版本的实际角色选预检项，而不是全局替换名字；优先确认还要支持哪些旧 arm。 |
| 低（清理） | 本地有 56 个 `.planner-only-test-*`、2 个 `.planner-only-request-fixture-*` 目录，合计约 10 MiB；历史归档另有明确用途。`docs/pi-planner-only-subtraction-plan.md` §0.1 已有四项暂定机制及 2026-12-15 的证据期限。 | 先确认无活跃进程或取证引用，再清本地夹具；不因 Native 是主力就删除 Lite 或提前撤回暂定机制。 |

不作为缺陷：`delegate.ts` 只在累计 tokens **超过**阈值时取消，与双语 README 的 `PI_PLANNER_ONLY_MAX_TOKENS` 定义一致。把 `>` 改为 `>=` 是契约变更，不是修 bug。

## 验证边界

- 在 `c3df5e3` 的独立检出运行 `TMPDIR=/project/tmp python3 -B -m unittest discover -s bench -p 'test_*.py'` 与 `TMPDIR=/project/tmp node --test bench/overhead.test.mjs`：61 + 2 项通过，无跳过。含忽略的本地 agent、Lite 启动继承 bridge、双版本测量争用环境变量的回归。未执行付费 campaign。
- `npm pack --dry-run` 列出 17 个文件，包括运行模块和 validator 定义；未做 tarball 安装测试。
- 发布门禁和基准是不同的检查。`c3df5e3` 上的本机门禁缺 `@earendil-works/pi-ai`，固定 fixture 门禁则在宿主清单 `1.4.0` 与导出版本 `1.5.2` 不一致时停止；这次尝试不计作通过。
