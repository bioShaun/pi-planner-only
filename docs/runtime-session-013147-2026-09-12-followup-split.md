# NX-01～NX-06 遗留项分工：需人工 vs 无需人工

日期：2026-09-12。基线：commit `5b76f0d`（工作树干净，`npm test` 全绿）。
依据：`docs/runtime-session-013147-2026-09-12-optimization-spec.md`（下称 spec）与 `.scratch/nx-followups/issues/01～05`。

本文回答一个问题：spec 的 C01～C18 和关闭标准里，哪些必须由你亲手做，哪些 agent 可以离线做完。它不是验收记录，不改变矩阵里任何条目的状态（当前全部 unproven）。

## 1. 判定规则

一项工作被归为**需人工**，当且仅当它满足以下至少一条：

- **R1 启动真实宿主**：需要一个新的 Root 会话在已升级的插件上跑真实模型，产生真实的子运行、工具事件或通知。agent 无法从插件内部启动宿主。
- **R2 授权/审批**：涉及对真实数据的不可逆变更（ledger 修复落盘、push），spec 或仓库规则要求显式人工授权。
- **R3 关闭判定**：关闭标准的"=0"计数只能在人工认可的成功案例上统计，认可本身是人工动作。

不满足任何一条的即**无需人工**：代码、fixture、离线测试、handler 级重放、矩阵回填的文书工作，agent 直接做。

spec L143 把证据分为三级：代码完成 / handler 验证 / 宿主验证。**同一条 C 项经常是"handler 级无需人工、宿主级需人工"**，下表按级别拆开标注。

## 2. C01～C18 逐条分工

| 条目 | 内容摘要 | handler 级 | 宿主级 | 人工要做的事 | agent 要做的事 |
|---|---|---|---|---|---|
| C01 | 重放 N 场 133 历史 meta，本会话 child 用量为 0，重启再扫不重复记账 | 无需人工 | 不要求 | 无 | 从 evidence.md 冻结 N 去敏 fixture，nx01 改用真实样本，加跨进程 restore→rescan 断言（issue 01） |
| C02 | 重放 T-023 的 121 children，识别 120 外场 + 1 错 Task；修复中断重跑一致 | 无需人工 | 不要求 | 无 | 同上冻结 M/N 样本；dry-run 明细断言 |
| C03 | 真实命令 handler 导出含 5 条新构建 untasked、三来源重复、外部 child；事件→ledger→export 守恒 | 无需人工 | 不要求 | 无 | 用冻结 fixture 走真实 handler 导出并断言守恒 |
| C04 | 0.036s / 8.913s / 15s 时序注入，一次 wait 交付，重复 wait 幂等 | 无需人工（已有） | **需人工** R1 | 宿主会话里让一个子运行在三种时序下完成，触发 wait | 分析宿主产出的 RunRecord，回填矩阵 |
| C05 | 输出永不出现、exit 非零、saved output 被抢先消费三类失败 | 无需人工（已有） | **需人工** R1 | 宿主会话里人为制造前两类失败各一次 | 采样后分析并回填 |
| C06 | 4 oracle pending + 1 running 经真实 adapter 持久化后重建 store | 无需人工（已有） | **需人工** R1 | 宿主会话里在 oracle pending 状态下退出并重启 Root | 检查重建后状态一致、slot 只释放一次 |
| C07 | 公开工具重放 Worker→修正后继→提交，外部编辑反例 | 无需人工 | 不要求 | 无 | 通过公开工具入口重放并断言 export 字段完整 |
| C08 | stale pass / 派工拒绝 / 实际复验 / 恢复重试的恢复增量断言；重算 M 的 9/8/1 | 无需人工 | 不要求 | 无 | 从冻结 M fixture 的公开事件重算 |
| C09 | T-022 混合修正、不可修复信封直接裁决、T-023 写锁拒绝 | 无需人工 | 不要求 | 无 | handler 重放三场景 |
| C10 | 新指纹下宿主探测原始调用/结果，五类工具及批量，配置值 vs 实际拦截 | 不适用 | **需人工** R1 | 宿主会话里让 Worker 依次调用 read/grep/find/ls/只读 bash 和一次批量调用 | 把样本冻结为 fixture，替换 floors.ts 公式反推的 `interceptedCalls`（issue 02） |
| C11 | 初始/修正 Worker 均覆盖，cat/sed 计入探索，写操作不误计，两个 execution 不串预算 | 无需人工 | 依赖 C10 样本 | 无 | C10 样本到手后重跑并回填 |
| C12 | 重放 T-016 / T-022 收尾；soft 一次、hard 后 partial 可摄取 | 无需人工 | **需人工** R1 | 宿主会话里让一个 Worker 触发 soft 再触发 hard 阈值 | 确认 contextPack 与 readFirst 警告在派工 handler 可见 |
| C13 | git_commit handler 四场景；push 需显式授权入口 | 无需人工 | **需人工** R1 + R2 | 宿主会话里各触发一次四种提交场景；**决定是否开放 push 授权入口**，不开放则 agent 只做"明确报告不支持" | handler 级四场景离线可用真实 git 仓库覆盖 |
| C14 | 真实宿主同 reportRevision 重复通知只派一个 oracle，与 reviewer 实际重叠 | 不适用 | **需人工** R1 | 宿主会话里对同一 revision 触发两次通知，再推进一个新 revision | 从 Root 工具调用数验证并行，回填 |
| C15 | 启用/停用、缺省/显式 read 范围、待裁决无运行、别 cwd 有 Task 的 handler 验证；通知字节对比 | 无需人工 | **需人工** R1 | 宿主会话里在启用和停用两种模式下各走一遍同一事件集 | 比较通知字节并记录原始分母 |
| C16 | 升级后启动新 Root，先记 provenance，再产生一个可审计子运行，指纹一致 | 不适用 | **需人工** R1 | **整个宿主会话的入口步骤**：安装目录与工作区隔离，reload，核对 loaded 身份，然后派一个子运行 | 核对 RunRecord 指纹与 disk HEAD 一致 |
| C17 | B01～B24 与 C01～C15 逐项映射到证据或 `notDoneReason` | 无需人工 | 汇总 | 无 | 回填矩阵；宿主级条目在人工会话之前统一填 `notDoneReason: host-run-pending` |
| C18 | 冻结 fixture 重算 E 的各项计数；真实公开入口产生一次 usage export 并验证守恒 | 无需人工 | **需人工** R1（仅触发） | 宿主会话末尾从公开入口执行一次 usage export | 重算与守恒验证，记录 schemaVersion、截止时间、缺失来源 |
| 关闭标准 | wait 无法送达 / 非预期裁决改写 / 外部 run 计入 / 错归属 / 重复费用 / untasked 丢失 均为 0 | 不适用 | **需人工** R3 | 认可宿主会话里的成功案例 | 在认可集合上统计六项计数，写入验收记录 |

汇总：

- **完全无需人工**：C01、C02、C03、C07、C08、C09、C11（handler 级）、C17（文书）。
- **需人工触发、agent 收尾**：C04、C05、C06、C10、C12、C13、C14、C15、C16、C18。
- **需人工判定**：C13 的 push 授权决策、关闭标准的成功案例认可。

## 3. 五个遗留 issue 的归属

| issue | 标题 | 归属 | 说明 |
|---|---|---|---|
| 01 | 冻结 M/N fixture 并回填矩阵 | **agent**（第 1、2 条）；第 3 条依赖宿主 | issue 文件本身标 ready-for-agent。M/N 快照已在 evidence.md，导出与重放不需要宿主。只有"挂真实 handler/宿主证据"的部分等宿主会话 |
| 02 | 宿主探测探索预算接线 | **人工触发**，agent 分析 | 对应 C10～C12 宿主级 |
| 03 | 宿主验证运行与矩阵回填 | **人工触发**，agent 回填 | 对应 C04～C06、C13～C16、关闭标准 |
| 04 | 拒绝原因枚举化 | **agent** | 纯重构，orchestrate/index/rs02 套件兜底 |
| 05 | ChildProvenance 类型提取 | **agent** | 纯重构，全量测试兜底 |

## 4. 执行顺序

顺序由一个约束决定：**C16 把宿主证据绑定到 loaded fingerprint 和 disk HEAD**。任何改代码的工作都必须在宿主会话之前落地，否则宿主证据立即过期，会话要重跑。

1. agent：issue 04（拒绝原因枚举化）。
2. agent：issue 05（ChildProvenance 提取、归因推导单点化、read ceiling 旗标）。
3. agent：issue 01 第 1、2 条（冻结 M/N fixture，nx01 改用真实样本，跨进程重扫断言），顺带完成 C01/C02/C03/C07/C08/C09 的 handler 级证据回填。
4. agent：提交，记录该构建的 fingerprint 与 HEAD，作为宿主会话的基线；矩阵中宿主级条目统一填 `notDoneReason`。
5. **人工**：按第 5 节 checklist 跑一次宿主会话。02 与 03 合并在同一会话里做，两者共用 C16 的 reload 与 provenance 步骤。
6. agent：分析宿主产出，替换 floors.ts 的公式反推，回填 C04～C06、C10～C16、C18 宿主级证据，在认可集合上统计关闭标准。
7. **人工**：按第 7 节预定规则在成功案例名单上签字。push 授权入口本轮已决定不开放（见第 7 节）。

## 5. 宿主会话 checklist（人工）

前置条件：

- [ ] 第 4 步的基线 commit 已存在，记下 HEAD。
- [ ] 插件安装目录与本工作区是两个不同路径。
- [ ] 在安装目录完成升级并 reload。

会话内按顺序执行，每一步完成后记下对应的 runId / executionId / rootSessionId：

1. **C16 入口**：启动新 Root，先执行一次 provenance 记录，核对 loaded fingerprint、sourcePath、diskHead 与基线一致；再派一个最小子运行。**若只 reload 未派子运行，本条不通过。**
2. **C10 探测**：派一个 Worker，让它依次做 read、grep、find、ls、只读 bash 各至少一次，再做一次批量调用。不要让它写文件。
3. **C12 阈值**：继续让同一 Worker 读到 soft 阈值一次，再读到 hard 阈值，观察 partial 摄取。
4. **C04 时序**：派三个子运行，分别在通知早于 wait、通知落在 wait 期间、通知晚于 wait 三种情况下调用 wait。第三种用 15s 边界。
5. **C05 失败**：人为制造两次失败：一次子运行输出永不出现，一次 exit 非零。
6. **C06 恢复**：在至少一个 oracle 处于 pending 时退出 Root，重启后观察状态、报告、nextAction。
7. **C14 并行**：对同一 reportRevision 触发两次通知，确认只派一个 oracle；再推进一个新 revision，确认可重派。
8. **C15 模式**：分别在启用和停用模式下走同一组事件；缺省与显式 read 范围各一次；准备一个别的 cwd 下有 Task 的情况。
9. **C13 提交**：依次触发 truth 外 dirty、伪造 Worker validation、门失败或超时、成功提交。**不要执行 push。**
10. **C18 导出**：会话末尾从公开入口执行一次 usage export。

会话结束后把 Root 会话目录路径和上述 id 列表交给 agent。agent 按第 7 节规则生成成功案例名单，你签字后 agent 接手第 4 节第 6 步。

## 6. 明确不需要你做的事

- 写或改任何代码、测试、fixture。
- 手工填写验收矩阵。
- 从 evidence.md 提取 M/N 样本。
- 判断 handler 级证据是否达标，`acceptance.ts` 门禁已强制三级分类。
- 逐条主观判断哪些运行算成功案例，名单由第 7 节规则机械生成。

## 7. 两项人工判定的既定决策（2026-09-12 已确认）

### 7.1 push 授权入口：本轮不开放

决策：维持 git_commit 对 `push: true` 的拒绝与"明确报告不支持"文本，不新增授权入口。

理由：

- 代码现状已满足 spec C13 的"否则明确报告不支持"分支，`index.ts` 的 git_commit 工具对 push 参数标注 Unsupported 并在调用时拒绝，本轮无需改动。
- C13 验证目标是 commit linkage 与零 Worker 提交运行，push 不在范围内。开放 push 会给宿主会话增加有远端副作用、不可回滚的步骤，误触会污染基线仓库的远端状态。
- 将来需要 push 时作为独立 spec 条目设计：授权主体、目标 remote 与 branch、是否 dry-run、审计导出中的记录方式。

宿主 checklist 第 9 步"不要执行 push"与此一致。

### 7.2 成功案例认可：会话前定规则，会话后签名单

决策：不逐条主观判断。以下三条同时满足的运行自动进入"认可成功案例"名单，分母为宿主会话内所有满足条件的运行，不挑选。

1. 运行来自本次宿主会话，RunRecord 指纹与基线 HEAD 一致。C16 不通过的运行一律不计。
2. 裁决通过公开入口落账为 accepted，中途无人工介入改状态。
3. 运行在矩阵中有对应条目，可追溯到 runId / executionId / rootSessionId。

补充约束：

- C04～C15 中人为制造的失败场景（输出永不出现、exit 非零、门失败等）自然落在分母外，但仍以 blocked 或 `notDoneReason` 留在矩阵中，不得从记录中消失。
- 人工若要从名单中剔除某个运行，必须给出写入验收记录的理由。
- 关闭标准的六个"=0"由 agent 在签字后的名单上机械统计，人工动作只有确认规则和签字两步。

## 8. 第 4 步执行记录：宿主会话基线（2026-09-12）

第 4 节第 1～4 步已由 agent 完成，本节记录宿主会话的基线。第 5～7 步待人工。

- **基线 commit**：`61bc74f677cfa9c11b7ddadc4d086bf61ba80a41`（短 hash `61bc74f`，紧随 `5b76f0d`）。
- **构建 fingerprint**：`ed1b521c8e8937f63c385fe3f1dac20106084dff4b400bde4eac11ba62644e56`（`computeLoadedFingerprint()` 对工作区文件计算；宿主会话第 1 步核对 loaded fingerprint 时以此为准）。该指纹包含 `acceptance-claims.ts`——它已加入指纹文件清单。
- 门禁状态：`npm run typecheck`、`npm test`（30 个套件）、`git diff --check` 全绿。`PI_PLANNER_ONLY_REQUIRE_CONTRACT=1 npm run test:e2e` 维持 spec §6 记录的环境限制（本机解析路径无 pi-subagents），非本次改动引入。
- 完成内容对应 issue：04（拒绝原因枚举化）、05（ChildProvenance 提取等）、01 第 1、2 条（冻结 fixture + 真实样本重放 + 跨进程重扫）及第 3 条（矩阵回填，`acceptance-claims.ts`）。三个 issue 文件已附完成记录。
- 宿主级条目（C04～C06、C10～C16、C18 宿主列）统一 `notDoneReason: host-run-pending`，与第 2 节表格一致；push 授权入口维持不开放（第 7.1 节）。

宿主会话按第 5 节 checklist 执行时，第 1 步核对 loaded fingerprint 应等于上列 fingerprint、diskHead 应等于基线 commit；不一致说明安装目录未升级到本基线。
