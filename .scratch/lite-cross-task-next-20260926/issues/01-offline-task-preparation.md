# 01：冻结跨任务候选及验收口径

Status: done
Type: task
Execution: 离线验证、发布检查、复现及独立核对完成；0 次付费模型调用。

选择 T1 和 T2b，复核 parent RED、masked baseline、gold、答案隔离，保存来源和哈希。T2b 修正旧 T2 提示词的 stage 顺序矛盾，原 T2 保留；同时冻结原 contract 未覆盖的链路审查。

不得修改原测试断言、源仓库或旧实验记录。完整报告和判断依据写入 ../readiness.md。

## 完成记录

[准备报告](../readiness.md)：T1 目标30通过、gold消除一项已有超时失败；T2b 目标10及masked2652通过；原 T2 不变。70个bench文件复现一致，96个历史原始文件哈希不变。T1首次临时检查误报及只读纠正记录保留。
