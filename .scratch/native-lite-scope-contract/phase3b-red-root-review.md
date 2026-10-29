# Phase3b Root 红灯检查与最小实现授权

Root 在实现 worker 阻塞等待期间，实读 `/project/tmp/pi-native-lite-phase3b-tests-report.md`、证据目录全部8份原始日志及命令/exit、controller before→after 差异、新 fixture diff，并核对当前实现与 before 字节一致。

## 检查结果

6项目标测试均为有效行为红灯（exit1）：未提供 monitor 目录、未覆盖继承目录、Root args 缺失 monitor，以及初始化 existing/corrupt/io-error 三类仍以 exit0 启动。无导入/语法错误。三类注入在旧 runner 中未执行，原因是缺少 initializer 接线；独立 initializer 注入检查 exit0，证明 EEXIST/EIO 与损坏内容注入有效。这里的 corrupt 用例证明初始化拒绝覆盖，不能宣称新增了 schema 校验。

原断言未删除/弱化，本步只添加 capture、7个测试（含一个注入器回归）及纯 fixture。Root 成本低阈值正常路径回归 exit0。当前 runner SHA `6b1da21c54dcc6eafb9451ebc1cd3b190393c33f8c1129f3a7eee162331d3741`、monitor SHA `e3429889255818ba2992b45b3a16e5c258f0d2d703bbc3512aebd95d094e5d72` 均与 before 一致，确认实现尚未修改。

接受这些红灯，仅授权修改 run-rpc-arm.mjs：在本臂结果路径下明确选择独立 monitor 目录，启动前创建目录并调用既有 initializeCostState；错误传播阻止 spawn，不覆盖已有状态；env 明确覆盖 PI_NATIVE_LITE_COST_STATE_DIR，Root -e 加 cost-monitor.mjs。允许控制日志记录实际 monitor 目录。不得改 monitor 内部行为、child 传播/cleanup/guard 或费用算法。新行为/守卫如需扩大范围，先测试并再次等待 Root 检查。

之后运行7项聚焦、controller/stage-a相关回归和原monitor相关回归；保留原始日志/exit/diff。完整release留待完整离线链路接线结束，不因局部绿灯放行真实provider。

## 证据边界

Root args 测试证明将扩展路径传给真实 runner 启动的本地 executable，不证明 executable 实际加载扩展或真实Native/Lite传播。双臂循环在红灯阶段被首次继承目录断言遮住，只能在绿灯阶段检查两模式完整执行，不另称独立双臂红灯。故障注入不覆盖symlink、目录创建失败、写入中途失败或并发。

## 成本检查点

测试子会话 bb1078de 已完成，Root 按 assistant entry id 去重20条，重复0、缺费0，reported USD0.11845480。session SHA `4a47a34115a96490d45a92d67b7ebaa2a91c323aa2de615d34bc7172cfbc57f0`；路径见测试报告。小步 USD0.75 检查额度余 USD0.63154520，供实现子会话及收尾；实现费用尚未结算，不能当零。此前累计 USD9.67524082 加测试已知费用 = USD9.79369562（非最终值，不含交互Root）。
