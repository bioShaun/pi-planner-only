# Root 最终复核：离线功能证据已核对，流程例外已获用户批准

后续决定：用户回复『按照你的推荐处理』，批准仅本次 checksum 测试时序缺口的例外，保留全部不合规记录；当前实现依据既有功能证据验收，S1 两臂最小真实链路校准进入逐臂准备和 Root 放行阶段。详见 [例外与 S1 阶段授权](checksum-exception-and-s1-authorization.md)。下文是授权前的完整复核记录，保留当时状态，不追改历史；其中“待用户决定”不再是当前阻塞。尚无真实校准通过结论。

2026-10-28。实现/测试由同一worker经R1、R2、R3完成；Root检查实际文件、相对初始快照及各轮快照的差异、原始日志和账本/session，没有仅采信报告。最后run `378ebc81-0c30-48c0-a4cf-6a6aac2ae03f` complete，process terminal observed，active async capacity 0。没有运行中的真实实验。未提交、推送、安装或reload。

## 验收结论

本阶段离线功能检查证据已核对；**整体最终验收尚未通过**。checksum/event-sum检查缺少实现前的有效行为红灯，违反全局AGENTS要求；Root未自行豁免。该项的事后旧实现重放与当前故障注入均有证据，但不能追认为TDD时序合规。R1先实现后补证据的历史也保留，不宣称全过程符合TDD。

三层结果契约、正式brief、逐臂预检、准备产物及合成校准输入已形成可审查版本。R1实际runtime/账本/workspace检查缺口已修复；R2发现的manifest version与runner首行/字面字段/S2路径接口不兼容已修复。准备产物沿用runner接受的manifest v1，加新冻结字段，不修改controller。

## 已核对的功能证据

- 最终聚焦 `node --test .scratch/native-lite-scope-contract/arm-preflight.test.mjs`：12/12，exit0。包含guard真实schema的checksum/合计/严格<26、不可变prefix/合法追加、锁/目标输出/符号链接、workspace与实际runtime文件、paired brief/S2 diff、prepare→manifest→预检CLI，以及真实runner启动前消费者测试。
- 真实runner + 纯本地PI_BIN mock：正式S1/S2、S1链路/S2拓扑、语义A–D的Native/Lite共16场景。原始红灯来自runner:37 manifest v1契约断言，后续绿灯证明全部到达mock spawn。mock仅记录argv/cwd/env，受控exit23；不加载Pi/provider，不证明RPC握手、实际child、报告/usage关联或模型语义正确。测试源码与原始红/绿均已读。
- legacy verifier：3/3，初始全批通过，合法账本追加与前臂已存输出分别被原全批规则拒绝。适配diff仅重定向ledger绝对路径，既有断言未变；原脚本未改。旧worktree/runtime只读引用；该证据仅说明旧全批入口不支持逐臂续行。
- `PI_SUBAGENTS_DIR=/project/tmp/pi-planner-native-release-repro/compare-xh4zUD/node_modules/pi-subagents npm run test:release` 全通过。Root读取完整日志：typecheck、contract、git/reviewer-range、delegate、host/host-runtime、handoff、status-color、index。复用现有依赖，无安装；默认全局缺pi-ai失败仍保留。R3仅修本轮准备产物/测试/文档，未无收益重复release。
- 初始既有tracked diff与最终逐字相同，SHA-256 `c113216e104e67599c7ec1e896897b3d9ceabc5f9fe774b6a283287420af9e72`。本轮worker改动限于scope-contract的17个文件；Root本文件及状态澄清另计。`git diff --check`通过。产品、controller、共享账本未因本轮被改写。

原始证据及SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `/project/tmp/pi-native-lite-scope-next/r3-preflight-final.log` | `13a9cc279086a3b766914a6263464d08388e6e18c9d11a00156413191ce022f3` |
| `/project/tmp/pi-native-lite-scope-next/r3-runner-consumer-matrix-red.log` | `1114fa1b6c9336452d7063b81339242f5862cb1b4343eee19d1c2061c02446e0` |
| `/project/tmp/pi-native-lite-scope-next/r3-runner-consumer-green-attempt2.log` | `0594fb652c5c8703d3df258a5a8c822ca5b45e901e9935e344e7015ee0a7398f` |
| `/project/tmp/pi-native-lite-scope-next/r2-legacy-baseline-final.log` | `88d5a544757501d16d309f7e815a560ca5e95dafc2248dcecbb56b9e45290a06` |
| `/project/tmp/pi-native-lite-scope-next/test-release-reused-r2.log` | `f3cfad46ad50ee93dfde52130301547cec26dd027bda4a210e541ce8bac5d74d` |
| `/project/tmp/pi-native-lite-scope-next/worker-report-r3.md` | `535d2e728ab0b56e609ed1e6eb56c046ab8e1a1ed77c0107d340bc9edc6dcb42` |

## 流程例外的精确范围

R2早期fixture `sealed(events, 2)` 的helper忽略第二参数，未产生预期的不一致总额，因此该次断言失败不能作为目标行为红灯。正确schema的旧实现重放是在修复之后完成，只证明旧实现会接受坏checksum；当前实现复用既有只读readLedger并通过正确checksum/事件合计故障注入。完整过程见 `/project/tmp/pi-native-lite-scope-next/r2-tdd-fixture-audit.md`，错误日志和冻结第一版保留。

依据 `/home/tcuni-claw/.pi/agent/AGENTS.md:9`：带测试行为变更须“先只写测试并运行……再写实现并贴出通过输出”，“验收时核对红灯输出，缺失则不验收”。Root不能把后补证据冒充实现前证据，也不应为制造时序而关闭正确guard。建议请求用户仅对此次既有实现的TDD时间序缺口作例外，保留非合规历史，基于已核对的回归证据继续；未来行为变更仍严格先红后绿。当前尚未收到该例外授权。

## 最终费用和账本

Root在子代理终态后按assistant entry id去重291条，重复0、cost缺失0。本轮同一恢复会话总reported为 **USD0.97239834**，替代全部途中快照，不重复加上R1/R2/R3检查点。历史known reported USD7.04251428，因此累计known reported为 **USD8.01491262**。模型报告费用不是provider发票；交互Root不纳入，reserved不与reported相加。

Session `/project/tmp/pi-native-lite-scope-next/control-session/6a1a4b87-b9b9-44e1-9f54-c92ff1408667/run-0/session.jsonl`，SHA-256 `98f0bf050e5b94d065899e49e1f2b2a426787d9d231841bcfe47366feb8ef225`。

共享ledger仍59事件、reserved USD16.204782395，SHA-256 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，锁不存在。请求停止线26未改，USD30累计授权未追加。

## 下一阶段

流程例外解决后，先准备并核验S1最小真实链路的Native/Lite两臂，逐臂由Root给具体launch gate；不是直接重开正式四臂。校准brief/env/runtime/候选/费用/锁/slot仍须按实际新批冻结和预检。后续语义A–D和S2拓扑按阶段证据另行放行。预检/启动mock只能证明其检查边界，不能代替真实链路和语义验收。

语义校准分开记录“合成报告本身的结论”与“worker是否忠实完成评审任务”；正确识别不合格合成报告可作为评审任务通过，不能强制实际结论。封存期望只供交互Root验收，不进入评估输入。意外结果/基础设施失败/预算或锁异常停止，不自动重跑。

preflight的USD8.50 observed-cost止点仍是提案，不是预留或整个12次调用的一揽子放行；每请求必须独立满足动态预留<26。当前没有provider launch gate，正式有效样本/完整pair仍0/0。
