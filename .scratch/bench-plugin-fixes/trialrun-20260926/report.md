# 首轮报告：native-pilot-t3（2026-09-26）

> 本文保留首次停止时的报告与后续重算说明。六次最终结果见 [续跑完成报告](../trialrun-cont-20260926/report.md)。

执行票：[09-ab-measure.md](../issues/09-ab-measure.md) ｜ 计划：[spec.md](../../lite-measurement-next/spec.md)
冻结条件见 `conditions.md`，逐条记录见 `runs-log.md`。本报告不发布节省比例。

## 计数（不只报成功样本）

| 口径 | 数值 |
|---|---|
| 计划尝试 | 最多 6 次（T3 × direct/native/lite × 2） |
| 实际启动 | 1 次（`T3-native-pds-1`） |
| 有效运行（停止时） | 0 |
| 有效运行（修复后离线重算） | 1；原始运行记录不改写 |
| 通过（任务质量） | 1（目标测试全过，masked suite 无新增失败） |
| 未完成/失败 | 0 |
| 剩余尝试 | 5，未启动（停止条件触发） |

## 链路可靠性结论

**停止时：native 臂测量链路暴露守卫误判，按费用缺口停止后续运行。修复后：已有一条记录离线恢复有效，三臂整体链路仍待续跑验证。**
`T3-native-pds-1` 任务本身完成，但 pi-subagents 的"单轮只允许一次 subagent 调用"守卫拒绝了 Root
同轮第二次调用，拒绝回执经 JSON 模式 transport 后呈 `details={}`、无 `results` 数组形状，
而当时的 `children()`/`runcheck` 把"无 results 数组"一律视为漏记用量的费用缺口，整条运行被标为
INVALID、总额 null。这是守卫对真实上游形状覆盖不全，不是任务失败，也不是插件污染
（拒绝来自 pi-subagents 自身；native 臂未加载本插件）。

## 费用、耗时、人工介入（attempt 1）

- 总费用（票 11 修复后离线重算，只读 runs，不调用模型）：opus 口径 **$2.2589**
 （Root 按 opus 重算 $2.2270 + child 按 actual 模型价 $0.0319），actual 口径 **$0.1111**；
 `invalid:[]`、`incomplete:[]`，`attempt_spend` 不再是 `INCOMPLETE/UNPRICED`。
 口径说明：仓库长期约定 child 恒按 actual 模型价、仅 Root 随 `--weight` 重算。
 被拒绝的调用未启动子任务，不贡献费用。
- 耗时：wall 1063s。人工介入：0。
- 机制观察：Root 39 轮、read 10 次、bash 42 次；4 次真实委派（3 worker + 1 reviewer 校验链），
  另有 1 次管理查询（capabilities）与 1 次被拒绝的重复调用。Root 同轮双发 subagent 调用值得在替身行为
  分析中记录（cpass-ds 与 opus 的委派纪律差距）。

## 与历史数据的关系

- 历史 T3 冒烟（`smoke-head-t3`，lite strict）在新汇总器下仍为 $0.92476074：汇总兼容性成立，
  不构成新三臂实验结果。
- 09-24 的 0.48 与"lite 相对 direct 省多少"仍为历史参考，本轮未产生可比较的新数据。

## 下一步决定：修复测量后重订试跑（不扩样本、不并行 handoff）

1. 开新工单修复 `bench/native_results.py` 对"被拒绝的重复 subagent 调用"的识别（详见 `runs-log.md`
   最小修复方向），`bench/test_native.py` 必须新增对应故障注入用例（真实 transcript 形状：
   `details:{}` + event 层 `isError`），且不得 weaken 现有 12 项断言；修复后重跑 `test_native.py`
   与 `npm run test:release`。
2. 修复验证通过后，重订试跑（仍沿用本轮冻结条件与顺序；`native-pilot-t3` 目录保留为停止证据，
   新试跑另起 campaign 名，避免覆盖）。
3. handoff：延后（见下）。

## Handoff 启动门槛评估（阶段 5）

启动要求：三臂首轮有效比较完成 **且** 费用链路可靠 **且** 有自然越过默认上下文阈值、尚有实质
工作的真实任务。三项启动门槛仍未齐备（当前重算有效 1/6、尚无三臂比较，整体费用链路待验证，无候选长会话样本）。
决定：**延后 handoff，一切 handoff 实现与测试不动**（`PI_PLANNER_ONLY_HANDOFF=off` 保持默认）。

## 2026-09-26 收尾与续跑更新

上方“下一步决定”的修复已经实现，真实 attempt 1 重算结果如费用节。维护者已授权继续推进。
本次审核又收紧空值字段识别并补金额断言；新反例通过，当前版本完整离线套件及发布检查因
仓库外 TMPDIR 只读而尚未完成，因此不宣称票 11 最终验收通过。
原始 runs、STOP 和 freeze 保持不变；修复版本另冻结，剩余五次沿原顺序与原累计预算续跑，
执行入口见 [续跑计划](../trialrun-cont-20260926/plan.md)。当前没有新增付费尝试。
