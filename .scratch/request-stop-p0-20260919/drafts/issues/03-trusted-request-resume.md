# 03: 可信新用户请求和 operator-only 恢复

**What to build:** 上个请求稳定结束后，真正的新输入能使用新额度；自动续跑、重载和 Root 自报新请求不能解锁。边界不明时 operator 有明确恢复入口。

**Blocked by:** 01 — 请求总额度耗尽后持久封锁并停止活动 child。

**Status:** needs-info

**Draft:** 尚未发布执行；测试入口随 [spec](../../spec.md) 确认。

- [ ] agent_end/turn_end/session_start/compaction 均不重置 Request；agent_settled 只保存结束证据。
- [ ] 旧请求 settled 且无活动调用后，受支持来源的新独立输入开启新 Request；SDK interactive 场景正反两组均验证。
- [ ] source=extension、scheduled/custom nextTurn/followUp、活动中的用户 steering 与 autocontinue 不重置；RPC 未获真实入口证据前走保守回退。
- [ ] operator-only request status/resume 命令可用；resume 不出现在模型 tool schema，不接受 tool/child 文本伪装调用。
- [ ] 无法证明旧调用停止时 resume 不启动新工作；request reset 不清未确认 Writer hold，迟到 terminal 只更新旧执行。
- [ ] 重载与缺损记录、session 分支切换、过期截止均保持封锁，不由内存初始化获得新额度。
- [ ] 插件 fixture 和真实 SDK/faux host 双层验证，单独断言不同输入来源、事件顺序和延迟事件归属。
- [ ] 用户说明明确宿主能力未知时如何恢复，以及 Root stop 与 child stop 的差别。
