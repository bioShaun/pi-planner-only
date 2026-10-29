# Root 恢复检查点

工作流 `58f84760-ac9f-49fe-9dae-8a7d05e0c4c5` 的 child `1bd4bca7-7a5c-4d98-9675-e34945b68eb9` 在1800000ms超时，保留 failed/timeout 结果，不能改写为成功。Root已读保留输出、实际部分文件与原始检查日志。process-terminal.json 为 observed/resumable，原写者已退出。

范围：当前HEAD仍27c3165；产品tracked源码未改。新增准备文件位于本目录。历史共享账本SHA256仍 `dc9e71b30b194b79ce1a15c09500341e74b90ab17904e84e7ade55878616cf5e`，19事件；生命周期runner仍 `dc790102fb95a0af8333fb7432a4d966cd1fe8c3bc5fbb4911efe6fd5a97f8dc`。未批准追加账本或实验启动。

Root已检查：
- S1 brief已补Root session公式及Lite requestId/ownerRunId/nodeId。
- budget-transfer.mjs、更新后的测试和ledger-transfer-plan.json已可审查。
- logs/preflight-final-tests.stdout：9/9通过。
- logs/verify-freeze-final.meta：exit0；stdout核对758个pi-subagents文件、337个Pi文件、四臂workspace和19事件账本。
- logs/budget-transfer-noop-baseline-red.stdout：实际追加断言及拒绝行为5项失败，非语法/导入错误；属于实现后的补充故障复现，不是原始test-first证据。

日志根 `/project/tmp/pi-native-lite-reopen-control/`。权威worker-report.md仍是修正前版本，不能按旧hash放行。恢复仅需核对既有最新证据、补缺失材料并更新权威报告；不重做已通过工作、不扩展范围、不启动实验。

费用：原child唯一会话117条assistant usage总计USD0.25610684（不含主会话，不是账单）。会话SHA256 `8e72f9ffccfd157cbd9f4456c2fddf3a9e4c86dfd65d499b8386d6cccd674bdb`；路径见原run元数据。恢复可能延用该session，后续应按唯一session/message重新汇总，不重复累加旧费用。

按同一原生机制恢复一次。再遇运行失败应停止并提交具体checkpoint；不切换CLI、不循环重试。slot及外部TMPDIR规则继续适用。
