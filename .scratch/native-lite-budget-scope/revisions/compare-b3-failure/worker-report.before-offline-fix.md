# Native/Lite 对照离线预检

## 状态

旧批次compare-a2的S1-native曾因ledger lock timeout失败并由Root停止；不可重试。其后一次性lock隔离维护获批完成，建立新离线批次compare-b3。Root明确放行compare-b3的S1-native一次，但该臂实际运行后因`invalid-native-completion-identity`失败；已停止compare-b3其余三臂，不重试。两个批次均0有效样本/0完整pair。compare-b3运行后又在共享ledger旁出现新的0字节.lock（inode78027492）；没有授权处理它，未改动。

## 当前臂结果：compare-b3/S1-native

- Root session `nl-20261028T115324-0800-compare-b3-S1-native`，provider `tcuni`、`gpt-6.1-terra`/high。唯一child run `5a8550b7-fd12-4535-9df9-ade4914fdc04`，agent worker，session `01a180ac-120a-72b2-88b8-4f4766c4bf31`，model `tcuni/gpt-6-luna`/medium，终态completed/exit0，child report `/project/tmp/pi-native-lite-20261028T115324+0800/results/compare-b3/S1-native/report.md` SHA256 `21074d78e8cdd4565d6024ef7cce1f95094c1be2c8693de08d9997be5b6b74a1`。报告内容是完整只读调查，但Root没有完成协议要求的最终acceptance。
- Runner wall time 89秒（12:01:37–12:03:06 +08:00）；Pi子进程exit0，但runner/shell exit1、`complete:false`，control最后为`native-receipt-rejected`，failure `invalid-native-completion-identity`。因此该child报告不能计作已验收样本，Root acceptance缺失，S1 pair无效；不自行推测身份字段为何不匹配。
- 实际payload指纹文件`request-fingerprints.jsonl`含21条，8条Terra Root请求、13条Luna child请求；与本臂追加的21条ledger event逐条以sessionId和payload hash匹配。文件SHA256 `b1334ba8cc028d5b7ac959757d3fc3857e301a30b8c71c334f6fecd59459711a`。Root实际assistant usage 8条：input 16,378、output 1,125、cacheRead 93,056、cacheWrite 0、reasoning 104、reported USD0.02665580。Child metadata报告：input 52,745、output 2,806、cacheRead 358,912、cacheWrite 0、reported USD0.01026662。两侧reported合计USD0.03692242；不是发票，未取得provider账单。
- 本控制worker唯一session最新194条unique assistant entries、无cost缺失，reported USD0.45290412，session SHA256 `f9639bf21337bdaec7d741d7e489887ccbefed9379c3c129d6630908afb64d8a`；相对Root launch gate检查点177条/$0.39261972只加增量，不重复叠快照。仍在已分配USD1控制准备额度内。以Root launch gate已知reported小计USD5.86162746为前值，加worker新增USD0.06028440与本臂session reported USD0.03692242，当前可见reported小计约USD5.95883428；排除交互准备/审查Root，不是最终账单。
- ledger由23变44 events，reserved从USD13.27409902升至USD14.78476627，新增请求保守reserve USD1.51066725（Root USD1.216175、child USD0.29449225）。完整ledger SHA256 `da3444382a03d6db8bff5af57a83e7788e1a658ae0c398ce894499333e8b9a31`，checksum `42976aa7f94070549fc07c4b8169e1729cee9732cd514bd7de9e30449f881125`；距当前$16 guard剩USD1.21523373。新增账本reserve和reported usage不相加当费用。
- 本臂raw session SHA256 `a490a9f50b42a293e10d532e901c428343ed68a2612e625a78c0201f1c7771b6`；control `91d42c642bc7dabef2b6935ac70a3fd89f946b475c180168014f53249053869e`；stderr `d93757dad5f6a783d790dacbb2a82c7595ff3f194d5edeb0e01465abced1dde0`；runner meta `4e4d22457a53a6da11e5c1c981369a87667def4069ee59ac8bf8ad024e157bfc`。Pi root session位于`results/compare-b3/S1-native/session/2026-10-28T04-01-37-666Z_nl-20261028T115324-0800-compare-b3-S1-native.jsonl`。
- 启动前真实ledger hash为批准值、23事件，lock路径不存在；启动前冻结hash与new S1-native manifest/brief均匹配。臂后候选仍`f818cc91c98d6129a152fb28161e00d2f601e494`、tracked diff空，输入manifest/brief未见漂移。失败后真实ledger旁出现空lock inode78027492，uid/gid1000，birth/mtime `2026-10-28 12:03:06.908560180 +08:00`，与终止时刻相近；不推断其创建者、不清理、不重试。须交Root决定后续。

## 历史准备与compare-a2记录

## 基线与范围

- cwd `/home/tcuni-claw/pi/pi-planner-only`，hostname `tcuni-claw`，HEAD `e45b9d843acaa79ebbb914325b5a1033592b3f48`。原工作区既有修改和未跟踪内容保留，未改写；cached diff quiet exit 0。
- 新batch `/project/tmp/pi-native-lite-20261028T111239+0800/`，attempt `compare-a2`；候选四臂均为 `f818cc91c98d6129a152fb28161e00d2f601e494`。顺序固定S1-native → S1-lite → S2-lite → S2-native。
- 四个detached worktree均实际HEAD等于候选，write-tree均`9a6e246f8d0007c56685e32f014f0a35643206f0`，tracked diff为空。worktree仅增加brief与diff输入、忽略的`.pi/settings.json`。brief沿用已授权S1/S2正文，只将批次/attempt路径更新并保留Root acceptance契约。
- 修正后S1 brief SHA256 `93eafd9a0ad564818ea136a4921bf91de24db1292ff4fe660d25f93b9395a9fa`；native/lite字节相同。S2 brief SHA256 `1186a574d58fa94f1a2a628359dec1a3dc807e31edfc8bf80801de5c1b5c27cc`；lite/native字节相同。session示例时间戳已按runner规则将`+`替换为`-`，pair/mode占位符保留。公共S2 diff及两臂input均SHA256 `72a2fa5d3a66649aac9426542182378b715874a81cdbabf24e6aeb241282d647`。
- ignored项目配置`.pi/settings.json`四臂相同，SHA256 `c91736f9e6ff90edd1510572f168406f9a26e720ca5b5fa04249f210fcd60065`。child配置为worker/oracle/reviewer `tcuni/gpt-6-luna` medium；reviewer没有bash，oracle有bash；S1恰好worker，S2恰好validator→oracle与reviewer。
- 核心入口：`/project/tmp/pi-native-lite-20261028T111239+0800/manifests/{S1-native,S1-lite,S2-lite,S2-native}.json`，批次runtime lock `config/runtime-lock.json`（最终SHA256 `530e15d0e04d0dec96257dae468edeb01ca4687ed04b5d1cf3340c60c0d75c63`），brief在`briefs/`，common diff在`common/`。四个manifest分别独立绑定候选worktree和输入。manifest完整文件hash：S1-native `42c3e21f29c1356651a772638c24865e4703aaab8b1fbccba586a1ae444ad4fe`，S1-lite `bf4b574dce640f337d21efb38790db2c566f2065a4184b9bd66be49d4b86c938`，S2-lite `7fff3cd5b2bd01aa0d31e56dd7b08ba575332e65d479f77c3d5e7a2c1e106a24`，S2-native `1471fc5a1c6ce42815fb60e04baced40528aa51241cd90843a044240c4379f35`。

## Runtime与runner

- runner最终SHA256 `396e8697680f178a077615538a4a94ab16f87a43b017420521ca7a722c6ec809`，等于最新用户指定值。旧冻结runner hash未沿用。其余冻结源码hash在runtime lock：lifecycle `fd7b684e...67b1f`、observer `c961748b...e42c2`、guard `42153941...fac0d`、guard-core `632b82cc...8268`、fingerprint `1fe6a679...b537`、child extension wrapper `f1752005...c0ef`。本轮不改runner/guard行为。
- runtime lock记录Node v24.14.0、Pi 1.4.0、pi-subagents 0.83.0，models.json SHA256 `a67bf0ecbc613c2ac6cb33f61d2759e8a9b9c449fd3a4519916b7f9f4dcf1fb7`。费率记录来自本机配置（非provider发票）：Terra input/output/cache read/cache write = 1/5/0.05/1.25 USD每百万token；Luna = 0.1/0.5/0.01/0.125。最新离线verify重新逐文件核对现安装Pi与pi-subagents runtime manifests；未安装或reload。
- runtime lock完整hash如上；已更新workspaces四臂树/diff/nonignored files/workspace hash/brief hash/settings hash。S1 workspaces hash均`a3a88e4f5be16d15bb66cdaabd0f434b8d12d40afafd1ea284ed8048c8c1720f`，S2均`7a47fd342507ceb2fa4b8ca77679be5e45a94aab837f1bbb4f76e7c7ef83a922`。前一版lock保存于`config/revisions/pre-root-review-1/runtime-lock.json`，SHA256 `d2519f1ee22732fdcf22e87abf708ce9f4789ffad20768e0bb70c022a8112c65`；旧brief/manifests也保存在同revision目录，旧文件hash见相邻配置。Pi manifest hash `4c384f02f2ea4e45d249332636eab34ec1aa8be11b3446872763aa36a1092dcd`，pi-subagents manifest hash `8bc7442460eb47a83169dba644073000ab41f23fdc44d12225d378818eab4368`。provider正式payload/tool指纹必须在实际启动时采集，离线文件验证不替代实际请求证据。
- Pi源码`dist/config.js:getAgentDir()`优先读取`PI_CODING_AGENT_DIR`，否则使用`homedir()/.pi/agent`。检查时`HOME=/home/tcuni-claw`且该变量unset；runner复制环境并未删除此变量。为消除外部环境漂移，启动命令显式设置`PI_CODING_AGENT_DIR=/home/tcuni-claw/.pi/agent`。实际loaded settings路径锁定为`/home/tcuni-claw/.pi/agent/settings.json`，SHA256 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`。

## 预算核对

- 共享账本仍为原文件 `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json`，23 events、reserved USD13.27409902、SHA256 `6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`。冻结前缀events JSON SHA256 `430bca5f1f124fd76727c6473efab44b77538565168afb50d5e5b892859c526d`。没有预留追加、退款或重建。
- 原控制预留合计USD11.41064652；已知历史控制实际USD5.40165224。本worker唯一session `/project/tmp/pi-native-lite-budget-scope/control-session/218c7347-e6bb-4471-a93e-9929dbefb145/run-0/session.jsonl`，截至隔离锁诊断检查点129 unique assistant message IDs、无cost缺项、reported USD0.25090200，文件SHA256 `71df28a7c4d0388c41f4875ec7bd74ba304731ccd52295751a5512e96244dff6`。该session先前18/42/78/99/105-entry检查点不重复相加；当前费用包含在Root核定的本workerUSD1准备额度内，检查点距限额USD0.74909800。最终由Root按相同唯一entry ID结算后续增量。
- 已知历史reported总额USD5.46900774；最新worker检查点已更新至下方独立诊断/维护阶段。交互准备/审查Root费用按最新授权排除，实验Root计入。reported费用不是最终provider发票。
- 共享ledger reserved距USD16请求停止线USD2.72590098；用户测试总授权上限USD30，排除准备/审查Root、包含实验Root。16是当前保守guard停止线，不是总授权；没有证明四臂全程都能在剩余guard空间内完成，逐臂请求仍由原guard控制，触线停止，不扩guard、不改ledger。

## 命令、日志与检查

- 第一版准备工具原始失败exit1在工具响应中可见，但后续slot rerun覆盖了原定stdout路径；`logs/prepare-batch-initial-failure.transcript.txt`是据原工具响应恢复的转录，明确标注并非原始日志。错误为目录已预建却断言根目录不存在，发生在创建worktree之前。成功重跑原始stdout/meta为`logs/prepare-batch.stdout`、`prepare-batch.meta`，slot cpu exit0，2026-10-28 11:14:12–11:14:14 +08:00。最新准备脚本也改为session示例规范化并生成动态workspaces锁；本批修正使用`refresh-batch.mjs`，exit0，日志`logs/refresh-batch.stdout`和`refresh-batch.meta`。
- Root二次审查发现三处实际配置一致性缺陷：runtime-lock.workspaces为旧批次值、brief session示例未规范化batch `+`、user settings路径未显式冻结；此外旧验证器漏掉这些断言。修复前先写`.scratch/native-lite-budget-scope/preflight-consistency.test.mjs`并针对现有坏配置运行红灯，exit1，4 fail/1 pass（workspace bindings、session示例、loaded settings path及坏workspace故障注入入口均暴露真实断言失败；controller哈希断言通过），原始日志/meta `logs/preflight-consistency-red2.stdout`/`.meta`，日志hash `cf5668525423490e58e5a3c3937592a59a81b0d380117082eaa2bc771f1452fe`。然后实现冻结契约helper，修正当前unstarted batch，保留旧锁/brief/manifests revision，绿灯exit0，5/5通过，包含把workspace hash篡改为全零时断言拒绝的故障注入；日志/meta `logs/preflight-consistency-green.stdout`/`.meta`，stdout hash `1be66e8b81adaa6a74a754d65a3f2cb43bb8fc11eb6f9d84ebfbe79658f98d58`。最终`verify-batch.mjs`重新检查所有manifest/brief/workspace、全部controller文件hash、实际loaded settings、pi/pi-subagents逐文件runtime manifests、账本前缀及输出路径，exit0；日志/meta `logs/verify-batch-final.stdout`/`.meta`，stdout hash `9dc10b36072f6ee4041be83a02c40c11c8a278af289058c6d2733c400b8e5f9b`。旧已验收controller离线20/20复用，不重跑；offline pass不计样本。
- 首臂前四个results目录均无文件；首臂失败后证据仅在S1-native目录，余下三个results目录仍为空。

## S1-native 首臂结果

- 本批唯一启动命令通过slot cpu执行一次，cwd `/project/tmp/pi-native-lite-20261028T111239+0800/worktrees/S1-native`，2026-10-28 11:31:09–11:31:16 +08:00，shell/slot exit 73；20分钟deadline未耗尽。启动前audit/status在`logs/slot-audit-s1-native-launch.log`和`slot-status-s1-native-launch.log`，audit exit0且无绕行重进程。stdout日志`logs/s1-native-launch.stdout`为空，meta `logs/s1-native-launch.meta`记实际cwd/时间/exit。
- runner实际Root session ID `nl-20261028T111239-0800-compare-a2-S1-native`；get_state回报provider `tcuni`、model `gpt-6.1-terra`、thinking high，prompt disposition started。其后provider请求被本地预算guard拒绝：`native-lite budget guard denied provider request: budget ledger lock timeout; fail closed`。Pi process与runner均exit73。没有child（`childRoles:[]`、child usage count0），没有Root acceptance/report，不能算成功或有效样本。
- 原始会话`results/compare-a2/S1-native/session.jsonl` SHA256 `847c0fde5b9e5cdbdcc0144f02735f22f4a6756c7d940fb61d5fc961a8720af7`；内嵌Pi session `/project/tmp/pi-native-lite-20261028T111239+0800/results/compare-a2/S1-native/session/2026-10-28T03-31-10-107Z_nl-20261028T111239-0800-compare-a2-S1-native.jsonl` SHA256 `44921095f956b694ac01b3ff9ebc3b097985e823c48af53a4d0bb1414e10271a`。内嵌session仅有system/user消息，无assistant model message或usage；`subagent-cost.txt`为空SHA256 e3b0c442...b855。此为运行日志usage观察，不能替代provider发票；最终可计费金额保持unknown。
- stderr `results/compare-a2/S1-native/session.stderr` SHA256 `e8fff94f09da1aeac0601f988a5f767869afb446bfdff1044ba4c71f44849f15`；control SHA256 `70bf553e1c952aa71781532e36fcc39fa6ee42335e387b1f5b3a70a94e20a64c`。未生成request-fingerprints.jsonl或runner stdout/stderr/meta，符合请求在fingerprint/provider dispatch前被拒绝的迹象；禁止据此猜测账单为零。slot完成状态记录于`logs/slot-status-s1-native-terminal.log`。
- ledger仍23事件、reserved USD13.27409902、完整hash保持`6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`，最后事件仍旧attempt `nl-20261028T010659-reopen-a1-S1-native`，本次无ledger事件/预留追加。外部已存在的`budget-ledger.json.lock`是0字节、mtime 2026-10-28 09:54，sha256 e3b0c442...b855；它早于本臂且与lock timeout相关，但未擅自删除、覆盖或修复。
- 臂后候选HEAD仍f818cc91c98d6129a152fb28161e00d2f601e494，tracked diff空；brief和S1-native manifest hash仍分别`93eafd9a0ad564818ea136a4921bf91de24db1292ff4fe660d25f93b9395a9fa`及`42c3e21f29c1356651a772638c24865e4703aaab8b1fbccba586a1ae444ad4fe`。runner输入配置未见修改。启动失败即停，不再验证重启或重试。

首臂经Root明确放行后的确定性入口（不是当前启动授权）：

```sh
cd /project/tmp/pi-native-lite-20261028T111239+0800/worktrees/S1-native
env PI_NATIVE_LITE_BATCH_ROOT=/project/tmp/pi-native-lite-20261028T111239+0800 \
  PI_NATIVE_LITE_BATCH_ID=20261028T111239+0800 PI_NATIVE_LITE_ATTEMPT_ID=compare-a2 \
  PI_CODING_AGENT_DIR=/home/tcuni-claw/.pi/agent \
  PI_NATIVE_LITE_SHARED_LEDGER=/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json \
  PI_NATIVE_LITE_MANIFEST=/project/tmp/pi-native-lite-20261028T111239+0800/manifests/S1-native.json \
  PI_NATIVE_LITE_RPC_DEADLINE_MS=1200000 \
  TMPDIR=/project/tmp/pi-native-lite-20261028T111239+0800/tmp \
  TMP=/project/tmp/pi-native-lite-20261028T111239+0800/tmp \
  TEMP=/project/tmp/pi-native-lite-20261028T111239+0800/tmp \
  node --experimental-strip-types /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-lifecycle/run-rpc-arm.mjs
```

runner内部生成Root session ID并使用pi RPC harness，20分钟硬deadline；自行校验输入hash、共享ledger prefix和所有结果文件`wx`不覆盖。此处仅作历史入口记录，不运行。

## 隔离锁诊断

- Root已要求保留失败报告原字节；不可变副本`/project/tmp/pi-native-lite-budget-scope/revisions/failed-batch-acceptance/worker-report.initial.md` SHA256 `eac0662f7e5645a1365b3204665842d1cbb01598b934b91f9be1809355291946`。当前权威报告仅增补独立诊断，未改该副本。
- 新复现脚本`.scratch/native-lite-budget-scope/lock-repro.mjs` SHA256 `a06e6dddc454d378853ce4449bcda98c515d61657f831da0d7cf1dde5a7e5830`直接调用实际`budget-guard-core.mjs:reserveProviderRequest`，使用隔离新建的fixture ledger；没有Pi/provider/harness。每轮将global fetch替换为计数器并断言调用数为0。
- 两次复现命令均exit0（exit0表示断言成功），分别为`PI_NATIVE_LITE_LOCK_REPRO_ROOT=/project/tmp/pi-native-lite-budget-scope/lock-repro-20261028T114000+0800 TMPDIR=... TMP=... TEMP=... node .scratch/native-lite-budget-scope/lock-repro.mjs`与对应`114500+0800`路径。元数据cwd/start/end/exit在各自`logs/lock-repro.meta`，原始JSON在`logs/lock-repro.stdout`。两次均观察无锁对照成功reserve `$0.09226625`，fixture ledger从1.0增至1.09226625/两events；预置0字节`ledger.json.lock`时精确返回`budget ledger lock timeout; fail closed`，fixture ledger before/after SHA相同，fetch计数0。后一次复现还见独立隔离fixture中把lock原子rename为`.quarantine`后同一reserve成功、账本更新，quarantine文件保留。这仅验证隔离fixture，不是对共享真实ledger的恢复授权。
- 第三轮带隔离quarantine恢复的命令exit0，cwd `/home/tcuni-claw/pi/pi-planner-only`，2026-10-28 11:47左右；原始输出`/project/tmp/pi-native-lite-budget-scope/lock-repro-20261028T114700+0800/logs/lock-repro.stdout` SHA256 `a3ba28c945ba70c84dfae0d05f647b1dbb0d3c061abc5c12fea4e2e9c607cb6f`，meta SHA256 `ff88384e4f09adb8b5a1be0224da859cf3b35a15e194f7781526be5be4a95b69`。前两轮原始输出sha为`6d80094984abd9a69572b863272727ecb79958847cc30a415be22708603c724a`和`a76514ad3f6d0955ea9aa47a6819e90ea3dfe0a07fdbc83f2e233a811820483c`。所有fixture在`/project/tmp/pi-native-lite-budget-scope/`，真实ledger及lock未写。
- 代码观察：`withLedgerLock`用`open(path + ".lock", "wx")`尝试500次、每次延迟10ms；已有任意同名文件就等待约5秒后fail closed，不读取owner。只有成功取得lock后进入try/finally并关闭/删除；timeout发生在try之前，故已有文件不被清理。正常回调异常会走finally；进程在成功创建lock后被强制终止则可能无法运行finally，但这只是可能机制，不是本次lock来源证明。
- Root保留的旧真实控制日志中，reopen-a1在2026-10-28 09:54:54.278 +08:00（01:54:54.278Z）记`native-launch-policy-rejected`，09:54:54.289 +08:00（01:54:54.289Z）为真实lock的birth/mtime，09:54:54.332 +08:00（01:54:54.332Z）Pi退出；该次此前有两条fingerprinted请求和两条对应reserve事件。这个11ms时序将lock创建时间定位到旧失败窗口附近，但没有open-file或writer PID证据，不能归因给具体进程/请求。真实lock为空，没有owner内容；Root的`fuser` exit1、无输出仅表示查询时未发现本机打开句柄，不足以证明创建者或安全可删。`/project/tmp`为本地ext4。原0字节lock inode78027473现已依Root批准rename隔离。原preflight只检查ledger字节/hash及manifest，并未检查`.lock`是否存在，因此启动前漏检此阻断条件。

### 假设与恢复

1. **已存在的空lock路径是直接阻断条件（已验证）**：只要同名路径存在，即使空文件、无持有者，实际reserve在约5秒后失败；移除/隔离后fixture reserve成功。此项解释症状，不解释谁创建它。
2. **旧执行在09:54失败窗口创建lock后异常中断（中等可能，未证实）**：预测若同一进程创建lock，lock birth与其reserve attempt吻合，进程terminal显示异常终止；现有时间相关但终态为Pi exit0/runner exit1，缺少guard调用/FD证据，不能确认。
3. **同机其他writer持有/创建lock（较低但尚不能完全排除）**：预测启动前或失败时另有同机runner及其FD；当前`fuser`无输出、ext4本地盘、slot任务已完成反对该项，但查询是事后且不识别文件创建者。
4. **准备流程未检测lock文件**是漏检因素而非根因：当前preflight核对ledger内容却没验证`.lock`不存在；加启动前拒绝可避免发起已知会被拒绝的请求，但不能自动恢复锁。

原建议已按Root授权执行一次：维护前再次检查同uid进程的ledger环境引用、runner命令及ledger/lock文件描述符；进程扫描匹配0。525个同uid进程中11个environ、10个fd目录不可读，Root此前已对这类进程独立分类为systemd/session/ssh/gpg及zombie，维护脚本未输出敏感cmdline/environment。本次实时扫描不能保证未来无writer，故维护限定在所有实验关闭时执行。锁文件rename到quarantine保留inode，不删除；没有调用真实reserve。

## 锁检测修复、维护与新离线批次

- 新增只读守卫`assertLedgerLockAbsent`于`.scratch/native-lite-budget-scope/freeze-contract.mjs`，`verify-batch.mjs`读取真实ledger前调用：仅`lstat`返回ENOENT允许继续；任何现存对象（包括空普通文件、symlink、directory、其他类型）报告路径/type/inode并拒绝；权限或其他I/O错误同样fail closed。未改controller、guard或真实请求路径，不做自动清理/陈旧锁回收。
- 修复前红灯原始命令`TMPDIR=/project/tmp/pi-native-lite-budget-scope/lock-preflight ... node --test .scratch/native-lite-budget-scope/ledger-lock-preflight.test.mjs` exit1，5 fail；函数尚不存在，普通锁、symlink、directory、ENOENT、EACCES用例均失败。日志`/project/tmp/pi-native-lite-budget-scope/lock-preflight/logs/lock-preflight-red-final.stdout` SHA256 `e7ef959ac3fb10a4d1e69956ab03559eb29ac487f9a94ce3e5de78b00cc93150`，meta在同目录。注意最初一次无效红灯因测试fixture互相污染而被排除；此处引用隔离fixture修正后的最终红灯。
- 缺陷也有旧预检行为证据：旧版`verify-batch.mjs`对compare-a2在2026-10-28 11:25的verify exit0日志产生于真实lock被11:53隔离之前，当时真实lock inode78027473已存在；旧验证器仍报告manifests/output检查通过，未检查锁路径。
- 实现后套件exit0，最终7/7通过：ENOENT可继续、空lock拒绝并含inode、symlink拒绝且不follow、directory拒绝、EACCES和EIO均fail closed；另断言verify-batch在读取ledger前调用锁检查。新增文件类型/错误故障注入，没有删弱既有断言。初次6/6绿灯log SHA256 `0be531c7748d682bfbd22ef0476d48b90a021616138843c5072deb2e7569b15d`；最终7/7原始日志在`/project/tmp/pi-native-lite-budget-scope/lock-preflight/logs/lock-preflight-final2.stdout`。维护后新批次实际调用锁检测，最终完整verify exit0、`outputPathsEmpty:true`。
- Root批准的维护脚本`.scratch/native-lite-budget-scope/quarantine-ledger-lock.mjs`在原始lock path/inode/owner/size/hash和ledger完整hash/事件数/预留额匹配后执行一次同文件系统rename。唯一quarantine `/project/tmp/pi-native-lite-budget-scope/quarantine-20261028T120000+0800/lock-quarantine/budget-ledger.json.lock`保留inode78027473、uid/gid1000、0字节及空文件hash。原lock路径现在不存在；ledger前后bytes均5357，23 events、reserved 13.27409902，SHA256仍`6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`。不自动回滚、不删除、未尝试真实预留。完整before/after JSON分别为`.../lock-quarantine/before.json`和`after.json`，hash `568cf9f5430c9044e04a0ce735efd9ed0aa762f7d24bf8d0765d59033fe035ca`及`272a6cf85b0c72b8b44d1f705b6ff6d82e1a401a7d8fa1730f22d9282cc4a505`；脚本原始exit0输出hash `e9167bcd378e4f4355c330a2370c9e9377c9b5ff93475970e06f16b2531677fb`。首次maintenance尝试因quarantine根目录已预建logs而exit1，未改变真实路径；成功动作使用新子目录`lock-quarantine`，meta在`logs/quarantine-retry.meta`。
- 新批次 `/project/tmp/pi-native-lite-20261028T115324+0800/` attempt `compare-b3`，由Root授权的离线准备脚本创建，候选四臂仍同一f818cc91...e494，顺序不变，模型/任务/guard/controller保持前述冻结值。独立verify新增锁路径检查，exit0；ledger仍23事件、13.27409902，prefix events SHA `430bca5f1f124fd76727c6473efab44b77538565168afb50d5e5b892859c526d`。S1 briefs native/lite同字节SHA `87ec6cb933cb65fe9ed7ab6174697ce46c4b057174308a871e92132e48a40797`；S2 native/lite同字节SHA `be4aefa9246b49e63660ba58bd3e4ff5db5f49261655824d60fc683797cc444c`；公共S2 diff SHA `72a2fa5d3a66649aac9426542182378b715874a81cdbabf24e6aeb241282d647`。runtime-lock SHA `506341447eeb94855d57379fa49586534d83b47dd4e9aa7884e97e33f9cf2e71`；manifest hash S1-native `28d7198835b688aa1b700a9e397518eaa42e09e6b371f3dbcaaa3a3429cd3de1`、S1-lite `e66c22814e90caceb5f28d938eabba5311b256ac3dc75e69f335a36ba28b21dd`、S2-lite `2c90091bba1e60329277b93109d33e4d88206e4b73a8349a0d23d2315418f931`、S2-native `b82f0f742240b56d6bf6b4fe53e4c47c9628bf60ac411e52d90a0ef23c84c0f0`。
- 新批次准备日志在`/project/tmp/pi-native-lite-20261028T115324+0800/logs/`：slot audit/status先行，prepare exit0 (11:53:45–11:53:48 +08:00)，final verify exit0 (11:54:00–11:54:01 +08:00)，verify stdout SHA256 `5e553f9b38f4dfd459d59c782a8a703e8d4fc09789af3aef7af3463f4710ccbb`。锁检测最终7/7 exit0，stdout SHA256 `cbd1202c30a5a745127ca1166d5c9040e9daed7e34a20bca382d56e43d9a9d80`。新批次只是离线冻结，所有results路径空；未provider启动。旧失败批次及其证据不改。
- 当前唯一worker session检查点173条unique assistant entries，reported USD0.38187004、无cost缺失，session hash `2d2d69349862943b0788b3a844e6b82c26ad9a8c0789157f08e149ff7de43f06`。不叠加早前检查点；仍在Root划定USD1本worker控制准备额度内，余额约USD0.61812996，非最终账单。

## Root门禁（compare-a2历史停止点）

compare-a2失败后Root停止该批；后续真实lock维护与compare-b3首臂授权分别见后续记录。该段仅保留历史decision context。

## Root门禁（compare-a2诊断阶段历史检查点）

当时仅隔离诊断获批，真实lock尚未隔离；该检查点随后由Root的lock-maintenance-gate.md及compare-b3 launch-gate取代。不能作为当前lock或批次状态。

## Root门禁（compare-b3当前终态）

compare-b3/S1-native已按Root授权启动一次，因`invalid-native-completion-identity`失败。Root acceptance未成立，本臂不计有效样本；本批S1-lite/S2-lite/S2-native取消，不重试。共享ledger新追加21条匹配指纹预留后变为44事件/$14.78476627。失败时另出现inode78027492的0字节ledger lock；没有授权处置，必须留存并停止，不启动其他臂或新请求。请Root验收本臂原始证据，并明确后续授权；本worker不继续自动化执行。
