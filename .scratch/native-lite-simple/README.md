# Native / Lite 简单 A/B 测试

比较 pi-planner-only 插件的 `native` 与 `lite` 两种模式，在同一个中等规模编码任务（`task.md`：duration/csv/slugify/report 模块加 CLI 和 README）上各跑 3 次，交错顺序 native-1、lite-1、native-2……。首要看效率（时间花在哪里），其次看 Root（贵模型）的成本、token、上下文和委派行为；正确性只作为 `valid` 门槛。

运行（一条命令，非交互，经 `slot cpu` 排队）：

    bash /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-simple/go.sh

结果目录：`/project/tmp/pi-native-lite-simple/<时间戳>/`，其中 `results.md` 是汇总，`runs/<mode>-<rep>/` 下有 `repo/`（agent 的工作仓库）、`session/`、`stdout.jsonl`、`stderr.log`、`meta.json`、`run.json`，`slot-preflight.log` 和 `run-all.log` 是运行日志。可用环境变量 `MODES`、`REPS`、`RUN_TIMEOUT_SEC`（默认 1800）、`MAX_TOTAL_USD`（默认 8）调整。

读 `results.md`：
- Runs 表最左是时间（秒，来自会话条目时间戳）：wall、rootModel（Root 模型调用耗时）、childBusy（子会话忙碌时长的并集）、rootIdleWait（子代理在跑而 Root 没在调用模型）、startup/finish（每次委派从发出到子会话开始、从子会话结束到 Root 收到结果的总和）、unattributed（wall 中无法归入 Root 模型/工具/子会话的框架开销）、plan/exec/review 三阶段、maxConc（最大并发子代理数）。
- 接着是成本指标：Root $ 与各类 token、Root share（Root 占总成本比例）、Root turns、peak/final ctx（单次请求 input+cacheRead+cacheWrite 的最大值/最后值）、delegated/launches（真正启动子代理的调用；Native 的 `subagent` 带 `action` 的管理调用单列为 mgmt calls）、child sessions、Root edits（Root 自己 edit/write/apply_patch 的次数）、Root bash、child $、total $、wall s。
- 右侧是门槛：modeOk、exit/超时、hidden（隐藏测试通过/总数）、visible、commits、flags。`valid` 为 no 的运行仍保留在表中。
- Per mode 表给出全部运行和仅 valid 运行的均值与中位数，并有一行 time share（rootModel / childBusy / 开销占 wall 的比例，可重叠，不必合计 100%）。

已知局限：
- 每种模式只有 3 次（n=3），只能看方向，不能下统计结论。
- 成本是会话里 provider 报告的 cost，不是账单。
- 单次运行只有超时（默认 1800 秒）兜底；`MAX_TOTAL_USD` 只在两次运行之间检查，单次运行内不会中途停。
- 子会话只在运行目录内查找；Root 委派了却找不到子会话时记为 `missing`（不当作 0），该运行判为无效。
