# 三臂续跑：保留 attempt 1，推进剩余五次

Status: completed
Date: 2026-09-26

维护者已授权推进，不需要再次确认预算或方向。当前会话在
`/project/tmp/ppo-bench/ticket11-closeout-20260926` 创建目录返回 EROFS；因此当前版本的完整验证和付费续跑未启动。
该限制已于 17:00 通过批准的沙箱外执行解除；完整验证及票 11 最终验收已通过。真实执行在允许写入 `/project/tmp`、slot 运行状态及宿主运行目录的环境中继续。
不要改用 `/tmp`，不要将完整发布测试的 TMPDIR 放进仓库，也不要绕过当前沙箱。

## 已有结果与计数

- 旧 campaign：`native-pilot-t3`。原 runs、STOP、freeze 全部保留。
- 已尝试 1/6：`T3-native-pds-1`，质量通过，修复后离线重算有效。
- opus 权重总额 $2.25891032（Root $2.227005 + child $0.03190532）；actual $0.11108864。
- 拒绝重复调用 1，不计入真实委派 4。opus 权重只重算 Root，child 始终使用实际模型价格。
- 新 campaign：`native-pilot-t3-cont-20260926`，最多新增五次；旧 attempt 1 不补跑。
- 原累计 $10 运行间检查点不重置，距检查点 $7.74108968；这不是新授权的单次硬限额。

## 冻结内容

`freeze-v3/baseline.txt`、`bench-worktree.patch`、`newfiles/` 和 `source.sha256.json`
共同描述修复后的源码（当前使用 freeze-v3；freeze 与 freeze-v2 保留前两轮审查前版本）；新增 native_results.py、test_native.py 及两份 arm JSON 均已收录。
`original-freeze.sha256.json` 保留旧证据包哈希，`subagents-config.json` 只包含子代理模型与角色配置。
`continuation.json` 显式继承原实验顺序与预算，不调用 campaign.sh 重新随机化。

原始冻结输入对比只允许 native_results.py、test_native.py、runcheck.py、summarize.py 的测量改动；
任务、提示词、基线、评测、run.sh、arm、价格与插件发布源码哈希未变，子代理模型配置与旧快照一致。
这不代替实际启动时对环境及宿主版本的复核。源码变化或新的修复须另冻结新版本，不覆盖旧包。

## 恢复执行的先决条件

1. 确认 `/project/tmp/ppo-bench` 为预期父目录，创建新的仓库外 TMPDIR。已观测 EROFS 的环境不要盲目重试。
2. 核对本包源码哈希、旧 runs 全部八个文件哈希及旧 freeze 哈希；恢复本轮 TaskSpec。
3. 查阅 `../ticket11-closeout-20260926/acceptance.json` 的代码审查结果。代码通过不代表最终验收。
4. 重任务开始前保存 `slot audit` 和 `slot status` 输出，人工检查资源冲突。不得终止其他任务或扩大槽位。
5. 在仓库根运行当前版本全部 14 项离线测试与完整发布检查；日志、退出码及源码哈希归档。

```bash
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/ticket11-closeout-20260926 PYTHONDONTWRITEBYTECODE=1 python3 -B bench/test_native.py
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/ticket11-closeout-20260926 npm run test:release
```

两条命令均须各自完成资源预检。失败即停止并处理；无跳过且全绿后记录当前版本验证结果，完成票 11 验收。
旧版本 13 项测试全绿不能替代当前 14 项。通过后，只读重算旧 attempt 1，保存 actual/opus 输出，确认八个原文件哈希未变。

## 逐次执行（不要整体粘贴成自动批处理）

每次运行前复核配置与模型列表（不发付费健康请求）、资源、已有费用及 STOP。
设置 `BENCH_OUT=/project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926`，
`BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675`，
`BENCH_MAX_ATTEMPTS=1`、`BENCH_ATTEMPT=1`、`BENCH_SKIP_HEALTH=1`、`BENCH_KEEP_CLONE=0`。
先检查输出父目录存在且该 campaign 没有未审计的既有尝试，再创建目录。每次通过 slot cpu 提交单次 run.sh。
禁止 campaign.sh --resume、后台 lane、自动重试或自动补样本。

| 全局次序 | 单次入口参数 | 前置要求 |
|---|---|---|
| 2 | `bench/run.sh T3 lite-pds-head 1` | 票 11 完整验收与启动前复核通过 |
| 3 | `bench/run.sh T3 direct-pds 1` | 第 2 次运行验收通过 |
| 4 | `bench/run.sh T3 direct-pds 2` | 第 3 次运行验收通过 |
| 5 | `bench/run.sh T3 lite-pds-head 2` | 第 4 次运行验收通过 |
| 6 | `bench/run.sh T3 native-pds 2` | 第 5 次运行验收通过 |

每次结束后核查进程退出、实际加载、Root/child 终态、日志和元数据、目标测试及 masked suite、
完整费用、模型、答案引用和人工介入。先检查新目录 STOP，再决定是否继续。
任何 API/额度错误、质量失败、计费缺口、未结束子任务、嵌套计费缺口或资源冲突都停止后续运行。

跨两个原始 runs 目录共同汇总（同一记录只能出现一次，不复制旧 attempt 1 到新目录）：

```bash
python3 -B bench/summarize.py /project/tmp/ppo-bench/results/native-pilot-t3/runs /project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926/runs --weight opus
python3 -B bench/summarize.py /project/tmp/ppo-bench/results/native-pilot-t3/runs /project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926/runs --weight actual
```

汇总退出 0 不等于完整有效；须检查 invalid、incomplete、总额未知和所有尝试费用。
累计 opus 达 $10 就不启动下一次；不足六次也保留停止报告，不重置次数或剔除失败。
首轮不发布节省比例；三臂有效比较与费用可靠性完成后，再评估扩样本和自然长会话 handoff 的独立入口。

## 2026-09-26 实际恢复

14 项离线测试与完整发布测试通过，独立最终验收 PASS，证据在 execution-20260926/。
源仓库 HEAD 从 462d5df 推进为 15d5e40，但冻结任务 parent/target 不变；已重新通过
独立标准答案与克隆隔离检查。原 freeze-v3 保留为启动前快照，不回写历史阻塞字段。
第 2/6 次已按计划启动；后续状态见 runs-log.md。

## 最终状态

六次均已完成并验收，未触发新的停止条件，累计 opus $9.27323652 低于 $10。
最大六次已用完；本计划不再启动任务。最终证据及下一步决定见 report.md。
