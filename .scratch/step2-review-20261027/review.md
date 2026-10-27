# 第2步审核记录

审核对象：HEAD `6e2c95a091fd0eb17e0ec3b8915affcebc3c29ab` 到当前未提交 `index.ts` / `index.test.mjs`。步骤0的 README/package 及其他既有工作树修改不在本轮修改范围。本轮只新增本目录的审核产物，未修源码、改测试或提交。

Root 结论：REQUEST_CHANGES。发现1个需修正的提示词契约退化。静态检查通过；不将子角色 completed 或静态通过作为整体验收。

## Root 确认的问题

P2，`index.ts:78`：将 `Check diffs and output before accepting` 改成 `Check diffs before accepting`，删除了接受结果前核对检查输出的明确要求。`CONTEXT.md:37` 规定 Root 依据 Git summary 和 check output 判断，而非子角色的自述。对只跑检查、没有 diff 的 validator 任务，以及实现完成但检查失败的任务，保留该指令尤其必要。delegate 描述中的“区分 implementation/checks/real run”并未直接替代核验输出要求。

最小修正：恢复 `and output`。当前长度非 strict 1487 / strict 1478；恢复后为 1498 / 1489，仍严格小于1500，无需提高阈值。本轮只提出修正，未修改冻结文件。

## Standards：qwen-local

原始报告见 `standards-result.md`。首行 PASS (code)，无硬性违规，提出两个判断性建议：相邻正则重复覆盖；长正则对措辞敏感。

Root 判断：均不阻断。不要按报告建议删除已有断言，项目明确禁止删弱既有断言。长正则属于已有断言的替换，未据此判成“新增固定原文测试”。

## Spec：Terra

原始报告见 `spec-result.md`。首行 BLOCKED (code)。确认上述输出核验指令丢失；另称新增固定原文测试，并因 reviewer 无 shell/哈希工具无法独立复算冻结哈希而阻塞。

Root 判断：输出核验问题成立；“新增固定原文测试”不采纳为缺陷，diff 显示现有 assert.match 的替换，没有增加测试项。哈希工具缺口属于本次审查工具与包指令的适配限制，不是产品缺陷。Root 的 prepare/check/receive 已复核冻结内容未漂移，不篡改子报告的 BLOCKED 状态。

## 证据复核：Luna 与 Root

原始报告见 `evidence-result.md`。Luna 认为记录与需求一致，明确受控 prompt 不证明自主路由或性能收益。它把原因类别附加到首行，违反结果格式，receive 返回2，保留 `evidence-receive.log`，未将其计为正式 PASS，未自行规范化首行。

Root 独立完成：

- `code.sha256` 三项均匹配。
- `sessions.sha256` 十项均匹配。第一次直接从仓库根调用 sha256sum 因清单为 sessions/ 相对路径失败；按正确基目录重新计算全部通过，非内容差异。
- 五份原始会话经原 analyze.mjs 复算，与存档摘要一致（仅忽略输入路径字段）；见 `evidence-recheck.json`。
- small 零 delegate；batch 同 turn 两个 explorer completed；lock 同 turn 一个 worker completed、另一个 refused；strict explorer 后 worker completed，最终回复为空且记录8次provider错误。
- 完整 `npm run test:release` 重新通过，包含 typecheck 与 host-runtime 5/5，见 `release.log`。命令：`TMPDIR=/project/tmp/pi-planner-step2-review-20261027 PI_SUBAGENTS_DIR=/project/tmp/pi-planner-host-1.4-contract-20261026/node_modules/pi-subagents slot cpu -- npm run test:release`。启动前 slot audit/status 已存日志，audit 未见绕过slot重进程。
- `git diff --check` 通过。既有静态日志存在，未把忽略文件误判为缺失。

验收边界：受控批量/前置探索会话证明执行路径可用，不证明新提示词在自然任务下自主选择该路径；记录已披露，未认定造假或新的阻断。需要评价路由改进时再补不给角色/顺序提示的样本。发布检查仍使用0.81.0隔离夹具，旧真实会话使用0.83.0，本轮未重跑真实模型路由实验，不能把两者视为同版本全覆盖。

## 模型试用事实

三路均以 fresh reviewer 启动，无实现历史；只读是行为约定，未声称严格沙箱。运行元数据分别保存在 `standards-runtime.json`、`spec-runtime.json`、`evidence-runtime.json`。

| 轴 | 实际宿主元数据模型 | 结果 |
| --- | --- | --- |
| Standards | qwen-local/qwen3.8-27b:low | completed，报告 PASS；仅非阻断建议 |
| Spec | tcuni/gpt-6.1-terra:high | completed，报告 BLOCKED；发现1个采纳问题、1个未采纳问题、工具证据限制 |
| Evidence | tcuni/gpt-6-luna:low | completed，内容可作参考，首行格式不合规 |

此次可确认三个模型均完成调用；任务不同且只有单样本，不能据此排序质量/速度/性价比。qwen用量为provider上报0，不能解释为真实无token或零成本。未修改全局模型配置。

正式包状态保留每轴原始结论；未申请 final gate。Root 的审核意见是先修上述P2再接受本步。Standards 0个硬性问题，Spec 1个Root确认的P2；证据边界不另列为代码缺陷。
