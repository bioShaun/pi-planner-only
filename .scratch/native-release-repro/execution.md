# Native 隔离发布验证执行记录

- 开始：2026-10-27T15:09:52+08:00；结束：2026-10-27T15:13:08+08:00（证据整理随后完成）。基线 HEAD `69e521cdbabdd5c198f083491088764a59b8f529`。
- 任务：增加固定版本隔离发布入口、CLI 故障注入、双语开发文档；保留默认本机测试语义。本次为真实 Native worker 模型会话，未额外启动模型对照会话，未 commit 或 push。返工：测试 fixture 增加两个实际导入文件以匹配前置检查；Root 复查后补充 TMPDIR guard 和清理故障注入、文档及最终完整验证。
- Native 试用边界：扩展通知给出的自身 retention 路径为 `/tmp/pi-subagents-uid-1000/async-subagent-runs/...`，属于宿主托管目录；子任务安装及测试使用 `/project/tmp`。仅记录观察，未修改宿主配置或删除该目录。
- 环境：Node v24.14.0、npm 11.9.0、宿主 pi-coding-agent 1.4.0；fixture 固定 pi-subagents 0.83.0、pi-ai 1.4.0。fixture lock 记录 registry 镜像 URL 与完整性摘要。用量：模型 token、费用 unknown；未测性能收益。
- 先写测试：`TMPDIR=/project/tmp/pi-planner-native-release-repro node --test isolated-release.test.mjs`，退出 1，4 项失败；完整 `red.log`。关键输出：`Missing script: "test:release:isolated"`，安装调用为空，退出码预期 37 实得 1。红灯发生于入口缺失，行为断言亦检查未发生的调用；不是语法或导入错误。
- 生成锁文件：预检后 `TMPDIR=/project/tmp/pi-planner-native-release-repro slot cpu -- npm install --package-lock-only --ignore-scripts --no-audit --no-fund --prefix fixtures/isolated-release`，退出 0，`lock-install.log`。
- 同一测试命令绿灯：退出 0，4 passed、0 failed，`green.log`；受控 npm 仅用于边界故障注入，不作为真实 release 通过证据。
- 实际全新目录：`mkdir -p /project/tmp/pi-planner-native-release-repro/real-run`，预检后 `TMPDIR=/project/tmp/pi-planner-native-release-repro/real-run slot cpu -- npm run test:release:isolated`，退出 0，完整 `release.log`。真实 `npm ci` 安装 94 包；typecheck、contract、git、delegate、host、host-runtime（5/5）、handoff、status-color、index 均通过；contract 未跳过。未使用 `/project/tmp/pi-planner-closeout-before-native`。
- 独立比较：新建 `/project/tmp/pi-planner-native-release-repro/compare-xh4zUD`，复制 fixture manifest/lock，预检后以 `slot cpu -- npm ci --no-audit --no-fund --prefix <dir>` 安装，退出 0；`diff -qr` 对比全局与固定 registry 包的 `src`、`agents` 均退出 0，完整 `comparison.log`。比较目录保留供复核。
- 重活前 `slot audit`、`slot status` 记录在 `resource-preflight.log`；首轮 audit 未发现绕过 slot 的重进程。未更改全局安装或模式配置；检查全局 `@earendil-works/pi-ai` 仍缺失，且全局源码和 agents 与固定包一致。此前无完整全局安装内容哈希，不能据此证明其他全局文件完全未变化。
- 原因：`contract.test.mjs` 直接导入全局包的 `src/slash/delegation-adapters.js`，其导入 `src/shared/provider-diagnostics.js`，后者静态导入 `@earendil-works/pi-ai`。pi-subagents 将该包声明为 optional peer（>=1.2.0），但本机全局包解析位置缺失它，Node 源码导入因此失败。隔离 fixture 只解决独立测试环境的依赖解析，不表示运行时插件不能通过宿主加载，也不验证完整运行时插件行为。
- 局限：默认入口仍依赖本机安装并可能跳过缺失源码或因缺失 peer 失败；隔离入口需要 registry 可访问且依赖现有根项目开发依赖。host-runtime 使用受控 provider/delegation fixture，不是完整 pi-subagents 子进程。

## Root 复查后补充

- 返工新增 CLI 验证：拒绝未设置 TMPDIR、仓库目录及指向仓库的符号链接，检查明确错误和未调用 npm；四种安装/运行结果均检查实际临时目录已删除、操作者父目录和哨兵仍存在，安装失败精确传播 42，成功调用 release 的 cwd 为仓库。
- 初次补测 `followup-tests.log` 的四项失败来自测试错误地要求父目录只含哨兵，Node 自身还创建了 `node-compile-cache`；改为检查入口创建的实际目录和前缀后，`followup-tests-green.log` 为 7/7。未发现需要修复的入口行为，未改入口实现。
- 最终完整验证：预检后 `TMPDIR=/project/tmp/pi-planner-native-release-repro/final-run slot cpu -- npm run test:release:isolated`，真实安装 94 包，退出 0；CLI 7/7、contract 不跳过、host-runtime 5/5，完整 `release-final.log`。最终文件 SHA-256 清单见 `final-sha256.txt`。未覆盖旧日志。
