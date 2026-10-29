# Phase3a 最终 Root 复核：去重修正通过，新增时序例外待决定

> 后续决定：用户已在复核后回复「按照你的推荐处理」，仅批准下述两处既有守卫的时序例外，允许继续离线集成。原复核事实与当时未批准状态保留；当前授权及执行门见 [phase3b-root-authorization.md](phase3b-root-authorization.md)。Phase3a 整体验收和真实校准仍未放行。

## 当前结论

Root已检查实际cost-monitor实现、恢复后的测试diff、四份行为红灯、聚焦和controller回归原始日志及子会话时间线。本次去重修正通过有限功能复核；Phase3a整体未验收，真实provider未放行。

去重已恢复原契约：新事件包装对象引用同一message/entry不重复计费，旧同event与冲突断言保留；相同内容但不同真实消息/entry仍独立记录。未绑定重放与跨session冲突新增测试先运行有效红灯（09:35–09:36Z），后改实现（09:36:42Z），再运行绿灯（09:36:59Z）。不同entry场景原实现已拒绝，仅作为回归检查，不假称新红灯。

20/20聚焦通过，27/27 controller/stage-a通过（复用已验收隔离依赖；默认全局缺依赖问题未修）。未运行完整release。仅本地host/provider stub及公共registry测试，不证明实际Native/Lite传播、完整费用/请求关联、child取消清理或正式批次有效性。身份映射目前依赖同一进程内message对象；跨reload的持久重放仍不是已完成能力。pending重放拒绝为handler级测试，不夸大为新增真实host端到端证据。

## 证据

目录 `/project/tmp/pi-native-lite-cost-phase3a-replay-8e873369/`：
- wrapper-red.log，exit1，SHA a1c4376bdca93ad98cc00eaede818f80211ed7b0ca2edd84d1003ed3b87b73f6，原场景实际2条而期望1条。
- unbound-replay-red.log，exit1，SHA b810a2fc6f601d2e12e934ca2c89206b595a1062eabf6af29efc1e7f0e3ccb63。
- pending-red.log，exit1，SHA 70970978bb857e776a4aafe5afa7d1875805887327f303fdce82a28f959eb066。
- session-conflict-red.log，exit1，SHA 9ecbc510c7bd03e13eb29a797f2b4d42ae52613861b44fe8bd2f536616009dda。
- focused-green.log，exit0，20/20；controller-green.log，exit0，27/27，SHA f32b9846525ac36bf866a63957c7eb4fc706e7ee164d2bbc3a58c3abfa207e6a。
- monitor.diff、test.diff、report-correction.diff及before/after拷贝已读取；原始host测试从首次read输出事后恢复，SHA f7d88ed2cba34f0a159bcf7b843a0ca6867f9e0206342bcdd067cd87843c90fe与原记录一致，不能称为当时完整快照。

## 两项未获豁免的流程缺口

原Phase3a的unbound/reload（另一实例遗留未绑定观察的拒绝）与corrupt-state（损坏JSON/schema拒绝）在初始monitor中先实现、后补测试。有效原始时序已在phase3a-root-review.md核对。当前绿灯证明所覆盖功能，不修复历史流程。用户此前仅批准checksum例外，本轮两项未获豁免。

建议提交用户的具体决定：仅对此两项既有guard的测试时序缺口作例外，保留全部不合规记录，允许在已知能力边界内继续离线集成；不追认先红后绿，不豁免费用/功能/停止证明，不直接批准真实运行，不新增USD30总授权。若获批，下一阶段先采用“仅测试子任务→Root核对有效红灯→单独授权实现”的拆分，以实际执行门防止再次先写guard后补测。例外未批准前不将该组件验收通过，也不进入依赖其通过的运行阶段。

## 最终费用与运行状态

本Phase3a连续子会话97f34ccf及resume8e873369已退出，Root按assistant entry id去重60条，重复0、缺费0，总reported USD0.34532900，替代此前USD0.20410620及途中快照。session SHA148de0eb0ae02e224521bc43bd17d51e6fc0ba7f4086dd6f51f3ecc58b0c48f2。

既有累计基数USD9.32991182加本session总值，累计known reported USD9.67524082；本小步USD0.75额度余USD0.40467100。该数不含交互Root，不与reserved相加，不是provider发票。

Root本次核对共享ledger SHA仍e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d，lock不存在。无本任务运行中的worker/实验，无真实S1启动。旧已冻结批次不能在runtime变更后复用。正式样本/完整pair仍0/0；尚需真实传播/停止与清理、完整runner接线、适用release、新冻结及逐臂gate。
