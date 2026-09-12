# 03: 宿主验证运行与发布矩阵回填（C04～C06/C13～C16 及关闭标准）

Status: ready-for-human

## 背景

本轮收尾修复合规行为（归属、恢复计数、wait 重放、费用守恒、C09 回滚、验收矩阵三级分类），离线套件全绿；但规范 L143/C16 要求宿主验证级证据：升级后启动新 Root、记录 provenance、产生至少一个可审计子运行，且 RunRecord 指纹一致。当前矩阵全部 unproven，提交信息不得声称宿主验证通过。

涉及条目：C04（0.036s/8.913s/15s 时序注入）、C05（三类失败 fixture）、C06（oracle pending 重放 + store 重建）、C13（git_commit handler 覆盖）、C14（同 revision 重复通知只派一个 oracle）、C15（read ceiling/通知字节对比）、C16（reload + 新 run）。

## 验收

1. 安装目录与工作区隔离，reload 后核对 loaded 身份（fingerprint/sourcePath/diskHead）再产生测试 run（C16）。
2. 逐条按矩阵三级分类回填证据；任一缺失不升格（acceptance.ts 门禁已强制，回填时用真实 runId/executionId/rootSessionId）。
3. 关闭标准（spec L165）：认可成功案例中 wait 无法送达=0、非预期裁决改写=0、已知外部 run 计入当前 session=0、错 Task 归属=0、重复费用=0、untasked 持久化丢失=0。

说明：需要真实宿主会话，人工启动。
