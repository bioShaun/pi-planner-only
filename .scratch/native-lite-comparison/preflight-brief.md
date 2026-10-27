# P6 环境与预算预检 brief

用户最新授权：首批 Native/Lite 两对比较总费用 <=US$20；实验 Root=tcuni/gpt-6.1-terra，worker=tcuni/gpt-6-luna。Root 已更新 protocol.md v1，reviewer/validator 也统一 Luna medium，Root high。请先读本 brief、protocol.md、项目 AGENTS.md/CONTEXT.md、归档 execution plan。当前主仓库 HEAD 4890751（产品基线固定 f818cc91c98d6129a152fb28161e00d2f601e494）。主会话只负责规划、diff与证据验收；实现及测试归你。

本次任务仅离线环境准备、检查及具体执行方案，不启动任何实验 Root/联网模型健康检查，不修改全局安装或设置，不 push/reload/commit，不再委派。你本身使用 Luna；无需为此重新确认用户已给的授权。

## 交付与范围

只新增 .scratch/native-lite-comparison/preflight/ 下文件及 /project/tmp/pi-native-lite-pairs/ 下隔离目录；不要编辑协议或旧记录，Root 最后汇总。既有未跟踪原件不覆盖。提供 preflight.md，明确每项命令/cwd/time/exit，机器敏感信息不入库。保留成功与失败，不把 unknown 写成零。

1. 查明如何创建 Native/Lite 两种全新 Root 会话，明确载入同一 frozen plugin f818cc9 与 pi-subagents 0.83.0、宿主1.4.0。允许离线创建四个独立 worktree、局部 .pi/settings.json、配置和 probe，符号链接已有依赖，不 npm install。先调查现成 bench/run-body.sh 与 .scratch/step2-prompt-20261027/execution.md 的实现/记录、已安装 pi SDK 和 CLI 帮助。Native 也必须显式加载该候选插件并选择 native；旧 bench Native 只加载 subagents，不能直接拿它冒充本协议 Native。不能误加载 dirty 全局 planner。
2. 只读离线验证实际插件加载（真实 loader/session 的工具注册或 mock provider 边界），不是只记录启动命令/路径。证明 Native/Lite 模式差异符合契约、模型覆盖在子角色生效、strict/handoff/context 设置一致或差异明确。离线 mock 不算真实模型运行。子模型 role override 仅局部配置；严禁直接输出完整 models/settings/auth 文件。保留 baseline、插件文件、锁、依赖版本/路径、配置与probe指纹。
3. 价格来源 Root 已只读确认 models.json 的 tcuni 定义（美元/百万）：Terra input1 output5 cacheRead.05 cacheWrite1.25 context500000 maxTokens128000；Luna input.1 output.5 cacheRead.01 cacheWrite.125 context1050000 maxTokens128000。本机价格只是估算，不能说实际账单。查明 Root+所有 Native/Lite child 的请求和费用如何统一计量、在途如何保守预留、怎么在累计+预留达到US$16时拒绝新调用，为US$20留余量。只读解析配置/现有测试，允许设计/实现最小独立测试 harness；不能指望 usageBudget 中止已启动请求，不能只靠最后统计。报告新Luna准备委派费用的可见覆盖；不足unknown。
4. 如果需要新增预算guard/runner行为，必须先仅写有意义测试并运行，保存失败 stdout/命令/exit（必须因行为缺失失败，不是导入/语法错误），再实现并贴通过证据；guard增加fault injection：超预算、未知usage、子进程/并发预留、超时或失败、只允许指定模型。不得删弱原断言。优先复用已有能力，不为两次实验建设大型框架。若需要明显跨包改动或无法可靠覆盖子请求，停止实现并报告具体缺口及最小可行方案，不笼统说预算未授权。
5. 输出两场景同字节brief、具体执行命令、四臂目录/新session方案、交替顺序、20min/arm、失败止损规则及可执行性。不读取另一臂结果（当前尚无）。SDK/CLI 为受控比较 harness 的候选执行方式，本次只离线准备；后续实际执行由Root验收后明确选定，禁止失败后静默换路。

## 资源

/tmp 禁止，TMPDIR/TMP/TEMP均为 /project/tmp/pi-native-lite-pairs/tmp；不重用系统HOME变量。首次重活先读 ~/.config/agents/slot.md；预计>1min、>2G或大量/data_0 IO必须先保存slot audit/status，再slot cpu/io -- cmd；原始slot日志含其他任务信息只留本机。并行工具<=4，每cwd一个写者。不用sleep/poll等父通知。

约10分钟有界完成离线预检；若预算guard变更超此范围，先交付可审查的设计和实际验证缺口。报告明确 ready / blocked 的具体证据。只给文档说明却没有实际加载验证不能算ready。Root将在你完成后读diff/测试日志并决定启动P6，不需你预先开等待Root批准的实验会话。
