# off/native/lite 模式实现完成

Status: completed — release、真实宿主验证和独立最终审查通过；没有付费模型试跑。

用户认可的最小三档已实现。默认仍为lite；native仅注入中性指引「实现和跑测试交给子代理，自己负责拆分、检查 git diff 与测试结果。」，原生工具和子任务生命周期由pi-subagents管理。native/off不启用Lite工具、strict限制、上下文提醒、handoff或Lite费用统计；直接绕过工具可见性调用Lite工具也会被拒绝。

## 使用

在更新后的插件中执行：

```text
/planner-only native
/new
```

恢复Lite：`/planner-only lite`后新建会话；`/planner-only status`查看当前模式、新会话选择及环境覆盖。旧`on`/`off`仍是即时Lite/关闭开关；有运行中的Lite委派或未确认停止的cwd锁时拒绝会话/模式切换。模式偏好保存在用户agent目录的`planner-only.mode`，不修改模型设置；新会话也可用`PI_PLANNER_ONLY_MODE=native`选择模式。

新会话优先级为MODE环境变量、旧PI_PLANNER_ONLY布尔环境变量、保存的偏好、旧off标记、默认Lite。已绑定会话在reload/resume时保留自己的档位；旧布尔环境变量未被MODE替代时保留即时覆盖行为。档位不会自动切换模型。

## 实现与验证

- 修改`config.ts`、`index.ts`、`index.test.mjs`和双语README、CONTEXT；既有断言保留。
- 增加模式选择、恢复/重新加载、原生工具可见性、直接调用拒绝，以及进行中/迟到终态锁的故障检查。
- 实际Pi0.87.1测试发现仅在session_start阻止忙碌切换太晚，已改为session_before_switch/fork/tree检查。保留[RED](host-busy-red.log)和[GREEN](host-busy-green-1.log)证据。
- [完整release](impl-release-rework.log)通过typecheck及contract/git/delegate/host/index五套测试，重任务经已审计slot cpu，TMPDIR在仓库外。
- [实际宿主生命周期检查](host-busy-green-1.log)覆盖new/reload/resume、两种扩展顺序和忙碌切换，网络及模型调用均0。
- [真实pi-subagents检查](upstream-check-3.log)使用Pi正式扩展加载器，验证subagents_enable后可调用subagent的管理列表接口，两种加载顺序均通过，未启动child或模型。首次裸Node导入缺少宿主peer别名的失败日志保留，未误记为功能通过。
- [独立审查](reviewer-result.txt)及[验收状态](acceptance.json)为PASS(final)，普通只读行为审查，不声称强制沙箱隔离。

## 边界

native是便利模式，提示词注入位置与旧benchmark的用户消息前缀不同，不宣称逐字节复现旧请求。公平A/B仍需两个干净起点、同模型配置和新会话。

当前版本不保证运行中reload时跨插件实例的锁隔离；先完成子任务并确认停止，再重载扩展。未建立实际付费模型下的效果结论，也未发布新版本或修改用户的实际全局偏好。使用细节见[中文README](../../README.zh-CN.md)。
