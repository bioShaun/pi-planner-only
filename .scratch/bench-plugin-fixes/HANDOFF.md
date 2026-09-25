# 交接：bench 与插件修复（截至 2026-09-25，HEAD c0262ed 之后）

新 session 先读本文件，再读 `spec.md` 和 `issues/` 下对应的票。仓库：`/home/tcuni-claw/pi/pi-planner-only`。

## 背景

我们复盘了 control campaign 的全部 run（结果在 `/project/tmp/ppo-bench/results/*/runs`，分析脚本在 `.scratch/bench-review/metrics.py` 和 `timeline.py`），在 bench 和插件两边都找到了问题，整理进 `spec.md`，并拆成 01–09 共九张票。

## 状态

| 票 | 状态 | 提交 | 要点 |
|---|---|---|---|
| 01 克隆不带未来提交，runcheck 检查答案泄漏 | done | f8b0a6f | `bench/prepare-clone.sh`；历史上泄漏过的 run 现在会被判为 INVALID（cpass-ds 组 27 条里有 10 条） |
| 02 标准答案检查，修 T1 | done | 00aef64 | `bench/goldcheck.sh`、`bench/evaluate.sh`；T1 现在有 4 个目标测试（字段 `testRefs`），和旧的 T1 结果不能直接比 |
| 03 WORKTREE 冻结成提交号 | done | 2c63db4 | 冻结后的值记在 campaign.json 的 `worktreeSha` |
| 04 机制指标 | done | 23036a7 | summarize 输出 `MECH` 行；新增 `--metric` 参数 |
| 05 关闭 intercom 桥 | done | a3d26d7 | 请求里带 `intercomBridge:{mode:"off"}` |
| 06 报告长度要求与截断 | done | fdf21f2 | 要求 3000 字以内；截断上限 6000，保留前 60% |
| 07 validator 称不能运行命令 | done | aed02cf | validator 结尾说明写明"有 bash，必须实际运行"；`/tmp` 的问题插件侧不处理 |
| 08 新任务与 direct arm | ready-for-agent | a59588e、c0262ed | arm `direct-pds` 和 `lite-pds-strict-head` 已加；决定接入 nf-pangenome-design `a04c1d7` 作为 T4，接入步骤见票 |
| 09 A/B 测量 | 已暂停，等维护者说开始 | e0ffaae | 冒烟测试通过（`smoke-head-t3`），完整命令见票 |
| 10 本 session 暴露的插件问题 | needs-triage | — | 见 `issues/10-session-findings.md` |

## 下一步

- **"continue with 08"**：按票 08 最后一条 Comment 的步骤接入 T4：
  - 在 `/project/tmp/ppo-bench/envs/nf-pangenome-design/` 建 venv；
  - 写 `bench/tasks/T4.json` 和 `T4.md`，Markdown 部分参照 T1.md 的格式（commit message 加一行要求）；
  - 生成 masked-suite 基线，放到 `bench/baselines/T4.failures.txt`；
  - 确认目标测试在 BASE 上失败，并且 `bench/goldcheck.sh T4` 输出 PASS；
  - 再用 `bench/campaign.sh t4-calib 2 T4 lite-pds-strict-head --parallel 2` 校准难度。这一步要花模型额度，先问维护者。
- **"start 09"**：`bench/campaign.sh ab-head-vs-297 6 T1,T2,T3 lite-pds-strict,lite-pds-strict-head,direct-pds --parallel 3`，共 54 条 run，大约 4–5 小时，消耗 ClinePass 额度。T4 接入后可以加进任务列表。
  跑完后汇总：
  - `python3 bench/summarize.py /project/tmp/ppo-bench/results/ab-head-vs-297/runs --baseline lite-pds-strict --metric <cost|root_cache_read|root_reads|truncated|refused|detached>`
  - 重点检查：05 之后 detached 是否为 0；06 之后 truncated 和 root_reads 是否下降；validator 说"不能运行"的比例；refused 次数，看 `2f934a8` 的措辞改动有没有效果。
  - 冒烟时 explorer 报告仍有约 6000 字，3000 字的要求可能没管住。

## 约束

- 本仓库遵循 planner-only 流程：Root 负责规划和验收，大块工作交给 delegate；接受改动前自己看 diff；提交用 git_commit。
- 插件改动：`TMPDIR=/project/tmp/ppo-review npm run test:release` 必须全绿；`git diff | grep '^-.*assert'` 必须没有输出；新加的守卫都要配故障注入测试。
- 重任务（跑测试套件、campaign）先执行 `slot audit` 和 `slot status` 并写入日志，再用 `slot` 提交；campaign.sh 会自己做这一步。不要往 `/tmp` 写任何东西；克隆、临时文件和环境都放在 `/project/tmp/ppo-bench`。不要改 `/public/scripts`。
- 维护者关心 token 消耗：任何会花模型额度的 campaign 都要先确认。
