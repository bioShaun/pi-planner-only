# Worker 分档：两个历史案例的证据复核

日期：2026-10-06。范围：复核 T2 处理顺序与 om09 AF 修正两个候选案例，不重跑业务任务或模型试验。第 5 节补充同日的科普动画案例（v1 Luna / v2 Sonnet），第 6 节为据此拟定、尚未执行的对照重放方案。

## 结论

已有 Lite 时期的返工和 Root 修正记录，但这两个案例目前都不能计为「已核实的 worker 能力不足」：

| 案例 | 已有证据 | 归因缺口 | 本轮处置 |
|---|---|---|---|
| T2 fold / off-target merge 顺序 | 历史报告记录一次 reviewer 判为 P1、worker 修复的返工；版本化任务文本仍可读取 | 任务文本要求放在合并之前，报告却把这个顺序列为缺陷；缺原始委派、reviewer 正文和修复 diff | 标记「需求/验收冲突待核」，排除出能力不足样本 |
| om09 多等位位点 AF | 历史报告记录 reviewer 发现问题后 Root 修正；委派 CSV 保留模型、run id、原始行号和耗时 | 无法读取原始任务和修正转录；不能确定缺陷对应哪个 worker、要求是否充分，以及额外 Root 轮数/费用 | 保留为真实业务候选，能力归因和修正成本均未知 |

这不否认历史返工，也不证明强模型无效。当前结论是「样本不足或结果混杂，继续补证据」，仍暂缓实现分档。

## 1. T2：先核清要求，再评价 worker

对象：2026-09-29 的 `rdt-r2t` / T2 treat。历史配置为 Lite strict、handoff=off，Root 为 `deepseek-v4.1-flash`，worker 为 Luna / medium；本轮未取得 child 原始身份记录，配置来自历史报告。

[第 2 轮报告的 T2 补充](../.scratch/root-decomp-trial-20260928/round2-report.md)记录：

- reviewer 将 fold 在 off-target merge 之前判为 P1，随后 worker 修复；这是一次重新委派，未记录 Root 接手实现。
- 目标测试 10 项通过、全套件无新增失败是最终评测结果，不代表首次实现通过。
- treat 整个任务花费 $0.2759，其中 Root $0.1512、所有 child $0.1247；耗时 1994 秒、Root 30 轮。上述数字均不是此次返工的增量成本。
- treat 还有文档同步、复审、广域探索和 Root 长输出，不能将与 base 的费用差全部归到这个缺陷。

本轮核对了 [T2 任务文本](../bench/tasks/T2.md)第 15–21 行，以及历史提交 `3f58416` 中的同一文件。两者 Git blob 均为 `251b64b1edb4a0269d2c7a39792fedc6ba7433f4`，明确写着：

> 插入点在 post_processor.run 之前、且必须在这三步之前，否则各有一种坏法：

其后第一步就是 `off_target_facts` 按 `probe_id` 合并。但该段又解释，过早加入 ALT 会继承 REF 事实或被补成零脱靶；[T2b 文本](../bench/tasks/T2b.md)相应位置则是「这三步之后」。这使 T2 要求本身及其与复盘结论之间存在冲突。

`3f58416` 是 [treat arm](../bench/arms/lite-tds-strict-treat.json)的插件版本。文件在该提交存在不等于已还原当时实际发送的完整 prompt；缺少冻结 prompt 和 Root 委派正文，因此还不能断言 worker 当时收到的指令就是这一段，也不能断言 reviewer 判断错误。

下一次复核所需材料：实际 task/prompt、首次 worker brief 与 diff、reviewer 的 P1 原文、返工 brief 与修复 diff。先判断是要求错误、Root 交接遗漏、worker 未遵守清晰约束，还是 reviewer 误判。只有最后能归到 worker 的实现或推理缺陷，才进入能力样本。

若用此题做未来对照，必须先确定合并与折叠顺序的验收条件，并冻结新的无歧义任务版本；历史 T2 结果保留原样，不能拿修订后的题目倒推过去模型的能力。

## 2. om09 AF：有修正记录，缺逐次归因

对象：om09 `/home/scripts/nf-rnaseq-v2`，Root 会话 `01a0e649-398b-7713-8774-fded5d70bdac`（2026-09-28），Root 为 Opus。

[真实使用复核](../.scratch/om09-usage-20260929/findings.md)第 51 行记录：Root 委派实现后再委派 reviewer；reviewer 发现多等位位点 AF 口径问题，Root 随后修改并检查，最终明确 Nextflow 未真实跑过。该报告的主样本均有 Lite 模式记录，但覆盖当时两个提示版本，不能称为与当前 pi-subagents 0.76.0 环境配置相同的样本。

本轮从 [delegations.csv](../.scratch/om09-usage-20260929/delegations.csv)独立筛出该会话的 6 次委派：1 个 explorer、4 个 worker、1 个 reviewer。以下是相关的五次，行号指原始 Root JSONL，模型是 CSV 已记录值：

| 角色 | 原始调用/返回行 | run id | 记录的 child 模型 / thinking | child 耗时（秒） |
|---|---|---|---|---:|
| worker | 44 / 45 | `1ceb6423-da64-4b6d-b274-911f77237b42` | `tcuni-luna/gpt-6-luna:medium` | 197.408 |
| worker | 54 / 55 | `6d6e54a5-f8d5-4f68-9d49-df7a35568de4` | `tcuni-luna/gpt-6-luna:medium` | 150.363 |
| worker | 73 / 74 | `a5a59126-481a-47fe-9da1-cdd90e5076dc` | `tcuni-luna/gpt-6-luna:medium` | 163.636 |
| worker | 87 / 89 | `da75e30f-d7b6-4096-9485-ae9c4c2f945d` | `tcuni-luna/gpt-6-luna:medium` | 338.470 |
| reviewer | 122 / 123 | `4c40768b-9760-42da-a57f-f7072de3b391` | `tcuni-luna/gpt-6-luna:high` | 128.592 |

五次生命周期状态都是 `completed`。这既不能证明首次质量通过，也不能把四次 worker 当成四次失败或同一问题的重试。CSV 没有任务正文、修正 diff 或逐次费用。

当前可追溯链条为：历史报告所述的实现 → CSV 可定位的 reviewer 返回（123 行）→ 历史报告所述的 Root 修正及最终说明（130 行）。不能据此推断修正只有 7 轮，JSONL 行号差不是 Root 轮数；reviewer 的 128.592 秒也不是返工耗时。

优先补齐原始会话 `2026-09-28T04-32-33-676Z_01a0e649-398b-7713-8774-fded5d70bdac.jsonl` 的任务、上述委派及返回、reviewer 之后的 Root 操作与用量，以及相应 child 产物和代码 diff。需要回答：AF 定义是否交代清楚、问题是新增还是既有、由哪次改动引入、Root 为修正实际增加了哪些操作、最终检查覆盖什么。完成后再裁定能否作为模型对照任务。

## 3. 证据保留情况与统计边界

本轮读取了仓库内历史报告、trial.log、delegations.csv、版本化任务文件和 Git 对象。按候选会话/run 标识检索了本机 `.pi/agent/sessions`、`.herdr/worktrees`、`/project/tmp` 和 `/home/tcuni-claw/pi` 中的可见文件；未找到这两个案例的原始转录副本。历史报告引用的 snapshot 目录、worktree 路径及 `/project/tmp/ppo-bench/results/rdt-r2t` 在本次环境中不可用。这只说明本轮未取得原件，不表示远端或其他归档已永久丢失。

本轮没有重跑历史采集脚本、连接远端或发起付费试验。记录的历史金额未按现价重算；缺少逐次用量的地方保持未知，不填零，也不由总任务费用推算返工费用。

已有 [medium/high thinking 对照](../.scratch/root-decomp-trial-20260928/round2-report.md)仅覆盖 T3、T2b，每格 n=1，实际推理强度变化也未验证。它不是换成更强模型的对照，不能填补本轮缺口。

## 4. 下一步的完成标准

1. 优先找回 om09 AF 原始会话和修正 diff，完成一条业务案例的归因与增量成本核算。
2. T2 先厘清实际发送的要求与 reviewer 依据；若只能新建修订题目，则标为新试验，不称为历史案例复现。
3. 至少有一条要求清楚、缺陷与返工链可核实的候选后，再冻结初始代码、验收条件、Root 配置、worker 提示/工具和对照模型。对照重复次数、预算及停止条件在启动前写定。

原件未恢复、归因未清或结果混杂时继续观察，不因已有一次审查修正就实现分档。

## 5. 科普动画案例：v1 Luna、v2 Sonnet

对象：manim 科普动画「液相捕获探针设计」，工程 `/project/tmp/tcuni_probe_video/`（非 git；v1 代码在 `v1_backup/`，v2 规格为 `STORYBOARD.md`）。用户反馈：v1 用 gpt-6-luna 做 worker，效果很不满意；v2 改用 claude-sonnet-5-5 重做，效果不错。

原始会话位于 `~/.pi/agent/sessions/--public-scripts-tc-probe-design-v2--/`：v1 Root `2026-10-05T23-25-38-335Z_01a10e63-…`，v2 Root `2026-10-06T09-00-36-856Z_01a11071-…`。两轮全部委派的 task 原文和返回已摘录到 [.scratch/worker-tiers-probe-video/](../.scratch/worker-tiers-probe-video/)（`v1-task01.md` … `v2-result10.md`），文件头注明时间戳及 Root JSONL 行号。

### 5.1 对比

| | v1（UTC 23:25–00:13，48 分钟） | v2（UTC 09:00–10:41，101 分钟） |
|---|---|---|
| Root | claude-opus-5-5 / high，33 轮 | claude-opus-5-5 / high，64 轮 |
| worker | 共 5 次委派：前 2 次 `gpt-6-luna:medium` 写出 S1–S9 全部场景并完成拼接；后 3 次为 `kimi-for-coding:medium`，负责修版面和配乐。会话中途换模型的原因未知 | 共 10 次委派，均为 `claude-sonnet-5-5:medium`；1 次 600 秒超时（`timed_out`），其余 completed |
| 用户输入 | 「做一个简单的视频…科普…你的方案是什么」→「做一个动画就行了」 | 「整个感觉是一个入门的作品」「需要足够吸引人观看，也让不了解的人能够很好的理解」 |
| 规格 | Root 在 task 里写了逐幕画面、字幕原文和抽帧自检要求（约 2.7k 字/次）；`style.py` 由 Root 提供，约 65 行，只含基础颜色和几个小部件，并要求 worker 只读 | Root 先写 10KB 的 `STORYBOARD.md`：品牌配色、版式分区、字号下限、主体宽度 ≥ 60%、「不许再出现缩在角落的小图」、动效原则、「钓鱼」比喻；第一次委派专门重建设计系统（约 480 行），之后逐幕实现 |
| 审查与返工 | 2 次 Luna 实现后，Root 抽帧发现主体普遍过小、挤在上半屏、标签重叠，再委派 2 次修版面 | 每幕交付 1080p 联系表和关键帧（`review/w1…w10`），Root 逐幕审查；S2 按 7 条问题返工，S6 由 Root 自己改，S7/S8 有修正 |
| 代码规模 | scenes_a/b + style 共约 370 行 | 约 1900 行，按新分镜重写 |
| 费用（会话 usage 记录值） | Root $1.93；child $0.53（Luna $0.017、$0.030；Kimi $0.25、$0.18、$0.06） | Root $6.54；child $3.57（Sonnet 单次 $0.11–$0.71） |

### 5.2 可以归到 worker 的部分

v1 的 Luna 有一条比较具体的线索。`v1-task01.md` 明确要求「用读图工具亲自查看。确认没有文字越界、重叠……有问题就修好再重新渲染」。Luna 交付时报告「修正后重新渲染并复查，未见文字越界、字幕遮挡或乱码。未解决问题：无」（`v1-result01.md`）。S6–S9 的报告同样写「未发现待解决问题」（`v1-result02.md`）。

但 Root 随后抽帧，在 `v1-task03.md` 和 `v1-task04.md` 中列出了以下问题：

- S2 三个标签「和图形或彼此重叠」；
- S4「待检探针和检测台有重叠」；
- S8「GC 分布」标题压在直方图上；
- S7 嵌套面板标签压在相邻矩形边框上。

这些都属于任务明确要求自检的项目。可以作为一个候选现象记录：**Luna 的视觉自检报告与 Root 复查结果不一致**。可能原因包括读图能力、执行不认真或报告过于乐观，目前无法区分。

「主体过小、偏上」不能算到 worker 头上：v1 的 task 和 `style.py` 都没有规定主体尺寸，v2 的 STORYBOARD 才把它写成规则。

### 5.3 归因混杂的部分

用户说的「入门作品」主要是对整体审美和表现力的评价。v1 到 v2 之间同时变化了以下因素，worker 模型只是其中之一：

1. 有了用户对 v1 的具体意见，并且是第二次做；
2. 设计系统从 Root 写的约 65 行升级为专门委派重建的约 480 行，规格中有明确的视觉下限；
3. 每幕都有 1080p 截图审查和返工，Root 轮数接近翻倍；
4. 总费用约 $2.5 对 $10.1，约 4 倍；
5. v1 后半段的修版面由 Kimi 完成，不全是 Luna。

Sonnet 也没有一次通过：有超时、有按 7 条问题的返工，Root 还亲自修过一次。

### 5.4 处置

- 记为「真实业务候选，归因混杂」，不计为「已核实的 worker 能力不足」。
- 第 5.2 节的自检报告不一致可以作为待验证假设，进入第 6 节的对照。
- 成本提示：按记录值，Luna 单次约 $0.02–0.03，Sonnet 单次约 $0.1–0.7，相差一个数量级以上；但两轮 Root 费用都大于 child 合计。分档收益应主要看能否减少 Root 审查和返工轮数。

## 6. 对照重放方案（拟定，未执行）

目的：在规格、初始代码、task 原文和验收条件都相同时，比较 `gpt-6-luna:medium` 与 `claude-sonnet-5-5:medium` 作为 worker 的首次交付质量，以及自检报告是否如实。这是提案第 2.2 节所说的固定任务对照，不重跑整个项目。

### 6.1 任务

| 编号 | 来源 task | 初始状态 | 说明 |
|---|---|---|---|
| R1 设计系统 | `v2-task01.md` 原文 | v1 代码（`v1_backup/` 中的 scenes/style/脚本）+ `STORYBOARD.md`，删除 `assets/`、`style_demo.py` | 规格依赖重、审美要求高；Sonnet 原始用时 216 秒 |
| R2 单幕实现 | `v2-task05.md`（S4Quality）原文 | v2 最终版 `style.py`、`assets/`、`STORYBOARD.md`；`scenes_a.py` 中 S4Quality 恢复为原占位（`chapter(2)` 后 `finish()`），其余场景保持最终版 | 设计系统固定，只考场景实现；Sonnet 原始用时 277 秒 |

不选 `v2-task02`，因为它在 Sonnet 下就超时了。也不选返工类任务，因为它们依赖前一次的产物。

### 6.2 执行约束

- 每组（任务 × 模型）各跑 3 次，共 12 次。每次在独立副本 `/project/tmp/worker-tiers-replay/<任务>-<模型>-<序号>/` 中运行；`env/` 用符号链接指向原工程，不复制 1.2G 环境。
- 两个模型使用同一个 worker agent 定义和相同工具；只改 `subagents.agentOverrides.worker` 的 model，thinking 固定为 medium。逐次记录请求值和 child 实际报告的 provider/model/thinking，身份不符的样本不计入有效对照，但费用照计。
- 沿用插件的 10 分钟 child 时限；超时视为该次失败，不追加时间。
- 单幕 `-qh` 渲染约 40 秒，可以串行执行。如需并行或整批提交，按 `slot audit`、`slot status` 预检后使用 `slot cpu -- <cmd>`。临时文件不放 `/tmp`。
- 预算上限 $8，按 Sonnet 单次 ≤ $0.7 估算。前两次出现环境或流程故障时暂停，先修好 harness，故障样本不计入对照。

### 6.3 评估

1. **客观项**：由同一 validator 按 task 原文的验收条款逐条判定。包括渲染是否成功、时长是否在范围内、STORYBOARD 的字号下限和主体宽度，以及关键帧中是否有重叠、越界或字幕遮挡。
2. **自检如实度**：统计 worker 报告「已解决或无问题」、但客观项判为未通过的条目数。这一项直接检验第 5.2 节的假设。
3. **盲评**：把联系表和关键帧去掉模型标识、随机编号后，由用户按「好看、一看就懂」做两两偏好比较。
4. **成本**：记录每次 child 的 token、费用和耗时；再估算要达到验收，还需要几次返工委派（每条未通过的客观项按需一次修正委派计）。

### 6.4 判读

- Luna 的客观通过率、自检如实度和盲评都明显落后，且 3 次结果方向一致：在提案第 1 节把本案例升级为「已核实的能力差异」，按提案第 2.2 节的四种结果判断后续。
- 差异只出现在 R1（设计、审美类），R2 接近：支持按任务类型分档。
- 两者接近：v1 与 v2 的差别主要来自规格和审查，搁置分档。
- 结果混杂或有效样本不足：照实记录，不据此下结论。
