# P2 实验预注册：Native 指令加两句

2026-10-29 用户明确授权重启一次 pilot 和 12 次正式对照；新 pilot `p2-restart-luna-01`，正式 campaign `p2-restart-terra-01`。旧环境失效批次保持原始证据，不计入正式分析，已付 $0.2527056 永久计入预算；决策规则不变。

Spec：`spec.md` P2。状态：费用未知暂停，证据不足，不改生产指令；第 6 至 12 次未运行。预算 $25 已获用户批准（2026-10-29），Root 为 tcuni/gpt-6.1-terra。详情见 `p2-report.md` 与 `p2-checkpoint.md`。

## 假设

- H1：加入"小改动自己做"后，Root 在小改动任务上直接修改代码的次数增加、委派次数减少，通过率不下降，费用和耗时不上升。
- H2：加入"审查发现先核实"后，Root 拿到 reviewer 结论后、委派修复前，打开代码核对的比例上升，通过率不下降。

## 唯一改动

两个实验组只有 `promptPrefix` 不同，其余配置全部相同，包括 Root 模型、子代理配置、任务和 pi/pi-subagents 版本。

- base：`实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。`（即现有的 `NATIVE_PROMPT`）
- treat：在 base 后追加两句：`一两处的小改动你自己直接做，不必委派。子代理审查给出的发现，先打开相关代码逐条核实，再决定是否修复。`

两句同时加入，因此只能估计合并后的效果。若结果为正，再决定是否拆开单独检验。

注入位置：bench 的 native arm 不加载插件，指令以用户消息前缀的形式进入，与现有 `native-pds`、`native-opus-calibration` 的做法一致。生产插件则把 `NATIVE_PROMPT` 追加到系统提示词，两者的位置不同，这是已知的近似。实验结论只用于判断指令内容是否值得改。

## 配置

- Root：`tcuni/gpt-6.1-terra`（2026-10-29 用户指定：先后放弃 astra、sol 以降低费用）。本机 Native 日常 Root 是 astra，Root 越便宜越可能不遵循指令，结论外推到 astra 时证据更弱。
- 2026-10-29 用户在实验开始前修订子代理配置：实验专用配置将 worker、reviewer、oracle、planner-validator 和其他角色默认设为 terra，scout 为 luna；严格 modelScope 只允许 terra/luna，指定角色限制各自模型。正式两组配置一致。全局 settings 不修改，运行前后记录哈希。
- 任务：
  - G1：小改动，检验 H1；
  - T3：边界行为，容易产生审查发现；
  - T2b：逻辑复杂，容易产生审查发现。
- 每组每任务跑 2 次，共 2 组 × 3 任务 × 2 次 = 12 次。串行运行（`--parallel 1`），`BENCH_MAX_ATTEMPTS=1`。
- 先用 `native-luna-pilot`（Root `tcuni/gpt-6-luna`，单价约为 terra 的 1/10；DeepSeek 已不可用）跑 1 次 G1 作试运行，验证流程；试运行结果不计入分析，费用计入预算。

## 指标

每次运行记录：
- `eval_pass`；
- 实际费用（Root 加子代理）；
- wall time；
- Root 的直接操作：edit、write、bash；
- 按角色统计的委派次数；
- reviewer 的结论数，以及其中 Root 先核实再委派修复的数量（由 `guidance_metrics.py` 扩展出来）。

汇总时按任务给出两组对比，标出通过/失败的翻转并说明原因。每个格子只有 2 个样本，要明确标注。

## 决策规则（预先确定）

- **采纳**：同时满足以下条件，才把两句写进 `NATIVE_PROMPT`：
  - treat 在任何任务上都没有出现"base 通过、treat 失败"的翻转，或者翻转的原因经核实与指令无关；
  - 至少一条假设的行为指标按预期方向变化；
  - 总费用的增幅不超过 20%。
- **不采纳**：通过率下降，或者两个行为指标都没有变化。
- **其余情况**（例如结果方向一致但样本不足）：不改代码，记录为"证据不足"，转为从日常使用中收集证据。

## 预算

- **单次费用估算**：terra 的单价是输入 $1/M、缓存读取 $0.05/M、输出 $5/M；原每次 $0.2–0.8 的估算基于 reviewer 为 sol，模型修订后不视为费用保证。
- **总预算**：12 次约 $3–10，加上试运行，上限 $25（2026-10-29 用户已确认）。
- **2026-10-29 用户修订执行方式**：逐次完整结算，pilot 和失败费用计入；前 6 次正式运行累计超过 $15 暂停，第 6 次后无条件暂停等待 Root；累计达到 $20 不再启动新运行，保留 $5 余量；费用未知停止。用户接受逐次结算及保守余量不能保证单次不越 $25 的风险，不要求请求前硬限额。

## 准备工作（不花钱）

1. 在 `prices.json` 中补上 `tcuni/gpt-6.1-terra` 的单价，并检查其他子代理模型都已定价。
2. 扩展 `guidance_metrics.py`，使其支持 Native 的 `subagent` 工具调用，并新增审查后核实的指标（按 TDD 进行）。
3. 新增 `bench/arms/native-terra-base.json` 和 `native-terra-treat.json`，以及试运行用的 `native-luna-pilot.json`。
4. 展开 G1 的 fixture；对 G1、T3、T2b 跑 goldcheck；dry-run 检查两组的命令只在 prompt 上不同。
