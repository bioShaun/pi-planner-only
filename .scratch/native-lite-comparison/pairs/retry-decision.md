# Root：首次启动失败后的同协议重试决定

Root 已读实际 RPC runner、失败 stderr、slot 命令与冻结 manifest。S1 Native 首次尝试在 runner 的 CWD guard 处退出，Pi 未 spawn，ledger 仍只有 US$1 准备预留；四臂 baseline 与源码未改。错误来自执行控制 worker 提交命令遗漏 cd，不是 Native/Lite 模式结果。

按原执行计划和协议“启动配置失败最多同协议重试一次”的约定，Root **批准这一次纠正后的重试**。此前“不得自动 retry”要求 worker 停止交回验收，本决定完成了该复核，不需要用户重复授权。重试前先明确 `cd /project/tmp/pi-native-lite-pairs/S1/native`，然后从该 cwd 提交 slot cpu 命令。保留失败记录与账本，输出重试 controller 日志到新文件名。Pi session.jsonl 尚不存在，因此首次真正会话可按原固定路径创建。

不更改 baseline、brief、模型、费用、guard、模式、RPC入口或20分钟单臂限制；只修正 shell 的工作目录。首臂成功并核对guard/child身份后按已授权顺序继续剩余三臂。再次启动失败、guard拒绝、覆盖缺口或模型漂移即停止，禁止自动绕过或切CLI。

截至此决定，四次 Luna 准备/控制 run 报告费用分别为 US$0.12735892、0.22839210、0.14862112、0.30405332，合计 US$0.80842546；它们属于准备和调度成本，不是实验臂费用，不是 provider 发票。US$1 seed reserve 接近此报告值，后续控制费用另列并从US$4安全余量中覆盖；不以未记录为零。
