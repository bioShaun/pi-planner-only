# S1 第一阶段 Root 检查：准备与红灯完成，实现未完成

执行run `59f79243-4abc-427b-8648-c452c0264f58` 正常结束；workflow `7fa0909a-785c-4c44-a0db-8eef3ed58c1b` complete。正常退出不代表任务完成：费用停止机制未实现、无绿灯、无真实校准，Root不验收为完成。

Root实读最终 worker 报告 `/project/tmp/pi-native-lite-s1-link-current-worker-report.md`、原始 cost-red.log，并比较 initial.diff 与当前实际 git diff。本子阶段对tracked文件仅新增 process-controller.test.mjs 中的fake Root费用事件和对应测试；未更改runner/guard实现，既有其他diff保留。

红灯 `/project/tmp/pi-native-lite-s1-link-control-1hFkrTek/cost-red.log`：1 test，0 pass，1 fail；断言“arm must not succeed after reaching its reported cost threshold”失败，实际exit0。属于行为缺失红灯，不是导入或语法错误。后续应保留这条测试并完成实现，不以删除/跳过测试恢复绿灯。

终态控制session按assistant entry id去重44条，重复0，缺费用0，reported USD0.33442880；历史USD8.01491262加该终态值后USD8.34934142。终态session SHA256 `7b7fc0d66bacddb3b5d31da08d6f83495d1ed73128ae491a3a84e48908df2bca`。恢复同一session后重新结算整个session替换此值，不能重复加快照。USD1.50控制检查点仍针对此连续工作累计，不因恢复重置。

Root本次核验共享ledger SHA256仍 `e2f88530b5fd448da53572be3401e74ceb9e6a17af971247d5144f6fbe2b354d`，锁不存在。未签发provider launch gate。

后续拆分：先完成已取得有效红灯的Root终态费用阈值检测与明确失败记录，添加并先跑缺失/无效费用、低于阈值等必要故障场景，再实现绿灯。此为可验证增量，不代表完整费用监测已完成，不启动provider。随后沿已批准实际执行形态契约补child费用观察与取消/清理证据、双方真实runner离线集成及适用release、重新冻结。若具体新增行为尚未有红灯，必须在实现前取得。

Native持久runner按自身observed process proof验收；纯in-process Lite按匹配委派身份的实际执行settled与cleanup验收，不强制Native实例字段。取消ACK不能单独证明终止；未确认记录unobserved并停止后续。这项澄清取代先前过度统一的终态字段要求。
