# om09 AF 原件找回尝试（2026-10-07）

## 结果

**找回部分历史摘录，尚未找回完整 Root JSONL、child 原件或修正 diff。** 这次新证据来自本机 Codex 的 2026-09-29 分析会话，不是重新连接 om09 取得的原件。

- 审查等级是 **P2**，定位 `script/variant/deg_variant_assoc.py` 第 117、163 行。
- reviewer 指出：dosage 把所有非参考等位基因一起计数，而 ANN 记录对应一个特定 ALT。于是 `1/2` 基因型的两个 ALT 记录都输出 AF `1.0`，与每个 ALT 的频率含义不符。建议按 ANN 对应 ALT 索引计数，或明确改标为位点级非参考 AF。这是恢复的审查意见，本轮未重跑该计算或验证代码。
- 找回了 reviewer 任务开头：要求只读审查未提交改动，关注正确性，包含 Nextflow 和 DEG_VARIANT_ASSOC 接线；任务尾部被截断，因此仍不知道完整 AF 要求。
- reviewer 返回摘要保留 `tcuni-luna/gpt-6-luna:high`、309k token、$0.0107、10 turns、129s。该金额仅为审查费用，不是返工增量费用；129s 是历史输出取整值，委派 CSV 的精确 duration 为 128.592s。
- 用户任务摘录包括建立差异分析与 SNP 的关联、调整报告章节。Root 最终回复摘录自报提交 `1d89adb`，使用冒烟数据生成报告，未实际运行 Nextflow。回复已被截断，不能凭这个提交号认定 AF 修复已包含在该提交中。

可读摘录见 [af-excerpts.md](af-excerpts.md)；留存输出与来源哈希见 [manifest.json](manifest.json)。未恢复的原始实施 brief、reviewer 完整报告、Root 修改工具调用、对应 diff 和用量仍须补齐。当前仍不能将此例归为已核实的 worker 能力不足。

## 来源与保真边界

来源文件：`/home/tcuni-claw/.codex/sessions/2026/09/29/rollout-2026-09-29T23-34-07-01a0edcd-41d7-7ba3-9b56-7066c55c194d.jsonl`。

| 源行 | 恢复内容 | 限制 |
|---|---|---|
| 141 | 原采集清单中存在目标会话，大小 658077 bytes | 是当时的文件元信息，不证明现在远端仍有原件 |
| 212 | 用户原始要求和 Root 最终回复的摘录 | 多会话输出；目标回复尾部已截断 |
| 283 | 历史抽取命令 | 从当时 `analysis.json` 抽取任务前 350 字符、报告前 1200 字符，并将换行转为空格 |
| 286 | reviewer 任务及报告摘录 | 命令主动截取，且整批工具输出还发生过截断；不能当作完整报告 |

`retained-output-*.json` 保存历史工具返回 payload，`.txt` 为解包后的可读输出；这些含其他会话片段，已通过本目录 `.gitignore` 留在本地。`af-excerpts.md` 只摘取目标会话块。哈希用于标识本次保留副本，不代表恢复了原始业务会话的 SHA-256。

## 本轮找回范围

按目标会话 id、reviewer run id 和归档扩展名，检查了本机 `.pi`、`.herdr`、`/project/tmp`、`/home/tcuni-claw/pi` 的可见文件，包含被 ignore 的文件；未找到目标原件或对应采集压缩包。仓库另有 `om09-run/s.tgz`，但它属于 2026-09-24 的其他会话，不是目标原件。随后在本机 Codex 2026-09-28 至 09-30 的记录中定位了上述分析会话。

## om09 连接结果

首次 SSH 被本环境的系统 SSH 配置权限错误挡住。改为显式读取既有用户配置后，连接报 `socket: Operation not permitted`，退出码 255；用户明确授权后用相同只读连接方式重试，仍是这个错误。没有进入远端执行命令，也没有改动远端文件、认证设置或本地 SSH 配置。

用户已经授权连接 om09，不需要重复索取授权。当前阻碍是执行环境无法创建网络 socket，且此会话不能提升权限；需要允许 SSH 网络连接的执行环境才能继续。

远端下一步应读取 `~/.pi/agent/sessions/*/2026-09-28T04-32-33-676Z_01a0e649-398b-7713-8774-fded5d70bdac.jsonl`、对应 child 产物，并检查 `/home/scripts/nf-rnaseq-v2` 中 `1d89adb` 及相邻提交的 diff。会话/child id 已保留在 [案例复核](../../docs/worker-tiers-evidence-2026-10-06.md)，无需重新摸排。
