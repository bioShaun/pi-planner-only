# Delegation 契约事故收尾记录

日期：2026-09-18。基线：`200985e9962da35097546cbb0f0a7896c00164ea`。

本地审核修复已完成并通过新的独立行为审核；完整发布验收和真实宿主验收仍未通过。本记录不将环境阻塞、mock 测试或工单状态更正算作全链路修复。

## 已完成的修复

- 从受控代码、包清单、测试脚本和指纹列表移除误入本次事故提交的 Explorer 模型接线。原有未跟踪 `explorer-model.ts` 和 `explorer-model-config.test.mjs` 的哈希未变，独立候选快照不带这两个文件仍可加载并通过类型检查。
- 移除两个生产入口对 `PI_SUBAGENTS_CAPABILITY_CHILD_RUN_IDENTITY` 的信任。环境变量不能覆盖不支持或缺失的 launcher 能力证明；回归覆盖 launcher 和已注册工具入口。
- 初始 Task 快照写入成功后才登记内存状态和父任务关联。真实写盘失败会阻止 child 启动并释放本次 reservation；回归验证父任务内存与账本、已有 reservation 均保持不变，新 Task 不会在重载后复活。后续生命周期写入仍保留原有尽力记录语义。
- 撤回 01、03、04、05 缺少真实宿主证据的完成声明，逐项取消未完成验收的勾选；02 保留本地准入修复的完成状态。

## 独立验证与审核

验证基于 971 个受控条目的独立候选快照，与冻结清单逐项相同，排除了未跟踪 Explorer 文件的帮助。

| 检查 | 结果 |
| --- | --- |
| 候选快照的模块加载、类型检查 | PASS |
| delegate、rs01、ledger-store、concurrency、refusal-breaker | PASS |
| index | FAIL：通过新增能力回归后，停在既有子进程 stdout 断言 |
| orchestrate | FAIL：真实 Git fixture 的 `spawnSync git EPERM` |
| 未改动命令 `npm run test:release` | FAIL：5 秒后停于 `task.test.mjs:287`，两份子进程输出均为空 |
| 最小 stdout 探针 | 普通及阻塞输出模式均记录 `spawnSync node EPERM`；未掩盖或放宽断言 |
| 新的独立行为审核 | PASS，无需进一步修正的代码 finding |
| 独立只读 launcher 的严格审核 | BLOCKED：slot 作业目录只读、cpu.socket EPERM，未取得运行时只读证明 |
| 真实 Pi host/launcher 验收 | 未完成，安装的 pi-subagents 0.68.0 缺少受支持的身份下发通道 |

[独立验证记录](independent-validation/ValidationReport.md)包含完整命令、退出码、stdout/stderr、失败尝试和最终哈希比较。[WorkerReport](WorkerReport.md)记录实现者自测；它与独立验证分开保存。[上游源码核对](upstream-capability-evidence.md)说明当前安装包的具体边界。

独立 Reviewer 使用无历史的 `astra_reviewer` 会话，核对了冻结差异、实际候选代码和独立测试证据，确认本轮四类审核问题的纠正；它是行为约束下的代码审核，不能替代未启动的严格只读审核。审核后唯一的受控文件调整是将工单 05 的旧测试描述更新为上述实际独立验证结果，没有再次修改运行代码或测试。

## 未关闭条件

| 工单 | 当前状态 | 剩余条件 |
| --- | --- | --- |
| 01 | ready-for-agent | 上游在 child 首轮前下发与 terminal 相同的 runId，并提供有文档的能力声明；随后验证首轮与纠正轮 |
| 02 | resolved | 本地准入回归通过；不代表整个版本发布验收通过 |
| 03 | ready-for-agent | 受控参数丢失的边界证据、关联输入诊断，以及真实 child 的 commands 重入验收 |
| 04 | ready-for-agent | 隔离真实宿主中的遗留 Task 查询与 blocked 结束演示 |
| 05 | ready-for-agent | 同一真实宿主基线完成完整事故链，以及完整发布检查与严格审核 |

上游支持版本尚无证据，不能假定某个未来版本号一定支持。不得以环境变量、猜测 runId 或改写 WorkerReport 代替上游通道。

## 交付状态

代码和工单变更保留在当前工作区；[最终补丁](final.patch)可直接复核。当前会话权限将 `.git` 设为只读，因此没有创建新提交或推送，HEAD 仍是 `200985e`。所有中间文件均在项目目录中；未修改原有 Explorer 文件、事故历史记录或全局 slot 配置。
