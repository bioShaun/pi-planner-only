# 02: Explorer 重新委派读取当前配置并保留真实运行身份

**What to build:** 操作者重新委派 Explorer 或在宿主正常重载配置后再次启动时，得到当前配置对应的模型；进行中的执行及历史记录不被改写。运行记录保留宿主实际报告的模型和 thinking，确保可以区分配置期望与实际观察。

**Blocked by:** 01 — Explorer 按子代理配置启动并保持只读。

**Status:** needs-triage

**Resolution:** Focused lifecycle checks passed; final closure blocked by 01 and release/host validation.

**Parent:** [主 spec](../spec.md)，实施决策 §9-§15，测试决策 §74-§77。

- [x] 从注册的 planner_delegate 创建可供后续执行的 Task，再以其返回的 canonical Task id 调用 planner_redelegate。两次 Explorer 执行使用票 01 的同一配置选择路径及只读能力，不另建解析分支。
- [x] 用两次实际工具调用验证宿主正常重载前后的模型选择：配置更新并对宿主可见后，新执行使用更新值，即使 planner-scout 已经注册；既有执行保留原启动选择。不引入超出宿主原有能力的热重载承诺。
- [x] 同时覆盖 model 与 thinking 的变更，确保运行时代理注册缓存不会冻结其中任一字段。
- [x] 显式 inherit 时，在两次执行之间改变本会话 Root 模型，第二次跟随当前 Root；不能取其他会话写入的全局默认值。已明确配置 scout 模型时，Root 的变更不覆盖该配置。
- [x] 重新委派保留 Task 身份、不可变 acceptance mode 和既有 RecoveryDecision 门槛。用集成测试证明：配置改变本身不能让需要恢复决策的执行绕过该门槛。
- [x] 通过结构化进度与终态返回宿主观察到的模型及 thinking，并验证工具结果和既有持久化记录继续保留这些实际值。请求模型与观察模型不同的夹具中，不能拿请求值覆盖实际值。
- [x] 宿主未提供 actual model/thinking 时继续记为未知，不使用请求值补造事实；不新增不在规格范围内的模型不匹配裁决系统。
- [x] 既有用量归属遵循实际宿主身份；配置变更不重写旧 execution 记录或历史费用，不启动历史数据迁移。
- [x] 保留代表性的 Worker、Reviewer、Validator 启动行为回归，并验证 Explorer 配置选择不会调用 Root 模型切换操作。所有 Explorer 生命周期场景仍保持相同的受限工具与 capability。
- [x] 本票的集成测试从注册工具入口运行生产配置加载、委派与结果处理路径，验证完整行为；完成相关类型检查，遵循项目隔离目录和 slot 规则。

**Verification boundary:** 复用注册工具、运行时代理事件、结构化 Delegation 以及结果/账本观察的现有集成测试边界，不新增只对模型解析 helper 自证正确的测试体系。

## 收尾复核（当前结论）

- 2026-09-18 收尾复核（替代下方早期“全量通过”结论）：注册工具入口的重新委派、模型/thinking 更新、inherit、恢复门禁、历史身份/用量及其他角色回归已在当前源码独立通过，见 `.scratch/explorer-model-config-closeout/final-focused-report.md`。
- 本票实现保留，但依赖票 01 的完整宿主兼容性尚未完成；全量发布检查被已复现的子进程 console 管道输出异常阻塞，真实宿主最终验收依赖票 03，故不作最终关闭。

## Comments（历史记录；完成声明已由收尾复核更正）

- 2026-09-18 实现与验证完成：
  - 生命周期与重入：`planner_delegate` 与 `planner_redelegate` 统一使用 `deps.resolveExplorerModelSelection`，重委派保持原有 Task 规范与只读能力。
  - 配置热读：由于运行时代理定义保持无模型（仅定义只读工具能力与 completionGuard=false），模型选择在每次启动前动态解析，磁盘配置变更在下次委派即生效，代理注册缓存不冻结配置。
  - 恢复门禁与历史不变性：失控被中断的 Task 仍严格要求 `RecoveryDecision`（`RECOVERY_REQUIRED`），即使配置发生变化也无法绕过门禁；重试启动使用新配置，旧执行记录不被改写。
  - 身份真实性：宿主实际报告的 terminal model / thinking 写入执行记录与账本；请求值与观察值不同时保持观察值，缺失时保持未知（不回填请求值）。
  - 用量与非目标角色隔离：`usage.jsonl` 持久化行核对确认子执行用量归属真实模型；Worker、Reviewer、Validator 请求不附带任何模型权威，Root 运行时模型未被改动。
  - 回归测试见 `explorer-model-config.test.mjs`，`npm run test:release` 全部通过。
