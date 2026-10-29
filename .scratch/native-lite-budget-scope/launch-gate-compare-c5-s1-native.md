# Root compare-c5 首臂放行

批准batch `/project/tmp/pi-native-lite-20261028T124534+0800/`、attempt compare-c5、S1-native一次，20分钟deadline。其余臂等待逐臂验收；旧批次不重试。

Root检查实际git diff：预算core仅BUDGET_USD 16→26及错误消息动态引用上限，其他provider/model/费率/output/校验/锁语义不变。独立读取预算test及原始红灯（5项2pass/3fail，常量/旧schema上限/并发拒绝差异，非语法导入错误）和绿灯5/5；原16基线仍测试拒绝。controller+Lite host原始23/23通过，隔离test:release exit0，含typecheck及release suites。测试由worker执行。

Root逐臂重新计算workspace/brief/manifest/settings与runtime lock一致，tracked diff空、results无文件。七个controller实际hash及实际user settings匹配。维护后的lock原路径不存在；quarantine实际inode78027492、uid1000、0字节保留；真实ledger完整hash仍da3444382a03d6db8bff5af57a83e7788e1a658ae0c398ce894499333e8b9a31，44事件/reserved14.78476627。

冻结：
- worker报告hash f9dfdb6c74b87459c1fd2d655629f87dcab0e8324066c0ec263c99c7af4f71e8
- runtime-lock ee30903574c3074453847d1c706f965692ff9fa65de591bf22ad909bfd58dd59，budgetStopUsd26
- S1-native manifest f55cb27420e77296682e16585d376bedafddc95e4e48a68cd76fd4c56247ce17
- S1 brief ea7f3f072ee2be75b455276ae2d45e43c300e1d9473cef7f2422118b305bf2c3
- runner 83378ce2f839895c43776406ad4a9232665d5399629473b3c1089e2e6bcd2166
- guard core 2f25d8425eb7afceab50912bd6394433b6c4d668572e213b9f6879b1998cefb6

原始预算日志实际位于 `/project/tmp/pi-native-lite-budget-scope/budget-26-red-isolated.stdout` 和 `budget-26-green.stdout`，不在budget-26子目录；controller/release日志在该子目录。Root已读取实际文件。报告路径歧义不影响上述验证。

Root重读同一控制session316条unique assistant，USD0.99288228，无缺失，hash a01cb38d77110f035f233a108f94d4a298237f1158f5b4be6c5f5c731e95d967。不叠旧快照；纳入范围已知reported小计USD6.49881244，非最终账单。控制累计分配2美元仍由旧控制reserve覆盖，用户总上限30测试费；26请求停止线距当前ledger余11.21523373。

执行权威报告当前首臂命令：cwd新batch/worktrees/S1-native，PI_NATIVE_LITE_BATCH_ID=20261028T124534+0800，ATTEMPT=compare-c5，MANIFEST绑定本批S1-native，显式PI_CODING_AGENT_DIR=/home/tcuni-claw/.pi/agent，原共享ledger，外部TMPDIR/TMP/TEMP。启动前核对冻结hash、账本、锁不存在及输出空，保存新的slot audit/status，然后slot cpu运行RPC harness一次。不能修改已冻结配置、人工改账本、处理新锁、自动重试或启动其他臂。

成功/失败后提交真实provider fingerprints与ledger对应、Root/child usage及身份终态、最终Root acceptance/报告hash、候选与配置不变及exit/wallclock。失败/timeout/guard stop即停止本批；成功也须Root验收后才启动下一臂。启动放行不等于有效样本验收。
