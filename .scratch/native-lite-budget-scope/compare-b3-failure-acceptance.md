# Root compare-b3 失败验收与离线修复范围

compare-b3/S1-native停止：唯一child已completed/exit0并生成报告，但实验Root未完成最终acceptance；controller以native-receipt-rejected / invalid-native-completion-identity退出。Pi exit0、runner/slot exit1、complete=false，仍0有效样本/0pair，其余三臂取消。本批不重试，不处理新lock，不启动新批次。

## Root独立证据

直接读取control及真实session message_end事件：第1243行customType=subagent-notify，details.runs唯一元素包含agent=worker、status=completed、runId=5a8550b7-fd12-4535-9df9-ade4914fdc04、asyncDir、durationMs、sessionLabel、sessionValue，**没有source字段**。stage-a-lifecycle.ts:nativeNotice与run-rpc-arm.mjs完成回执检查均要求source===async，构成已观察契约差异。缺失source不等于runId/agent错误，不能据此说child执行失败；是否及如何兼容需对照安装版本的通知生成器并离线重放。

报告实际SHA256 `21074d78e8cdd4565d6024ef7cce1f95094c1be2c8693de08d9997be5b6b74a1`。

Root按唯一session/message核对：
- 实验Root 8条assistant，reported USD0.02665580，session SHA256 `4b5078dac68d1819229f96d6da88773d2ed8eb344562301e0bfd6b50657e155d`。
- 实验child 13条assistant，reported USD0.01026662，session SHA256 `1fb6539a7ba27277b566576036dd26f7dcfe22bca4300194487af459601e9765`。
- 本臂reported合计USD0.03692242，非发票。
- 本控制worker 196条assistant，reported USD0.46012528，无缺失，session SHA256 `9107e7b633c19e3b5245bfcf249651554b7d2c16b483741309ec88968f50456d`。新口径已知reported小计USD5.96605544，后续增量继续算，不叠旧检查点。

21条fingerprint的(sessionId,payloadSha256)多重集合与ledger第24–44条(sessionId,payloadHash)完全相等，均唯一。当前ledger44事件、reserved14.78476627，SHA256 `da3444382a03d6db8bff5af57a83e7788e1a658ae0c398ce894499333e8b9a31`。距16请求停止线1.21523373；预留不能与reported相加。下一次实验若仍采用16门，余量小于本次消耗的1.51066725，不能忽略该约束。用户30测试累计上限仍有效，不是实际超限。

新的真实lock inode78027492保留未动。出现时刻与失败终止接近，仅时间相关不能确认创建者或完整机制。

## 离线下一步

授权同一worker继续既有累计USD1控制分配，接近0.8报告：先保留不可变失败报告/关键源码基线及真实通知缩减fixture；从安装通知生成器核对schema，先只写真实通知回放失败测试（缺行为的断言红灯，不接受仅缺函数/导入错误作为本次回归证据），再作最小harness修复并验证。若宿主确认合法完成通知省略source，可在已登记native-async run的关联范围内兼容该省略形式；显式错误source、错误agent、未知/stale/duplicate run、failed status等必须继续拒绝。两处检查和进程级控制器流程均覆盖；不伪造最终acceptance、报告hash或usage。

并行范围内只读调查/隔离复现终止期间遗留锁机制，给出真实guard持锁阶段与runner shutdown相互作用证据及最小建议；不自动清理真实lock、不更改guard/预算上限、不另开真实provider。先做可复现诊断，若修复锁需改变守卫语义则交Root审查。不要用反复清锁重建批次替代修复。

仅允许修改.scratch/native-lite-lifecycle中harness及其针对性测试、.scratch/native-lite-budget-scope或新.scratch/native-completion-contract证据/复现文件。保留旧批次源版本可追溯，失败manifest/result不改；产品、全局安装不改。按slot及/project/tmp规则执行必要测试，Root检查实际git diff及原始红绿输出；完成后仅交离线验收，不自动新建/启动实验批次。
