# 执行结果

已完成固定版本隔离发布入口及真实 release 验证，未发现阻塞。入口在仓库外新建并清理自己创建的目录，锁定 pi-subagents 0.83.0 与 pi-ai 1.4.0，先验证源码与 agents，再传入 `PI_SUBAGENTS_DIR` 调用原有 `test:release`；安装及 release 失败向上传递。默认入口仍验证本机版本。

变更：`package.json`、`scripts/test-release-isolated.mjs`、`isolated-release.test.mjs`、`fixtures/isolated-release/package.json` 和 `package-lock.json`、`README.md`、`README.zh-CN.md`，以及本目录证据。未更改产品 peer、模式或运行时插件。

根因：contract 直接导入 `src/slash/delegation-adapters.js`，经 `src/shared/provider-diagnostics.js` 静态导入 `@earendil-works/pi-ai`；上游声明它为 optional peer，而本机全局解析位置缺失。此问题是独立 Node 源码测试环境依赖，不足以推断宿主中的运行时插件不可用。

红灯：`red.log` 记录 4 项失败，包含 `Missing script: "test:release:isolated"`、安装调用为空和预期退出码 37 实得 1；绿灯 `green.log` 为 4 passed、0 failed。红灯时入口本身尚不存在，除行为断言外 npm 也明确报告缺少脚本。

真实 release：全新 `/project/tmp/pi-planner-native-release-repro/real-run` 下执行 `TMPDIR=/project/tmp/pi-planner-native-release-repro/real-run slot cpu -- npm run test:release:isolated`，真实 npm ci 安装 94 包，退出 0；contract 实际通过，host-runtime 5/5，完整日志 `release.log`。不使用上一轮目录。锁定 registry 包与本机全局安装的 `src` 和 `agents` 均 `diff -qr` 相同（`comparison.log`）。全局 pi-ai 仍缺失；未执行全局安装或修改模式配置，其他全局文件没有运行前完整哈希。

资源检查见 `resource-preflight.log`，完整命令、版本、时间、局限和用量见 `execution.md`。局限：固定 fixture 测的是固定版本且需要 registry；默认本机入口可能因依赖缺失失败，host-runtime 不是完整插件子进程验证。未暂存、提交或推送。
