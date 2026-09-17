# T-20260917-002 envelope 事件调查（2026-09-17）

## 结论

**本 Task 的两次异常是一次 token、一次 wall，不是两次累计 token 超限。** 120000 是 Root 在公开 `planner_delegate` 参数中显式指定的本次 execution 上限，不是当前代码默认值，更不是上下文窗口大小。第一次在累计 input+output=128226 时正确走取消路径；监控取 UPDATE 累计快照的最大值，没有把同一快照重复相加。第二次异常发生在第三轮 execution，Root 已把 token 上限改成 1000000，实际触发的是 180000ms wall 定时器。[S:94,96,102,119,121；delegate.ts:118–134,817–830]

**合理性判断（建议，不是统计结论）**：显式成本/时间熔断本身合理，但把 120000 当成这类开放式历史证据调查的通用预算，没有本事件支持。首轮仅约24秒、11个工具调用就耗尽，输入占98.96%，且一次宽泛目录枚举显著放大下一轮输入；优先修正调查路径、结果体积和分阶段交付，再校准预算。直接升到100万也未解决无界搜索、旧文档误用和报告质量问题。此样本只有一个 Task、四次不同工作范围的尝试，不能给出可靠 P95、最优阈值或普遍成功率。

另有已复现的小边界问题：wall 回调不重新检查 elapsed，真实日志出现 `wall observed=179999 limit=180000` 却写“exceeded”。这是 wall 计时/措辞问题，不是第二次 token 熔断，也不足以解释约两分钟的全盘搜索。[S:121；delegate.ts:660–667,817–819]

## 范围和一手来源

当前工作区 HEAD：`de2cdbd0466070f6f8b6ea9350bf523b4696cdfd`。只新增本报告，测试/提取脚本置于 `/tmp/opencode`；未修改生产代码、现有测试、用户文件或他人报告，未调用模型或真实委派。先读既有 `.scratch/planner-verdict-recovery-research-20260917.md` 获取路径，未把旧 `.scratch/worker-token-limit-research.md` 当当前实现依据。

原始记录别名（后面的行号均指原文件）：

- **S**：`/home/tcuni/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-16T23-13-55-911Z_01a0ac7f-8ec6-71a9-9456-f87e583eaa14.jsonl`。
- **A/B/C/D**：同目录 `subagent-artifacts/<runId>_worker_0_transcript.jsonl`，runId 依次为：
  - A `5238d98c-553d-42e7-af01-bd9687f7f6f8`
  - B `197c5d1a-02f3-4ed3-bf49-9f8447a72cde`
  - C `230454e7-8c28-4003-a35d-33da44468543`
  - D `eebde8c8-226b-49e7-82d8-c93617389d80`
- **MA/MB/MC/MD**：上述文件名后缀换成 `_worker_0_meta.json`；各自6–17行提供 usage、turns、durationMs、toolCount。
- **U**：`/home/tcuni/.pi/agent/npm/node_modules/pi-subagents/`。当前安装版本0.68.0（`package.json:3`）。下文 `U/...` 为该目录下源码。

证据边界：Root 历史原始返回是事件事实；当前源码及离线测试解释实现，不逐字证明历史进程加载的所有依赖。没有完整持久化 UPDATE 流，不能声称数清每次 heartbeat；但逐 assistant usage 重算与 MA/实际异常完全吻合。报告只引用公开工具调用/结果与 usage 数字，不引用 thinking 或签名。

## 先复现，再提出与核验假设

首先执行 `node --experimental-strip-types delegate.test.mjs`，输出 `delegate.test.mjs: all cases passed`（exit 0）。测试走真实 `runDelegation`，launcher 为 fake、不调用模型；涵盖超限、回退快照、无 envelope、大 token、无 heartbeat 的 wall（`delegate.test.mjs:1765–1856`）。它能断言本次取消路径的 signal/observed/limit/recovery，而不只是检查进程退出。

随后提出四个可证伪假设并核验：

| 假设 | 可检验预测 | 结果 |
|---|---|---|
| H1 Root 显式设120000 | 原始调用包含 envelope；不传时不限制 | S:94明确传120000/480000；真实路径无配置在999999也不触发 token；成立 |
| H2 snapshot max，而非重复相加 | 重复/下降快照不取消；usage按消息相加等于128226 | 源码、边界 harness、A逐消息重算三者吻合；成立 |
| H3 第二次是wall | 第二条异常signal=wall；对应token低于当轮上限 | S:121=wall；C累计123542<1000000；成立 |
| H4 首次主要是输入累积 | input远高于output，宽泛读取后每轮input明显增大 | 126896/1330；A:42后下一轮input从13313增到37893；成立。精确token因果拆分未测，不把增量全部归给单一工具结果 |

发现179999/180000后，另做确定性回调注入验证：真实 `runDelegation`，仅虚拟 Date.now 和目标180000ms timer，证明回调在179999时仍取消。它证明实现缺少二次 elapsed 检查，**不证明真实宿主为何差1ms**（时钟量化、调度与系统时间变化未取证）。

## 四轮实际耗用、耗时、进展

时间为UTC；duration取meta，括号内为Root公开call到result时间差，包含准备/终止确认等，不能当模型推理时长。

| 轮/run | envelope tokens / wall | input / output | cacheRead / cacheWrite | turns / 工具调用 | duration | 结果 |
|---|---|---|---|---|---|---|
| 1 A | 120000 / 480000ms | 126896 / 1330 | 0 / 0 | 12 / 11 | 23.611s（34.015s） | tokens128226取消；未写文件 |
| 2 B | 1000000 / 180000ms | 167054 / 10615 | 250535 / 0 | 14 / 14 | 45.971s（56.434s） | 改01注释、返回报告；短SHA freshness被拒并有无依据声明 |
| 3 C | 1000000 / 180000ms | 119226 / 4316 | 135028 / 0 | 17 / 16 | 179.992s（190.400s） | wall取消；未完成纠错 |
| 4 D | 1000000 / 300000ms | 47302 / 5016 | 0 / 0 | 6 / 6 | 25.818s（36.305s） | 最小文档纠错、完整HEAD、进入reviewing；并非原宿主验收已完成 |

来源：S:94/96、102/103、119/121、131/132；MA–MD:6–17。所有meta模型均为 `tcuni-agy/gemini-3.8-flash-high:high`（各14行）。A/C 的 turns 各含一个零usage终止错误消息（A:47/C:67），因此不能把12/17一律说成12/17次有账单的模型推理。toolCount包含 structured_output 和被拒绝/中止调用，不能等同成功工具数。四轮监控口径 input+output 分别为128226、177669、123542、52318；cacheRead单独统计，不再混入该上限。

### 首轮详细轨迹与 token 跳变

A:3–30：git状态与完整HEAD、查nx目录和followup文件、读CONTEXT、followup两段、01票历史。A:31–34有一次find漏pattern错误；35–38补参数重复nx目录查询。A:39调用 `find {pattern:"*",path:".scratch"}`；42返回32766字符、502行的宽泛清单。A:43准备读 `.scratch/host-verify-46-48-49-50/summary.md`，46立即 `Operation aborted`。本轮未见写工具或写入shell，S:96终止快照亦无新的tracked修改。

按A各assistant行的公开usage重算（input+output，不含cache）：

| 原始行 | 当轮input | 当轮output | 累计 |
|---|---:|---:|---:|
| 3 | 4469 | 423 | 4892 |
| 7 | 5000 | 278 | 10170 |
| 11 | 5624 | 39 | 15833 |
| 15 | 5713 | 73 | 21619 |
| 19 | 7025 | 89 | 28733 |
| 23 | 10628 | 94 | 39455 |
| 27 | 11471 | 69 | 50995 |
| 31 | 12820 | 71 | 63886 |
| 35 | 12940 | 38 | 76864 |
| 39 | 13313 | 55 | 90232 |
| 43 | 37893 | 101 | 128226 |
| 47 | 0 | 0 | 128226 |

从90232跳到128226，单次新增37994；超限8226，即阈值的6.855%。这与消息结束才获得usage的离散采样一致，不需要重复加总假说。累计input包含每轮再次发送的已有上下文；不是唯一新读文字数量，也不是128226上下文窗口。首次最大已记账单轮input只有37893。

### 第二、三、四轮的进展与浪费点

- B:7–10再次全量枚举.scratch；11的input升到29772。47–50写票据注释并做diff-check；51–54 structured_output缺validation.type被拒，55–58补齐。S:103保留的报告用了短SHA，并声称纯沙箱/无插件环境；这些话不是本研究采纳的事实。Root要求“最多12次工具”但实际14次，其中两次structured_output；不是机械硬上限。[S:102；B:3–58]
- C:7–18查仓库、`/public/pi`并递归grep；23–30读02/03 wontfix并看历史；43–46扩大到`find /public`；55–58查旧文件，工具输出表明历史代码已删除。63执行 `find / -name "handoff-evidence-index.json" -o -name "*host-validation*" ...`，从23:28:30.180到23:30:29.925被中止，约119.745s。16次工具均为读取/查询，未见纠错写入；已有dirty是B留下，不能归因C。Root要求最多10次工具，实际16次，说明提示约束不足。[C:3–67；S:119/121]
- D:3–6越界offset读取失败；7–14重新读并edit；15–18 diff-check与完整HEAD；19–22同样缺validation.type，23–26修复。约5次“工具”要求最终为6次（包含2次structured_output）。这轮成功仅是Root给出准确替换内容后的文档修正，不能据此断言52k足以完成原调查。[S:131/132；D:3–26]

## 当前实现：参数来源、计数、采样和wall

1. `validateEnvelope(undefined)`直接返回undefined，显式数字向下取整并验证正整数，source固定`delegation-param`（delegate.ts:118–134,604）。ADR-0001:59–66也明确no defaults；ADR-0002:65–66更新恢复入口为redelegate。不存在本路径内默认120000。S:94是实际来源，S:102/119/131是后续Root显式调整；每轮单独计数，没有继承上轮累计余额（delegate.ts:653）。
2. U/src/runs/foreground/execution.ts:1079–1105在assistant `message_end`累加input/output/cache/cost；`progress.tokens=input+output`，不含cacheRead/cacheWrite；1133–1134触发UPDATE。950–974发送snapshot；U/src/slash/delegation-adapters.ts:241–283,308–328逐层透传tokens。不是每个流式token都实时封顶，也不是provider max-output参数。
3. delegate.ts:823–830取非负有限tokens，用Math.max，严格`>`触发；等于120000不会触发。660–667只记录第一条异常并abort一次。重复UPDATE、回退值不重加，未知值不重置观测。这与A逐消息总和完全一致。
4. 采样取消允许一个消息usage跳过阈值；取消传播还可能留下已发起工具。上限不是精确不可超出的账单保证。本次第一条超限快照就是128226，不能把8226全解释为取消后的继续消耗；A:43已经记账，A:46工具被取消。
5. wall从调用launcher前起算，是独立setTimeout（delegate.ts:815–836），不依赖UPDATE，非CPU/模型时间。回调直接breach，没有`elapsed >= limit`检查，且Date.now为wall clock。真实S:121与注入测试均显示观测179999也可取消；应改进计时边界和文案，但本次仅报告建议。
6. 提示中的“最多N工具调用”不是本 envelope 字段。当前 `delegate.ts` 不转发toolBudget，schema只给maxTokens/maxWallMs（221–227），此次实际多轮超过提示数字。上游adapter支持request.toolBudget（U/src/slash/delegation-adapters.ts:286–305），不能误称本Root已经启用了它。

## 建议及尚未证明的部分

### 建议（未实施）

- **先控制输入和搜索范围**：Root提供核实过的证据索引路径；缺路径时有界查找并交付缺失清单，避免全.scratch列举、`find /`、递归扫node_modules/历史sessions。read/find的输出体积预算比只数调用更接近此次成本来源。
- **分阶段交付**：现状/索引核验→明确需要补的宿主证据→最小编辑/验证，每阶段有可保留的结果。到预算前留出structured report与schema纠错余量；只有硬取消会丢失尚未成形的报告。
- **预算口径显式化**：告知Root这是每execution累计非缓存input+output，不是上下文窗口或纯输出；缓存命中率会显著改变同样工作量的监控数值。若目的是经济成本，另研究按实际cost/缓存价格计量；若目的是防探索失控，还需要工具范围/时长/进展指标。不要把缓存直接加进现有计数而不改契约。
- **120000可作为某个有界试探阶段的显式上限，但不应宣传为调查任务默认安全值**。本例证明它会在当前轨迹下、完成报告前停止；并未证明只提高到某一数值就能得到正确结果。B虽177669完成报告，却需质量纠正；C升至100万仍超时。先在同类任务收集分阶段input/output/cache、工具结果体积、成本、时长和合格交付，再提出可验证的预算调整假说。
- **wall保持独立保护有价值**：此例阻断了全盘搜索；与其直接延长到5分钟，更应给单命令合理超时并收紧范围。对179999/180000，研究使用单调时钟、到期复查并重新调度剩余时间，或者把文案改成“timer deadline fired”而非无条件“exceeded”。
- **若需要机械工具预算**，明确定义是否包含structured_output/失败调用，走可测试的结构化控制；本次12/10/5只是自然语言约束。别把报告修正和宿主验收完成混为一谈。

### 不确定性

没有按provider原始请求逐token复算，usage视为宿主/provider报告值；未做因果消融来分离tool清单、prompt、既有上下文对input增量的精确贡献。没有完整UPDATE历史、历史依赖加载hash的独立核验，也没有阈值分布统计。C的1ms差值根因不明。上述边界不影响“两次异常不同信号”“Root显式120000”“累积快照非重复相加”这三项结论。

## 测试命令与实际输出

```sh
node --experimental-strip-types delegate.test.mjs
node --experimental-strip-types /tmp/opencode/envelope-boundary.mjs
node /tmp/opencode/envelope-stats.mjs
```

前两个exit 0，stdout：

```text
delegate.test.mjs: all cases passed
PASS token: duplicate/regression ignored; 120000 allowed; 128226 cancels once
PASS no envelope: 999999 does not trigger token cancellation
PASS wall: no UPDATE needed
REPRO wall: timer callback at observed=179999 still cancels for limit=180000
```

stats脚本按JSON结构提取usage，不输出thinking，重算A/B/C/D分别128226/177669/123542/52318，均与meta相符；确认A:42结果32766字符、502行。边界harness用真实TaskStore/UsageLedger/runDelegation和隔离临时git目录，launcher仅提供快照/取消terminal；没有调用生产工具、没有模型请求。wall注入只验证该回调边界，不冒充真实等待180秒的性能实验。
