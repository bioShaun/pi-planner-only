# Root 首臂启动放行

批准新批次 `/project/tmp/pi-native-lite-20261028T111239+0800/`、attempt `compare-a2` 的 S1-native **一次**，20分钟deadline。其余臂尚未放行，任何错误、失败、超时或guard停止均停止本批后续启动，不自动重试。

## 已独立核对

Root读取新增prepare/refresh/verify/helper/test实际源码及原始红绿日志，核对修正前4 fail/1 pass是旧workspace、session示例及settings绑定断言失败，非语法/导入错误；修正后5/5，含篡改workspace hash拒绝的故障注入。最终verify exit0。红灯针对错误冻结材料，不能据此声称复现了provider行为。未重跑已验收controller20/20；本轮测试由worker运行。

Root逐臂重新计算实际tree/diff/nonignored files的workspace SHA256，与lock/manifest一致；实际brief与briefSha256/pairedBriefSha256/lock一致，ignored settings一致，tracked diff为空，输出目录无文件。七个controller/extension实际文件与lock一致，user settings实际文件hash一致。主repo tracked diff仍仅为已有recommendation两行变更；新增untracked实现文件已直接审查。

- 权威worker报告SHA256 `2b3712ecdcd3682de42c8493d77da89f49de676248b3b5cc703c7d17319af573`；路径 `/project/tmp/pi-native-lite-budget-scope/worker-report.md`。
- 最终runtime-lock SHA256 `530e15d0e04d0dec96257dae468edeb01ca4687ed04b5d1cf3340c60c0d75c63`。
- S1-native manifest SHA256 `42c3e21f29c1356651a772638c24865e4703aaab8b1fbccba586a1ae444ad4fe`。
- S1 brief SHA256 `93eafd9a0ad564818ea136a4921bf91de24db1292ff4fe660d25f93b9395a9fa`。
- runner SHA256 `396e8697680f178a077615538a4a94ab16f87a43b017420521ca7a722c6ec809`。
- 红灯日志SHA256 `cf5668525423490e58e5a3c3937592a59a81b0d380117082eaa2bc771f1452fe`；绿灯 `1be66e8b81adaa6a74a754d65a3f2cb43bb8fc11eb6f9d84ebfbe79658f98d58`；final verify `9dc10b36072f6ee4041be83a02c40c11c8a278af289058c6d2733c400b8e5f9b`。
- 修正前lock实际保留，SHA256 `d2519f1ee22732fdcf22e87abf708ce9f4789ffad20768e0bb70c022a8112c65`。

## 预算与放行范围

原共享ledger实际仍23 events、reserved13.27409902，完整文件SHA256 `6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`。请求停止线保持16，余2.72590098；累计授权30仅测试范围，交互Root排除。

Root重读worker唯一session：81条unique assistant usage，reported USD0.11618982，无重复/缺失；检查点SHA256 `f58654e56c6275829ed893a3ae0dab5ea900067a25a24fa487c4b3cd1e9e27d3`。纳入范围已知reported总额5.58519756，控制预留11.41064652仍覆盖历史控制5.40165224及本worker累计1美元分配；不是新增ledger事件。后续增量继续核算。

使用上述报告中的确定性启动命令，显式PI_CODING_AGENT_DIR=/home/tcuni-claw/.pi/agent；cwd必须为本批worktrees/S1-native，绑定本批manifest、原共享ledger，TMPDIR/TMP/TEMP指向本批外部tmp。启动前再次核对冻结hash/ledger/output未占用，保存新的slot audit/status日志，然后通过slot cpu运行受控RPC harness。仅允许guard为实际请求正常追加预留，不得人工重写、退款或补控制事件；不得修改已冻结输入、controller、guard或全局安装。

运行完成收集provider fingerprints与每笔ledger对应、真实Root session/child身份与终态、Root acceptance、报告实际hash、候选及运行配置不变、费用与退出码，交Root验收。启动成功本身不是有效样本。

原始准备失败stdout曾被覆盖，恢复件仅是session工具响应转录，该局限已如实记录。采用权威worker报告作为合并预检入口，不再要求重复preflight.md。离线检查不证明完整四臂能在16停止线内完成。
