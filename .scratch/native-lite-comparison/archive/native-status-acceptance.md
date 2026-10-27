# Native 状态栏独立验收与本地检查点

日期：2026-10-27。Root 接受并提交 `3db1846`（父提交 `2126209`）。仅提交 CONTEXT.md、README.md、README.zh-CN.md、contract.test.mjs、index.test.mjs、index.ts：217 行新增、13 行删除。无新增修复；保留 reviewer 行为。未推送、发布、合并远端或更改运行配置。

## 实际 diff 验收

- Native Root 用量按观察到的回合累计；子代理用量以 `≥` 显示已记录下限，RPC 不可用或无效时显示 unavailable。文档和 status 命令解释缺失/未完成 workflow 收据等限制。
- RPC 累计快照赋值替换，不做增量累加；异步完成事件按当前 sessionId 过滤。requestId、session generation、当前模式与 sessionId 联合限制旧回复；旧 timer 不得覆盖新快照。
- reset/tree 切换取消在途请求并使代次失效；shutdown 取消请求并卸载 completion listener。Root 检查了 Pi 1.4.0 agent-session.reload：先 shutdown 旧 runner，再重建 runtime，故 reload 清理旧监听器且新扩展重新订阅。
- 只在 Lite 发送 context warning；Native direct execute 拒绝 Lite 工具；RootHandoff.settled/schedule 有 Lite 门控。strict 与 auto handoff 环境设置下的 Native 隔离断言保留。
- 检查完整六文件 diff 和现有 guard fault-injection：重复快照、旧会话/回复/超时、非法版本/数值、失败 RPC、shutdown 清理。reviewer 注册及其已有行为未改。

## 证据绑定

Root 与 fresh worker 独立重算 `.scratch/reviewer-range-integration-20261027/combined-source-manifest.sha256`，192/192 匹配，提交后再次匹配。manifest 包含产品源码、测试、两份 package lock 和 fixture。Root 读取对应 release-combined.log：typecheck、CLI 7/7、cost RPC contract 非跳过、git/reviewer-range、delegate、host、host-runtime 5/5、handoff、status-color、index 通过。退出 0 由原 acceptance 及执行记录提供，日志未内嵌 shell exit。

原 `.scratch/native-status/red.log` 为状态内容缺失的 AssertionError；followup-red.log 为 shutdown handler 缺失的 AssertionError，对应 target.log/followup-green.log 通过。原红灯不是语法或导入失败；单份红绿日志未保留完整 shell 命令/退出码，该限制不隐藏。

源码及 lock 未变化，当前全局 RPC、cost、workflow receipt 与 package.json 四项指纹与原记录及保留的隔离副本一致；不重复跑完整测试。没有重新安装依赖，不将 lock/四项比较夸大为当时所有传递依赖或当前安装完整性的逐字证明。验收范围是本地源码检查点，不是运行安装部署验收。

worker 报告：`/home/tcuni-claw/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/subagent-artifacts/outputs/dd1a40f4-50af-4459-a6bc-5875c36c8c1d/native-acceptance/evidence.md`。

Root 检查 git diff --check、暂存前六文件指纹、暂存补丁与冻结候选逐字一致后提交。提交后 tracked 工作树及 index 无改动，426 个原有未跟踪文件路径集合与提交前一致；本轮没有写入这些文件。原始状态与补丁保留本目录 root/。

## Skill 与调度范围

本会话可发现并读取 pi-subagents、council-mode SKILL.md；subagent guide 的 workflows/recommended-orchestration-pattern 可读取。采用 pi-subagents 的简单单 child 规则，没有为了制造并行启动多余任务。

证据核对 child `dd1a40f4-50af-4459-a6bc-5875c36c8c1d` 的宿主状态记录 startedAt=1793094088409、durationMs=65132（UTC 09:41:28.409–09:42:33.541）。child 自报核对命令窗口 09:41:32–09:41:51，随后生成报告，两者口径不同。Root 同时进行实际源码审查。Root steer/resume/interrupt 干预 0；没有待批准的空等待 child。status.json 没有 usage 字段，不编造费用或 token。

这不是“验证 child ∥ 独立源码 reviewer child”的完整多阶段 workflow 实测，不能宣称第4步完成或 Native 更快/更便宜。后续真实实现任务沿用：单写者固定候选 → 验证与独立源码审查并行 → Root 汇总同版证据 → 需要时才启动集成/修复写者。记录实际开始/结束、重叠、干预与已有用量；不扩展遥测。

supervisor 回复工具在本会话已可见；只读 action:list 成功返回 No pending supervisor requests。支持当前工具可调用，不等同于真实待决请求的端到端回复验证。旧诊断文件保持原样。

## 分支同步方案

只读 git ls-remote 确认 origin/main 为 `8168e126bed60d5a7f485718f17d7114d1322bfa`，与缓存一致。提交后 main 相对 origin/main ahead 5 / behind 3；共同祖先 `6e2c95a091fd0eb17e0ec3b8915affcebc3c29ab`。

远端独有的三个提交为 8168e12、460b710、d765909，净变化只有 CHANGELOG.md 的四行（timeoutSeconds、role diagnostics、steer warning）。本地独有五项为宿主/Lite 收尾、隔离 release、Git 操作归因、reviewer、Native 状态栏。

建议后续在仓库外独立 worktree 从 3db1846 建 integration 分支，fetch 后复核远端，merge origin/main 保留现有验收 SHA；确认净新增仅预期 CHANGELOG 并检查 merge diff，再更新本地 main。若仅文档变化且绑定不变，无需机械重跑 release；若出现产品变化则由 child 执行受影响验证。暂不执行同步、不 rebase 已验收提交、不强推。推送和发布另行处理。

Native 自动 handoff、check v1、遥测实现、thinking 对照继续暂缓；研究文档未混入功能提交。
