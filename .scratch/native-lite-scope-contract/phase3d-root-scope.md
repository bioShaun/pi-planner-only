# Phase3d：真实委派路径的离线 monitor 传播验证

用户在Phase3c交接后要求「下一步」。Root限定本步为Native/Lite真实委派路径的离线传播验证，HEAD e45b9d843acaa79ebbb914325b5a1033592b3f48，保留全部既有dirty内容。Phase3c通过，整体及真实provider仍未放行。

## 证据与验收边界

现有cost-child-registry.test.mjs只验证公共registry，cost-stop-host.test.mjs手动读取registry加载host；lite-host-controller.test.mjs明确排除真实执行peer并模拟bus响应。它们不能证明实际Native/Lite child加载monitor。本步通过实际委派入口/执行runner创建本地child session，provider边界必须完全替换为本地确定性stream，模型网络禁用、隔离auth/settings；不得调用外部provider。仅通过本地测试harness运行必要child session，不允许另起控制子代理。

目标：每种模式证明实际委派入口→真实执行runner→child扩展加载→本臂monitor目录→child费用观察身份；另臂独立状态不受影响。通过缺失/错误目录或stop等最小故障场景确认断言能识别未传播/失效，优先复用既有行为而不引入新guard。仅registry、参数静态匹配、手动创建第二个host、伪造bus终态、直接调monitor API不能作为真实路径通过证据。若真实链路不能在当前授权边界下离线驱动，报告精确接口/环境阻塞，禁止扩大到全局插件/产品代码或付费试跑。

## 执行门

第一worker仅核对契约、新增测试与纯fixture，并运行；不得修改实现或弱化旧断言。保存初始快照、精确diff、命令/exit、原始输出和hash，退出交Root。已有行为直接绿灯如实报告，不人为删除正确实现制造红灯。新增行为必须失败于缺失目标行为；语法、导入或环境失败不是有效红灯。新fixture本身可修正，但保留失败记录与原因。

第二worker先contact_supervisor(reason=need_decision)阻塞请求Root核对第一worker原始证据。Root亲读实际diff/日志/快照后才决定授权最小实现或仅收尾验证。未收到具体许可不得改实现；新增守卫须另行仅测试并再次等待Root。允许实现的最大范围仅实验辅助文件.scratch/native-lite-lifecycle/，并且必须有有效红灯及Root单独授权。禁止修改产品根目录源码、候选、全局安装、guard预留算法、共享账本。

完成本步只运行传播聚焦与适用相关回归；完整release待离线链路补齐，不做新冻结、不启动真实实验、不commit/push/install。Root检查实际diff及原始结果后写最终结论。

## 预算和运行约束

累计known reported基数USD10.15295222，不含交互Root、不加reserved。本步所有控制worker合计USD0.75 reported检查点，来自既有USD30授权，不增加总额；USD26 reported停止线及共享reserve严格<26保持。接近检查点提前交接，换session不清零。报告原始session路径及按唯一assistant entry id去重费用。

所有临时文件在/project/tmp或项目子目录，TMPDIR/TMP/TEMP在仓库外/project/tmp，禁止/tmp。首次重活前读~/.config/agents/slot.md；预计>1min、>2G内存或大量/data_0 IO必须先slot audit和slot status写入项目日志，然后slot cpu/io等执行；不改槽位、不杀其他任务。最多4个并行工具。重测试建议统一slot cpu。既有隔离PI_SUBAGENTS_DIR=/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents可复用，必须记录真实解析路径和版本，不能将隔离与全局runtime等同；环境漂移停报，禁止安装绕过。

证据每worker使用新/project/tmp/pi-native-lite-phase3d-<stage>-<unique>/，保留初始git status/diff、所有触及文件before/after及hash、每次命令exit和完整原始日志、最终diff、费用/session路径、自己启动进程终态。只读核对/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json，预期SHA e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d，lock不存在；不可改或清锁。

仍待后续：Root+child完整费用/请求关联及汇总、真实child停止清理、适用release、新冻结和逐臂Root gate。本步不得声称这些完成。
