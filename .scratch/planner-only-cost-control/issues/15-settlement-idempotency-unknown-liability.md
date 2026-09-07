# 15: 结算、幂等与未知负债

**What to build:** 已完成调用按宿主 Usage 结算并释放未消费预留；重复的 result、notify 或恢复事件只结算一次。确认从未启动才释放全额预留；取消请求、超时、丢失通知都不是停止证明，预留继续占用直到确认。未知 Usage 保持待结算或记为未知负债；未知价格不等于零，已配置费用上限时不能仅凭可见小计放行。token 约束独立于费用约束有效。

**Blocked by:** 14。

**Status:** ready-for-agent

- [ ] 同一 runId 的完成通知重复两次：账本只扣一次，预留只释放一次。
- [ ] 启动失败且宿主确认未启动：全额预留释放。
- [ ] 取消请求后无确认：预留保持；status 显示在途。
- [ ] 子进程 Usage 缺失：记为未知负债，配置了费用上限时下一次启动被拒绝并说明。
- [ ] 子进程模型无费率但 token 已知：token 维度正常结算，费用维度记未知。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（User Stories 33–35，阶段 D 决策第 4 条）。
