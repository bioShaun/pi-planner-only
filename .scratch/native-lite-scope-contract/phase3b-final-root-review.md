# Phase3b Root 复核：runner 启动接线小步通过

Root 已实读测试 before→after 差异、新注入 fixture、六项原始红灯、七项聚焦绿灯、组合回归原始日志/命令/exit、runner 实际增量及两子会话。接受本小步离线接线，不代表 Phase3a 整体或真实两臂校准验收。

## 实现与时序

实际实现仅 run-rpc-arm.mjs 增加7行：import 既有 initializeCostState；每臂 results/attempt/arm 下的 cost-monitor 路径；启动前 mkdir 和初始化；env 覆盖 PI_NATIVE_LITE_COST_STATE_DIR；Root -e 参数增加 cost-monitor.mjs。初始化异常发生在 spawn 之前并直接拒绝启动。未修改 monitor 算法、child 行为、预算guard或产品代码。

当前 runner 与 after 快照逐字节一致，SHA256 `94d509c86f2a2e3f1116451c68a54b011472dfb25f8265d4952d8bcc35cd54d0`；当前测试与测试 worker after 一致，monitor 与 before 一致。实现增量文件 implementation.diff SHA256 `3ca2d1a368cbe934fc014c6ad6f2919259447ff2b2c7b05653a9c3aa4f1ae1d7`。

测试 worker 先完成红灯并退出，Root 实读并批准后，实现 worker 于 2026-10-28T10:12:58.311Z 收到 supervisor 明确授权才继续，实现与绿灯均在其后。本次执行门实际生效，未发生新增先实现后补测。

## 验证

证据 `/project/tmp/pi-native-lite-phase3b-implementation-7ae2798d/`：7项聚焦各 exit0，含 Native/Lite 模式循环的独立目录及继承污染检查；controller、stage-a、monitor、child-registry、event-order、stop-host 组合回归 exit0，54/54通过。regression.log SHA256 `68357986a2baca2f6fe8ea2c5ee8955a264d8389689f34b3a66da2d309cfec42`。

slot audit/status 在测试组合命令前已归档，audit 未发现绕过 slot 的重进程，测试走 slot cpu。使用已有隔离 PI_SUBAGENTS_DIR，TMPDIR/TMP/TEMP 均在仓库外 /project/tmp。完整 release 未运行，留待完整离线链路接线后按项目要求执行。

参数 fixture 仅证明真实 runner 将 monitor 路径传给本地 executable，不证明 executable 实际加载或真实 Native/Lite child 传播。已有状态/损坏内容拒绝依靠既有 initializer，不宣称新增 schema 守卫；故障注入覆盖 EEXIST/EIO，不覆盖目录创建失败、写入中途失败、symlink或并发。

## 费用和运行状态

Root 按各 session 唯一 assistant entry id 重新结算：
- 测试 bb1078de：20条，重复0、缺费0，reported USD0.11845480；session SHA256 `4a47a34115a96490d45a92d67b7ebaa2a91c323aa2de615d34bc7172cfbc57f0`。
- 实现 7ae2798d：15条，重复0、缺费0，reported USD0.08071140；session SHA256 `b4644289a633b1dcc742d08c7006acd281374753cc08b2a76ef2450d0fcf2377`。

本小步合计 reported USD0.19916620；原累计 USD9.67524082 加本小步，累计 known reported USD9.87440702。本步 USD0.75 检查额度余 USD0.55083380；不含交互 Root，不与 reserved 相加，不是 provider 发票。两个 session 绝对路径见对应子报告。

两个子任务与 workflow 已完成，子报告的进程终态检查未发现对应测试/runner/fake-pi 残留。Root 本次只读重算真实共享账本 SHA256 仍为 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，budget-ledger.json.lock 不存在。未启动真实实验臂，未 commit/push/install，未创建新冻结。

## 后续门

用户对两处历史时序缺口的例外继续仅限原范围。尚需真实 Native/Lite 委派路径的扩展传播验证、Root+child 完整费用/请求关联与汇总、运行期间停止及 child 清理、剩余 runner 集成、适用 release、新冻结与逐臂 Root gate。已授权的后续离线工作沿用「只测试子任务→Root核对有效红灯→明确实现授权」；无需再次请求同一例外。真实 provider 仍不放行，旧冻结材料不得复用为新 runtime 的凭证。
