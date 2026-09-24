# 05: 固定版本宿主与发布验收

**What to build:** 用完整、可复查的证据交付 P0，并明确哪些运行模式只封锁委派，哪些已经证明整个 Root 请求停止。

**Blocked by:** 01、02、03、04。

**Status:** needs-info

**Draft:** 尚未发布执行；与 [spec](../../spec.md) 一起确认。

- [ ] 固定插件源码/版本、实际 host 与 launcher；记录本地 peer 0.84.4 和全局 host 0.85.1 的差异，真实 launcher 目标为 0.69.0。
- [ ] 各票的 focused tests 已通过；真实 SDK/faux 断言相同参数、文案改写、跨 Task/recovery、mixed tool batch、scheduled/queued continuation 与下一新输入。
- [ ] 请求封锁后所有 child REQUEST 为 0；确认/未确认取消及 Writer hold 重载均有证据；无 hard cancel 时明确显示 Root 可能继续消耗 token。
- [ ] 真实普通终端/CI 的 CLI+0.69.0 transport 验收覆盖 request/terminal 关联、CANCEL 和 usage；自然语言有界运行与程序注入的 faux 实验分开记录。
- [ ] 对声称 full stop 的模式证明 halt 后无模型/child/自动续跑；TUI 源码或 replica binding 不算真实 TUI 通过，缺失时保持未验证标记。
- [ ] 在普通终端或 CI 跑完整 npm run test:release 及子进程测试，记录 result.error、signal、exit 和输出；sandbox EPERM 不改测试、不算产品回归。
- [ ] 代表性正常任务验证建议默认值的可用性，失败样本保留；若需改值，先明确新值与理由，不让模型自动抬高边界。
- [ ] 冻结中性证据并以独立只读父 launcher 完成 fresh Reviewer strict gate，实际权限探测有证据；最终状态与被审版本一致。
- [ ] 历史模型核验独立列示，当前 0.69.0 无模型证据时标未知；不恢复路由，也不承诺成本节省。
- [ ] 最终报告将“P0 保底通过”和“完整 Root stop 通过/缺失”分列；缺少强制验收就保持未完成。
