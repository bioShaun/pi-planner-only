# 01: Explorer 按子代理配置启动并保持只读

**What to build:** 操作者现有的 scout 模型和 thinking 配置通过真实 planner 工具入口作用于 Explorer。显式 planner-scout 覆盖、宿主配置优先级、子代理默认值和有意继承均按规格生效；错误配置明确失败，不能静默换成 Root。Explorer 始终作为受信任的只读代理运行。

**Blocked by:** None (can start immediately).

**Status:** needs-triage

**Resolution:** Partial implementation; focused checks passed; full host compatibility remains open.

**Parent:** [主 spec](../spec.md)，实施决策 §2-§8，测试决策 §68-§75。

- [x] 先通过现有注册工具集成测试复现：Root=A、scout=B/thinking low、子代理默认=C，三个模型不同；调用 planner_delegate 的 Explorer 后应选择 B/low 并绑定 planner-scout。保存修复前失败、修复后通过的证据，不能只测独立解析函数。
- [x] 沿“宿主可见配置 → Pi 适配器 → Orchestration → 结构化 Delegation 启动器”的完整路径传递有效 model/thinking。确认可用的受支持宿主接口；必要兼容加载封装在单一适配器，不直接导入依赖的原始 TypeScript 源码图。
- [x] 如需局部预重构，先在本票内以保持原行为和现有测试通过的小步引入窄适配边界，再接入修复；不单独交付没有运行行为的解析模块。
- [x] model 与 thinking 各自按“显式 planner-scout 覆盖 → 宿主解析后的 scout 有效配置（包含适用默认值）→ 宿主既有回退”选择。覆盖仅模型、仅 thinking、thinking off 和无配置场景，不把部分覆盖当作整体替换。
- [ ] 项目、用户、provider 专属配置以及代理定义的优先级符合宿主当前支持的语义。通过配置夹具驱动生产加载路径，不在测试中复制一个自制解析器充当 oracle。
- [x] 子代理默认模型在 scout 未指定模型时生效；支持的显式 inherit 保留其含义，继承当前会话 Root，不能被低优先级默认值覆盖。
- [x] provider-qualified 模型标识完整传递，包括模型部分仍包含斜线的情况。使用宿主既有解析与可用性检查，不新增模糊匹配规则。
- [ ] 缺失可选配置仍按正常回退处理；非法、不可读的适用配置和不可用的指定模型给出可识别的失败，不能成功启动一个未经配置允许的 Root 替代执行。若宿主已有显式配置的 fallback，保持其既有语义，不发明候选模型。
- [x] 声明工具仍严格为 read、grep、find、ls，保留 restricted-reader 能力证明和既有 completion-guard 行为。即使 scout 配置带有写工具、提示词、skills、extensions 或嵌套委派能力，也只转移模型选择，不转移这些能力。
- [x] 缺少受信任的运行时注册时保持原有启动拒绝；任何模型配置都不能绕过该门槛，不能改为启动 builtin scout。
- [x] 通过共享 Delegation 路径接入，不向 Root-facing TaskSpec 新增模型权威，不从提示词或 WorkerReport 文本猜模型。保持创建与重新绑定入口契约以及其他角色的既有路由。
- [ ] 本票包含上述成功、回退、失败和能力隔离场景的宿主工具集成回归，并完成相关类型检查。测试临时目录使用项目内隔离空间，不修改真实用户配置；达到重任务阈值的命令按项目 slot 规则执行并记录预检查。

**Verification boundary:** 复用已获用户确认的注册工具入口集成测试；真实 Pi 最终验收由票 03 汇总，不能因此省略本票的确定性回归。

## 收尾复核（当前结论）

- 2026-09-18 收尾复核（替代下方早期“实现完成/全量通过”结论）：补齐 builtin scout 的 low、标准用户/项目定义、builtin 整体覆盖和 custom 逐字段覆盖语义；模型字符串原样交宿主解析，移除自行精确匹配注册表的错误门禁。非法已知 override/definition 元数据拒绝；仅投影 model/thinking。
- 当前是按 pi-subagents 0.68 核对的有限兼容层。包贡献的 plain scout、额外扫描目录、部分复杂 frontmatter，以及 defaultProvider、modelScope、maxThinking、disableBuiltins=true 等有效宿主配置会明确拒绝；原规格要求的完整宿主兼容性仍未完成，不能将拒绝等同于支持。声明依赖范围中的其他版本未验证。
- 当前定向独立验证已通过，见 `.scratch/explorer-model-config-closeout/final-focused-report.md`。原全量发布通过声明撤回；当前完整检查失败及环境诊断见同目录 `final-validator-report.md`。

## Comments（历史记录；完成声明已由收尾复核更正）

- 2026-09-18 最小失败复现记录：在引入模型解析适配器前，集成测试执行 Root=A、scout=B/low、default=C 场景，AssertionError 验证启动 REQUEST 收到 `undefined` 而非 `scoutp/model-b`，失败日志已保存在 `.scratch/explorer-model-config/red-evidence.log`。
- 2026-09-18 实现完成：
  - 新增 `explorer-model.ts`：纯适配模块，按宿主相同优先级解析 user/project scope 下的 `subagents` 设置（`planner-scout` 显式覆盖 → `scout` 覆盖及 provider 特定条目 → `defaultModel`/`defaultThinking`），严格校验非法 JSON、目录不可读、无效 thinking 枚举及可用模型注册表（支持带斜杠的多段模型名如 `nested/model-d`），显式 `inherit` 透传；工具、提示词、skills 严格隔离不转移。
  - `delegate.ts`：在 `runDelegation` 依赖中注入 `resolveExplorerModelSelection`，在 Explorer 创建 Task 前校验配置并下发至 typed Delegation 请求的 `model`/`thinking` 字段；未配置时省略字段交宿主既有回退。
  - `index.ts`：在运行时插件绑定中将 `ctx.model`、`ctx.modelRegistry` 以及 `workspaceCwd` 连通至 `resolveExplorerModelSelection`。
  - 回归测试：`explorer-model-config.test.mjs` 全量用例覆盖成功矩阵、失败矩阵、能力隔离及注册门禁；`npm run test:release` 干净通过。
