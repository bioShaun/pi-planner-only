# Native/Lite 实验预算 Guard

状态：**harness 实现与离线测试 ready，未启动 P6。** 真实 Root/child 实验请求仍须 Root 验收本 diff 后发起。本轮没有真实 provider 请求或付费实验。

## 改动

只新增实验 harness 文件，没有修改产品源码、全局配置、安装包或四臂 worktree 源码：

- `budget-guard-core.mjs`：账本、文件锁、单请求估算、原子 reserve 和校验。
- `budget-guard.ts`：Pi `before_provider_request` hook；失败直接 `process.exit(73)`，不依赖会被 Pi runner 捕获后继续执行的异常。
- `budget-guard.test.mjs`、`budget-guard-provider.test.mjs`：账本/fault injection 与真实 Pi loopback provider 边界测试。
- `S1-brief.md`、`S2-brief.md`：加入同样的 Root/child 执行前缀，更新四份输入副本。
- S2 的固定 reviewer 输入 `/project/tmp/pi-native-lite-pairs/common/S2-candidate.diff`，SHA-256 `72a2fa5d3a66649aac9426542182378b715874a81cdbabf24e6aeb241282d647`。validator 负责 shell；独立 reviewer 无 shell，只读此文件，避免 Lite `base` reviewer 因 worktree `.pi/settings.json` 和 input 未跟踪文件拒绝脏树。

brief 指纹：S1 四份均为 `2071686d4f1f4d7b7d8614baf84e762ba9732ce59850361c68d90529388f7f64`；S2 四份均为 `6785646596487226f911c7c2756da64c10e3da7fe4059ac7eae3d8eff834785b`。

## Guard 行为

- **唯一请求 allowlist**：provider 必须为 `tcuni`，model 必须为 `gpt-6.1-terra` 或 `gpt-6-luna`；缺失 provider/session/ledger、未知模型、非 plain request、缺失 input、旧式 `max_tokens`、未知顶层字段、非法 output limit、坏账本、读写/锁错误都 fail-closed。只接受 OpenAI Responses payload 的已知顶层字段。
- **保守 input 上界**：`min(model.contextWindow, UTF8(JSON.stringify(payload)).byteLength + 8192)`。整个 provider payload 纳入，而非只估用户文本；包括 instructions/tools/images 等当前请求内容。结构余量 8192 tokens。该上界不依赖 provider usage，也不写入 prompt。
- **output 限制**：预留始终按 16,384 output tokens 的最坏值计价；请求缺字段时写入 `max_output_tokens=16384`，请求本身低于该值时保留更低值，高于时 clamp 到 16,384，绝不提高调用方原有限额。
- **单请求 reserve**：input 按 `max(input, cacheWrite)`、output 按 output 费率；Terra 为 `1.25 * inputUpper / 1e6 + 5 * 16384 / 1e6`，Luna 为 `.125 * inputUpper / 1e6 + .5 * 16384 / 1e6`。按 context 上限时单次最高分别 `$0.70692`、`$0.139442`；短请求按 JSON byte 上界计价。cacheRead 不比 cacheWrite 更贵，故以更贵的输入/写缓存价预留。
- **共享硬闸**：所有四 arm 与每个 child 用同一 `/project/tmp/pi-native-lite-pairs/budget-ledger.json`。`mkdir/open wx` 独占锁、读校验 checksum 和总额、写临时文件 fsync 后 rename。当前已确认 reserve+$newReserve `>= $16` 时拒绝；失败/超时/unknown usage 不退款，绝无对账退款路径。锁持有进程崩溃会 fail-closed 留锁，须由 Root 审核账本后人工处置，不能自动删锁。
- **最少账本字段**：版本、累计预留、校验 hash；每事件仅有模型 ID、reserve USD、session ID、时间、payload hash。没有 prompt、headers、API key 或 auth。checksum 用于发现偶发损坏，不是防同 UID 恶意修改的 MAC。
- **child 覆盖**：Root session_start 通过 pi-subagents 0.83.0 `registerRequiredChildExtensions` 注册 guard 路径并标记 `requireForAllRunners=true`。该机制的 `resolvePiLaunchToolPlan` 在 Native/Lite 两类 Pi child plan 都把路径追加到 extension args，同时保留 runtime/tool extensions；要求的非 Pi runner 会被拒绝。child 自己加载 guard 时也会为其后续 child 递归注册。缺少 registry path/session ID 或注册错误，同样 exit 73，不发送 provider 请求。
- **真实 Pi hook 退出**：Pi 1.4.0 的 `ExtensionRunner.emitBeforeProviderRequest` 捕获 hook throw 后会继续，所以 hook 不 throw；拒绝后同步 `process.exit(73)`。loopback provider 测试在父 Root 和设置 `PI_SUBAGENT_CHILD=1` 的 child 进程都观察到 exit 73、拒绝文案和 HTTP request count 0。

账本已创建且本轮测试未触碰：初值 `$1.00`，事件标记为准备委派 `36c7a7ce-6cd2-4930-9102-00fdec37667d` 的 Luna 保守预留；来源 Root status 报告总额 `$0.12735892`（input 192649 / output 45669 / 90 turns）。该 `$1` 是准备费用预算 reserve，不代表实际账单。实际账单仍 unknown；余额可用于实验的 reserve 最多 `$15`，硬拒绝线 `$16`，授权上限 `$20`。

## TDD 与验证

红灯命令在实现前运行：

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp node --test .scratch/native-lite-comparison/preflight/budget-guard.test.mjs
start=2026-10-27T20:38:22+08:00 end=2026-10-27T20:38:22+08:00 exit=1
```

红灯不是导入/语法错误：`provider requests must reserve within the shared hard budget before transport` 以断言 `missing pre-request reserve behavior: no shared budget guard implementation` 失败。完整 stdout 与 exit 在 `/project/tmp/pi-native-lite-pairs/preflight/budget-red.stdout`、`budget-red.exit`。

最终 harness 测试：

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp env -u PI_SUBAGENT_CHILD node --test .scratch/native-lite-comparison/preflight/budget-guard.test.mjs .scratch/native-lite-comparison/preflight/budget-guard-provider.test.mjs
start=2026-10-27T20:56:07+08:00 end=2026-10-27T20:56:08+08:00 exit=0
```

7/7 pass，最终日志 `/project/tmp/pi-native-lite-pairs/preflight/budget-final3.stdout`（2026-10-27 20:58:28–20:58:29 +08:00，exit 0）。覆盖点：超预算、missing/bad ledger、未知 provider/model/field、output cap 不提高调用方 limit、跨进程并发只允许一笔接近 cap 的 reserve、timeout/unknown usage 不退款、`requireForAllRunners` child extension snapshot，以及真实 Pi hook 在 loopback transport 前拒绝。provider 测试仅启动 localhost mock；拒绝时 HTTP 调用数为 0，无外网模型调用。此前修正测试并保留的中间失败在 `budget-core-green.stdout`, `budget-provider-green.stdout`, `budget-provider-attempt2.stdout`, `provider-attempt3.stdout`；最终绿灯证据不覆盖这些失败记录。

项目 release：初次直接用全局 pi-subagents 的 `npm run test:release` exit 1，原因是安装包目录不能解析宿主 peer `@earendil-works/pi-ai`；未改全局安装。随后在 `/project/tmp/pi-native-lite-pairs/preflight/pi-subagents-isolated/` 建临时包副本并链接已有 0.83.0 dependencies 与 Pi 1.4.0 peers，以 `PI_SUBAGENTS_DIR` 重跑：

```text
cwd=/home/tcuni-claw/pi/pi-planner-only
TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp PI_SUBAGENTS_DIR=/project/tmp/pi-native-lite-pairs/preflight/pi-subagents-isolated env -u PI_SUBAGENT_CHILD npm run test:release
start=2026-10-27T20:53:15+08:00 end=2026-10-27T20:54:00+08:00 exit=0
```

typecheck、isolated-release、contract、git、delegate、host、host-runtime、handoff、status-color、index 全通过。stdout 在 `/project/tmp/pi-native-lite-pairs/preflight/release-isolated4.stdout`。初次 slot cpu 的 release 检查因安装包目录缺 peer 失败；slot audit/status exit 0 已保存为 `release-slot-audit.txt`、`release-slot-status.txt`。通过临时副本/已有依赖 symlink 修复测试解析后重跑耗时 45 秒，exit 0；未改全局安装。

## 启动命令

每个 arm 单独替换 cwd、mode、strict、session ID 和 brief；只有 Root 验收后才执行。所有请求共用已 seed 的账本，**禁止重建或 reset**：

```bash
cd /project/tmp/pi-native-lite-pairs/S1/native
export PI_NATIVE_LITE_BUDGET_LEDGER=/project/tmp/pi-native-lite-pairs/budget-ledger.json
export PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS="$HOME/.pi/agent/npm/node_modules/pi-subagents/bundle/required-child-extensions.js"
env -u PI_SUBAGENT_CHILD \
  PI_PLANNER_ONLY_MODE=native PI_PLANNER_ONLY_STRICT=false \
  PI_PLANNER_ONLY_HANDOFF=off PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS=150000 \
  TMPDIR=/project/tmp/pi-native-lite-pairs/tmp TMP=/project/tmp/pi-native-lite-pairs/tmp TEMP=/project/tmp/pi-native-lite-pairs/tmp \
  pi --approve --mode json --session-dir /project/tmp/pi-native-lite-pairs/results/S1-native/session \
    --session-id p6-S1-native --model tcuni/gpt-6.1-terra --thinking high --no-extensions \
    -e "$HOME/.pi/agent/npm/node_modules/pi-subagents/index.js" \
    -e "$PWD/index.ts" \
    -e /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-comparison/preflight/budget-guard.ts \
    -p "$(<input/brief.md)" \
    > /project/tmp/pi-native-lite-pairs/results/S1-native/session.jsonl \
    2> /project/tmp/pi-native-lite-pairs/results/S1-native/session.stderr
```

Lite 仅切换 `PI_PLANNER_ONLY_MODE=lite PI_PLANNER_ONLY_STRICT=true`；S2 同理并把 Reviewer 输入指向 `input/S2-candidate.diff`。会话、报告和命令日志放在 worktree 外的 `/project/tmp/pi-native-lite-pairs/results/S{1,2}-{native,lite}/`，不写 worktree 的 `.pi` 或 input。不得移动/覆盖已有离线 loader 原始记录。不切换 provider/CLI、不允许 unknown model；exit 73 或 guard 加载错误立即停止后续请求。子 runner 的 mandatory guard 注册需要环境变量 `PI_SUBAGENTS_REQUIRED_CHILD_EXTENSIONS`，不可省略。

## 边界

- Guard 覆盖显式加载它的 Pi provider requests 和 pi-subagents 所有本地 Pi child plans；`requireForAllRunners` 拒绝外部 runner。loopback 测试在 Pi root 及带 child env 的 Pi 进程各验证 provider hook，但**没有**从 parent 发起一次真实 pi-subagents Native/Lite delegation 并穿过 child 模型调用完整链。真实 child path 由 mandatory registration 与 Pi 0.83.0 `resolvePiLaunchToolPlan` 覆盖；Root 可单独复核这一点。
- 该 ledger 是同一 OS 用户权限下的实验护栏，可防并发/意外超支，不能抵抗同 UID child 恶意删除/重建账本，也不监测 Pi 外部自行启动的任意 HTTP/API 客户端。保持实验 brief 只读和 shell scope；若威胁模型包含恶意 child 或其他模型客户端，则不应把它称为 provider 账单硬上限。
- 每请求用最长价格计费并且不退款，会比真实 usage 高估；这正是预留策略。$16 是本机估算 reserve 闸，不是 provider 发票；provider 真账单和本次准备委派仍 unknown。
- 本轮没有改全局配置或加载安装插件，没有 staged files。新文件仅在 `.scratch/native-lite-comparison/preflight/`；隔离包、账本、测试日志、固定 diff 和四份输入副本均在 `/project/tmp/pi-native-lite-pairs/`。
