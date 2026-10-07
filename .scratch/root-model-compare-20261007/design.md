# Root 模型对照设计稿

日期：2026-10-07。状态：用户已确认（预算上限 $30，先做第一阶段）。第一阶段已完成，结果见 `findings-phase1.md`；第二阶段待定。接 `docs/worker-tiers-evidence-2026-10-06.md` 第 6.10 节：非试验会话共花 $388，其中 Root $371、child $17，省钱只能从 Root 入手。

## 1. 要回答的问题

worker 固定为 Sonnet 时，Root 从 Opus 换成 Sonnet 或 DeepSeek Flash，交付质量会不会下降，整个任务能省多少。

## 2. 已知事实

- **单价**（`bench/prices.json`，每百万 token，输入/输出/缓存读）：Opus 5/25/0.5，Sonnet 3/15/0.3，DeepSeek Flash（cline-pass）0.3/1.2/0.006。按 token 计，Sonnet 是 Opus 的 60%，DeepSeek Flash 约 6%。
- **为什么会话费用差 10 倍以上**：真实会话里，Opus Root 每个会话平均约 $5，Sonnet Root 约 $0.4。单价只差 40%，剩下的差距主要来自任务轻重和轮数，不能当作换模型能省的钱。
- **已有对比**（explorer 汇总，出处见 §7）：
  - 没有 Opus、Sonnet、DeepSeek Flash 三种 Root 在同一任务、同一 worker、同一验收下的对比。
  - 没有找到「日常 Root 选 Opus」的依据记录。
  - bench 的 T1–T3 用便宜 Root 加 Luna worker 也都 12/12、8/8 通过，任务太容易，分不出高低。
  - root-delegation-guidance 的 G1/G2 不配对，每组 n=1。
- **bench 可复用**：
  - `bench/run.sh`、`campaign.sh` 提供 Landlock 写入边界、`runcheck`、`summarize.py` 和 resume。
  - arm 的 JSON 可以指定 `rootModel`。
  - worker 模型读 `~/.pi/agent/settings.json`，现在已是 Sonnet，运行期间不能改。

## 3. 第一阶段：拆 Opus Root 的花费（只读日志，约 $0.3）

对 66 个 Opus Root 会话按轮拆分费用，分四项：缓存读、缓存写、输入、输出。再把 Root 的工具调用分成五类：自己读代码或数据、审查 child 结果、委派、提交、回复用户。

目的有两个：
- 估计换 Root 能省的上限。缓存读占比越高，换 Sonnet 的节省越接近 40%。
- 找出比换模型更便宜的办法。例如 Root 自己读大文件花了多少，长会话的上下文是否在每轮重复计费。

这一阶段的结果可能直接改变第二阶段的优先级。

## 4. 第二阶段：固定任务对照

**R1：读写锁改动。**
- 来源：本仓库 10-01 的 Root 会话，基线是 `850933b`，答案是 `f2fe050`。
- 给 Root 的输入：用户级的需求，即当时 Root 提出、用户回复「可以」的那条建议第 1 项（explorer 和 reviewer 之间可以并行，和 worker 仍然互斥；scout 去掉写工具），加上本仓库的 AGENTS.md 约束。
- Root 要做的事：自己拆分任务、写 brief、委派 Sonnet worker、审查，交出可以提交的状态。
- 隐藏验收：沿用第 6.9 节 S2 的 12 条，但去掉「逐字文案」这一条，因为文案由 Root 来写。另加两条：
  - scout 是否去掉了写工具。这是当年 reviewer 提出的 P2。
  - README 是否与新规则一致，没有矛盾。第 6.9 节里 Sonnet worker 有 1/3 的概率漏掉这一点，好的 Root 应在审查时发现。

**R2（暂缓，待 R1 结果再定）**：业务数据任务。例如 om09 的「差异分析结果与 SNP 结果建立关联」，从用户原话开始。这类任务的做法由 Root 设计，第 6.9 节 S1 的 46 条检查只适用于 Opus 当时定的规格，需要另做通用检查，再加盲评，准备成本较高。

**臂与次数**：Root 分三种（Opus、Sonnet、DeepSeek Flash），thinking 都按日常配置，worker 都是 Sonnet medium。每臂 3 次，共 9 次，交错串行。

**运行**：
- 单次 Root 会话可能长达 20–40 分钟，用 `slot` 在后台提交，不放在委派里跑。
- 每次运行核对实际生效的 Root 和 worker 身份。
- 运行目录用 `git archive` 加新的 `git init`，看不到答案提交。

**记录**：
- 隐藏验收通过数。
- Root 是否在审查时发现并修正了 worker 的缺陷。
- Root 轮数，以及委派、返工的次数。
- 总费用（Root 加所有 child）和端到端耗时。
- 是否需要人工介入或接手。

## 5. 判读（启动前写定）

- **便宜 Root 合格**：同时满足下面三条：
  - 3 次的隐藏验收平均通过数不低于 Opus 平均减 1；
  - 交出的结果里，没有 Opus 3 次都没出现过的 P1 级缺陷，例如测试被削弱、文档与新规则矛盾；
  - 3 次里不超过 1 次需要人工介入。
- **Sonnet Root 合格**：建议日常 Root 改为 Sonnet，再用 R2 或真实使用观察一段时间。
- **只有 DeepSeek Flash 也合格**：同样建议，但它此前作为 worker 在视觉任务上 5/6 超时，需要先看它作为 Root 的超时情况。
- **都不合格，或 Opus 自己 3 次也不稳定**：保留 Opus。改从第一阶段找到的花费结构入手省钱。
- **n=3 只能看出明显差异**：差异小于 1 条检查时，记为「无明显差异」，不据此排名。

## 6. 预算与停止条件

- 第一阶段约 $0.3。
- 第二阶段准备约 $1。运行费用按每次估计：Opus $2–4，Sonnet $1.5–2.5，DeepSeek Flash $0.3，worker 每次 $0.2–0.5。9 次合计约 $15–25。上限 $30，超出就停下汇报。
- 同一臂连续 2 次因环境原因失败，立即停止排查，不计入结果。

## 7. 出处

- `docs/lite-measurement-2026-09-24.md`：T1–T3 不是 Root 模型对照。
- `.scratch/lite-increment-review-20260926/guarded-calibration-20260926/report.md`：只有 Opus 一臂。
- `.scratch/root-delegation-guidance/campaign-report.md`：G1/G2 不配对，n=1。
- `.scratch/root-decomp-trial-20260928/round1-report.md`、`round2-report.md`：Root 都是 DeepSeek Flash，比较的变量是 prompt 和 worker thinking。
- `.scratch/om09-usage-20260929/findings.md`：业务记录，任务不同，不可比。
