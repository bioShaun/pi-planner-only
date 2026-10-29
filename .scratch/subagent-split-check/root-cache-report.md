# Native Root 等待子代理时的缓存过期：离线测量报告

Spec：`spec.md` P1 第 2 步。工具：`bench/root_cache.py`（issue 01–03）。日期：2026-10-29。

## 数据与方法

- 数据：本机 `~/.pi/agent/sessions`，共 619 个顶层 Root 会话文件。目录扫描跳过 883 个子代理会话（`forks/`、`run-N/`）以及 `subagent-artifacts`。
- 运行：`slot cpu -- python3 -B bench/root_cache.py ~/.pi/agent/sessions [--mode any] --json ...`，每次约 2.5 秒。预检和命令见 `log.md`，原始输出在 `/project/tmp/ppo-root-cache/all-{native,any}.{txt,json}`。
- 按 Claude 细分间隔并估算费用时，用的是临时脚本 `/project/tmp/ppo-root-cache/claude_gaps.py`（未入库）。它的间隔、跳过规则与 `root_cache.py` 一致，输出在 `claude-gaps-{native,any}.txt`。
- 定义：
  - 空闲间隔 = 本轮请求开始（`message.timestamp`）减上一条 assistant 响应结束（外层 `timestamp`）。native 下 `approx_gaps=0`。
  - 命中率 = cacheRead / (input + cacheRead + cacheWrite)，按 token 加总。
  - 冷启动 = cacheWrite > cacheRead。
  - 低命中轮 = 单轮命中率 < 0.5，与 provider 无关。

## 结果一：Native（默认模式，2184 轮）

全体：

| 组 | 轮数 | 命中率 | 冷启动 | 低命中 | cacheWrite 费用 |
|---|---:|---:|---:|---:|---:|
| structural | 52 | 14.3% | 4 | 43 | $0.28 |
| <5m | 1997 | 97.0% | 0 | 17 | $3.51 |
| 5-60m | 131 | 88.3% | 11 | 14 | $7.05 |
| >=60m | 4 | 99.4% | 0 | 0 | $0 |

触发原因 × 间隔组（只列有数据的行）：

| 触发 / 组 | 轮数 | 命中率 | 冷启动 | cacheWrite 费用 |
|---|---:|---:|---:|---:|
| toolResult / <5m | 1705 | 96.9% | 0 | $3.04 |
| user / <5m | 110 | 96.6% | 0 | $0.24 |
| user / 5-60m | 16 | 84.0% | 3 | $1.55 |
| user / >=60m | 2 | 99.8% | 0 | $0 |
| subagent / <5m | 172 | 98.4% | 0 | $0.22 |
| **subagent / 5-60m** | **115** | 88.8% | **8** | **$5.50** |
| subagent / >=60m | 2 | 99.3% | 0 | $0 |
| other / <5m | 10 | 99.5% | 0 | $0.02 |

按 provider/model 拆分后，两类模型差别很大：

| provider/model | 组 | 轮数 | 命中率 | 冷启动/低命中 | cacheWrite 费用 |
|---|---|---:|---:|---:|---:|
| tcuni/gpt-6-astra | <5m | 1774 | 97.0% | –/17 | $0 |
| tcuni/gpt-6-astra | 5-60m | 120 | 96.0% | –/3 | $0 |
| tcuni/gpt-6-astra | subagent / 5-60m | 107 | 95.5% | –/3 | $0 |
| tcuni/gpt-6-astra | >=60m | 4 | 99.3% | –/0 | $0 |
| tcuni-claude/claude-opus-5-5 | <5m | 223 | 96.9% | 0/0 | $3.51 |
| tcuni-claude/claude-opus-5-5 | **5-60m** | **11** | **4.3%** | **11/11** | **$7.05** |
| tcuni-claude/claude-opus-5-5 | **subagent / 5-60m** | **8** | **3.9%** | **8/8** | **$5.50** |

Claude Opus 在 native 下 5-60m 各轮的细分间隔（全部为冷启动）：5–6 分钟 3 轮（均为 subagent 唤醒），6–8 分钟 1 轮，8–15 分钟 6 轮（4 轮 subagent），15–30 分钟 1 轮（subagent）。

### 子代理唤醒且间隔 ≥5 分钟

- 共 117 轮，占 native 统计轮次的 5.4%。其中 109 轮是 gpt-6-astra（命中率约 95.5%，无写入费用），8 轮是 Claude Opus。
- Claude Opus 的这 8 轮全部冷启动，cacheWrite 费用 $5.50。它们占 Claude native 轮次的 3.3%，但占 Claude native 总花费 $25.06 的 22%。

## 结果二：全部模式对照（`--mode any`，11727 轮，包含 lite/off 会话）

- tcuni 的 GPT 系列（astra、sol 等）在 5-60m 下命中率仍有 92–96%。astra ≥60m 的 4 轮命中率 99%；sol ≥60m 的 2 轮为 0%。
- Claude Opus：
  - 5-60m 共 223 轮，其中 39 轮冷启动（17%），cacheWrite 费用 $25.35；
  - ≥60m 9 轮全部冷启动，费用 $6.77；
  - 冷启动集中在 15 分钟以上的间隔：15–30 分钟 25 轮中有 11 轮。8 分钟以下的非 subagent 轮多数仍然命中（5–8 分钟 83 轮中 11 轮冷启动）。
  - 非 native 会话中，等待 5 分钟以上仍能命中的情况较常见。推测原因是同前缀的并发请求（例如 fork 子代理，或同一前缀的其他会话）在 Root 等待期间刷新了缓存，这一点未验证。native 的子代理不共享 Root 前缀，所以 Root 冷启动率为 100%。
- Claude Sonnet：5-60m 28 轮中 10 轮冷启动，费用 $1.27。

## 长保留期（`PI_CACHE_RETENTION=long`）费用估算

以下是**估算**。按 Anthropic 公布的倍率计算：5 分钟写入为基础价的 1.25 倍，1 小时写入为 2 倍，读取为 0.1 倍。只计 Root 自身：

- 非冷启动轮：写入费用乘以 1.6。
- 间隔 5–60 分钟的冷启动轮：视为可以挽回。已有前缀改按读取计费（写入费 × 0.08），新增部分按非冷启动轮写入费的中位数 × 1.6 计入。
- 其余冷启动（structural、≥60m）：写入费用乘以 1.6。

| 范围 | 现在 cacheWrite | 估算（1h） | 可挽回的冷启动轮 | 模型总花费 |
|---|---:|---:|---:|---:|
| native, Claude Opus | $10.87 | $6.88 | 11 轮（现 $7.05） | $25.06 |
| any, Claude Opus | $107.20 | $140.29 | 39 轮（现 $20.90） | $495.71 |
| any, Claude Sonnet | $5.36 | $6.94 | 10 轮（现 $1.11） | $15.54 |

- native 的 Claude Root 可省约 $4，占其总花费的 16%，但样本只有 240 轮。
- 全部模式下反而多花约 $33，约占 Opus 总花费的 7%。原因是大部分写入发生在 <5 分钟的连续轮次里，这些写入都要按更高的单价计费。
- `PI_CACHE_RETENTION` 是进程环境变量。设置后，子代理通常也会继承长保留期，它们的写入同样变贵。以上估算未计入这一项，实际净效果会更差。
- GPT 类（tcuni 代理，`openai-responses`）没有写入费用，现有缓存在 5–60 分钟内基本不过期。长保留期对它们的收益接近 0。

## 局限

- **会话分支**：按文件顺序处理，没有还原会话树。回退或分支后的间隔可能失真。
- **费用来源**：费用取自会话记录中 pi 按模型价格表算出的 `usage.cost`，不是账单。tcuni 代理的实际计价可能不同。长保留期的估算用的是 Anthropic 公布的倍率，挽回轮的新增写入量用中位数近似。
- **空闲间隔的定义**：从上一条 assistant 响应结束，到本轮请求开始。它包含工具执行时间和用户思考时间，不等于缓存在服务端的实际闲置时长。
- **识别方式**：Root 的身份按文件位置识别。模式按会话内最近一条 `planner-only-mode` 判定；没有这条记录的会话在 native 统计中不计入。
- **样本量**：native 下的 Claude 样本很小，只有 240 轮，其中 5-60m 11 轮，结论的置信度有限。本机 native 会话以 gpt-6-astra 为主。

## 结论

1. **问题是否存在**：取决于 provider。
   - Native Root 用 Claude 时：子代理唤醒间隔 ≥5 分钟的轮次全部冷启动。这类轮次只占 3.3%，却占 Claude native 总花费的约 22%，问题确实存在。
   - Native Root 用 tcuni GPT 系列时（本机 native 的主流用法）：等待 5–60 分钟后命中率仍约 95%，没有可测量的问题。
2. **`PI_CACHE_RETENTION=long`：不建议默认开启，也不建议在文档里笼统推荐。**
   - 按全部模式估算，开启后 Claude 的缓存费用反而上升约 30%（$107 → $140）。
   - 只有"Native Root 用 Claude，并且经常异步等待子代理 5 分钟以上"时，估算才有约 16% 的净节省，而且这还没有计入子代理继承长保留期后增加的写入费用。
   - 建议只在文档（spec 用户故事 10）里说明三件事：它的作用；写入单价从 1.25 倍升到 2 倍；只在 Claude Root 长时间等待的场景下可能划算。由用户自行决定。
3. **P1 第 3 步（`/planner-only status` 显示缓存命中率和冷启动次数）：建议暂缓。**
   - 主流用法（GPT）下没有问题，所以显示这两项的信息量很低。
   - Claude 的问题已经可以用本离线工具按需测量。
   - 如果之后 native 的 Claude 用量明显增加，可以重新评估，届时只显示冷启动次数和写入费用即可。
4. **其他可选对策（未实施）**：
   - 改用 Claude 做 Native Root 时，长时间等待尽量改为同步等待或分批收集，以减少多次唤醒；
   - 或者 Root 用 GPT 系列，Claude 只用于子代理。
   - 这两条都属于使用习惯，不需要修改插件。
