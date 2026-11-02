# subagent-split-check 项目日志

## P2 handoff：第五次运行错误，停止

重启正式第 5 次 T2b treat rep=1：`bench/run.sh` exit=4，eval pass=true，但 native evidence collection failed，原始错误 `child assistant error`。原始 root transcript 另含 `tcuni API error (502): {"message":"Upstream service temporarily unavailable","type":"upstream_error"}`；worker `bcdd4495-d275-4029-9048-5ff492927c98` transcript 同样记录该 502。两次 async worker 的 artifacts/session/status 与原始运行、STOP 已冻结至 `/project/tmp/ppo-p2/restart-formal-05-recovery/`，`SHA256SUMS` 校验通过。不能将 eval pass 当有效样本；actual attempt spend 为 null，只有 root known lower bound $1.055255。前四正式运行及两批 pilot 已确认累计 $1.15094988，加本次已知下界至少 $2.20620488；实际总费用未知。按用户指示不继续第 6 次、不重试、不等待 Root，交接见 `p2-checkpoint.md`。

## P2 正式第三样本 status 分类恢复

Root 已验收 T3 treat 原样本的离线重分析并纳入：历史 invalid 与 reanalysis valid 并列保留，eval pass；累计 $0.73359708。Root 允许归档此解析缺口 STOP，继续固定顺序第 4 至 6 次。

T3 treat rep=1 原运行 exit=4、eval pass=true/valid=false，STOP `native subagent x1: launched subagent has no terminal child results`。经原始 `tool_execution_start.args.action=status` 与对应 call ID 核实这是同一已启动 worker 的观察调用，返回 mode=single/results=[]，非新启动。冻结 `/project/tmp/ppo-p2/restart-formal-03-recovery/` 和 SHA256SUMS；原始 eval 与 STOP 不改。单独重分析 runcheck valid=true；Root terra 36 轮 $0.15377，worker terra 18 轮 $0.152865，合计 $0.306635；worker input=74088/output=8069/cacheRead=768640/cacheWrite=0，session 与 terminal usage 一致。含旧批次、重启 pilot、正式1至3累计 $0.73359708。Root 待核验。

脱敏真实 fixture 先红 `/project/tmp/ppo-p2/status-red.log` 后绿 `status-green.log`；未知 action、resume、错 ID、缺终态和错 call ID 故障注入 `status-faults.log`，额外 status 响应与 launch call ID 矛盾红绿 `status-identity-red.log`/`status-identity-green.log`。完整回归 `/project/tmp/ppo-p2/status-identity-suite.log`：41 native + 3 guidance 通过；中间回归失败原样保留在 `status-suite.log`、`status-suite-final.log`。只把绑定的 status/list 视为观察，未知 action/resume 失败关闭；既有 list fixture 和无标识历史 management 兼容保持。

## P2 正式首样本通知终态恢复

Root 已验收并纳入第 1 次 G1 treat：原 harness verdict invalid 与独立 reanalysis valid 并列保留，eval pass，不是重跑或额外样本。累计 $0.34437008；Root 允许归档由该解析缺口产生的 STOP 并按固定顺序继续第 2 至第 6 次。

按 Root 放行后，固定顺序首个 G1 treat rep=1 运行退出 4，原 eval pass=true/valid=false，STOP `native subagent x1: nonterminal/asynchronous subagent result`；未重试。原始文件不变，冻结 `/project/tmp/ppo-p2/restart-formal-01-recovery/`（SHA256SUMS 已校验）。实际 `subagent-notify` 的结构化 runId/asyncDir/session 与 launch、status 的 toolCallId/step/session/process terminal 绑定，引用的 terminal metadata 和逐轮 transcript 独立验证后可离线结算；Root terra 11 轮，worker terra 8 轮无嵌套，worker input=11201、output=2153、cacheRead=60416、cacheWrite=0。单独重分析 bundle `/project/tmp/ppo-p2/restart-formal-01-reanalysis-bundle`，runcheck valid=true，Root $0.0338928、child $0.0249868，共 $0.0588796；加旧批次及重启 pilot 累计 $0.34437008。原 eval 仍 invalid，是否纳入由 Root 决定。红绿 `/project/tmp/ppo-p2/notify-red.log`、`notify-green.log`，故障注入 `notify-faults-final.log`；完整 suite `/project/tmp/ppo-p2/notify-suite.log`（40 native + 3 guidance）。支持已验证的 single `bg_wait` completion 和 structured `subagent-notify`；文档中的普通 status/fleet 是管理/观察 API，不将状态文本或仅 status.complete 视为终态证据，未证明的其他异步形态继续拒绝。等待 Root 验收和继续放行。

## P2 用户授权重启

用户明确授权重新运行唯一一次 G1 luna pilot `p2-restart-luna-01` 和 12 次 terra 正式对照 `p2-restart-terra-01`。旧批次原样保留、排除分析，$0.2527056 计入累计。全局 settings SHA-256 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`，专用 settings 与快照 SHA-256 均为 `166e4afe5012a97cffc4424ba734d779ab663226771b48b0d63418b642824b5a`。继续跳过付费健康检查、不重试、每次结算。

重启 pilot `p2-restart-luna-01`：离线 Native 工具探针成功；正式入口退出 4，eval pass=true 但 valid=false。原始 STOP：`native subagent x1: failed child result; native subagent x1: nonterminal/asynchronous subagent result`。Root 发起一次 worker 异步调用，status 曾报模型 `tcuni/gpt-6.1-terra`；现有采集没有可结算终态 child 证据，actual summary 的 total 为 null，Root 已知下界 $0.00658888 不能代替总费用。旧批次 $0.2527056 加新 pilot 后总额未知，立即停止，不进行正式运行或重试。完整结果 `/project/tmp/ppo-bench/results/p2-restart-luna-01/`，分析 `/project/tmp/ppo-p2/restart-pilot-summary.json`、`restart-pilot-guidance.log`、`restart-pilot-command.log`。非目标测试变化仅为 pycache。等待 Root 核验。

离线恢复：冻结主记录、异步目录、完整 worker session、terminal metadata/transcript 与 archive 于 `/project/tmp/ppo-p2/restart-pilot-recovery/`，`SHA256SUMS` 校验通过。主 transcript 的 `bg_wait.details.completions` 含同一 runId、child metadata 和 transcript；metadata/转录/session 核对结果 worker terra，input=11587、output=2397、cacheRead=52480、cacheWrite=0，7 轮最终 stop、无嵌套；Root 11 轮均 luna。新增异步单 child 终态兼容，脱敏真实结构 fixture、缺失/错 ID/重复/篡改/截断故障注入；红绿及套件见 `/project/tmp/ppo-p2/async-{red,green,faults-red,faults-green,empty-red,empty-green,suite-final}.log`，38 native + 3 guidance 通过。单独重分析 `/project/tmp/ppo-p2/restart-pilot-reanalysis-bundle` 及 `restart-pilot-reanalysis.json`：runcheck valid=true，Root $0.00658888 + child $0.026196 = $0.03278488；加旧批次累计 $0.28549048。原 eval 和原始 STOP 未改，摘要仍保留 historical eval.valid=false，不自动追认；等待 Root 核验和正式放行。

## P2 环境失效与离线修复

Root 已独立验收离线修复；付费重跑仍需用户明确授权。原始失效批次与累计费用 $0.2527056 保留。

Root 确认停止付费并隔离 pilot + 6 次正式运行，全部不用于 H1/H2 和采纳结论；费用累计 $0.2527056，详细逐次账本见 `p2-report.md`。所有 harness valid 不代表实验条件有效：被测 Root 继承了 `PI_SUBAGENT_CHILD=1`，导致 Native 主工具未注册；T2b base 原始 transcript 明确报告无委派工具。前几个 base 无委派即失败时未人工追查，是监测遗漏。

只变更该变量的离线真实 Pi 工具列表在 `/project/tmp/ppo-p2/tools-child.log` 和 `tools-root.log`；前者只有内建读写工具，后者包含 `subagent`。未检测到 `PI_SUBAGENTS_HERDR_BRIDGE` 在当前环境设置，但它会切换扩展加载路径，因此独立 Root 同时清除该变量。bench 新增启动前离线工具探针，置于健康检查之前；失败关闭。实际启动路径注入两个变量的红灯 `/project/tmp/ppo-p2/root-guard-red.log`，绿灯 `/project/tmp/ppo-p2/root-guard-green.log`，缺标记/非零/超时等故障注入 `/project/tmp/ppo-p2/root-guard-faults.log`；isolated agent 覆盖防护红绿为 `agent-override-red.log` / `agent-override-green.log`。真实 dry-run `/project/tmp/ppo-p2/fixed-real-dry-run.log`，回归 `/project/tmp/ppo-p2/guard-suite.log`（native 36、guidance 3 通过）。settings 前后哈希仍为 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`。付费续跑须用户另行授权。

## P2 配置验收及 pilot 准备

Root 已验收隔离方案。实验 settings 快照 `p2-settings.json` 和 `/project/tmp/ppo-p2/agent/settings.json` SHA-256 均为 `166e4afe5012a97cffc4424ba734d779ab663226771b48b0d63418b642824b5a`；全局 settings SHA-256 为 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`。离线发现结果 `/project/tmp/ppo-p2/discovery.json` 确认六个外部 CLI 角色禁用及目标模型映射。禁用付费健康检查；单次尝试，无重试。费用初始 $0。

Pilot `p2-20261029-luna-pilot-01`：`slot cpu -- env ... bench/run.sh G1 native-luna-pilot 1` 退出 0，完整输出 `/project/tmp/ppo-p2/pilot-command.log`；eval pass/valid 均为 true，91 秒。实际 Root 的 15 条 assistant 记录均为 tcuni/gpt-6-luna，未发生委派，不能验证实际 child 加载或模型。`summarize.py --weight actual` 确认 Root $0.0073222、child $0、累计 $0.0073222，未见缺失或未定价用量；原始汇总 `/project/tmp/ppo-p2/pilot-summary.json` 和 `pilot-summary.log`，guidance `/project/tmp/ppo-p2/pilot-guidance.log`，reviews 均为 0。全局和实验 settings 运行后哈希不变。正式随机顺序 dry-run `/project/tmp/ppo-p2/formal-order.log`，尚未运行，等待 Root 放行。

## P2 离线预算检查

- 未启动付费运行，费用 $0；pilot 0/1，正式样本 0/12。
- `node --input-type=module -e "await import('/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js'); console.log('native extension import OK')"`，退出 0，输出 `native extension import OK`。
- `PI_OFFLINE=1 pi -ne -e /home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents/index.js --no-session --mode rpc </dev/null`，退出 0，无输出；仅检查加载，不证明子代理运行时动态加载。
- `python3 -B bench/test_guidance_metrics.py`，退出 0，3 tests OK；输出 `/project/tmp/ppo-p2/guidance-tests.log`。以上命令均显式设置 TMPDIR、TMP、TEMP 到 `/project/tmp/ppo-p2` 或 `/project/tmp/ppo-bench`。
- `~/.pi/agent/settings.json` 前后 SHA-256 均为 `335a650100ae9178fe4c3ae021eadcb0d419c5f72b90a4a2acdd70004708d5b7`，未修改。
- `bench/run-body.sh:165` 仅提供时间限制，终态后才收集子代理证据；`bench/summarize.py:97-98` 在不完整时不能确定总费用。安装的 pi-subagents `docs/tool-reference.md:111-112` 说明 usageBudget 不预留且不停止已运行的子代理，toolBudget 只限制工具调用；`docs/configuration.md:467-497` 的并发和派生次数限制不是美元限额。详见 `p2-report.md`。

## 2026-10-29T14:03:26+08:00 slot 预检（全量 Root 缓存分析前）

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 56.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 346   CPU权重 50

=== 池 io（6 槽）===
3087 finished   /project/tmp/slot/ts-out.sl3eNX 0        224.31/11.83/0.72 [mouse-e116-model-review-fixture]/home/tcuni-claw/.local/share/slot/jobs/1793242811-220915-2139.sh
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh

=== 池 cpu（16 槽）===
4048 finished   /project/tmp/slot/ts-out.9uQvnh 0        72.09/56.79/39.44 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252712-2096306-12513.sh
4053 finished   /project/tmp/slot/ts-out.7AQkA2 0        6.09/7.08/0.77 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252828-2133121-31764.sh
4056 finished   /project/tmp/slot/ts-out.R70rvT 0        0.87/3.86/0.09 [LQL008-v5compat-B73V4_ctg6]/home/tcuni-claw/.local/share/slot/jobs/1793252963-2163293-18404.sh
4058 finished   /project/tmp/slot/ts-out.lMRW2K 0        178.08/58.71/2.65 [LQL008-v5compat-Chr10]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163584-4201.sh
4059 finished   /project/tmp/slot/ts-out.a2Rs79 0        211.17/71.19/3.04 [LQL008-v5compat-Chr2]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163782-31962.sh
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## 2026-10-29T14:04:32+08:00 全量分析

会话目录在本地 nvme（非 /data_0），用 slot cpu。命令：
```
slot cpu -- python3 -B bench/root_cache.py ~/.pi/agent/sessions --json /project/tmp/ppo-root-cache/all-native.txt
slot cpu -- python3 -B bench/root_cache.py ~/.pi/agent/sessions --mode any --json /project/tmp/ppo-root-cache/all-any.json
```

结果（初版，含 fork 子会话，作废待重跑）：native 1500 文件 / 2848 轮，耗时 2.5s；any 39141 轮。
发现：`forks/` 下 6 个 fork 子代理会话复制了父会话历史并带 native 标记，贡献 686 轮（含 subagent/5-60m 41 轮，全为 tcuni/gpt-6-astra）。`run-N/` 子运行 875 个，不带模式标记，仅影响 --mode any。开 issue 03 修正后重跑。

## 2026-10-29T14:06:31+08:00 slot 预检（issue 03 后重跑）
```
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
=== heavy.slice 资源用量 ===
  内存 58.4G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 287   CPU权重 50

```
重跑完成：native/any 输出见 /project/tmp/ppo-root-cache/all-{native,any}.{txt,json}

## 2026-10-29T14:08:21+08:00 报告

结论写入 `root-cache-report.md`。Claude 细分与长保留期估算用临时脚本 `/project/tmp/ppo-root-cache/claude_gaps.py`（slot cpu，native/any 各一次）。probe/ 已删除。

## G1 preflight 2026-10-29T14:36:57+08:00

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 60.7G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 241   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## T3 preflight 2026-10-29T14:36:58+08:00

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 60.5G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 241   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## T2b preflight 2026-10-29T14:37:57+08:00

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 36.6G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 239   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## release preflight 2026-10-29T14:41:53+08:00

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 40.0G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 240   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## final release preflight 2026-10-29T14:44:32+08:00

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 23.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 242   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4055 finished   /project/tmp/slot/ts-out.21MZ4D 0        232.71/108.64/4.00 [prod_run002-select_strict2]/home/tcuni-claw/.local/share/slot/jobs/1793252960-2162559-28960.sh
4065 finished   /project/tmp/slot/ts-out.l8PKEs 0        3.05/4.07/0.11 [prod_run002-select_strict2-check]/home/tcuni-claw/.local/share/slot/jobs/1793253217-2211952-16396.sh
4060 finished   /project/tmp/slot/ts-out.xSuzAr 0        264.45/92.88/3.88 [LQL008-v5compat-Chr3]/home/tcuni-claw/.local/share/slot/jobs/1793252967-2164467-7015.sh
4057 finished   /project/tmp/slot/ts-out.8rvJ2r 0        362.51/136.14/5.59 [LQL008-v5compat-Chr1]/home/tcuni-claw/.local/share/slot/jobs/1793252964-2163422-4882.sh
4062 finished   /project/tmp/slot/ts-out.6Ha6lr 0        167.79/73.38/2.82 [LQL008-v5compat-Chr5]/home/tcuni-claw/.local/share/slot/jobs/1793253176-2203068-15905.sh
4061 finished   /project/tmp/slot/ts-out.VvmBWN 0        240.86/102.09/3.97 [LQL008-v5compat-Chr4]/home/tcuni-claw/.local/share/slot/jobs/1793253142-2196849-8282.sh
4068 finished   /project/tmp/slot/ts-out.VcdqV2 0        153.53/65.32/2.61 [LQL008-v5compat-Chr6]/home/tcuni-claw/.local/share/slot/jobs/1793253233-2215727-28726.sh
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
560  finished   /project/tmp/slot/ts-out.MRtAgf 1        10.51/20.10/3.50 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026]/home/tcuni-claw/.local/share/slot/jobs/1792989760-560120-19058.sh
561  finished   /project/tmp/slot/ts-out.Qwe1c7 1        468.49/478.30/29.98 [nipponbare-r498-tc-by-rice-6k-stage1-smoke-20261026-a2]/home/tcuni-claw/.local/share/slot/jobs/1792989808-566422-21040.sh
562  finished   /project/tmp/slot/ts-out.PTdhUN 1        3.49/14.29/0.69 [qk383-vcf-stub]/home/tcuni-claw/.local/share/slot/jobs/1792994926-1125718-17607.sh
563  finished   /project/tmp/slot/ts-out.NIueEr 1        3.46/14.04/0.61 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995073-1140089-5222.sh
564  finished   /project/tmp/slot/ts-out.U4s2FC 0        97.79/300.20/18.04 [qk383-vcf-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995100-1142898-187.sh
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
```

## P2 隔离测试 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 40.9G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 254   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
566  finished   /project/tmp/slot/ts-out.0ZkmBF 0        2547.36/21139.19/945.70 [qk383-fastq-entry]/home/tcuni-claw/.local/share/slot/jobs/1792995919-1229995-26837.sh
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
```

## P2 pilot slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 52.7G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 283   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4054 finished   /project/tmp/slot/ts-out.TozqAM 0        594.56/583.59/35.61 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793252871-2142827-20967.sh
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 1 G1-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 45.1G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 310   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4069 finished   /project/tmp/slot/ts-out.fQx6gJ 0        142.72/62.34/2.76 [LQL008-v5compat-Chr7]/home/tcuni-claw/.local/share/slot/jobs/1793253327-2235415-2247.sh
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 2 G1-base slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 39.5G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 251   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 3 T3-base slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 40.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 246   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 4 T3-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 46.1G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 252   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 5 T2b-base slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 42.2G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 250   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 formal 6 T2b-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 33.6G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 258   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4071 finished   /project/tmp/slot/ts-out.1pUARZ 0        109.29/47.60/2.18 [LQL008-v5compat-Chr9]/home/tcuni-claw/.local/share/slot/jobs/1793253385-2246062-18763.sh
4070 finished   /project/tmp/slot/ts-out.GLYIHN 0        154.22/72.68/3.15 [LQL008-v5compat-Chr8]/home/tcuni-claw/.local/share/slot/jobs/1793253345-2238498-22481.sh
4076 finished   /project/tmp/slot/ts-out.fV1khZ 0        0.98/0.71/0.04 [prod_run002-v5-cr090-merge]/home/tcuni-claw/.local/share/slot/jobs/1793253560-2279298-13154.sh
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
567  finished   /project/tmp/slot/ts-out.udHAk4 0        4.91/18.63/0.81 [qk383-fastq-resume]/home/tcuni-claw/.local/share/slot/jobs/1792998860-1634624-14204.sh
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
```

## P2 guard 回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 28.2G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 187   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4077 finished   /project/tmp/slot/ts-out.DSf8Se 0        0.64/0.58/0.01 [prod_run002-v5-cr090-check]/home/tcuni-claw/.local/share/slot/jobs/1793253585-2284761-2151.sh
4078 finished   /project/tmp/slot/ts-out.EokMlb 0        14.05/9.08/1.28 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253670-2301227-775.sh
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart pilot slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 30.8G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 184   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4080 finished   /project/tmp/slot/ts-out.2IODpq 0        4.61/3.77/0.37 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253681-2303421-10729.sh
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 async recovery slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 38.1G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 181   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 async 回归最终 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 51.4G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 176   CPU权重 50

=== 池 io（6 槽）===
3084 finished   /project/tmp/slot/ts-out.dojvcL 0        401.20/60.38/5.59 [TC-SXAU-pan-YM158]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199629-6362.sh
3082 finished   /project/tmp/slot/ts-out.l4J9bN 0        402.64/61.19/5.55 [TC-SXAU-pan-XY6]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199433-4715.sh
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh

=== 池 cpu（16 槽）===
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 async 冲突回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 50.9G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 179   CPU权重 50

=== 池 io（6 槽）===
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh

=== 池 cpu（16 槽）===
4082 finished   /project/tmp/slot/ts-out.OUgPAp 0        53.41/61.05/4.20 [mouse-e116-ann-01]/home/tcuni-claw/.local/share/slot/jobs/1793253770-2320112-21145.sh
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart formal 1 G1-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 51.4G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 177   CPU权重 50

=== 池 io（6 槽）===
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh

=== 池 cpu（16 槽）===
4081 finished   /project/tmp/slot/ts-out.ryEyMX 0        601.81/578.15/35.92 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253726-2311260-15650.sh
4090 finished   /project/tmp/slot/ts-out.Ut7mQa 1        2.78/2.12/0.41 [mouse-e116-g2-02]/home/tcuni-claw/.local/share/slot/jobs/1793254401-2445394-639.sh
3994 finished   /project/tmp/slot/ts-out.wDEojV -1       6071.46/5768.18/39.23 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793249274-1448558-10872.sh
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 notify 回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 61.8G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 179   CPU权重 50

=== 池 io（6 槽）===
3083 finished   /project/tmp/slot/ts-out.NN8zQQ 0        406.99/59.83/5.39 [TC-SXAU-pan-JM22]/home/tcuni-claw/.local/share/slot/jobs/1793242717-199518-5818.sh
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart formal 2 G1-base slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 53.4G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 174   CPU权重 50

=== 池 io（6 槽）===
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart formal 3 T3-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 47.2G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 179   CPU权重 50

=== 池 io（6 槽）===
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 status 分类回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 63.7G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 184   CPU权重 50

=== 池 io（6 槽）===
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 status 分类兼容回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 63.5G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 176   CPU权重 50

=== 池 io（6 槽）===
3089 finished   /project/tmp/slot/ts-out.sZh6LI 1        2.86/0.51/0.48 [LQL008-blastdb-identity001]/home/tcuni-claw/.local/share/slot/jobs/1793243159-291727-31062.sh
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 status 最终回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 50.5G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 201   CPU权重 50

=== 池 io（6 槽）===
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh
3171 finished   /project/tmp/slot/ts-out.eOo2Qa 0        576.71/86.66/63.16 [nmu-ssr-step2-preflight]/home/tcuni-claw/.local/share/slot/jobs/1793265970-469146-25103.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 status 身份回归 slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 47.0G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 177   CPU权重 50

=== 池 io（6 槽）===
3090 finished   /project/tmp/slot/ts-out.G64qvP 1        0.05/0.02/0.01 [TC-SXAU-layout-final]/home/tcuni-claw/.local/share/slot/jobs/1793243193-298557-5818.sh
3091 finished   /project/tmp/slot/ts-out.Mo72Xl 0        124.57/69.56/13.88 [TC-SXAU-step2a-prepare]/home/tcuni-claw/.local/share/slot/jobs/1793244687-598003-28363.sh
3096 finished   /project/tmp/slot/ts-out.gZQcqA 0        54.74/9.59/4.76 [TC-SXAU-step2a-candidate]/home/tcuni-claw/.local/share/slot/jobs/1793245661-788926-6832.sh
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh
3171 finished   /project/tmp/slot/ts-out.eOo2Qa 0        576.71/86.66/63.16 [nmu-ssr-step2-preflight]/home/tcuni-claw/.local/share/slot/jobs/1793265970-469146-25103.sh

=== 池 cpu（16 槽）===
4079 finished   /project/tmp/slot/ts-out.b4NzRI -113     1917.71/1065.92/23.66 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793253672-2301731-28195.sh
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart formal 4 T3-base slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 35.3G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 236   CPU权重 50

=== 池 io（6 槽）===
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh
3171 finished   /project/tmp/slot/ts-out.eOo2Qa 0        576.71/86.66/63.16 [nmu-ssr-step2-preflight]/home/tcuni-claw/.local/share/slot/jobs/1793265970-469146-25103.sh
3173 finished   /project/tmp/slot/ts-out.jhj8mK 1        1.21/0.43/0.10 [nmu-ssr-step3-s1-integration]/home/tcuni-claw/.local/share/slot/jobs/1793266931-648092-3017.sh
3174 finished   /project/tmp/slot/ts-out.r6kLM2 0        5.83/4.19/0.40 [nmu-ssr-step3-s1-integration]/home/tcuni-claw/.local/share/slot/jobs/1793267100-679683-6972.sh
3175 finished   /project/tmp/slot/ts-out.P0tgSw 0        8.01/4.17/0.29 [nmu-ssr-step3-s1-final-integration]/home/tcuni-claw/.local/share/slot/jobs/1793267347-726109-9476.sh

=== 池 cpu（16 槽）===
4091 finished   /project/tmp/slot/ts-out.z33Sru 0        907.34/469.07/20.13 [prod_run002-select_A2]/home/tcuni-claw/.local/share/slot/jobs/1793255628-2667829-1554.sh
4097 finished   /project/tmp/slot/ts-out.6S1Yv8 0        2.74/3.59/0.18 [prod_run002-select_A2-check]/home/tcuni-claw/.local/share/slot/jobs/1793256569-2814935-16491.sh
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh
4154 finished   /project/tmp/slot/ts-out.dYzLFt 0        2.74/3.31/0.25 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793267317-720538-30619.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
568  finished   /project/tmp/slot/ts-out.uExwyj 1        4.42/15.53/1.27 [qk383-bam-entry]/home/tcuni-claw/.local/share/slot/jobs/1792998902-1639565-4825.sh
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
```

## P2 restart formal 5 T2b-treat slot 预检

```
$ slot audit
PID      RSS         CPU%  COMM             状态

没发现绕过 slot 的重进程。
$ slot status
=== heavy.slice 资源用量 ===
  内存 26.9G 已用 / 64.0G 软限 / 76.0G 硬顶   swap上限 0.0G   进程 11   CPU权重 50

=== 池 io（6 槽）===
3098 finished   /project/tmp/slot/ts-out.oYgBnv 0        35.62/9.42/0.51 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245903-835888-18514.sh
3100 finished   /project/tmp/slot/ts-out.Jbs5Mb 0        12.76/1.54/0.15 [io]/home/tcuni-claw/.local/share/slot/jobs/1793245972-847498-7870.sh
3102 finished   /project/tmp/slot/ts-out.pr8GWc 0        166.71/18.59/2.06 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246077-868694-15669.sh
3103 finished   /project/tmp/slot/ts-out.VHB4yu 0        22.31/9.73/0.52 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246288-908722-20036.sh
3104 finished   /project/tmp/slot/ts-out.7ECQbR 0        40.05/17.50/1.53 [io]/home/tcuni-claw/.local/share/slot/jobs/1793246427-937602-972.sh
3092 finished   /project/tmp/slot/ts-out.HcpWxx 0        2477.59/2157.86/1892.40 [io]/home/tcuni-claw/.local/share/slot/jobs/1793244871-632678-27015.sh
3109 finished   /project/tmp/slot/ts-out.FZtHW5 0        730.51/38.30/40.77 [mouse-e116-sequence-full]/home/tcuni-claw/.local/share/slot/jobs/1793247878-1193543-18969.sh
3110 finished   /project/tmp/slot/ts-out.iA5epf 0        67.71/43.88/2.88 [mouse-e116-translation-full]/home/tcuni-claw/.local/share/slot/jobs/1793248653-1334367-8921.sh
3112 finished   /project/tmp/slot/ts-out.4vFoXP 0        388.93/62.00/5.78 [TC-SXAU-step2b-parent-sha]/home/tcuni-claw/.local/share/slot/jobs/1793249396-1471420-31520.sh
3111 finished   /project/tmp/slot/ts-out.MFqfHS 0        2116.83/496.85/78.41 [mouse-e116-features-full]/home/tcuni-claw/.local/share/slot/jobs/1793248777-1357853-14692.sh
3108 finished   /project/tmp/slot/ts-out.d5aABM 0        4417.83/3445.28/488.27 [nmu-ssr-b000-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793247852-1188318-30590.sh
3137 finished   /project/tmp/slot/ts-out.AZBGDu 1        1.40/0.32/0.17 [nmu-ssr-b001-b011-diagnostic]/home/tcuni-claw/.local/share/slot/jobs/1793253044-2176641-6560.sh
3139 finished   /project/tmp/slot/ts-out.hJAm77 0        993.16/15.48/7.71 [mouse-e116-iupac-01]/home/tcuni-claw/.local/share/slot/jobs/1793253099-2188468-7187.sh
3114 finished   /project/tmp/slot/ts-out.FOatoo 0        11552.06/647.92/161.62 [mouse-e116-relationships-01]/home/tcuni-claw/.local/share/slot/jobs/1793251031-1774472-6060.sh
3151 finished   /project/tmp/slot/ts-out.XRYK4G 0        55.30/107.91/7.92 [mouse-e116-snpeff-dump-04]/home/tcuni-claw/.local/share/slot/jobs/1793255989-2726767-29693.sh
3166 finished   /project/tmp/slot/ts-out.bYk8K6 0        428.13/251.65/31.13 [TC-SXAU-3a-check188]/home/tcuni-claw/.local/share/slot/jobs/1793264046-100921-6203.sh
3171 finished   /project/tmp/slot/ts-out.eOo2Qa 0        576.71/86.66/63.16 [nmu-ssr-step2-preflight]/home/tcuni-claw/.local/share/slot/jobs/1793265970-469146-25103.sh
3173 finished   /project/tmp/slot/ts-out.jhj8mK 1        1.21/0.43/0.10 [nmu-ssr-step3-s1-integration]/home/tcuni-claw/.local/share/slot/jobs/1793266931-648092-3017.sh
3174 finished   /project/tmp/slot/ts-out.r6kLM2 0        5.83/4.19/0.40 [nmu-ssr-step3-s1-integration]/home/tcuni-claw/.local/share/slot/jobs/1793267100-679683-6972.sh
3175 finished   /project/tmp/slot/ts-out.P0tgSw 0        8.01/4.17/0.29 [nmu-ssr-step3-s1-final-integration]/home/tcuni-claw/.local/share/slot/jobs/1793267347-726109-9476.sh

=== 池 cpu（16 槽）===
4099 finished   /project/tmp/slot/ts-out.h640ta 0        504.94/80.05/5.94 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840917-29772.sh
4100 finished   /project/tmp/slot/ts-out.TmmV0b 0        7.58/9.27/0.79 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257346-2948542-13589.sh
4098 finished   /project/tmp/slot/ts-out.sVXgaC 0        970.24/446.88/15.81 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793256744-2840892-29358.sh
4102 finished   /project/tmp/slot/ts-out.WWosSn 0        118.54/115.32/2.58 [nmu-ssr-step2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793257824-3040278-26355.sh
4101 finished   /project/tmp/slot/ts-out.OAMULB 0        558.13/559.19/30.51 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793257702-3015012-20769.sh
4104 finished   /project/tmp/slot/ts-out.oTleaC 0        147.43/121.06/2.92 [nmu-ssr-step2-ab-final]/home/tcuni-claw/.local/share/slot/jobs/1793259179-3319911-28335.sh
4106 finished   /project/tmp/slot/ts-out.i2aFXg 0        159.95/123.04/3.50 [nmu-ssr-step2-ab-final2]/home/tcuni-claw/.local/share/slot/jobs/1793259458-3375263-4220.sh
4115 finished   /project/tmp/slot/ts-out.5BPHai 1        91.46/77.97/1.53 [nmu-ssr-step2-c1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793260865-3675862-867.sh
4117 finished   /project/tmp/slot/ts-out.U8frYp 0        17.94/18.10/8.41 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261122-3725364-21641.sh
4116 finished   /project/tmp/slot/ts-out.huVjtV 0        135.16/123.00/3.71 [nmu-ssr-step2-c1-final]/home/tcuni-claw/.local/share/slot/jobs/1793261028-3705767-16026.sh
4120 finished   /project/tmp/slot/ts-out.Gwwx1a 0        4.47/0.09/0.02 [LQL008-B73V4-remote-import]/home/tcuni-claw/.local/share/slot/jobs/1793261323-3768382-29634.sh
4121 finished   /project/tmp/slot/ts-out.oZ6EQh 6        37.88/0.12/0.04 [LQL008-B73V4-VCF-import]/home/tcuni-claw/.local/share/slot/jobs/1793261533-3809996-20500.sh
4118 finished   /project/tmp/slot/ts-out.fjADAo 0        543.87/546.95/28.64 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793261165-3736933-812.sh
4129 finished   /project/tmp/slot/ts-out.2wAEM7 0        162.30/149.38/5.38 [nmu-ssr-step2-c2-regression]/home/tcuni-claw/.local/share/slot/jobs/1793262910-4074978-29754.sh
4138 finished   /project/tmp/slot/ts-out.pXlVlw 0        43.74/0.12/0.05 [LQL008-B73V4-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793263860-63969-23053.sh
4136 finished   /project/tmp/slot/ts-out.qQdlqV 0        163.38/149.28/5.70 [nmu-ssr-step2-c2-final-v2]/home/tcuni-claw/.local/share/slot/jobs/1793263782-47332-16631.sh
4142 finished   /project/tmp/slot/ts-out.fZlyJ1 0        25.00/0.11/0.02 [LQL008-B73V5-renamed-import]/home/tcuni-claw/.local/share/slot/jobs/1793264084-110027-5122.sh
4154 finished   /project/tmp/slot/ts-out.dYzLFt 0        2.74/3.31/0.25 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793267317-720538-30619.sh
4155 finished   /project/tmp/slot/ts-out.b73KJq 0        192.89/166.44/7.91 [nmu-ssr-step3-s1-regression]/home/tcuni-claw/.local/share/slot/jobs/1793267348-726194-5932.sh
4156 finished   /project/tmp/slot/ts-out.mN9Yak 0        282.38/268.88/38.21 [cpu]/home/tcuni-claw/.local/share/slot/jobs/1793267381-732281-27196.sh

=== 池 gpu（1 槽）===
ID   State      Output               E-Level  Times(r/u/s)   Command [run=0/1]
0    finished   /project/tmp/slot/ts-out.Klqlh0 1        2518.52/25.40/23.06 [pea-core64-gvcf-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788450823-2685461-30840.sh
1    finished   /project/tmp/slot/ts-out.PvKmS9 0        2833.30/23.35/19.17 [pea-zw6-split-pilot]/home/tcuni-claw/.local/share/slot/jobs/1788485505-3129294-9946.sh
2    finished   /project/tmp/slot/ts-out.sPGlHF 1        36280.62/98.40/128.66 [pea-core62-gvcf-production]/home/tcuni-claw/.local/share/slot/jobs/1788535147-4122570-128.sh
3    finished   /project/tmp/slot/ts-out.yQuMTp 1        1.69/2.58/0.36 [pea-core62-gvcf-production-retry]/home/tcuni-claw/.local/share/slot/jobs/1788763955-862696-15880.sh
4    finished   /project/tmp/slot/ts-out.wFXDJ3 1        47402.62/129.45/181.22 [pea-core62-gvcf-production-retry2]/home/tcuni-claw/.local/share/slot/jobs/1788764220-902012-13728.sh
5    finished   /project/tmp/slot/ts-out.U4k4Gx -1       54932.29/191.75/197.69 [pea-core62-gvcf-production-hold-oom]/home/tcuni-claw/.local/share/slot/jobs/1788823757-2917383-6915.sh
6    finished   /project/tmp/slot/ts-out.67A8BB 0        75.31/1522.55/93.26 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791419644-3643757-18607.sh
7    finished   /project/tmp/slot/ts-out.mbvevi 1        511.03/344.20/199.68 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791422320-3888805-18625.sh
8    finished   /project/tmp/slot/ts-out.1fbwdI 1        900.26/545.75/371.18 [gpu]/home/tcuni-claw/.local/share/slot/jobs/1791423077-3996272-22390.sh
11   finished   /project/tmp/slot/ts-out.iq6kaf 1        0.43/0.35/0.02 [coturnix-parabricks-s1-smoke-a1]/home/tcuni-claw/.local/share/slot/jobs/1792033392-2790319-14362.sh
12   finished   /project/tmp/slot/ts-out.hccsBV -1       1.45/0.35/0.04 [coturnix-parabricks-s1-smoke-a1-r2]/home/tcuni-claw/.local/share/slot/jobs/1792033462-2800076-279.sh
34   finished   /project/tmp/slot/ts-out.8MO4yy 0        53.78/0.14/0.34 [bqsr-csi-diag]/home/tcuni-claw/.local/share/slot/jobs/1792152352-2140762-11067.sh

=== 池 nf（2 槽）===
569  finished   /project/tmp/slot/ts-out.7tXEpe 0        380.08/615.20/98.31 [qk383-bam-entry-r2]/home/tcuni-claw/.local/share/slot/jobs/1792998950-1645885-9660.sh
570  finished   /project/tmp/slot/ts-out.RfSZxn -1       59233.00/320434.44/5913.36 [TC-Ai-50K-20261019-002-T44-threshold-only-production]/home/tcuni-claw/.local/share/slot/jobs/1793000483-1834446-8399.sh
582  finished   /project/tmp/slot/ts-out.S1z616 1        4561.17/24101.23/832.15 [wheat_fielder_rnaseq]/home/tcuni-claw/.local/share/slot/jobs/1793056431-2220880-12209.sh
583  finished   /project/tmp/slot/ts-out.P0C88m 0        2506.29/21311.96/695.23 [qk383-fastq-full-r2]/home/tcuni-claw/.local/share/slot/jobs/1793056484-2229949-24233.sh
571  finished   /project/tmp/slot/ts-out.9erTyl 0        386.31/610.12/97.82 [qk383-bam-resume]/home/tcuni-claw/.local/share/slot/jobs/1793002911-2191056-32589.sh
584  finished   /project/tmp/slot/ts-out.dKeUaS 0        5.42/18.08/0.87 [qk383-fastq-republish-binding]/home/tcuni-claw/.local/share/slot/jobs/1793066452-3740849-20342.sh
585  finished   /project/tmp/slot/ts-out.CAbjH1 0        3.51/12.54/0.62 [qk383-wt-preview]/home/tcuni-claw/.local/share/slot/jobs/1793067720-3903912-19692.sh
586  finished   /project/tmp/slot/ts-out.z5o7ml 0        2446.33/11665.90/311.20 [wheat_fielder_rnaseq_r2]/home/tcuni-claw/.local/share/slot/jobs/1793073042-379102-26611.sh
588  finished   /project/tmp/slot/ts-out.LiQe2f 1        57.76/124.78/13.46 [panel-exact-reuse-closeout]/home/tcuni-claw/.local/share/slot/jobs/1793081718-1326846-12926.sh
589  finished   /project/tmp/slot/ts-out.WoqGX1 0        40.36/84.31/9.76 [panel-exact-reuse-attempt-2]/home/tcuni-claw/.local/share/slot/jobs/1793081924-1353477-15136.sh
587  finished   /project/tmp/slot/ts-out.WaBqwd 0        11785.16/54312.43/1274.60 [wheat_fielder_rnaseq_tf]/home/tcuni-claw/.local/share/slot/jobs/1793077577-931467-18792.sh
591  finished   /project/tmp/slot/ts-out.I9SVE6 0        4570.04/9480.70/1176.22 [nf]/home/tcuni-claw/.local/share/slot/jobs/1793152634-463676-17552.sh
592  finished   /project/tmp/slot/ts-out.Ecerj2 0        103.81/29.96/7.05 [TC-SXAU-step5-smoke-w]/home/tcuni-claw/.local/share/slot/jobs/1793256835-2856054-11375.sh
593  finished   /project/tmp/slot/ts-out.ZxhHm0 0        84.52/29.33/6.13 [TC-SXAU-step5-smoke-w2]/home/tcuni-claw/.local/share/slot/jobs/1793257010-2884207-6648.sh
594  finished   /project/tmp/slot/ts-out.O5I4cA 0        124.89/23.21/7.88 [TC-SXAU-step5-smoke-w3]/home/tcuni-claw/.local/share/slot/jobs/1793257165-2912770-30714.sh
595  finished   /project/tmp/slot/ts-out.Q1NcIh 0        105.57/20.61/6.58 [TC-SXAU-step5-smoke-t]/home/tcuni-claw/.local/share/slot/jobs/1793257388-2956799-5168.sh
596  finished   /project/tmp/slot/ts-out.Td1pQW 0        70.51/35.69/8.29 [TC-SXAU-step5-bench-w]/home/tcuni-claw/.local/share/slot/jobs/1793257822-3039715-4857.sh
597  finished   /project/tmp/slot/ts-out.EWr87X 0        1098.70/566.78/107.58 [TC-SXAU-step5-pilot-w]/home/tcuni-claw/.local/share/slot/jobs/1793258138-3104679-30946.sh
598  finished   /project/tmp/slot/ts-out.mpugFL 0        1258.36/727.17/128.11 [TC-SXAU-step5-pilot-t]/home/tcuni-claw/.local/share/slot/jobs/1793259307-3345198-3820.sh
590  finished   /project/tmp/slot/ts-out.17LagV 1        175768.12/960790.06/19550.97 [TC-Ai-50K-T44-resume-a2]/home/tcuni-claw/.local/share/slot/jobs/1793092030-3427860-27919.sh
```
## 第 5 次离线审计及最终版核对

冻结 `/project/tmp/ppo-p2/restart-formal-05-recovery/` 的 `sha256sum -c SHA256SUMS` 全部通过。Root、fb child、bc child 已报告费用分别 $1.055255、$0.4267626、$0.0884542，seq5 下界 $1.5704718，含旧批次等累计下界 $2.72142168；Root 和 bc 各一次 502 无 usage 报告，无法确认收费。STOP 保留。详情见 `/project/tmp/ppo-p2/seq5-offline-audit/seq5-audit.md` 及逐请求清单。

同版 runcheck 显式引用 bundle 后 seq1-4 均 valid。pilot 原独立 bundle 最终版因 missing async status 被拒，使用冻结 status 和 artifacts 尝试 collect_bundle 又报 conflicting child artifact references；旧独立验收保留，最终版 pilot 未通过。解析 SHA256：`runcheck.py` a4a1502c9ab515421f619d459c0f85e374385ad57499d395d475394b4993086a；`native_results.py` 5949dab9d2d964cb9ec47651002546f758e9cf596989220be4ec1b90eda5a42c；`summarize.py` c20f3464bb33d2b07ba523d9a694621824bf074cc231500a8c1741f26ca5979f；`guidance_metrics.py` ba7fc10408b002b9c39db1fbff54401d4b3a6e49150fb83a040ba88b29f1c47c；`prices.json` 9392b8307e0e230203b4189640330c88fd99a34778752a70e61718d32ec06d16。
