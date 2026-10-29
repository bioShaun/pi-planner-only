# S1 控制检查点结算与 Phase3a 交接

## Root 已核对

连续控制session（初次run59f79243及resume d333e174）已退出。Root逐条按assistant entry id去重131条，重复0、缺费用0，reported USD1.31499920。历史基数USD8.01491262，累计known reported USD9.32991182；不是将途中快照相加。session SHA256 `1a73fcd224da85f903eb98cbe0959c59d5befdd0825d5e7a656015b5835da098`。原session绝对路径见 s1-phase1-root-review.md 对应报告。

Root实读最终报告 `/project/tmp/pi-native-lite-s1-link-current-worker-report.d333e174.md`、全部3个Phase3测试文件、stop/aggregate/concurrent原始红灯，并独立核对hash。Root费用有限增量已先红后绿：5/5和controller/stage-a隔离依赖27/27。Phase3仅新增三个测试文件，无监测实现，不能验收为完成，不能放行provider。

原始证据 `/project/tmp/pi-native-lite-s1-link-control-1hFkrTek/`：phase3-stop-red2.log SHA c3e4d73a3fc5dd2342ba8c10d53e0f9e56e1b3aa80e3a8f60e13bbaf05bb01a7；phase3-aggregate2-red.log SHA 1be4f5528da6318c566b616757d5cae11c5d83c401ddef8d93d4343e5f4c8934；phase3-concurrent-red.log SHA fae22e42423fb9f9d13cdf9d6b18e8265110d4925983fe37ee3a56591fc34c7b。均因缺失目标行为失败，不是导入/语法失败。公共registry红灯不能声称覆盖两种真实委派路径。

共享ledger `/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json` SHA仍e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d，lock不存在。

## Root 后续安排与费用

用户已授权处理例外并推进S1；修复准备/预算停止缺口在该范围内。此前USD1.50是报告检查点，不是用户累计USD30授权上限。Root已在该点前收尾并核对产物，现在分配下一小步最多USD0.75控制reported检查额度，来自既有USD30，不增加授权总额；该小步含失败及收尾，接近额度应提前交接。连续累计控制检查值对应USD2.06499920（已结算1.31499920+新增最多0.75），不因更换子会话隐藏或清零旧消耗。新子会话按自身唯一entry去重，累计known基数USD9.32991182；交互Root排除，reserved与reported分列。

## Phase3a 唯一执行任务

repo/cwd `/home/tcuni-claw/pi/pi-planner-only`，dirty现状保留。新worker唯一writer；不提交/推送/安装，不运行真实provider，不启动实验批次、不修改候选/产品源码/全局插件/真实ledger/guard预留算法。只完成现有红灯对应的最小共享费用观察与请求阻断模块、required-child注册及必要身份/故障测试。本步不负责真实Native/Lite cleanup、完整launcher接线或新批冻结；这些后续必须仍阻止真实启动。

先读 AGENTS.md、CONTEXT.md、本文件、上一份最终报告、`.scratch/native-lite-lifecycle/{cost-stop-host.test.mjs,cost-child-registry.test.mjs,cost-event-order.test.mjs,required-child-extensions-wrapper.mjs,request-fingerprint.ts}`，以及已有Root费用代码（run-rpc-arm.mjs）。避免重复前轮接口探索：已验证Pi1.4.0 message_end扩展回调先于session append；turn_end在工具后才有entry ID；before_provider_request的普通throw会被host捕获。cost-event-order.test.mjs已用真实host本地stream证明。

实现要求：
1. 新独立monitor模块/扩展，在message_end把有效assistant完成费用以session+instanceNonce+单调序号稳定记录，使用只属于本批的外部monitor state，原子合计多session/多进程费用；达到1.25持久化stop。允许可验证的更简单等价设计，避免通用平台。不得写真实reserve账本。
2. 在turn_end将临时记录绑定真实session entry ID，不再次加金额；正常未绑定窗口允许合法child请求且费用已计入，不能当missing。重复观察身份幂等，同内容不同真实响应各算一次；冲突/重载/重试无法唯一对应则fail closed，不猜身份。新增这些行为先补有效红灯再实现对应分支。可逐条red→green，不要求一次写完所有未来阶段测试。
3. before_provider_request发现stop、必须state缺失/无效或监测故障时，先留证再在隔离实验/fixture进程显式非零exit，真实host stub调用必须0；普通throw不算阻断。message_end优先记录stop，保留原消息持久化机会。并发更新不得丢记录；参数/状态守卫也要故障注入先红后绿。
4. 注册`native-lite-cost-monitor`为required child extension供现有真实registry消费；当前只验收公共registry与真实host加载测试，不谎称已覆盖Native/Lite真实委派。未启动monitor的全臂runner仍不可用于实验。若给既有wrapper新增必需monitor会使旧fixture失败，需要更新fixture提供明确独立monitor目录而不是关闭监测/弱化断言。
5. 优先让已存在cost-stop-host四项与registry变绿，再完成本步身份绑定/重复/并发/无效费用的最小测试。旧有效红灯已被Root验收，可用于对应实现；不要重跑旧实现制造新历史。测试修改若修fixture契约须说明理由，保留原始红灯，不删除/弱化现有断言。不得把module-not-found/语法失败当行为红灯。
6. 不重复运行已知全局缺依赖失败。相关fixture和controller检查使用已验收既有隔离PI_SUBAGENTS_DIR=/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents。如确有环境漂移，停报具体差异，不能安装绕过。本增量完成先交Root，不提前跑完整release或创建批次。

成功标准：实际模块/扩展/注册和真实host fixture在已批准边界内生效；已有红灯+新有效红灯→对应绿灯；保留相关controller回归，无provider；报告所有未覆盖项，不宣称全臂预算或cleanup完成。若真实阻塞给精确测试失败/接口冲突及最小替代，常规实现选择自行决定；不要重复询问已批准nonce/临时绑定/隔离process.exit等设计。

所有临时文件/project/tmp或项目子目录，禁止/tmp；TMPDIR/TMP/TEMP仓库外/project/tmp。首次重活前读 ~/.config/agents/slot.md，预计>1min、>2G或大量/data_0 IO的每个任务先slot audit/status写日志并走slot cpu/io等；不调槽位、不杀他人进程。并行工具<=4。不得再委派子agent。

用新证据目录 `/project/tmp/pi-native-lite-cost-phase3a-<unique>/` 保存初始diff/文件快照、每次红绿原始输出和命令exit、改动hash、最终diff、费用/session路径、ledger只读hash/lock状态及你拥有的进程终态。输出报告绑定在工具output路径。结束时清楚列出本步完成行为和仍未实现的真实传播、cleanup/launcher/freeze等后续门。Root亲自检查实际diff及原始结果。
