# Root 失败验收与停止记录

批次20261028T111239+0800，attempt compare-a2：S1-native失败，余下S1-lite/S2-lite/S2-native取消。有效样本0，完整pair0。首臂一次启动授权已消耗，不重试本批。

Root独立读取实际control.jsonl、stderr、slot运行meta、内嵌session角色并重算文件hash。运行时间2026-10-28 11:31:09–11:31:16 +08:00（control为03:31:09–03:31:16Z，子代理通知所写11:31:16Z不正确）。Root模型/高思考/session身份匹配，prompt started，随后本地budget guard报 `budget ledger lock timeout; fail closed`。Pi/slot exit73；无child、无Root acceptance。内嵌session只有system/user，没有assistant usage；其余三臂结果目录无文件。

核实hash：
- 权威worker报告 `eac0662f7e5645a1365b3204665842d1cbb01598b934b91f9be1809355291946`
- control `70bf553e1c952aa71781532e36fcc39fa6ee42335e387b1f5b3a70a94e20a64c`
- session事件流 `847c0fde5b9e5cdbdcc0144f02735f22f4a6756c7d940fb61d5fc961a8720af7`
- stderr `e8fff94f09da1aeac0601f988a5f767869afb446bfdff1044ba4c71f44849f15`
- 原ledger `6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`，仍23事件/reserved13.27409902，无新事件。

原账本旁0字节lock：inode78027473，mtime/ctime/birth为2026-10-28 09:54:54.289402780 +0800；早于本次启动。Root运行fuser无输出、exit1，说明本次查询未发现打开句柄，不等于已充分证明可安全删除。未删除/修改lock或ledger，未杀进程。锁持有者、来源及中断清理机制仍待隔离复现和调查；不以mtime自行宣称根因已确定。

本轮Root检查worker唯一session108条assistant usage，reported USD0.19095878，无缺失cost；hash `abc40af3d05f7ce57b1a3460e9489f344f05e91f33a7208955e00c3fbb0639f8`。纳入范围已知reported小计5.65996652，不重复累加旧检查点。实验未报告usage；发票未核实，不能由空日志宣称最终计费为零。交互Root仍排除，实验/控制预算口径不变。

后续仅授权独立离线诊断：在/project/tmp新隔离目录复现相同锁超时和无锁对照，收集进程/历史终态/锁来源只读证据，提出安全恢复和防回归方案供Root审查。真实ledger/lock、controller/guard及冻结失败批次不改，无新的provider实验或其他臂启动。实现与测试由同一worker执行，继续已有累计USD1控制分配；Root审查证据。使用diagnosing-bugs技能，先取得确定可复现命令再作根因结论；任何后续行为修复须先行为红灯再实现绿灯，且新增守卫有故障注入。
