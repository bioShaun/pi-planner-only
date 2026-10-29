# Phase3c Root 复核：runner 运行中停止标记接线小步通过

Root已亲读实际git diff及before→after增量、两轮测试diff/纯fixture、原始红绿日志与命令exit、文件快照和子会话时序。接受本小步离线runner停止接线；Phase3a整体及真实两臂校准仍未验收、未放行。

## 实际行为与范围

run-rpc-arm.mjs每100ms检查本臂cost-monitor/stop.json；存在标记即停止，不依赖JSON内容解析；ENOENT为无标记，其他stat错误记录monitor-check-failed。停止时记录monitorDir及child-stop-unobserved，设置失败/取消成功状态、关闭输入并向直属Pi发送SIGTERM，500ms后仍存活则SIGKILL。费用审计结果处理和最终退出前重查标记；直属进程close后清理新增定时器。

新增monitor-stop-fault.cjs只作测试进程指定路径的EIO注入。旧断言保留，原monitor算法、child生命周期、guard及产品代码未改。cost-monitor.mjs SHA仍e3429889255818ba2992b45b3a16e5c258f0d2d703bbc3512aebd95d094e5d72。对HEAD的git diff包含此前已存在改动，本步范围依据已保存before快照确定，未将旧增量算成本步实现。

runner当前与runner.after逐字节一致，SHA3e357157bf1c935fc7115c0d70c5910d1a09b82ab40ae756fbe396c4edf61c0d；runner.diff SHA c9b39f6f921b5bbb5aaf28e5488417d39d68dfed12c853e35e7b371c32be480f。测试与test.after一致，SHA6a9ff99b981d65e4e7e829e827ca6380ff922b41494ef3575070d78c9f9594bb；新fixture与injector.after一致，SHA855e00fee3f6658c8ed1fc8b5c4ff6e3ae9f681f41014de6dbdf325d5da738a9。git diff --check通过。

## 测试时序与结果

首个测试worker f297cdad先完成8项有效红灯并退出；实现worker 5df218be先阻塞请Root核对，于2026-10-28T12:18:35.868Z收到常规行为授权。其后主动提出非ENOENT观察错误缺红灯，Root仅授权测试；该worker保存未变runner并完成两模式I/O红灯与独立注入器绿灯，再次阻塞。Root亲读后于12:21:51.063Z明确授权该守卫；首次runner修改在12:22:05.064Z，其后才运行绿灯。12:23:22.181Z补充已授权最终退出前复查后，又运行最终聚焦和组合回归。未新增先实现后补测。

原始证据目录：
- /project/tmp/pi-native-lite-phase3c-tests-f297cdad：最初8项断言红灯（exit1，另2项成功回归）及Root费用5/5回归。
- /project/tmp/pi-native-lite-phase3c-io-5df218be：I/O两项断言红灯（exit1）与独立注入器通过；最终final-focused.log 13/13、exit0，SHA90f3ec21d4cb6d31fd255b6c0ca063c35e64bdcba5036a9b7a7249cfb31d95c6；final-combo.log 56/56、exit0，SHAe583764bf146c395e4ee5daa0c6f04d298b13dd01345436fdd12ddc7b0d0f8a4。

最终组合范围精确为process-controller.test.mjs、stage-a.test.mjs、cost-monitor.test.mjs三个文件；不把此前其他host/registry/event-order套件算作本轮已重跑。完整release未运行，仍待离线链路补齐。最终测试使用既有隔离PI_SUBAGENTS_DIR，TMPDIR/TMP/TEMP为仓库外/project/tmp；每次slot前检已归档，audit未发现绕过slot重进程，测试走slot cpu。

## 证据边界

停止与EIO用例在两个模式均通过所有后续断言，顽固fixture和I/O fixture约0.7秒结束，早于6秒fixture自退和8秒deadline；测试证明直属fixture终止。EIO旧runner未检查stop，所以红灯不是已执行EIO处理的证明；绿灯验证精确注入marker确实生成。fast用例覆盖费用审计回复前写标记，不证明穷尽所有并发时序；100ms轮询与500ms升级是实现配置，不是provider费用硬上限或所有系统负载下的停止时延保证。

没有验证真实Native/Lite扩展传播、真实child取消/进程清理、Root+child完整费用/请求关联与汇总；这些继续阻止真实两臂启动。观察stop缺失本身不证明monitor仍健康或child已被覆盖。旧冻结不能复用为新runtime凭证。

## 费用与终态

Root按各已结束session的唯一assistant entry id重算（路径见两个子报告）：
- 测试f297cdad：14条，重复0缺费0，reported USD0.11079140；session SHA989212f9d93ac4389e19aeab847d14ea70dac06819099fa748db939979fb26b2。
- 实现5df218be（含追加I/O测试）：32条，重复0缺费0，reported USD0.16775380；session SHA23f059d43cbfba7209513a13d05a293d3607a10e9225b975085e4bc0d23de7de。

本小步reported USD0.27854520；累计known reported USD9.87440702 + USD0.27854520 = USD10.15295222；本步USD0.75检查点余USD0.47145480。上述替代途中快照，不含交互Root、不与reserved相加、不是provider发票。

workflow及两个worker均completed，worker收尾进程检查未见其test/runner/fake-pi残留，未触碰观察到的其他任务。Root只读核对真实共享账本SHA仍e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d，lock不存在。未commit/push/install，未运行真实实验臂，未创建新冻结。

后续仍按先测试→Root核对有效红灯→单独授权实现推进真实委派离线传播、完整费用关联/汇总和child停止清理，再做适用release、新冻结与逐臂Root gate。本小步通过不解除这些门。
