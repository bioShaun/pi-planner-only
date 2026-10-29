Status: done

# 03 Root 缓存分析：目录扫描跳过子代理会话

Spec：`../spec.md` P1（"只统计 Root 会话"）。依赖 issue 01、02（已完成）。

## 为什么（全量运行时发现）

`~/.pi/agent/sessions` 下除顶层 Root 会话 `<cwd目录>/<时间>_<id>.jsonl` 外，还有子代理会话：

- `<cwd目录>/<父会话名>/<runId>/run-<N>/session.jsonl`：pi-subagents 子运行（875 个）。不带 `planner-only-mode`，native 默认下本就不计，但 `--mode any` 会把它们算成 Root。
- `<cwd目录>/<父会话名>/forks/<forkId>/<时间>_<id>.jsonl`：fork 子代理会话。首行 `session` 头带 `parentSession`，文件复制了父会话历史（含 `planner-only-mode` native 和父会话的 assistant 条目，条目 `id` 与父会话相同），后续是子代理自己的轮次。实测 6 个 fork 在 native 统计中贡献了 686/2848 轮（重复计数 + 子代理轮次）。

## 行为

- 目录递归收集时，除现有的 `subagent-artifacts` 外，再跳过：路径分量中含 `forks` 的文件，以及路径分量匹配 `run-<数字>` 的文件。
- 命令行直接给出的文件路径不跳过（用户显式指定即统计）。
- JSON 新增 `skipped_child_sessions`（因上述规则跳过的文件数，不含 `subagent-artifacts`）；文本输出 `Files:` 行追加 `skipped_child_sessions=N`。
- 其他输出不变。

## 验收

- 在 `bench/test_root_cache.py` 新增测试：目录下同时有顶层会话、`x/forks/f1/s.jsonl`、`x/r1/run-0/session.jsonl`（均为 native 且有 assistant），目录扫描时 `files` 只计顶层、`skipped_child_sessions=2`、轮次只来自顶层；直接以 fork 文件路径为参数时它被统计。
- TDD：先只写测试并运行，失败须因缺少该行为；再实现到通过。
- `TMPDIR=/project/tmp/ppo-root-cache python3 -B bench/test_root_cache.py` 全部通过，`bench/test_guidance_metrics.py` 仍通过；原有 13 个测试不得删除或削弱。
- 只修改 `bench/root_cache.py` 和 `bench/test_root_cache.py`。

## Comments

### 2026-10-29 Root 验收：通过

run 8e8ad102。红灯：新增 2 个测试 KeyError `skipped_child_sessions`；绿灯 15 OK、`test_guidance_metrics.py` OK，Root 复跑确认。worker 自定：显式指定优先，不计入跳过数；`run-<数字>` 精确匹配。
