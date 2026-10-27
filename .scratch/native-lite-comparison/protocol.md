# 比较协议 v2：已冻结批次停止，0 个有效样本

当前状态：**stopped**。首臂首次启动CWD错误，唯一纠正重试又因RPC runner漏发初始请求而停止；均未发送实验provider请求。离线修复已通过10/10检查，但本批不再启动，见[批次验收](pairs/acceptance.md)。下文保留当时冻结的实验配置与规则。

冻结时状态：**frozen，Root 已接受离线预检与预算保护，授权按下述顺序启动 P6**。用户已明确授权首批比较费用不超过 US$20，实验 Root 使用 `gpt-6.1-terra`、worker 使用 `gpt-6-luna`。该授权替代 v0 的 US$10 建议及旧模型配置；无需再次确认金额。依据[归档计划](archive/native-lite-execution-plan-2026-10-27.md)。

## 基线与问题

候选固定为 `f818cc91c98d6129a152fb28161e00d2f601e494`（独立集成分支）。其父提交为 `3db1846aedb23a6b5552f69ffb70b552cdb94c7a` 与 `8168e126bed60d5a7f485718f17d7114d1322bfa`，产品源码与前者相同，仅新增 changelog 四行。证据以 [sync.md](sync.md) 及最终检查记录为准；不能把当前 dirty 安装作为此基线。

首批选择两种本计划确有需求的只读场景。它们检验调查和验收编排，不代表新增功能或缺陷修复的效果。后续真实行为变更任务只能另冻协议，不能据此推广。

| ID | 决策问题与来源 | 两臂相同 brief | 接受条件 |
| --- | --- | --- | --- |
| S1 | P5：一次有界的源码调查是否值得额外编排 | 在固定基线调查 Native 用量采集的来源、去重规则和覆盖限制，对照 Lite 的用量覆盖；只读源码/测试，给出具体文件定位、未知项和可比范围。不读取本轮研究归档、报告或另一臂结果。 | 结论可由源码支持；覆盖 Root/child、input/output/cache、重复计数边界、费用缺失；区分源码语义、实际运行和账单；不得声称某模式已更省钱。 |
| S2 | P1：固定候选的检查与独立源码审查是否能合理重叠 | 验收 `3db1846..f818cc9` 集成候选：核对 merge 父提交/祖先、完整净 diff、历史 192 项 manifest 与 release 的适用限制。必要检查与独立只读源码审查可并行，最后 Root 汇总同一版本证据。 | 保存实际命令、cwd、起止与退出码；正确归因所有指纹差异；不把源码相同视为依赖环境相同；不改源码/全局安装，不运行无关全量 release。 |

S1 Native 先、Lite 后；S2 Lite 先、Native 后。任务 brief 在启动时复制为两份同字节文件，记录 SHA-256。每臂独立 checkout、新 Root 与新 child；第二臂 Root 不得读取第一臂解答。当前 Root 已见准备工作结果，不能充当任一实验臂的盲 Root，只负责冻结/调度/最终验收。

## 角色与配置

用户指定两臂实验 Root `tcuni/gpt-6.1-terra`、worker `tcuni/gpt-6-luna`；声明 thinking 沿用 Root high、worker medium。为避免其他子角色引入第三种模型，本批 reviewer 与 validator/oracle 也统一使用 `tcuni/gpt-6-luna` / medium，作为 Root 的实施选择记录，禁止沿用全局的 Sol/Astra 子角色覆盖。S1 使用一个 worker 调查；S2 使用 validator + 独立 reviewer，满足源码冻结且验证不写源码时并行。不增加 explorer 或等待 Root 批准的占位 child。

以上模型/角色配置已由四个真实 Pi 离线 RPC 会话核实；这不是实际联网模型响应证明。执行时保存 provider 完整 ID、声明 thinking、实际消息模型、工具清单、skills、宿主/插件/pi-subagents 版本、安装来源、源码/锁文件/依赖指纹。已核实宿主 1.4.0、pi-subagents 0.83.0；正式请求的 system/tools/payload 指纹在发送前记录，不用离线配置代替实际消息证据。

两臂均要求实现与检查交给 child、Root 验收；Lite strict=true、handoff=off，Native 使用其自身生命周期（不伪称具有 Lite strict）。禁止中途 handoff 或模型切换，若必须切换则终止该候选并重冻。两臂 context 阈值已核实为150000，模式/tool激活由离线RPC核实；正式模型请求的完整system/tools指纹尚未取得。Native workflow 与 Lite delegate 的工具和 supervisor 能力差异单列；不人为限制并发来制造优势。历史安装路径及会话状态见 [native-runtime.md](native-runtime.md)，本批隔离环境见[预检记录](preflight/preflight.md)。

## 隔离、资源、计量与止损

每臂已创建 `/project/tmp/pi-native-lite-pairs/S{1,2}/{native,lite}/` detached worktree，均为共同基线。正式 session、evidence 与报告放在 checkout 外的 `/project/tmp/pi-native-lite-pairs/results/S{1,2}-{native,lite}/`，每臂新会话。源码只读，候选不集成生产。只在本地保存脱敏记录，不写外部系统。

建议每臂墙钟上限 20 分钟，首批两对累计 80 分钟；正常失败不重试，启动配置失败最多同协议重试一次且仍计入该臂时间/费用。不切换 CLI 绕过失败；环境前提不符即 blocked。补测默认 0 对，只有影响选择且有明确判别问题时，另记录理由并交换顺序，每场景最多额外 1 对，仍受总费用约束。

**用户确认首批费用总上限 US$20。** 预留至少 US$4 安全余量：按已核实口径的累计费用加在途请求保守预留达到 US$16 时不启动新请求；不得把模型日志费用当成最终账单。正常准备工作与实验分列，新的 Luna 准备委派也计入可见费用预算，不以未知为零。只有报告型 usageBudget 不能视作硬账单上限：它可能不能中断已启动请求。

当前本机模型配置费率（USD / 百万 token）为 Terra input=1、output=5、cacheRead=0.05、cacheWrite=1.25；Luna input=0.1、output=0.5、cacheRead=0.01、cacheWrite=0.125。来源为 `~/.pi/agent/models.json` 的 tcuni 两个指定模型字段，仅摘录非敏感字段；这是本机计价配置而非 provider 发票。预检需确认请求/用量覆盖、在途保守预留及失败时停止后续请求的方法；采用此配置估算并明确边界，不再把“用户未定金额”当成阻断理由。

所有命令临时目录在 `/project/tmp`；重活先保存 slot audit/status 到本机日志，再 slot cpu/io 提交，不把其他任务资源信息入库。臂顺序执行，记录缓存冷热/共享资源干扰，不声称完全控制缓存。用量按 Root 与每个 child 分列 input/output/cache read/write、来源和覆盖；缺失填 unknown。墙钟包括准备、调度、等待、返工、最终验收，各阶段时间不简单相加。生命周期不等于模型计算时间。

## 验收与启动门槛

候选报告移除模式标记后按同一标准审查；若工具痕迹使匿名化失效，记录偏差。保留失败、超时、未完成与环境故障，不计算失败=零费用，不从单 pair 推断统计显著性。

启动条件复核：

1. 金额已确认 US$20。已实现按本机费率计算的请求前保守预留；累计不退款，达到 US$16 拒绝新请求；每请求输出 cap=16384，两臂一致。共享账本初值 US$1 为准备工作预留，三次已完成 Luna 准备 run 的报告费用合计 US$0.50437214，尚非 provider 账单。
2. 四个独立新 Root 的版本、模式和模型配置已由真实 Pi loader/RPC 核实。选定显式加载候选插件与 pi-subagents 的 Pi CLI harness，不加载 dirty 全局 planner。它是受控比较的执行入口，失败时不得切换 CLI 绕过。
3. 预算保护通过 mandatory child extensions 传播到 Pi children，拒绝不支持的外部 runner。Root 读了注册、Native async 与 Lite API preflight 的传播源码。loopback 已验证正常请求与拒绝请求、清空/污染外层环境身份，9/9 通过；完整真实 Native/Lite child 链仍须在各正式臂用 ledger/session/launch receipt 核对，未覆盖即停止后续臂，不能追认为成功。
4. 不更新现有安装、不 reload。局部配置、brief、guard 与源码在每臂启动前冻结 manifest；发生实质漂移即停止。工具差异和声明档位已记录，首个实际 provider payload hash 与 session 元数据在运行日志中收集，缺失不伪造。

Root 已读取针对真实身份缺陷的失败断言与修复后的9项成功输出，接受 [guard 身份修复](preflight/guard-fix.md)。Guard 源码 SHA-256 `421539411c9a853c2341b83ed69c3aa71bcf4c213599a95798abae77447fac0d`；core `632b82ccf67c6033032619ba629f0827c1edb7d8fbf006c975f9f6752f1f8268`。S1 brief `2071686d4f1f4d7b7d8614baf84e762ba9732ce59850361c68d90529388f7f64`，S2 `6785646596487226f911c7c2756da64c10e3da7fe4059ac7eae3d8eff834785b`。

本批只允许文本请求、本地 function tools 和指定模型；多模态、provider hosted tools 与 service-tier 改价请求拒绝。Guard 是同 UID 下的实验护栏，不是 provider 账户账单上限，也不声称防恶意 child 篡改。同账本跨进程原子预留、失败不退款；真正账单与完整准备/主会话费用的覆盖边界单列。S2 reviewer 读取同一冻结 diff 工件，validator 执行命令，避免局部配置导致 Lite committed-base 干净树检查拒绝。

用户已授权场景准备、普通子代理执行和本地证据交付。P6 按冻结协议执行；P7 等待结果且只有明确决策价值才补测。P4 的真实后续任务观察独立积累，不作为启动 P6 的前提。
