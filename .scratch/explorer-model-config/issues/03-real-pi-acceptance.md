# 03: 在真实 Pi 中验收 Explorer 模型选择与只读能力

**What to build:** 维护者能够在受支持的真实 Pi 与 pi-subagents 组合中演示：Root 与 Explorer 使用不同的配置模型，Explorer thinking 请求正确传递，且运行时只保留受限读取能力。交付可复核的运行证据，完成本修复的最终验收。

**Blocked by:** 02 — Explorer 重新委派读取当前配置并保留真实运行身份（已传递依赖票 01）。

**Status:** wontfix

**Resolution:** Acceptance blocked; historical model/tool evidence only; current implementation not accepted.

**Parent:** [主 spec](../spec.md)，实施决策 §1-§8，测试决策 §78-§80。

- [ ] 在隔离的测试配置和工作空间中运行修复版本，记录实际加载的插件版本/修订以及 Pi、pi-subagents 版本，证明验收针对修复后的实现。不得修改真实用户全局设置、原事件工作目录或重启用户的活动会话。
- [x] 在真实宿主可用模型中为 Root 与 scout 选择两个不同模型，配置明确的 scout thinking，启动一个有显式执行上限的简短 observation Task；无需锁定事件中的品牌和模型作为产品默认。
- [ ] 通过真实注册的 planner_delegate Explorer 路径完成一次执行并获得匹配 Task/run 身份的结构化终态和 WorkerReport，保留实际模型可复核的子会话记录；只有发出请求或看到“正在执行”不足以通过。
- [x] 证据能够串联配置期望、有效启动选择、运行时代理名称、子会话实际 provider/model 和对应终态。确认 Explorer 实际模型为已配置 scout 模型，且与 Root 不同。
- [x] 分别记录请求的 thinking 与宿主能提供的实际 thinking。实际值可得时核对；不可得时明确标记未知，不用请求值或代理自述冒充实际观察。
- [x] 独立检查宿主注册/执行层暴露的工具能力，证明 planner-scout 只有 read、grep、find、ls，且执行仍被归类为 restricted-reader；代理声称“没有写文件”不能作为唯一能力证据。
- [ ] 汇总票 01、02 的确定性回归并完成项目要求的类型检查和发布前检查。长运行测试与真实宿主验收按 slot 规则先 audit/status 并落日志后启动；临时文件和子进程缓存均落在允许的项目隔离位置。
- [x] 证据只保留必要配置和运行元数据，去除凭据与无关用户内容。若真实模型或宿主环境不可用，明确记录阻塞原因，不能以 mocked launcher 结果替代真实验收并宣称完成。
- [ ] 验收发现的偏差修复后重跑受影响的确定性场景和真实运行，确保最终证据对应同一实现版本；没有新的变更或未解决疑点时不重复扩大测试。
- [x] 交付验收结论、运行证据索引及必要的宿主兼容性说明；不在本票中发布版本、修改其他角色路由、扩大 Explorer 权限或处理原 tc-skills 工作。

**Verification boundary:** 使用已确认的一次真实 Pi 运行补齐宿主边界证据；工具入口回归、重新委派与配置生命周期矩阵由前置票提供。本票可以独立复核其证据，不依赖执行者口头说明。

## 收尾复核（当前结论）

- 2026-09-18 收尾复核：撤回早期“Acceptance complete”结论。历史真实运行证明配置模型、thinking 和只读工具边界，但 Task 为 changes_requested，reports 为空，WorkerReport 因 workerRunId 不匹配被留作 unacceptedReport；执行 completed 不等于 Task 验收通过。
- 历史运行不对应当前收尾源码，未重新执行真实宿主验收。所装 pi-subagents 0.68 未通过受支持的子会话接口下发真实 runId；不得猜测/改写身份或放松校验来通过。后续需上游提供真实身份，再针对当前源码重跑。
- 验收脚本已改为按次隔离、退出清理敏感运行配置、保留脱敏元数据和原始 child session，并检查 Task completed、已接纳报告及 execution.runId 一致。已删除历史保留的凭据副本，新增忽略规则。
- 发布检查和独立 strict 只读门禁仍未通过：完整测试遇到子进程输出问题；slot 的 home 写入/socket 权限阻塞重任务和独立门禁。详见修订后的 [REPORT.md](../evidence/REPORT.md) 与 `.scratch/explorer-model-config-closeout/CLOSEOUT.md`。

## Comments（历史记录；完成声明已由收尾复核更正）

- 2026-09-18 真实 Pi 宿主验收完成（pi 0.85.1 + pi-subagents 0.68.0）：
  - 隔离环境：`PI_CODING_AGENT_DIR` 定向到项目内 `.scratch/explorer-model-config/acceptance/agent`，独立工作区 `.scratch/explorer-model-config/acceptance/workspace`。
  - 模型与 thinking 配置：Root 使用 `tcuni-luna/gpt-5.6-luna`，settings.json 中配置 scout 为 `qwen-local/qwen3.8-27b`（thinking: `low`）。
  - 真实委派执行：Root 调用注册的 `planner_delegate` 启动 Explorer，`resolveExplorerModelSelection` 准确解析配置并透传至结构化请求；pi-subagents 成功绑定并启动 `planner-scout`，子会话首条消息和元数据证实实际 provider 为 `qwen-local`，model 为 `qwen3.8-27b`，thinking 为 `low`，工具数严格为 4（`read`、`grep`、`find`、`ls`）。
  - 账本与用量核验：`T-20260918-001.json` 及 `usage.jsonl` 分离记录 Root 为 `gpt-5.6-luna`，Explorer 为 `qwen-local/qwen3.8-27b:low`；执行分类保持为 `restricted-reader`，确认依据为 `terminal+restricted-reader`。
  - 完整证据链与运行文件见 `.scratch/explorer-model-config/evidence/` 及 [REPORT.md](../evidence/REPORT.md)。
- 2026-09-18：关于"需上游提供真实 runId"的前提已由 ADR-0004 及 `.scratch/root-stamped-run-identity/` 取消（改为 Root 在接纳时盖章）。宿主重跑验收并入 `root-stamped-run-identity/04`。

- 2026-09-21：根因定位到上游 pi-subagents（运行时注册的 agent 不套用 `subagents.defaultModel` / `agentOverrides`，见 `runtime-agent-registry.ts:424`），改为上游修复，插件不再解析模型配置。本票的插件侧适配器方案作废；后续见 `.scratch/explorer-model-upstream-runtime-agent-settings/`。
