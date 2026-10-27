# Root 复查补充结果

已完成补充验证，未修改入口实现。CLI 故障注入覆盖 TMPDIR 未设置、仓库路径和指向仓库的符号链接：均明确报错且未启动安装或 release。成功、安装失败、release 失败和缺源码四条路径均在测试夹具清理前确认入口创建的安装目录已删除，操作者父目录及哨兵保留；安装失败精确退出 42，release cwd 为仓库。

双语 README 现注明根项目先运行 `npm ci`、TMPDIR 必须已存在，以及中断后的清理不作保证。`execution.md` 已修正真实 Native worker 会话描述并记录宿主 retention 目录与子任务临时目录的边界。

最终验证：`TMPDIR=/project/tmp/pi-planner-native-release-repro/final-run slot cpu -- npm run test:release:isolated`，退出 0，真实 npm ci 安装 94 包，CLI 测试 7/7，contract 未跳过，host-runtime 5/5。完整输出为 `release-final.log`，代码与关键日志的 SHA-256 清单为 `final-sha256.txt`，资源预检追加于 `resource-preflight.log`。

首次新增测试的 `followup-tests.log` 记录测试本身的过严断言：Node 在父目录建立了 `node-compile-cache`。修正测试以确认实际安装目录删除后，`followup-tests-green.log` 为 7/7；没有发现入口行为缺陷。旧日志未覆盖。未 commit、push 或修改全局配置；清理不保证中断信号场景。
