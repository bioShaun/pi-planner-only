# 09：direct / native / lite 三臂测量

Status: done
Execution: 本轮六次已完成，有效 6/6、质量通过 6/6；opus $9.27323652，actual $0.390404648，独立证据核验 PASS。
Type: task
Blocked by: none

本轮只回答：相比原生 pi-subagents 加委派指引，插件是否提供额外价值。旧版 `297b065` 回归比较另排，不执行下面历史记录中的 54 条 campaign。

三臂为 `direct-pds`、`native-pds`、`lite-pds-head`。Root 固定 cpass-ds；native/lite 使用相同委派指引和子代理配置，lite 明确 `STRICT=0`、`HANDOFF=off`。先用已有 goldcheck 通过记录的 T3，每臂两次，最多 6 次尝试，串行，无自动重试。不接入新任务或扩大模型矩阵。

主指标是通过率、包含失败和返工的总成本、耗时及人工介入。机制指标用于解释差异。六次试跑只检查链路有效性及明显问题，不能据此发布节省比例；通过后再决定扩样本。

## 当前结论（2026-09-26 首轮完成）

[完整报告](../trialrun-cont-20260926/report.md)。原 attempt 1 保留并只读重算，剩余五次按原顺序完成；
无重试、无新健康请求，原 $10 累计检查点未达到，最大六次已用完。
票 11 完整验证及最终验收完成。下一步是重新评估插件增量价值，暂不扩大当前 cpass-ds 矩阵。
handoff 因缺少自然长会话样本及未验证检查点隔离恢复继续延后。本票关闭的是本轮六次范围，未授权扩样本。
下列执行边界和 Comments 保留从准备、停止到恢复的历史，不代表仍在等待权限或试跑。

## 执行边界（2026-09-26）

- 准备阶段：完成 native 加载、原生结果校验、子代理计费及离线故障测试；记录准确版本与配置。当前插件基线为 `ad51067da379edf5735cb9b03d70f17bda331675`，bench 改动尚在工作树，启动时需保存其补丁和哈希。
- T3 既有证据：`/project/tmp/ppo-bench/gold/T3.eval.json` 为 pass，target_test_exit=0，masked suite 无新增失败。本轮未重跑 goldcheck；真实运行前复核源仓库、Python 环境和任务文件未漂移。
- 准备随机顺序与冻结元数据可用 `BENCH_MAX_ATTEMPTS=1 bench/campaign.sh native-pilot-t3 2 T3 direct-pds,native-pds,lite-pds-head --parallel 1 --dry-run`。该命令仍会写 `/project/tmp`，当前沙箱不能执行。
- 付费运行逐条提交，按上述顺序执行 `bench/run.sh`，不要直接启动整批后台 lane。每条前运行并保存 `slot audit`、`slot status`，通过后使用 `slot cpu`；每条结束后由 Root 检查有效性、质量、费用再继续。每条设置 `BENCH_MAX_ATTEMPTS=1`、`BENCH_SKIP_HEALTH=1`，避免重复健康请求产生未入账费用；先用不调用模型的模型列表检查配置。
- 预算：最多 6 次模型任务尝试，无自动重试、无自动 resume。按仓库现有 opus 权重重算的累计任务成本达到 $10 后不再启动下一条；这是逐条检查点预算，不是单次请求硬限额，也不等于 ClinePass 额度或实际账单。执行中的 run 仍受 run.sh 的 3600 秒时限约束。
- 任一 API/额度错误、未结束子任务、缺失费用/模型、目标答案引用、验收失败、无法确认的 slot 冲突，立即停止后续运行并记录，不用额外尝试掩盖失败。无法确认可用 ClinePass 额度时不得承诺完成全部六次。
- 汇总使用 `--weight actual` 与 `--weight opus` 分别保存，标明定价表来自仓库；记录所有当前尝试，包括无效与未完成运行。`void/` 历史重试不自动纳入，故本轮禁止重试；缺失用量时仅报告已知费用与缺口，不发布完整成本结论。
 - 当前会话 `/project/tmp` 不可写，不能创建真实克隆/结果或运行要求仓库外 TMPDIR 的完整发布测试。无付费运行已启动。此处是环境阻塞，不是等待再次授权。
 - 2026-09-26 首轮试跑（`native-pilot-t3`，证据目录 `.scratch/bench-plugin-fixes/trialrun-20260926/`，含 `conditions.md` 冻结条件、`freeze/` 复现材料、`runs-log.md`、`report.md`）：阶段 1 全部重做通过（仓库外 TMPDIR 的 `test:release` 全绿、12 项离线回归 OK、T3 goldcheck 重跑 PASS、克隆隔离证明 target 不可达、历史冒烟重汇总仍 $0.92476074；`/project/tmp` 当日已可写，未改用 `/tmp`）。尝试 1/6 `T3-native-pds-1`：wall 1063s，pi exit 0，任务质量 pass（目标全过、masked suite 与基线逐项一致），但 runcheck 判 INVALID（唯一原因 `subagent result has no child results array`）。定位：Root 同轮双发 subagent 调用，pi-subagents 单发守卫拒绝第二次调用，该拒绝回执经 JSON transport 后呈 `details={}` 无 `results` 数组，现有守卫误判为费用缺口，整条总额 null（当时记录的 opus 下界 $3.8223 后已更正；当前重算 opus 总额 $2.25891032 / actual 总额 $0.11108864；被拒调用无子任务无费用）。按"费用缺口即停止"触发停止，剩余 5 条未启动；`STOP` 已由 run.sh 写入 campaign 目录。下一步：另开工单修复 `native_results.py` 对"被拒绝的重复调用"的识别并在 `test_native.py` 加真实形状的故障注入用例（不 weaken 现有断言），通过 `test_native.py` + `test:release` 后重订试跑（另起 campaign 名，保留本次目录为停止证据）。handoff 延后（首轮有效比较 0/6、费用链路不可靠、无候选长会话）。本次不发布节省比例。

## Handoff 后续入口

票 09 首轮有效比较完成、费用链路可靠，并找到自然越过默认上下文阈值且尚有后续工作的真实任务后，再启动独立交接试验。无需等待票 09 全部重复完成；没有符合条件的任务则延后。先从同一交接前检查点比较继续原会话与主动交接，统计交接准备、重新探索及遗漏返工；confirm/auto 触发体验在此后单独测试。详见[交接协议当前安排](../../../docs/lite-handoff-measurement-protocol.md#current-plan)。

## Comments

- 2026-09-25 冒烟测试：campaign `smoke-head-t3`，T3 × `lite-pds-strict-head` × 1。插件被冻结在 a59588e，运行结果 pass，runcheck 判为有效，费用 $0.92（按 opus 价）。机制指标：refused=0、detached=0、truncated=1/6、Root 读文件 12 次。
  explorer 报告仍有 6063 和 6159 字符，超过了 3000 的要求。scout 自己的系统提示规定了一套较长的输出格式（Files Retrieved/Key Code/Architecture/Start Here），任务文本里的长度要求没压住它。A/B 时重点看这项；如果效果不明显，下一步可以改写 explorer 的结尾说明，或者换一个输出格式更短的 agent。
- 历史方案，2026-09-26 已被上方三臂小试跑取代，不再按此启动（原估计消耗 ClinePass 额度，约 4–5 小时）：
  `bench/campaign.sh ab-head-vs-297 6 T1,T2,T3 lite-pds-strict,lite-pds-strict-head,direct-pds --parallel 3`
  共 54 条 run。汇总命令：`python3 bench/summarize.py .../ab-head-vs-297/runs --baseline lite-pds-strict --metric <cost|root_cache_read|root_reads|truncated|refused|detached>`。
- 2026-09-25 方向评估（[§2.4、§4 第三/四步](../../../docs/lite-direction-review-2026-09-25.md)）补充计划，票仍暂停，未启动任何付费运行：
  - 一次只回答一个问题：先验证当前修复是否减少返工和总成本；handoff 另做长会话实验，不放进本票。
  - 加第三臂 **native**：原生 pi-subagents，加一句"实现交给子代理"的指引，不加载本插件。09-24 的 lite 提示词本身就带这句话，这一臂用来隔离插件在指引之外的贡献，回答插件有没有存在理由。需要先在 bench 里支持该模式（run.sh 加载方式、runcheck 与机制指标对 `subagent` 工具的口径），再定任务与次数。
  - 固定日常回归模型（cpass-ds），少量目标 Root 实测用于校准；不扩大到全部模型和全部组合。
  - 09-24 的 0.48 降级为历史参考；"lite 相对 direct 省多少"等本票用干净克隆重跑后再写。
- 2026-09-26 维护者授权按推荐推进：恢复本票准备及小规模三臂试跑，handoff 按上述入口延后。当前运行阻塞与离线验证结果以本轮记录为准。
- 2026-09-26 准备实现：新增 native-pds 与匹配的非 strict lite-pds-head；支持原生子任务有效性检查、独立运行身份去重和计费。检测到嵌套委派时暂标 INVALID/未完整计价，不把顶层费用冒充总费用；这会停止本轮试跑，不能静默剔除后继续扩样本。
- 离线验证：12 项故障测试、shell 语法、diff 检查通过；历史 T3 冒烟重新汇总仍为 $0.92476074（opus 权重）。元数据丢失、JSONL 截断、退出记录缺失和非零退出不再能产生完整成本结论，仅保留已知费用下界。`npm run test:release` 的 typecheck、contract 通过，随后 git suite 因 `/project/tmp` 只读而中断；host 单独通过，delegate/index 未运行。日志见 `../native-prep-20260926/`。无真实模型调用，本轮没有新增 ClinePass 消耗。

- 2026-09-26 最新推进状态：维护者已授权收尾修复并续跑。当前启动 1/6，停止时有效 0；
  经修复后只读重算有效 1、质量通过 1，尚无三臂比较。原 STOP、runs 和 freeze 均保留原样。
  当前会话 /project/tmp/ppo-bench 创建目录返回 EROFS，因此新增付费尝试为 0；这不是等待再次授权。
  续跑另用 native-pilot-t3-cont-20260926，显式继承 lite-1 → direct-1 → direct-2 → lite-2 → native-2，
  不按新 campaign 名重新洗牌。总尝试上限仍为 6（含旧 attempt 1），跨目录累计原 $10 检查点预算，
  已发生 $2.25891032，距检查点 $7.74108968。不得因新目录重置预算或补跑旧 attempt 1。
  恢复条件及冻结材料见 [续跑计划](../trialrun-cont-20260926/plan.md)。

- 2026-09-26 续跑启动：票 11 当前版本全验证和最终审查通过；源仓库 HEAD 已推进，但克隆
  仍只 fetch 冻结 parent SHA、注入固定 target 测试。新隔离 goldcheck 通过，目标提交不可达，
  masked suite 与原基线完全一致。第 2/6 次 T3-lite-pds-head-1 在独立 campaign 启动，
  原 attempt 1 与 $2.25891032 保留计数。当前运行结果见
  [续跑记录](../trialrun-cont-20260926/runs-log.md)。

- 2026-09-26 最终完成：六次均有效且通过，opus 累计 $9.27323652、actual $0.390404648。
  native1 的原无效记录与 STOP 保留；lite1 非目标 benchmark 两处 fixture 改动经 Root 复核，
  不影响目标与 masked suite，自动审计提示原样保留。独立证据核验 PASS，未发布节省比例。
  48 个原始文件已记录哈希，七个续跑 child 的原始转录已归档；本轮置 done。
