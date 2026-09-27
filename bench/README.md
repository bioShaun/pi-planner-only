# 端到端基准

`bench/` 用固定任务、模型配置和插件版本运行并评估 pi；脚本只执行任务，不负责成本汇总。成本之后由 `bench/summarize.py` 汇总。

## 文件

- `tasks/`: 任务元数据与原始提示词；任务 JSON 可用可选 `testRefs` 将单个目标测试路径映射到其来源 commit，未配置的测试从 target 读取；`baseline/` 不在此目录，基线位于 `baselines/`。
- `arms/`: 对比配置。Lite arm 加载 pi-subagents 和插件，native 仅加载 pi-subagents，direct 不加载扩展。`native-pds` 与 `lite-pds-head` 使用相同 Root 模型和提示前缀，后者明确关闭 handoff 与 strict。
- `run.sh`: 单次运行公共入口。它先由 `temp_guard.py` 安装并验证 Landlock 写入边界，再执行内部 `run-body.sh`；结果写入 `$BENCH_OUT/runs/`。每个克隆只包含 parent 可达历史，测试文件取自 target；`runcheck.py` 会标记 transcript 中对 target 提交的引用。
- `campaign.sh`: 配对、交错地提交多任务 campaign。
- `summarize.py` / `prices.json`: 汇总 token、成本和评测结果。

新增任务时添加同名 JSON 和 Markdown prompt，并提供 masked-suite baseline。新增 arm 时添加 JSON，字段沿用现有配置。`pluginRef` 可设为 `WORKTREE` 使用当前工作树，或用 git ref 固定插件快照；campaign 会把干净工作树的 WORKTREE arm 固定到 campaign 创建时的 HEAD。

## 标准答案检查

新增任务投入使用前，必须先通过 `bench/goldcheck.sh <task-id>`。

## 第一层：确定性开销

```bash
npm run bench:overhead
node --experimental-strip-types bench/overhead.mjs static --ref HEAD~2 --ref HEAD
node --experimental-strip-types bench/overhead.mjs corpus .handoff/p21-r100/runs
```

`static` 对比插件系统提示词与工具定义的字符数及近似 token；可用 `--json OUT` 保存结果，指定一个 ref 时与工作树对比，指定两个 ref 时直接对比。`corpus` 汇总 pi JSONL Root assistant 轮次和工具结果长度，并估算结果在后续轮次中的重读成本。近似 token 算法仅用于相对比较，不等同于模型 tokenizer。两条命令都不调用 LLM，通常数秒内完成。

## Campaign

```bash
bench/campaign.sh <名称> <重复次数> <任务逗号列表> <arm逗号列表> [--resume] [--dry-run] [--parallel N]
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --parallel 4
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --dry-run --parallel 4
bench/campaign.sh pilot-root 2 T1,T2,T3 lite-kimi,lite-gemini --resume
```

Campaign 输出位于 `/project/tmp/ppo-bench/results/<名称>`。提交前会把 `slot audit`、`slot status` 的完整输出和各 task/rep 的随机化 arm 顺序写入 `campaign.log`，stdout 只打印一行预检摘要（heavy.slice 用量、各池运行/排队数）；audit 发现绕过 slot 的重进程时列出这些进程并以退出码 6 拒绝提交（不会终止它们；等待、降低并发或报告冲突，确需继续时设 `BENCH_ALLOW_SLOT_CONFLICT=1`）。顺序种子及并行 lane 数写入 `campaign.json`。`--parallel N` 将交错后的 run 顺序轮询分配到最多 N 个 lane，每个 lane 顺序执行。`--dry-run` 只显示 lane 分配和提交命令。执行前会按 Root 与 child 模型做健康检查；可用 `BENCH_SKIP_HEALTH=1` 跳过。检查失败退出码为 3，runcheck 判定运行无效时退出码为 4，并写入 `STOP` 熔断后续 lane。campaign 的每条 run 最多尝试 `BENCH_MAX_ATTEMPTS` 次（默认 2）：非最后一次失败时 `run.sh` 只追加一行 `RETRY` 并以退出码 5 退出，lane 把该次文件移入 `void/<id>-attempt<N>-<时间>`，等待 `BENCH_RETRY_DELAY` 秒（默认 120）后重试；最后一次仍失败才写 `STOP`。直接调用 `run.sh` 时默认只尝试 1 次，行为不变。`--resume` 归档 STOP，跳过 eval 标记有效的 run；旧 eval 无 `valid` 字段时按 JSONL 重新检查，无效 run 的旧文件会在 lane 执行时移入 `void/` 后重跑。

## 汇总

```bash
python3 bench/summarize.py /project/tmp/ppo-bench/results/<名称>/runs --weight opus --baseline direct --json summary.json
```

支持多个 runs 目录及 `opus`、`astra`、`sol`、`actual` 权重。缺少评测文件的 run 会列为 `INCOMPLETE`，由 `bench/runcheck.py` 判定无效的 JSONL 会列为 `INVALID` 并从统计中排除。Native 按 pi-subagents 的 `details.results` 按 child 计费，并显示调用数 `delegates` 与 child 数 `children`；若发现嵌套委派，现有摘要无法证明子代的全部按模型成本，故标为无效且总成本为 null，不会按顶层用量报出低估值。原有 lite 专用的 refused/detached/truncated 指标不表示 native 具备相同机制。JSON 摘要的 `attempt_spend` 含当前 runs 目录内有效、无效和未评测的各次运行成本；缺少定价或用量时总额为 null，归档到 `void/` 的重试不计入，跨尝试完整花费需另行核算。Native 路由会预检常用 worker/scout/oracle/reviewer 模型；其他动态角色以实际结果模型定价，未知模型将中止可信总额。健康检查与 runcheck 不触发额外汇总；`BENCH_DRY_RUN=1` 会打印健康检查命令但不执行。

Native runner 在计费检查前将主 JSONL 声明的 child metadata 和完整 transcript 复制、校验到 `runs/<id>.native-evidence/`，记录主 JSONL 和子产物的 SHA-256、runId/index 与原始来源。采集失败写 `runs/<id>.native-collection.log` 并停止运行。detached 的累计中间用量仅在同一 run 的终态产物通过验证后由终态替换；不同 run 即使同 session 也分别结算。离线归档重算可指定 `python3 bench/summarize.py <runs> --weight actual --bundle <frozen-bundle> --json <new-output.json>`；`runcheck.py <run.jsonl> --bundle <frozen-bundle>` 核验其计费证据。旧 eval 标记无效的运行仍列为 INVALID，费用只进入 attempt_spend，不追认统计样本；离线结果写到新文件。

## 运行

Guard 从 `/proc/self/mountinfo` 读取 `/tmp` 及其子挂载的设备号，若任一设备同时挂载在 `/tmp` 之外，或 mountinfo 缺失、格式异常，则在创建临时目录和调用 Pi 前拒绝启动。设备限制继承于本地进程树；任务发给原有外部 daemon 或远程执行器时不能仅凭任务文本认为它们受限。

显式 `BENCH_OUT` 在启动 runner 内部脚本前检查：若落在 `/tmp` 或其文件系统设备上则拒绝，不调用 Pi。guard 故障时仅在父目录、现有输出目录及已打开的 `STOP` 常规文件均不在 `/tmp` 设备上时记录停止；这些设备号检查是保守拒绝条件。

公共入口要求 Linux x86_64/aarch64、Landlock ABI 3+ 与 `/project/tmp`。选定的临时目录必须位于 runner 源码仓库外，且 `/project/tmp`、选定目录和自动创建前已存在的 `ppo-bench` 父目录均不得与 `/tmp` 使用相同的文件系统设备号；这是保守的拒绝条件，即使某路径与 `/tmp` 并非 bind alias，同设备也会拒绝。为每条运行分配 `/project/tmp` 下短而唯一的**实际物理目录**，将语义运行 ID 保存在输出元数据中，不要放入 TMPDIR 路径；不同 Python 版本的 socket 名称不同，不存在通用安全长度保证。guard 安装 Landlock 并验证 `/tmp` 写入被拒后，会用任务 JSON 配置的 Python 解释器，在新进程中实际绑定并关闭 multiprocessing AF_UNIX socket；没有任务 JSON 的测试入口使用 guard 当前解释器。探测失败或超时会在执行内部脚本前拒绝启动。验证后设置 `TMPDIR`、`TMP`、`TEMP`，并向所有 arm 的 Root 提示词说明同一路径要传给委派 child、禁止使用 `/tmp`；子任务文字转发是行为要求，不保证注入 child 的系统提示词，进程继承的内核规则独立执行。规则覆盖文件写入、创建、删除、重命名、链接和截断；不限制读取或网络，也不声称约束已打开的文件描述符、所有元数据操作或远程机器执行。`run-body.sh` 是内部实现，不是受支持的直接调用入口。边界建立或验证失败时，在任何 Pi 调用前退出 3；若 `BENCH_OUT` 的安全父目录可写则写 `STOP`，即使配置了重试也不会写 `RETRY`。成功启动时 stderr 与 run metadata 的 `tempResource` 记录 backend、ABI、policy 与临时目录。Landlock 权限位以本机 `/usr/include/linux/landlock.h` 及 Linux kernel `userspace-api/landlock.html` 文档为准。

离线回归（不调用模型）：`TMPDIR=/project/tmp python3 -B bench/test_native.py`。真实 guard 测试需要可写的 `/project/tmp`，不可使用仓库内 TMPDIR 替代；插件的 `npm run test:release` 同样要求仓库外 TMPDIR。

有效运行必须有包含 arm mode 和 Root 模型的元数据，以及明确为 0 的 Pi 退出记录。缺失/损坏元数据、截断 JSONL、缺失退出记录或非零 Pi 退出会阻止完整费用声明；JSON 中 `known_cost_lower_bound` 仅是已知费用下界，不能用它代替 `cost: null` 的未知总费用。

```bash
export BENCH_OUT=/project/tmp/ppo-bench/results/<campaign>
slot audit > /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot status >> /project/tmp/ppo-bench/results/<campaign>.log 2>&1
slot cpu -- bench/run.sh T1 lite-sol 1
```

也可用 `slot cpu -b` 后台提交。每次启动重跑前必须执行 `slot audit` 与 `slot status`，并把输出记录到 campaign 日志。运行结果、stderr、耗时、退出码及评测分别保存在 `runs/` 下；克隆默认在成功评测后删除，可设 `BENCH_KEEP_CLONE=1` 保留。`BENCH_DRY_RUN=1` 只执行预检和命令展示，不启动 pi。

## 初筛 Root 的选择（2026-09-25 试跑）

T1–T3 × 2 次，成本按 opus 价，参照 2026-09-24 的 sol lite（轮数 15–22，每次委派 5–7 次，$1.05–2.01）：

| arm | 通过 | Root 轮数 | 每次委派 | 每次成本 |
|---|---|---|---|---|
| lite-kimi | 6/6 | 18–32 | 0–1 | $0.61–1.68 |
| lite-gemini | 6/6 | 35–106 | 1–11 | $2.57–9.54 |
| lite-kimi-strict | 6/6 | 14–18 | 3–8 | $0.57–1.12 |

- kimi 在默认模式下几乎不委派，等于 direct 模式；gemini 轮数多、波动大，实价也不比 sol 便宜。
- 初筛用 `lite-kimi-strict`（kimi + `PI_PLANNER_ONLY_STRICT=1`）：行为最接近 sol，同任务两次差异最小。
- 它测的是严格模式。改提示词措辞、调整"小事自己做"这类改动，结论必须在 `lite-opus` 上确认。

### Root 走 Cline / Command Code 的路由（2026-09-25）

- Cline 的模型 ID 不带 `cline-pass/` 前缀时按 Cline Credits 计费。`control-cline-{muse,mimo,ds}-strict` 三组在 13:15 起收到 402 余额不足，已跑的 12 次全部 INVALID，三组作废。
- ClinePass 在本地区不提供 muse，也没有 mimo-v2.6-flash。这两个模型改走 Command Code Provider API（pi provider `commandcode`，key 为 `TCUNI_COMMAND_KEY`），对应 arm 为 `lite-ccmuse-strict*`、`lite-ccmimo-strict*`。glm-5.3-flash 与 deepseek-v4.1-flash 走 ClinePass，对应 arm 为 `lite-pglm-strict*`、`lite-pds-strict*`。provider 定义在本机 `~/.pi/agent/models.json`，不在仓库内。
- ClinePass 按 5 小时滚动、周、月三层额度计量，撞限会写 STOP，用 `--resume` 续跑。
