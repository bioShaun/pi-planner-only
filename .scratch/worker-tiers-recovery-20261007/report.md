# om09 AF 原件找回与归因复核（2026-10-07）

## 结论

**完整原始会话、6 个 child 会话及提交证据已经从 om09 找回，11 个文件均通过远端/本地 SHA-256 校验。** 当前网络已放开，前一阶段的 socket 限制已解除；远端操作仅用于读取日志和 Git 对象。

原件改变了此前的判断：**AF 算法是 Root 在实施 brief 中明确规定的，worker 按要求实现；Root 审查后保留算法并解释口径，没有改成逐 ALT 频率。** 此例不能作为「worker 能力不足、反复失败后由 Root 修好」的证据。

## 原始证据链

Root 会话：`2026-09-28T04-32-33-676Z_01a0e649-398b-7713-8774-fded5d70bdac.jsonl`，130 行，658077 bytes。远端路径在 `/home/glx/.pi/agent/sessions/--home-scripts-nf-rnaseq-v2--/`。原文件读取前后大小/mtime 一致，SHA-256 为 `0c1dca6478e4067ac615f91e3dc9cbea2df2841e840ffa7d6404426d451e0219`。

| 原始 Root 行 | 证据 | 对归因的含义 |
|---|---|---|
| 73 | 实施 brief 第 3 条写明 `Alt dosage = fraction of non-zero alleles in GT.`；第 4 条要求组 AF 为已调用样本 dosage 均值 | 所有非参考等位基因合计的算法来自 Root，而非 worker 自行发明 |
| 74 | worker 完成脚本和冒烟检查；run id `a5a59126-481a-47fe-9da1-cdd90e5076dc` | 能将脚本实现绑定到具体 worker |
| 87 | 下一个 worker 只负责流程/报告接线，明确要求不要改变该脚本逻辑 | 不能把会话中的四次 worker 委派当成四次 AF 重试 |
| 122–123 | reviewer 审查明确包含多等位边界；指出 P2：ANN 对应单个 ALT，但 dosage 为所有非参考合计；建议逐 ALT 计算或明确标成位点级非参考 AF | 审查暴露的是计算口径与 ALT 展示可能混淆的问题 |
| 124–125 | Root 读取脚本相关实现 | 有具体复核动作 |
| 126–127 | Root 将 genotype 解析移到目标基因过滤之后，添加位点级 dosage 注释；重跑旧冒烟数据，`diff -r` 返回 `SAME` | 这是性能调整和口径说明，未改变 AF 数值；`SAME` 也不是新多等位边界测试 |
| 128–129 | 提交 `1d89adbb5bfc3c97ab146700ba4a9bb7c1241130` 成功 | Git 对象已取回，可核对实际提交内容 |
| 130 | 最终回复明确“多等位位点的频率按所有非参考等位基因合计算，不单独计算某一个 ALT”；并说明 Nextflow 未真实运行 | Root 选择保留原统计定义；不能称为完整流程已验收 |

reviewer 还提出图标重叠的另一条 P2；本次仅对 AF 案例归因，没有把另一条意见算作 AF 返工。

## 代码与模型验证

child 原件在 Root 同名目录下的 `<run id>/run-0/session.jsonl`，并非当时预计的扁平 `subagent-artifacts` 文件。因此初次按旧 artifact 路径查询没有命中，但原 child 会话并未丢失。

- AF worker 原件的 `model_change` 为 `tcuni-luna/gpt-6-luna`，`thinking_level_change` 为 `medium`；reviewer 为相同 provider/model，thinking 为 `high`。这是日志记录的模型身份与档位，不是仅从当前设置推定，也不是一次更强模型对照。
- 从 AF worker 会话第 40 行的完整 `nl -ba` 输出恢复了 worker 交付源码。它与提交源码的 `parse_genotype` AST 完全一致。
- 对两个版本执行小型函数检查：`0/1:10` 的 dosage 均为 0.5，`1/2:10` 均为 1.0。检查仅验证日志所示的历史算法与前后差异，不等于认可逐 ALT 解读，也不代替业务集成测试。
- [worker 到提交的 diff](worker-to-commit.diff)还包括零 DEG 比较保留在汇总中的调整；该 diff 覆盖交付到提交的全部变化，不能都归到 AF 审查之后。AF 审查后的具体修改以 Root 第 126 行为准。

可复算命令：`python3 .scratch/worker-tiers-recovery-20261007/verify_recovery.py`。结果见 [verified-summary.json](verified-summary.json)。脚本验证下载哈希、恢复 worker 源码、比较函数 AST、运行上述两个输入，并按原始 usage 字段计算费用；不重跑业务数据或网络请求。

## 能核算的费用与不能推断的收益

以下均为历史日志中记录的美元费用，没有按现价重算：

| 范围 | Root 轮次 | 费用 |
|---|---:|---:|
| 审查后读代码、调整并检查（124、126 行） | 2 | $0.1788895 |
| 提交与最终回复（128、130 行） | 2 | $0.1760275 |
| 审查返回后至本轮结束 | 4 | $0.3549170 |

reviewer 自身费用为约 $0.0107375；审查返回到 Root 最终回复的记录时间差为 44.872 秒。这些是可观测的后续阶段成本与时间，不是“换强 worker 后可以全部省掉”的费用：其中有性能优化、常规提交/回复，也没有对照运行。AF 实施 worker 的记录费用约 $0.00795418，同样不能单凭它与 Root 后续成本的比例证明升级收益。

## 保存内容与历史边界

- [remote-manifest.json](remote-manifest.json)：11 份远端证据的来源、大小与 SHA-256；日志附读取稳定性检查，Git 产物附命令退出码。
- `raw/root-session.jsonl`、`raw/children/`：完整业务会话与 6 个 child 原件，保持本地忽略。
- `raw/commit-stat.txt`、`raw/commit-variant.diff`、`raw/commit-log.txt`、`raw/committed-variant.py`：固定提交的只读 Git 输出。
- [verified-excerpts.json](verified-excerpts.json)：相关原始行的消息/工具调用，省略 thinking 内容；完整原件仍在 raw 中。
- [初次摘录找回记录](partial-recovery-report.md)及 [manifest.json](manifest.json)：保留网络尚未放开时的过程与摘录来源，属于历史阶段，不再代表当前缺口。

本次恢复和核对的是 2026-09-28 历史版本；没有检查远端当前代码是否还有相同问题，也没有修改远端业务代码。结论只限于该历史 AF 案例：先核清 Root 的规格与输出释义，不将它列入已核实的 worker 能力不足样本。
