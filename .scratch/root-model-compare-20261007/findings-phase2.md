# Root 模型对照第二阶段（R1）结论（2026-10-08）

设计见 `design.md`（§4 R1，§5 判读规则）。运行产物在 `/project/tmp/root-model-compare/r1/out/`。过程记录见 `docs/root-model-compare-progress-2026-10-08.md`。

## 1. 一句话结论

- **按设计稿 §5 的字面口径**：两条便宜臂各有一处「Opus 3 次都没有出现过的 P1」：
  - sonnet-1 的 README 有一句措辞与新规则矛盾；
  - dsflash-2/3 给 reviewer 加了锁。

  按这个口径两条都不合格，应当保留 Opus。
- **按裁量口径**：sonnet-1 那句话在同一段里就被纠正了；dsflash 是照字面执行了一个有歧义的提示词（见 3.3）。按这个口径两条都合格，**Sonnet 当 Root 的质量与 Opus 无明显差异，单次总费用约为 Opus 的 30%**。
- **采用哪个口径需要用户裁定**。我建议采用裁量口径（理由见第 4 节）。
- **R1 本身区分度不够**：分数差异主要来自检查的偏差（第 3 节），而不是 Root 的能力。建议做 R2。

## 2. 数据（9 次全部有效；worker 固定为 Sonnet medium）

| 运行 | 冻结自动项 | 校正后\* | 人工项（scout 汇报 / README） | 墙钟 | Root 轮数 | Root $ | child $ | 总 $ | 委派 |
|---|---|---|---|---|---|---|---|---|---|
| opus-1 | 18/18 | 18 | 通过 / 通过 | 754s | 31 | 1.73 | 0.51 | 2.24 | explorer 1、worker 1、reviewer 1 |
| opus-2 | 18/18 | 18 | 通过 / 通过 | 703s | 37 | 2.34 | 0.58 | 2.93 | worker 1、reviewer 1 |
| opus-3 | **8/18** | 17–18 | 通过 / 通过 | 909s | 46 | 3.42 | 0.93 | 4.35 | worker 3、reviewer 1 |
| sonnet-1 | 18/18 | 18 | 通过 / **不通过**‡ | 427s | 24 | 0.91 | 0.54 | 1.44 | worker 1 |
| sonnet-2 | 17/18 | 17 | 通过 / 通过 | 189s | 20 | 0.62 | 0 | 0.62 | **0** |
| sonnet-3 | 17/18 | 17 | 通过 / 通过 | 219s | 20 | 0.72 | 0 | 0.72 | **0** |
| dsflash-1 | 15/18 | 16 | 通过 / 通过 | 783s | 43 | 0.10 | 0.73 | 0.84 | worker 1、validator 1、reviewer 2 |
| dsflash-2 | 16/18 | 18† | 通过 / **不通过**† | 678s | 55 | 0.10 | 0.62 | 0.72 | worker 1、reviewer 2 |
| dsflash-3 | 16/18 | 18† | 通过 / **不通过**† | 569s | 43 | 0.09 | 0.57 | 0.66 | worker 1、reviewer 2 |

**均值**

| 臂 | 冻结自动项 | 总费用 | Root 费用 | 墙钟 |
|---|---|---|---|---|
| Opus | 14.7 | $3.17 | $2.50 | 789s |
| Sonnet | 17.3 | $0.93 | $0.75 | 278s |
| DS Flash | 15.7 | $0.74 | $0.10 | 677s |

**第二阶段花费**：账本 $14.93，只含运行（含 2 次无效冒烟和健康检查）。加上准备阶段约 $2，合计约 $16.93，未超出 $30 上限。

\* **校正**只用于判读，冻结分数不改。三类偏差见第 3 节。opus-3 的 17–18 是用变体 driver 补测的行为结果（8/9，唯一未过的是 3.2 所说的文案问题），再加上对 `assertions_kept`、`scout_write_tools` 的人工复核得出的。

† reviewer 加锁：按冻结细则不通过，但符合提示词的字面意思，见 3.3。

‡ sonnet-1 的 `README.md:32` 写着「worker 和 validator 独占仓库：a second child in the same repository is refused until it ends」，中文 README 第 26 行意思相同（「同一仓库里的第二个子代理会被拒绝」）。这与 reviewer 可以并行矛盾，尽管同一段末尾又写了「A reviewer … holds nothing」。

其余 8 次的锁说明我按同样严格的标准逐段复核过，没有类似问题。例如 sonnet-2 写的是「a second child of any holding role」，dsflash-1 明确写了「A reviewer holds nothing, so it runs alongside either」。

## 3. 冻结检查的三处偏差（逐条核实过）

### 3.1 opus-3 得 8/18 是测试工具的盲区，不是缺陷

- **Opus-3 的方案**：没有沿用内置 scout，而是在插件里通过 pi-subagents 的 `pi-subagents:runtime-agent-register:v1` 事件，运行时注册一个只读 agent `planner-scout`（工具为 read/grep/find/ls/bash），explorer 改用它。这是 9 次中唯一一个在仓库内真正去掉 explorer 写工具的方案。
- **为什么判不过**：
  - 已安装的 pi-subagents 0.76.1 确实支持这个事件（`src/agents/runtime-agent-events.js`）。
  - 但隐藏 driver 的假事件总线不应答这个事件，于是 explorer 一律被拒，涉及 explorer 的 8 条行为检查全部失败。
- **变体验证**：做了一个只多应答注册事件的 driver 变体（`r1/supplementary/driver_reg.mjs`），9 次的冻结版和变体版结果都存在 `r1/supplementary/driver_reg_results.txt`。
  - opus-3 的行为检查从 1/9 升到 8/9；
  - 其余 8 次的结果完全不变。
- **另外两条未过项也属误伤**：
  - `assertions_kept`：被换掉的 3 条断言都和 scout 的名字或输出文件有关，替换后的断言更严，断言了工具列表里不含 write/edit/apply_patch。
  - `scout_write_tools`：检查只看 REQUEST 和 scout.md，看不到注册定义里的工具限制。
- **planner-scout 的来历**：它是本项目早期用过的 agent，在 CHANGELOG 和 ADR 中都有记载，属于从仓库历史里重新找到的方案，不是泄漏。隔离检查也没有发现越界。

### 3.2 handoff_guard 只检查拒绝文案

dsflash-1 把锁冲突时的拒绝文案改成了「a child is still holding the working directory.」，opus-3 改成了「a child still holds a repository lock.」。handoff 仍然被正确拒绝，只是检查要求文案中出现 `still running`。

### 3.3 冻结提示词在 reviewer 上有歧义，检查偏向答案的读法

- **提示词原文**：「explorer 和 reviewer 之间改成可并行，和 worker 仍互斥」。
- **两种读法**：
  - dsflash-2 和 dsflash-3 照字面实现：reviewer 也加读锁，与 worker 互斥。dsflash-2 在汇报里写明了「原来 reviewer 完全不持锁」，理由是审查可能读到正在修改的工作树，所以主动收紧。也就是说，它是在知道现状的前提下作出的选择。
  - Opus 和 Sonnet 6 次都依据「仍」字和基线现状，让 reviewer 保持不加锁。opus-3 在汇报里明确说明了这个取舍。
- **检查的偏向**：隐藏检查 `reviewer_unaffected`、`assertions_kept` 中与 reviewer 相关的断言，以及人工项 README 细则，都按答案 f2fe050 的读法来定。
- **代价**：这个选择确实让 reviewer 失去了与 worker 并行的能力，dsflash-2 也因此删掉了一条保护 reviewer 并行的断言。

## 4. 按设计稿 §5 判读

| 条件 | Sonnet | DS Flash |
|---|---|---|
| 平均通过数 ≥ Opus 均值 − 1 | 冻结：17.3 ≥ 13.7，满足；校正：17.3 vs 约 18，差 1 以内，记为无明显差异 | 冻结：15.7 ≥ 13.7，满足；校正：约 17.3，无明显差异 |
| 没有 Opus 从未出现过的 P1 | 字面口径：sonnet-1 的 README 矛盾（文档与新规则矛盾是 §5 列举的 P1 例子），**不满足**；裁量口径：措辞失误，同段即纠正，不影响行为，满足 | 字面口径：reviewer 加锁属于行为与文档都与检查规则矛盾，**不满足**；裁量口径：对歧义需求作出的有理由选择，满足 |
| 人工介入不超过 1 次 | 0 次 | 0 次 |

**我建议采用裁量口径**，理由有三：
- §5 举的 P1 例子是「测试被削弱、文档与新规则矛盾」，本意是抓实质性错误；
- sonnet-1 那句话的错误程度明显低于这个本意；
- dsflash 的「错」源自冻结提示词本身的歧义，检查又偏向答案的读法。

即使采用裁量口径，dsflash 的这个倾向也值得记下：遇到歧义时，它选择了收紧现有能力。

**其他观察**
- **Sonnet 当 Root 有 2/3 次完全不委派**：
  - sonnet-2/3 主要用 bash 自己改代码、自己跑测试；sonnet-1 只委派了 1 次 worker，没有派 reviewer。
  - 3 次都没有独立审查；sonnet-1 那句 README 措辞问题恰好是审查容易抓到的那类。
  - 小任务上这样更快更便宜（189–219 秒，$0.6–0.7）。但在大任务上 Root 自己干活要背着 Root 的上下文开销，省钱效果未必还在。
- **审查后返工**：Opus 和 DS Flash 每次都派了 reviewer。dsflash-1、dsflash-3、opus-2、opus-3 都根据审查意见修了问题。
- **DS Flash 当 Root**：
  - Root 自己读文件、改文件很多（自己 edit 3–14 次，读文件 22–33 次），Root 轮数 43–55，是三臂中最多的；
  - 但 Root 费用只有 $0.10 左右，总费用主要是 child；
  - 4 次尝试中有 1 次被 provider 的「Stream error」打断（pi 1.0.4 不会自动重试这种错误）。另一次健康检查超时出在 Luna，与臂无关。
- **Opus**：费用和墙钟都最高；opus-3 的方案最有野心，同时也最贵（$4.35）。

## 5. 建议

1. **如果用户同意裁量口径**：日常 Root 试用 Sonnet（符合设计稿 §5「Sonnet Root 合格」那一支），用真实使用或 R2 观察一段时间。观察重点：
   - 是否该委派时不委派，以及没有独立审查导致的漏检；
   - 对大任务的费用。

   **如果坚持字面口径**：保留 Opus，改从第一阶段找到的花费结构入手省钱。
2. **DS Flash 暂不作为日常 Root**：先在需求清楚的任务上用，再看它对歧义需求的处理和 provider 中断率。
3. **建议做 R2**，选一个更大、靠 Root 自己做明显不划算的任务，专门检验 Sonnet 当 Root 时的委派意愿和审查习惯。R2 的提示词要避免 3.3 那样的歧义；隐藏检查不要绑定答案特有的接口或文案（3.1、3.2）。
4. **n=3**：这些结论只能说明「没有明显差异」，不能据此给三臂排名。
