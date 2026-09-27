# 交接：bench 与插件修复（更新于 2026-09-27，本地 HEAD 32c4a86 + 本文件所在提交）

新 session 先读本文件，再读 `spec.md` 和 `issues/` 下对应的票。仓库：`/home/tcuni-claw/pi/pi-planner-only`。

## 背景

我们复盘了 control campaign 的全部 run（结果在 `/project/tmp/ppo-bench/results/*/runs`，分析脚本在
`.scratch/bench-review/metrics.py` 和 `timeline.py`），在 bench 和插件两边都找到了问题，整理进 `spec.md`，
并拆成 01–12 共十二张票。

## 状态

| 票 | 状态 | 提交 | 要点 |
|---|---|---|---|
| 01–07 克隆隔离 / goldcheck / 冻结 / 机制指标 / intercom / 报告预算 / validator 提示 | done | f8b0a6f…aed02cf | 细节见各票；01 的父提交克隆与答案泄漏检查、02 的 `testRefs` 都改变了旧结果的可比性 |
| 08 新任务与 direct arm | done（T4 接入未做，见"历史安排"） | a59588e、c0262ed | `direct-pds`、`lite-pds-strict-head` 已加 |
| 09 direct/native/lite 三臂测量 | done | e0ffaae… | 六次完成，有效 6/6、质量 6/6；opus $9.27323652 / actual $0.390404648，独立核验 PASS |
| 10 session 暴露的插件问题 | done | c6a1496、15cbbbd | count-only 无关脏路径、explorer 输出文件收口、campaign slot 预检 |
| 11 native"拒绝重复调用"被误判为费用缺口 | done | 0a6ec3e（修复）、21990d1（票面） | `details={}` 的拒绝回执不再算缺口，有效性恢复 |
| 12 native 回放用例依赖本机归档 | done | 32c4a86 | 改成仓库内 gz fixture，缺失即失败不再跳过 |
| 01（lite-t2c-focused）T2c 任务定义入库 | ready-for-human | — | `bench/tasks/T2c.json` 的 `repo` 指向仓库内克隆，且 target `c3dd016` 不在 canonical 仓；先推 commit，再删 `.gitignore` 里的两行排除 |

## 下一步

- **付费矩阵停止**（2026-09-27 决定）：不扩样本、不因一次正向信号加角色、强化 strict 或启用 handoff；
  下一阶段只记录真实开发任务里自然出现的效果与失败，出现具体缺口才做针对性修复。
- **handoff 继续延后**：等自然长会话（自然达到 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` 且仍有实质工作）
  与同检查点隔离恢复证据；默认 off 不变。见 `docs/lite-handoff-measurement-protocol.md#current-plan`。
- **T2c 任务定义入库**：先完成上表最后一行票面（把 `c3dd016` 推进 `/public/scripts/tc-probe-design-v2`），
  再把 `T2c.json` 的 `repo` 改成 canonical 路径、删掉 `.gitignore` 里 `bench/tasks/T2c.{json,md}` 两行。
- **推送**：本地有 13 个提交未推送（`origin/main` 停在 `c0262ed`，远端 ref 自 09-25 未 fetch）。
  维护者本轮选择先不推送；要落地先 `git fetch` 看上游是否前进，再决定直接推 main 还是开分支 PR。
- **历史安排（已作废，不要再执行）**：票 08 的 T4 接入步骤、`ab-head-vs-297` 的 54 条 campaign。
  需要新的付费运行时必须先取得维护者确认。

## 约束

- 本仓库遵循 planner-only 流程：Root 负责规划和验收，大块工作交给 delegate；接受改动前自己看 diff；
  提交用 `git_commit`。
- 插件改动：`TMPDIR=/project/tmp/ppo-review npm run test:release` 必须全绿；`git diff | grep '^-.*assert'`
  必须没有输出；新加的守卫都要配故障注入测试。
- bench 改动：`TMPDIR=<仓库外可写> python3 -B bench/test_native.py`（36 项）与 `npm run test:release` 都要全绿。
  本机 `/project/tmp` 只读时会有 8 项 guard/Landlock 用例失败，那是环境限制，必须换可写环境复跑后才能声明通过。
- 重任务（测试套件、campaign）先执行 `slot audit` 和 `slot status` 并把输出写入日志，再用 `slot` 提交；
  `campaign.sh` 会自己做这一步。不要往 `/tmp` 写任何东西；克隆、临时文件和环境都放在 `/project/tmp/ppo-bench`。
  不要改 `/public/scripts`。
- 证据落库位置：`.scratch/bench-plugin-fixes/verify-commit-20260927/`（`f2dc9e3..21990d1` 的提交后验收）与
  `.scratch/bench-plugin-fixes/ticket12-fixture-20260927/`（fixture 哈希与验证日志）。
- `.gitignore` 已排除 bench 运行克隆、原始转录、freeze 打包与本机工具目录；新增证据前先确认不会被忽略规则吃掉
  （`git check-ignore -v <path>` 应无输出）。
- 维护者关心 token 消耗：任何会花模型额度的 campaign 都要先确认。
