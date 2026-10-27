# P6 离线预检结果

状态：**环境准备部分 ready；P6 blocked，不得启动付费实验。** 本次未发出模型 prompt、未做联网健康检查、未启动真实 child、未改全局安装或设置，也未 push/reload/commit。交付由 Root 审阅后决定是否继续。

## Ready 证据

- 四个 detached worktree 均为 `f818cc91c98d6129a152fb28161e00d2f601e494`，位置分别为 `/project/tmp/pi-native-lite-pairs/S{1,2}/{native,lite}`。各自 `.pi/settings.json`、输入 brief、证据目录隔离；依赖 `node_modules` 指向现有仓库依赖，没有安装或改写依赖。未读取任何另一臂结果。
- 四臂均显式加载候选 `index.ts` 和已安装 `pi-subagents/index.js`，而不是使用 dirty 全局 planner。`--no-extensions` 阻止自动发现其他 extension；`-e` 明确加载两项。宿主 `pi 1.4.0`；`pi-subagents 0.83.0`，路径 `/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`。
- Pi 1.4.0 RPC 会话的真实 loader/probe 注册了 Native/Lite 工具。Lite active tools 包含 `delegate/git_audit/git_commit/handoff`，隐藏 `subagent`；Native 不激活上述 Lite 工具，保留 `subagent/subagent_supervisor`。Native workflow 与 Lite delegate/control 的能力差异是真实观测，不视为同工具集。每臂另有 `planner-only: native` 或 `planner-only (strict)` 启动状态。
- `subagents-models` 只读管理命令对 worker、scout、oracle、reviewer 均返回 `tcuni/gpt-6-luna`, thinking `medium`，override 来源为对应 worktree 的 `.pi/settings.json`。Root RPC `get_state` 为 `tcuni/gpt-6.1-terra`, `high`。这是本地 loader/session 配置验证，不是真实模型调用或运行用量证明。
- 四臂相同项目配置指纹：SHA-256 `343dd87d14a081f2d33bd3072d913962561782e4a260fc4ca74b603800a2bcd1`。模式配置实测：Native `strict=false`（Native 不宣称 Lite strict）、Lite `strict=true`；两者 `handoff=off`、`contextWarnTokens=150000`。Root system prompt 按协议有意不同（Native 中性提示 vs Lite 编排/strict 指引）；本次没有发模型请求，因此未采样模型实际收到的完整 system prompt/tools schema 指纹，正式启动前还须补冻结记录。
- 插件和环境指纹：candidate `index.ts` `0a8b277e12d92ead7151fe9850dcaebfea2c10207f1134667cbe22a23f5887a1`；`package-lock.json` `105da12bbe51f12dfe2862e0cbf8641c0cd2bf6f7f1f1e266309ef5a828a6fd4`；`skills-lock.json` `83589059c6c7ba7a6ce32e47fe3d37e16769c191a3d34cc9cf78a5a532dffcb4`。Pi SDK、pi-agent-core、pi-ai 均为 1.4.0，TypeBox 1.3.27。pi-subagents `package.json` SHA-256 `753e66504724d74e12dd02ba324744dbe3a9a5073dc5ffdf22c0154ebf36b7e8`；其源码入口 SHA-256 `ce413b7cb2e174f76d21a29a95704dcdfdbcb3c95049833dd4009d233e5f1b01`，bundle 入口 `bb53c96a4b65ea279745c4f9f3dec952a9d40410152b09c04de2d3e83c4f1f7e`。
- `~/.pi/agent/models.json` 只提取指定模型非敏感费率字段：Terra input/output/cacheRead/cacheWrite = `1/5/0.05/1.25`，context/maxTokens `500000/128000`；Luna `0.1/0.5/0.01/0.125`，`1050000/128000`（美元/百万 tokens）。这是本机估算配置，不是 provider 发票或账单。
- S1 两臂 brief SHA-256 都为 `4cbbdb45c62a4b5b2175c5d131b7d1d99e0656300a0eeb119454a7ca9983966f`；S2 两臂都为 `f2dd88fa890e7ea2c7ffd71423a1bfb5b19f34fe8ac910884d2f551d503bf3b5`。原件在本目录，复制件在每个 worktree 的 `input/brief.md`。

## Blocked 证据

1. **US$16 硬止损目前不可执行。** 插件 `index.ts` 将 Root usage 汇总为 tokens/cost，Lite child 结果到达后计数；Native child cost 是异步 RPC 的已记录下限。它们是会话内展示/观测，不是统一、持久、跨进程预算锁。Root/所有 Native 与 Lite child 的每次请求不能在派发前共同预留并原子拒绝；unknown usage、失败/超时和在途请求也没有可靠的 worst-case 保留。pi-subagents `usageBudget` schema 明确是 root-only reported usage / blocks launches，且已启动 children 不会被中止；不能覆盖 Root，也不是账单硬限。仅靠最终统计或 status bar 会低估风险。
2. Native 与 Lite 可见用量口径不同：Root message 给 input/output/cacheRead/cacheWrite 与 cost，但插件 Root totals 只显示聚合 tokens/cost；Lite child receipt 可选且缺失时仍计 child 数、无 cost，故失败/超时不等于零。Native child cost RPC 结果是 lower bound，异步/不可用/不完整 receipt 可缺失。缓存计价字段存在，但不能据现有 UI 认定全体请求逐项完整。
3. 本任务是新 Luna preparation delegation；当前 worker 没有可读取的父端 provider 发票或 usage receipt。其实际准备费用覆盖为 **unknown，不按零计**。离线 Pi RPC 记录没有 assistant model message/usage，因此这些探测本身未观察到 provider 请求；但无法据此证明 worker 委派费为零。
4. 最小可行硬止损方案需要跨 Root 与所有 Pi child 的 provider 请求边界共用计量器：请求发送前从共享原子账本按模型费率对输入（未缓存上界）及最大输出预留；unknown、失败或超时保留最坏预留/直到可核对；收到 usage 后按 input/output/cache read/write 对账释放差额；若累计已确认费用 + 全部 in-flight reserve `>= $16` 则 fail-closed 拒绝下一次 provider 请求。必须验证 Native workflow 派生的每个 session 也装载同一 meter，并对超预算、unknown usage、并发/子进程预留、超时/失败、模型 allowlist 作 fault injection。当前插件和 Pi 子进程未提供这条跨进程、请求级共享硬闸，安全实现/覆盖需扩展 runner/host/provider seam；按 brief 的停止规则，本次不改产品、不造大框架，也不声称已落实预算 guard。
5. 每臂 20 分钟可作为墙钟止损，但费用停止条件未落实，所以不能以时间上限替代预算硬闸。Root 运行前还需冻结实际 system prompt、context/tool manifest 以及来源与覆盖边界。

## 场景与执行准备

顺序：S1 Native → Lite；S2 Lite → Native。每臂 20 分钟，累计四臂 80 分钟。正常失败不重试；仅启动配置失败可在同协议内重试一次，时间/费用仍计入。无论原因不得切换 CLI 绕过失败；任一 arm 超时/模型切换/来源不明/预算 guard 失效，停止后续请求并保存已有日志。达到 `confirmed+in-flight >= $16` 必须拒绝下一请求；$20 是总授权上限，至少 $4 留作余量。缓存冷热、共享资源干扰和 lifecycle 时间分别记录，不将未知 usage 或失败算零。

两组 prompt 已准备为同字节文件：S1 调查 usage 来源/去重/覆盖边界并只读比较 Native/Lite 源码；S2 验收父提交/祖先、完整净 diff、192 项历史 manifest 与 release 证据适用限制。每对 arm 独立 worktree、新 session ID 和证据目录；只允许各自 Root 看自己的 brief/worktree。S1/S2 brief 不包含本预检结果，运行 arm 不得查看另一臂或本目录的说明。

经验证可用于后续执行的启动模板（Root 验收前**不要执行**；参数、会话 ID、brief 和 stdout/stderr 路径按 arm 独立替换）：

```bash
cd /project/tmp/pi-native-lite-pairs/S1/native
env -u PI_SUBAGENT_CHILD \
  PI_PLANNER_ONLY_MODE=native PI_PLANNER_ONLY_STRICT=false \
  PI_PLANNER_ONLY_HANDOFF=off PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS=150000 \
  TMPDIR=/project/tmp/pi-native-lite-pairs/tmp \
  TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp \
  pi --approve --mode json --session-dir /project/tmp/pi-native-lite-pairs/S1/native/session \
    --session-id p6-S1-native --model tcuni/gpt-6.1-terra --thinking high \
    --no-extensions --extension "$HOME/.pi/agent/npm/node_modules/pi-subagents/index.js" \
    --extension /project/tmp/pi-native-lite-pairs/S1/native/index.ts \
    -p "$(<input/brief.md)" \
    > /project/tmp/pi-native-lite-pairs/S1/native/evidence/session.jsonl \
    2> /project/tmp/pi-native-lite-pairs/S1/native/evidence/session.stderr
```

Lite 只替换 arm、session ID 和 `PI_PLANNER_ONLY_MODE=lite PI_PLANNER_ONLY_STRICT=true`；S2 同理。该命令显式禁止自动加载 dirty 全局 planner，显式加载同一 0.83.0 与候选插件；模型认证仍取既有本机授权，但本次未读/输出认证文件。必须先有可执行硬预算闸并把 usage reservation 注入每个 child，才能由 Root 决定实际执行。当前模板只证明创建独立 session/加载路径可用，不构成 P6 开始授权。

## 命令与日志

时间均为本机 `2026-10-27 +08:00`；命令 cwd 和 exit 如下，原始输出放 `/project/tmp/pi-native-lite-pairs/preflight/`，未把包含 host 元信息的 RPC 原文复制入仓库。

| 时间 | 命令 / cwd | Exit 与证据 |
|---|---|---|
| 20:16:51 | `slot audit`，项目 cwd | 0；本机日志 `slot-audit.txt`。紧接 `slot status` 同 cwd exit 0，日志 `slot-status.txt`；原始 status 仅留本机。之后没有重活需要占 slot。 |
| 约 20:17 | `git worktree add --detach <arm> f818cc91c98d6129a152fb28161e00d2f601e494` 四次，repo cwd | 四次 exit 0；四个 SHA 实际核验完全相同。每个 arm 链接现有 `node_modules`，不运行 npm install。 |
| 约 20:20 | `pi --help`、Pi 1.4.0 / pi-subagents 版本及路径检查，项目 cwd | 0；确认 `--extension` 可重复、`--no-extensions` 可与显式路径并用。未运行联网 health check。 |
| 约 20:22 | `node .scratch/native-lite-comparison/preflight/loader-probe.mjs <pi-subagents/index.js> <arm/index.ts>`，各 worktree cwd，四次 | 四次 exit 0，SDK 真实 `loadExtensions` 无 errors；两项 extension 的工具/command/handler map 已注册。摘要日志 `S{1,2}-{native,lite}-loader.json`。 |
| 约 20:24 | 初次 CLI RPC probe，各 worktree cwd | exit 0 但**未通过验证**：本执行环境继承 `PI_SUBAGENT_CHILD=1`，候选插件按设计 no-op，且子角色字段误用 `thinkingLevel`。未覆盖或抹除失败；原始 `*-probe.jsonl`、`*-active.stderr` 保留。字段依据已安装 0.83.0 schema 修正为 `thinking`，命令显式 `env -u PI_SUBAGENT_CHILD`。 |
| 约 20:26 | SDK 版本抽取命令试读 `require("jiti/package.json")` | exit 1，因 jiti 不在 root `node_modules`（非 package export）；没有版本推断。后续使用锁文件记录的根依赖版本，pi SDK/Subagents 版本分别从其绝对 package 路径核实。 |
| 20:27:05 | `env -u PI_SUBAGENT_CHILD node --experimental-strip-types --test index.test.mjs`，repo cwd，`TMPDIR=/project/tmp/pi-native-lite-pairs/tmp` | exit 0，1 test pass，0 fail；日志 `index-test.log`。是现有模式/usage 行为测试，不是预算 guard 测试。 |
| 20:27:17–20:27:20 | `pi --offline --approve --no-session --mode rpc --model tcuni/gpt-6.1-terra --thinking high --no-extensions -e <pi-subagents/index.js> -e <arm/index.ts> -e <probe.ts>`，每个 worktree cwd；stdin 为 `get_state`、`/subagents-models worker`；环境显式设 mode/strict/handoff/context 和 `/project/tmp` temp | 四次 exit 0，stderr 各 0 bytes；实际工具/active 状态见对应 `S{1,2}-{native,lite}-verified.jsonl`。命令全程 `PI_OFFLINE=1`，session ephemeral，无 assistant model message、无 provider usage、无网络模型调用。 |
| 20:28 左右 | `pi --offline ...` + `/subagents-models` 对 worker/scout/oracle/reviewer，S1 Lite cwd | exit 0；四角色均 Luna/medium。日志 `S1-lite-roles.jsonl`，为本地只读管理命令，未派发 child。 |
| 20:28–20:29 | 模型配置脱敏提取、源码/锁/设置指纹、cached diff 检查，repo cwd | 成功输出仅列指定模型价格与 hash；`git diff --cached --quiet` exit 0（无 staged 文件）。一次包含不存在 root `jiti` 的版本提取失败已如上保留。 |

行为红绿证据约束：未新增/修改 guard，因此没有预算行为测试红灯或绿灯，也没有预算 fault injection；不得把以上 loader 探测或现有 `index.test` 说成预算守护通过。必须先补共享请求闸的红测并证明因行为缺失失败，才可实现其 guard。

## 可复核文件与风险

- 工作区产物：`S1-brief.md`、`S2-brief.md`、`settings.json`、`probe.ts`、`loader-probe.mjs`、本报告。四 worktree 另有相同设置和各自 brief；临时 RPC 原文、slot raw status 和检查日志均在 `/project/tmp/pi-native-lite-pairs/`，不含于 git。
- 本仓库当前 index 无 staged files。既有 `.scratch/native-lite-comparison/protocol.md` 修改及其他未跟踪文件在任务开始已存在，未改写。
- residual risk：费用账单和 Luna 准备委派成本 unknown；运行中 Root/child 请求没有统一 hard stop；完整 prompt/tool/context manifest 未冻结。以上任一项未闭合即维持 blocked。
