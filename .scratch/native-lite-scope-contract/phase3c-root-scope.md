# Phase3c：runner 观察 monitor stop 的离线小步

Root 接续用户「继续推进」。Phase3b runner 初始化接线已复核；HEAD e45b9d843acaa79ebbb914325b5a1033592b3f48，所有既有 dirty 内容保留。本步仅实验 runner 消费现有 stop.json，不代表 Phase3a 整体或真实两臂放行。

## 范围与契约

监测扩展在本臂 cost-monitor/stop.json 写停止证据，但 runner 现仅处理 Root RPC cost、deadline、终态审计，没有消费共享 stop。下一小步只修改 `.scratch/native-lite-lifecycle/run-rpc-arm.mjs` 及 controller 测试/必要纯 fixture。

1. 运行期间，即使没有新的 RPC 输出，也应定期观察本臂 stop.json。标记存在即拒绝本臂；内容无需成功解析才停止（无效内容不能使其忽略）。不得将其他臂/继承目录的标记作为当前臂证据。
2. 留下明确 monitor-stop 原因和监测目录，不能落成成功/正常费用审计。最终成功收尾前也要检查停止标记，覆盖快速退出/首次轮询之前的窗口。
3. 针对此停止路径，终止直属 Pi 进程；不能仅依赖 stdin EOF，SIGTERM 后仍存活要有有界 SIGKILL 升级。测试设置明显更长总 deadline，证明停止不是 deadline 兜底；不无限等待。清理本步增加的定时器/观察任务，关闭日志前等待写入完成。
4. 保留 child-stop-unobserved 事实：直属 Pi close 不是 Native/Lite child 清理证明。不能标记 child-cleanup 已验证，不能改 monitor 算法、子代理生命周期、guard预留或产品代码。文件读取错误如新增 fail-closed 分支，须先对应故障注入红灯；常规缺少 stop.json 是合法运行态。
5. 保留既有 Root cost stop 和成功路径断言。新增 Native/Lite 两模式覆盖：运行中有效 stop；坏内容 stop；忽略EOF/SIGTERM进程的停止；快速退出前 stop；无 stop 正常成功/另一目录 stop 不干扰。可用参数化测试减少重复。纯 fixture 不冒充真实委派传播。

## 执行门

测试 worker 唯一writer，只写测试/纯fixture，不修改实现。保存 before实现/测试快照、实际 diff、每条原始失败输出及命令exit/hash。缺行为红灯须为断言失败，不能语法/导入问题。已有行为绿灯如实记回归，不人为制造失败。完成并退出。

实现 worker 起步必须 contact_supervisor 阻塞请求 Root 复核具体证据，等待单独授权。Root 亲读 diff、原始红灯与before hash后才许可最小实现。不得用本文件直接越过该门。新增守卫先测试再请求 Root；测试不删除/弱化旧断言。完成运行聚焦+controller/stage-a/monitor组合，原始绿灯、实际diff、before/after hash留存；完整release仍留待离线链路接线完成。

## 资源、预算和输出

cwd `/home/tcuni-claw/pi/pi-planner-only`。不 commit/push/install，不修改全局插件/候选/产品源码/真实共享账本，不跑真实 provider 实验臂，不创建新冻结；不得再委派。已知可用隔离依赖 PI_SUBAGENTS_DIR=/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents，禁止重复已知全局缺依赖失败或自行安装。

所有临时文件在 /project/tmp 或项目子目录，禁止 /tmp；TMPDIR/TMP/TEMP 使用仓库外 /project/tmp。重活前读 ~/.config/agents/slot.md，每次预计>1分钟、>2G或大量/data_0任务先 slot audit/status 归档，再走 slot cpu/io；不调槽、不杀他人进程，工具并行<=4。

本步测试+实现合计 reported USD0.75 控制检查点，含失败和收尾，取自既有USD30总授权；沿用USD26 reported停止及严格<26预留规则，不自动清零。累计known基数USD9.87440702，不含交互Root，与reserved分列。接近额度提前报告收尾。

证据各用 /project/tmp/pi-native-lite-phase3c-<stage>-<unique>/。报告列出精确文件、命令/exit、hash、before/after差异、费用session绝对路径、拥有的进程终态。只读核对共享 ledger `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json`（既有SHA e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d）、lock状态。不得将测试fixture算为真实两臂或完整费用关联/清理验证。
