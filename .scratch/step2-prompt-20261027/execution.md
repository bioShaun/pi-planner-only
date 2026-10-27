# 步骤 2 提示词行为执行记录

日期：2026-10-27。范围：仅提示词与 delegate 工具描述。静态检查另见 [static-checks.md](static-checks.md)，本文件只记录实际 Pi 会话。

## 结论

实际会话覆盖了方案第 2 步要求的四类行为：

| 场景 | 证据 | 结果 |
| --- | --- | --- |
| 非 strict 小任务自做 | `sessions/small.jsonl` | 0 次 delegate；Root 用 bash 追加一行；通过 |
| 独立且锁兼容的批量派发 | `sessions/batch.jsonl` | 同一 turn 两个 explorer；均 completed；通过 |
| 同仓库写者锁拒绝 | `sessions/lock.jsonl` | 同一 turn 两个 worker；一个 completed，一个 refused；通过（强制探针） |
| 必要的前置探索 | `sessions/explore2-strict.jsonl` | strict 下 explorer → worker 顺序执行；通过（用户明确要求先探索） |

另有一个非 strict 观察：`sessions/explore.jsonl` 中 Root 自行读取 24 个模块并完成 2 个文件修改，未委派。该样本说明小任务自做规则仍在生效，不作为“必要前置探索”的通过证据。

## 环境与模型

- Pi `1.4.0`；插件从工作树 `index.ts` 加载，未安装副本。
- 根会话模型：`kimi-coding/kimi-for-coding`，`--thinking low`。
- 子角色模型：测试夹具 `.pi/settings.json` 将 worker/scout/oracle/reviewer 覆盖为 `qwen-local/qwen3.8-27b`，`--thinking low`；该 provider 返回 0 token/0 费用。
- 每个会话均使用：
  ```text
  pi -ne -ns -np -nc --approve \
    -e /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents \
    -e /home/tcuni-claw/pi/pi-planner-only \
    --model kimi-coding/kimi-for-coding --thinking low \
    --no-session --mode json -p "<prompt>"
  ```
- 会话 JSONL 的 `toolsAdded` 中 `delegate` 描述长度均为 1345，包含新的批量派发文案，确认实际加载的是本次工作树代码，而不是旧安装。

### pi-subagents 版本漂移

11:51 的探测会话使用当时安装的 `0.81.0`。包时间戳显示全局安装在 13:56 变为 `0.83.0`，发生在验收会话之前；验收实际使用 `0.83.0`。静态发布检查仍按步骤 0 的隔离夹具使用 `0.81.0`。两者都在声明范围 `>=0.70 <1` 内。`0.83.0` 的实际会话已验证 delegate 生命周期、锁和结果返回；未对 0.81.0 与 0.83.0 做逐项差分。未主动回退全局安装。

### Provider 限制

验收期间只有 `kimi-coding` 根模型可用。`tcuni` 返回 503、`cline`/`commandcode` 余额不足、`google` 地区不支持、`tcuni-claude`/`tcuni-agy` 无可用账户。Kimi 的并发上限为 1，因此部分会话出现 403 重试：

- `batch`：3 次 Root 403，最终正常完成；子 explorer 未报错。
- `explore2-strict`：8 次 Root 403；explorer 与 worker 均 completed，但 Root 在 worker 之后耗尽重试，最终回复为空。文件与 worker 报告完整。
- `small`、`lock`、`explore`：0 次错误。

这些 403 是根模型 provider 限制，不是 delegate/锁/子角色失败；不把它们计作插件拒绝。

## 场景细节

### 1. 小任务自做（non-strict）

Prompt：

```text
In this repository, append the line 'Smoke: ok' to README.md. This is a single small edit; just do it and confirm.
```

观测：`turn 0` 只有 `bash`，`delegateCalls=[]`；README 追加成功；最终回复确认。无错误。符合“约 ≤2 个文件或 ≤10 分钟由 Root 自做”。

### 2. 独立 explorer 同批（non-strict）

Fixture：`logs/` 12 个日志、`docs/` 10 个决策文件。Prompt 明确两个调查独立，并要求并行 explorer，随后合并结果。

观测：`turn 3` 同时发出 2 个 `delegate(role=explorer)`；两个结果分别为：

```text
[explorer/scout] completed · qwen-local/qwen3.8-27b:low · 0 tok · $0.0000 · 5 turns · 28s
[explorer/scout] completed · qwen-local/qwen3.8-27b:low · 0 tok · $0.0000 · 5 turns · 26s
```

`parallelDelegateTurns=[{"turn":3,"delegates":2}]`。Root 合并出 8 个 ERROR code 与 10 条决策。这是“独立且锁兼容”的正向样本，没有新增拒绝。

### 3. 同仓库 worker 锁拒绝（non-strict，强制探针）

Prompt 明确要求同一消息发两个 worker，预期一个被拒绝，不要重试或串行化。观测：

```text
worker A: completed · qwen-local/qwen3.8-27b:low · 3 turns · 21s
worker B: delegate refused: another worker/validator child is still running in repository
          /project/tmp/pi-planner-step2-20261027/lock. Wait for it to finish, or use role
          "reviewer" (read-only). ...
```

`left.txt` 存在且内容为 `A`；`right.txt` 不存在。两个调用在同一 turn，`refused` 计数由插件记录。该样本是强制探针，用于验证锁拒绝路径；正常提示词下不应主动制造此批次。

### 4. 必要前置探索（strict，用户明确要求）

Fixture：`src/modules/` 80 个模块，`Config` 为公共接口。Prompt 说明消费面未知，要求先用 explorer 调查，再用 worker 实现并运行 `node --experimental-strip-types src/main.ts`。

观测：

```text
turn 3: delegate(role=explorer) → completed · 8 turns · 23s
turn 5: delegate(role=worker)   → completed · 5 turns · 16s
```

Explorer 结论：80 个模块全部 `import type` 消费，唯一构造点是 `src/config.ts` 的 `loadConfig`。Worker 修改 `src/config.ts`、`src/main.ts`，并报告：

```text
node --experimental-strip-types src/main.ts → exit 0
module-01
retryLimit:3
```

Git diff 仅这两个文件。Root 最终回复因 8 次 403 为空；探索→实现顺序和产物均完整。该样本验证“未知事实会改变公共接口/范围时先探索”，但探索是用户明确要求的，不证明模型在所有情况下都会自发选择 explorer。

### 5. 非 strict 自做观察（不计入通过）

Fixture：`src/modules/` 24 个模块。Prompt 要求先调查消费面再实现，未要求角色。Root 未委派，直接读取 24 个模块、修改 2 个文件、运行并提交。该行为符合非 strict 小任务自做规则，但也说明该任务规模未触发“值得委派”的判断；不把它当作必要前置探索的证据。

## 证据与复算

- 原始会话：`sessions/*.jsonl`（Pi `--mode json` 事件流）；哈希见 `sessions.sha256`。
- 摘要：`sessions/*.analysis.json`，由 `analyze.mjs` 从 `turn_end` 提取；`parallelDelegateTurns` 表示同一 turn 的多个 delegate。
- 夹具初始状态哈希：`/project/tmp/pi-planner-step2-20261027/fixtures-initial.sha256.json`；运行后状态：`fixtures.sha256.json`。
- 夹具、prompt 与命令均在 `/project/tmp/pi-planner-step2-20261027` 下，可重跑；该目录不在仓库内。
- 子角色模型覆盖仅存在于夹具 `.pi/settings.json`，未修改操作者全局设置。

### 证据边界

- 这是真实 Pi 会话，但根模型是 Kimi、子角色是 qwen-local，不是操作者日常的 Sol/Opus 组合；路由结论受模型能力影响。
- `batch` 与 `explore2-strict` 的 prompt 明确要求并行/先探索，属于受控提示，不是完全自然的路由观察。
- `explore2-strict` 的最终自然语言回复缺失（provider 403），以工具结果和磁盘 diff 为准。
- 未进行受控质量、耗时、token 或费用对照；这些属于后续步骤，不在步骤 2 验收内。
- 未提交产品仓库改动；夹具内的提交由会话产生。工作树中步骤 0 的 README/package 改动保持原样。
