# 02：bench 场景任务与离线指标

Status: done
Type: task
Blocked by: 01（只有 treat arm 的 `pluginRef` 依赖 01 的 commit sha，其余部分可以先做）

Source: `../spec.md`（User Stories 22–24、Testing Decisions 最后一条）。

## 目标

构建两个固定场景任务、两组对照 arm 和一个离线指标脚本，供票 03 比较改动前后的插件版本。本票不调用模型，也不跑 campaign。

## 场景任务

沿用现有 bench 任务格式：任务 JSON 包含 `repo`、`parent`、`target`、`tests`、`python`、`baseline`，另有同名的 prompt Markdown 和 `bench/baselines/<id>.failures.txt`。先例见 `bench/tasks/T3.json`、`T3.md`。

两个任务放在一个新建的小型 fixture 仓库里：

- 仓库做成 git bundle，放在 `bench/fixtures/root-guidance/`；另提供一个脚本，把它展开到 `/project/tmp/ppo-bench/fixture-repos/root-guidance`。
- 任务 JSON 的 `repo` 指向展开后的路径。
- 仓库只用 Python 标准库加 pytest；测试可以用 bench 已有的 Python 解释器。

1. **G1 产物型（考角色路由）。** 交付物是一个新脚本，外加它生成的 JSON 或 TSV 汇总文件。prompt 用"审计""核对"这类容易让 Root 想到 validator 的措辞，但明确要求产出文件。
   - `target` 的测试断言脚本存在、输出文件存在且内容正确。
   - 通过的必要条件是有角色写了文件。
2. **G2 长运行型（考拆分与等待）。** 先做一处小的代码修复，再运行仓库自带的"伪流水线"命令。修复前，流水线在中途失败。
   - 伪流水线以 sleep 为主，几乎不耗 CPU。每个阶段写进度日志，总时长约 7 分钟，结束时写完成标记和结果文件。
   - 测试断言结果文件内容与修复后的期望一致。
   - arm 通过环境变量 `PI_PLANNER_ONLY_TIMEOUT_MS=300000` 把子任务时限设为 5 分钟，确保运行本身超过时限，但总时长仍可控。

两个任务都必须先通过 `bench/goldcheck.sh <task-id>`。

## Arm

参照 `bench/arms/lite-tds-strict-base.json` 的形状，新建 `lite-tds-guid-base.json` 和 `lite-tds-guid-treat.json`：

- `rootModel` 与现有 tds arm 相同。
- 非 strict：Root 能自己跑 bash，才观察得到等待行为。
- env 设 `PI_PLANNER_ONLY_HANDOFF=off` 和上面的 `PI_PLANNER_ONLY_TIMEOUT_MS`。
- 两个 arm 的 `promptPrefix` 相同，并且不提示角色、等待或验收方面的内容。
- base 的 `pluginRef` 用 `c2fcc8b`（改动前），treat 用票 01 的 commit sha。

## 离线指标脚本

新增 `bench/guidance_metrics.py`，读取一个或多个 `runs/` 目录下的 run JSONL，每个 run 输出一行（TSV，另可选 JSON）：

- 按角色统计委派次数，按终态（completed / timed_out / failed）统计次数；
- validator 委派中任务文本要求创建或写文件的次数：按关键词启发式判定，只标记供人工复核，不当作定论；
- timed_out 之后的补派次数；
- 同一条 assistant 消息里工具名和参数都相同的重复调用次数，只计多出的部分；
- Root 的 bash 命令里含 sleep 的条数和 sleep 秒数合计，以及同轮重复的等待命令数；
- Root 的 edit、write、bash 次数（反向指标）；
- 评测结果和 wall 时间：取自 bench 已有的 eval 和 meta 文件；成本继续用 `bench/summarize.py`，本脚本不重复计费。

JSONL 解析可参考 `bench/runcheck.py`、`bench/summarize.py` 和 `.scratch/om09-usage-20260929/analyze.py`。

## 测试

- 给 `guidance_metrics.py` 配一个小型合成 JSONL fixture，覆盖以下情况，并用离线测试断言各项计数：
  - 一次 validator 写文件任务；
  - 一次 timed_out 加一次补派；
  - 同一条消息里 3 条相同的 sleep 命令。
- 测试以 `TMPDIR=/project/tmp python3 -B bench/test_native.py` 的同类方式运行，不调用模型。可以放进现有测试文件，也可以新建 `bench/test_guidance_metrics.py`。

## 验收

```bash
bench/goldcheck.sh G1 && bench/goldcheck.sh G2
TMPDIR=/project/tmp python3 -B bench/test_guidance_metrics.py
bench/campaign.sh rdg-dry 1 G1,G2 lite-tds-guid-base,lite-tds-guid-treat --dry-run
```

`goldcheck` 会运行 G2 的伪流水线，约 7 分钟，按规则用 `slot cpu` 提交。

## Comments

- 2026-09-30 完成。fixture 仓库三 commit：c0 `c40ec92605656726cae93aaa3e03baf4043b0d93`（G1 parent）、c1 `2e28f6a09bafb3d278040e84022d4f3fcae299ed`（G1 target / G2 parent）、c2 `1e69318b2a5d38f601bb6b48da6a1e753661bc26`（G2 target）。bundle 在 `bench/fixtures/root-guidance/root-guidance.bundle`，`expand.sh` 展开到 `/project/tmp/ppo-bench/fixture-repos/root-guidance`（已展开）。
- goldcheck：G1 PASS（Root 复跑确认），G2 PASS（slot cpu 作业 2589，流水线实跑约 7 分钟；preflight `slot audit`/`slot status` 已记入 `../slot.log`）。
- arms：`bench/arms/lite-tds-guid-base.json`（pluginRef `c2fcc8bb5f3dd15cc130eaa07ad6a6932f4c4cf4`）与 `lite-tds-guid-treat.json`（pluginRef `d186304e2de209a38cb1dfbde5f869e2158142c8`，票 01 的 commit）；非 strict，env 设 `PI_PLANNER_ONLY_HANDOFF=off`、`PI_PLANNER_ONLY_TIMEOUT_MS=300000`，promptPrefix 两 arm 相同且不涉及角色/等待/验收。
- `bench/guidance_metrics.py` + `bench/test_guidance_metrics.py`：合成 fixture 测试全过；在 rdt-r5s 真实 runs 上 sanity 正常。campaign dry-run 正常展示 4 个 lane（G1/G2 × base/treat）。
- 注意：eval 的 `non_target_tests_changed` 会列出 pytest 生成的 `tests/__pycache__/*.pyc`，是 evaluate.sh 的既有计数行为，不影响 pass 判定。
