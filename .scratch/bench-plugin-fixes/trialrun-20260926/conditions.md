# 三臂试跑冻结条件（native-pilot-t3）

Date: 2026-09-26
Campaign: `native-pilot-t3`，输出 `/project/tmp/ppo-bench/results/native-pilot-t3`
执行票：[09-ab-measure.md](../issues/09-ab-measure.md)
计划：[lite-measurement-next/spec.md](../../lite-measurement-next/spec.md)

## 阶段 1 运行前验证（全部在当前版本上重做，未复用历史结论）

| 检查 | 命令 | 结果 | 证据 |
|---|---|---|---|
| 临时目录可写 | `mkdir /project/tmp/ppo-bench/...` | 可写；上次 EROFS 不再存在，未改用 `/tmp` | `slot-preflight-goldcheck.log` 同目录 |
| 完整发布测试 | `TMPDIR=/project/tmp/ppo-bench/relcheck-20260926 npm run test:release` | exit 0；typecheck + contract/git/delegate/host/index 全部 `ok`，无跳过 | `/project/tmp/ppo-bench/relcheck-20260926/release.log` |
| bench 离线故障回归 | `TMPDIR=.../regress-20260926 python3 -B bench/test_native.py` | 12 tests OK，exit 0 | `.../regress-20260926/native-tests.log` |
| T3 标准答案复核 | `slot cpu -- bench/goldcheck.sh T3` | `GOLD T3 PASS`；target 30 passed，masked suite 14 failed 全在基线内，`files_changed=4` | `/project/tmp/ppo-bench/gold/goldcheck-20260926.log`、`T3.eval.json` |
| 任务/环境未漂移 | 任务与基线文件最后提交 `fac7ca4`(09-24)；`.venv` 无 09-25 21:52 之后的文件；`evaluate.sh`/`prepare-clone.sh` 未改动 | 一致 | `freeze/snapshot.txt` |
| 答案提交不可达 | `prepare-clone.sh` + git 层检查 | 克隆内 target 全 sha 与 7 位前缀 `cat-file` 均 128；`log --all` 525 = parent 524 + 1 条 bench 提交；无 refs、无 remotes；三个目标测试文件与 target 版本逐字节一致；BASE 上目标测试 12 failed | `isolation-T3.log` |
| 汇总向后兼容 | `summarize.py .../smoke-head-t3/runs --weight opus` | 仍为 `$0.92476074`，机制指标不变 | `historical-summary.log` |
| 模型与配置（不调用模型） | `pi --list-models` | Root `cline/cline-pass/deepseek-v4.1-flash` 存在；子代理 worker/scout/oracle/reviewer 均为 `tcuni/gpt-6-luna` 且存在 | `model-preflight.log` |
| slot 资源 | `slot audit` / `slot status` | audit 干净（无绕过 slot 的重进程，exit 0），池空闲，heavy.slice 7.9G/64G | `slot-preflight-goldcheck.log` |

goldcheck 复跑覆盖了 `/project/tmp/ppo-bench/gold/T3.eval.json`，新旧内容逐字段相同（09-25 的值已在票 09 记录）。

## 阶段 2 冻结条件

| 条件 | 值 |
|---|---|
| 任务 | T3（`bench/tasks/T3.json` + `T3.md`，sha 见 `freeze/snapshot.txt`） |
| Root 模型 | `cline/cline-pass/deepseek-v4.1-flash`（cpass-ds），三臂相同 |
| direct | arm `direct-pds`，不加载 `-e` 扩展，无委派前缀（prompt 586 字符） |
| native | arm `native-pds`，仅 `-e pi-subagents`，中性委派前缀（prompt 625 字符） |
| lite | arm `lite-pds-head`，`-e pi-subagents` + `-e 插件`，同一前缀 |
| native/lite 前缀 | `实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。`（不指定工具名） |
| lite 模式 | `PI_PLANNER_ONLY_STRICT=0`、`PI_PLANNER_ONLY_HANDOFF=off`（run.sh 先 `-u` 再显式注入） |
| 插件快照 | `BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675`；插件 8 个发布源文件相对基线干净，故内容等同工作树 |
| 宿主 | pi `0.87.1`，pi-subagents `0.71.0`，node v24.14.0 |
| 子代理配置 | 同一运营者配置 `~/.pi/agent/settings.json`：defaultModel 与 worker/scout/oracle/reviewer 均 `tcuni/gpt-6-luna`（planner 为 `tcuni-ds/deepseek-v4.1-flash`） |
| 计价表 | `bench/prices.json`，sha256 `07a556fc…61f4` |
| 重复与并发 | 每臂 2 次，共 6 次尝试，`--parallel 1` 串行 |
| 重试 | `BENCH_MAX_ATTEMPTS=1`，无自动重试、无自动 resume |
| 健康检查 | `BENCH_SKIP_HEALTH=1`（不发起付费健康请求）；启动前用 `pi --list-models` 做无模型核对 |
| 单次时限 | run.sh 内 `timeout 3600` |

复现材料：基线提交 `ad51067da379edf5735cb9b03d70f17bda331675`、完整工作树补丁 `freeze/bench-worktree.patch`（7 个已跟踪文件）、未跟踪新增文件内容与哈希 `freeze/newfiles/`（`native-pds.json`、`lite-pds-head.json`、`native_results.py`、`test_native.py`）、`freeze/snapshot.txt`（含全部输入 sha256）。

## 冻结顺序与清单

`campaign.sh ... --dry-run` 生成，种子写入 `freeze/campaign.json`；实际逐条调用 `bench/run.sh`，不使用后台 lane：

1. `T3-native-pds-1`
2. `T3-lite-pds-head-1`
3. `T3-direct-pds-1`
4. `T3-direct-pds-2`
5. `T3-lite-pds-head-2`
6. `T3-native-pds-2`

## 预算与停止条件

- 共 6 次任务尝试，失败与无效同样占用次数，不补样本。
- 每条结束后按 `bench/prices.json` 的 opus 权重重算，累计**所有已发生尝试**（含无效/未完成）达到 **$10** 即不再启动下一条。这是运行间检查点预算，不是单次硬限额，也不是 ClinePass 额度或实际账单。
- 每条启动前保存并判断 `slot audit` / `slot status`；发现绕过 slot 的重进程或无法确认的冲突则停止，不终止他人进程、不提高槽位容量。
- 立即停止条件：API/额度错误、质量验收失败、目标答案引用、未确认的子任务终态、费用或模型缺失、日志/元数据/退出证据缺失、嵌套委派计费缺口、无法确认的资源冲突。
- 停止后保留原因、已发生消耗、剩余尝试与最小修复方向；不通过替换任务、增加重试或静默排除失败来凑样本。
- 本轮禁止重试，因此不应产生 `void/` 归档尝试；一旦出现必须披露并单独计价。

## 逐条执行记录

见 `runs-log.md`。
