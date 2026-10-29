Status: done

# 01 离线分析 Root 缓存命中与空闲间隔

Spec：`../spec.md` 中的 P1 第 1 步。

## 目标

新增离线命令 `bench/root_cache.py`。它读取 Pi 会话 JSONL，按 Root 请求前的空闲间隔和触发原因，统计缓存命中情况，用来判断 Native 下等待子代理时 Root 缓存是否过期。

## 输入格式（取自真实会话）

- 每行一个 JSON 对象。
- Root 消息：`{"type":"message","timestamp":"<ISO>","message":{"role":"assistant","usage":{"input":..,"output":..,"cacheRead":..,"cacheWrite":..,"cost":{"cacheRead":..,"cacheWrite":..,"total":..}},"provider":..,"model":..}}`。
- 其他 `message` 的 role 有 `user`、`toolResult`、`system`。
- 模式：`{"type":"custom","customType":"planner-only-mode","data":{"mode":"native"|"lite"|"off"}}`。可能在会话中途出现多次，以最近一次为准。
- 子代理通知：`{"type":"custom_message","customType":"subagent-notify"|"subagent-incremental-child-notify"|"subagent_control_notice"|...}`，凡 `customType` 以 `subagent` 开头的都算。
- 结构变化：`{"type":"model_change"}`、`{"type":"thinking_level_change"}`、`{"type":"compaction"}`（若存在）、`{"type":"session"}`。
- 交接产生的新会话：首条 user 消息文本以 `[planner-only handoff]` 开头。
- 无法解析的行、缺少 usage 的 assistant 消息一律跳过，不报错。

## 行为

命令：`python3 bench/root_cache.py <文件或目录...> [--mode native|lite|off|any] [--gap-minutes 5,60] [--json OUT]`

- 目录递归收集 `*.jsonl`，跳过路径中含 `subagent-artifacts` 的文件。
- `--mode` 默认 `native`：只统计当时模式匹配的 Root assistant 轮次；`any` 表示不过滤。
- 对每个统计的 assistant 轮次：
  - **间隔**：本条与上一条 assistant 记录时间戳之差，单位为分钟。
  - **触发原因**：取上一条 assistant 之后、本条之前，最后一条非 assistant 条目的类别：`toolResult`、`user`、`subagent`（custom_message 的 customType 以 subagent 开头）、`other`。
  - **结构性冷启动**：会话首个 assistant 轮次，以及其前方紧邻（与上一条 assistant 之间）出现 `model_change`、`thinking_level_change` 或 `compaction` 的轮次，归入 `structural` 组，不进入间隔分组。交接新会话的首轮同样归入 `structural`。
  - **命中率**：cacheRead / (input + cacheRead + cacheWrite)；分母为 0 时不计入。
  - **冷启动轮**：cacheWrite > cacheRead。
- **按间隔分组**：默认边界为 5 和 60 分钟，组为 `<5m`、`5-60m`、`>=60m`；边界可用 `--gap-minutes` 修改。
- **每组输出**：轮数、合计命中率（按 token 加总后计算）、冷启动轮数、cacheWrite 费用合计（取 `usage.cost.cacheWrite`，缺失记 0 并统计缺失数）。
- 另外按"触发原因 × 间隔组"输出同样的指标。
- 文本输出须注明两点：间隔包含生成时间，是近似值；会话分支按文件顺序处理。
- `--json OUT` 写出：`files`（统计的文件数）、`turns`、`groups`、`by_trigger`、`structural`、`params`。
- 没有任何匹配轮次时输出说明，退出码为 0。

## 验收

- 新增 `bench/test_root_cache.py`（unittest 风格，参照 `bench/test_guidance_metrics.py`），用合成 JSONL 覆盖：
  1. 三个间隔组各至少一轮，命中率和冷启动计数正确；
  2. 子代理通知唤醒的轮次被归为 `subagent`；
  3. 会话中途从 native 切到 lite 后，默认模式下 lite 轮次不被统计，`--mode any` 时被统计；
  4. 首轮、model_change 之后的首轮、交接新会话的首轮归入 `structural`；
  5. 坏行和无 usage 的 assistant 被跳过；
  6. `subagent-artifacts` 路径下的文件被跳过；
  7. `--gap-minutes` 修改边界后分组随之改变；
  8. JSON 输出含上述字段。
- 运行命令：`TMPDIR=/project/tmp/ppo-root-cache python3 -B bench/test_root_cache.py`（先 `mkdir -p` 该目录）。
- 不修改其他文件，现有 bench 测试不受影响：`TMPDIR=... python3 -B bench/test_guidance_metrics.py` 仍须通过。

## Comments

### 2026-10-29 Root 验收第一轮：需返工

首轮实现（`bench/root_cache.py`、`bench/test_root_cache.py`）的红灯、绿灯和冒烟均已核对。核对真实会话后发现两处与数据不符：

1. **间隔可以精确计算。** 真实会话中，assistant 条目外层的 `timestamp`（ISO）是响应结束时间，`message.timestamp`（毫秒）是请求开始时间：两者相差即生成耗时，实测 3.7–19.4 秒；子代理通知之后的那条 assistant，`message.timestamp` 紧跟通知时间。因此：
   - 间隔改为：当前 assistant 的 `message.timestamp` 减去上一条 assistant 的外层 `timestamp`；
   - 只有当前条缺少 `message.timestamp` 时，才退回到外层时间戳之差，并单独计数 `approx_gaps`；
   - 文本说明改为只在出现退回时提示近似。
2. **触发原因被记账类条目覆盖。** 真实会话中 assistant 之间穿插着 `custom`（如 `pi-todo-state`、`subagent_supervisor_reply`）、`usage`、`session_info`、`context_edit` 和非 subagent 的 `custom_message`（如 `pi-todo-context`）。现实现把它们都记成 `other`，会掩盖真实的触发原因。改为：
   - 只有 `message:user`、`message:toolResult` 和 customType 以 `subagent` 开头的 `custom_message` 会更新触发原因；
   - 其他条目一律忽略；
   - 上一条 assistant 之后没有任何上述条目时，触发原因为 `other`。

另外，红灯时只有 5 个测试，绿灯时有 6 个（`test_weighted_rate_and_zero_denominator` 是后来补的）。返工新增的测试须先单独跑出红灯。

### 2026-10-29 Root 验收第二轮：通过

返工 run a939479a。红灯：新增 3 个测试失败（KeyError `approx_gaps`、两处 `0 != 1`），均落在新断言上；绿灯 9 个测试 OK，`test_guidance_metrics.py` OK，均由 Root 复跑确认。实现与上面两条返工规格一致，原有 6 个测试保留未削弱。冒烟（tc-probe-design-v2 会话）：33 轮，`approx_gaps=0`，subagent 触发 3 轮（其中 5-60m 1 轮）。

冒烟会话的 provider 是 `tcuni`（openai-responses），`cacheWrite` 费用为 0，`cold_starts` 的定义（cacheWrite > cacheRead）对这类 provider 无效。按 provider 拆分和与 provider 无关的低命中轮计数另开 issue 02。
