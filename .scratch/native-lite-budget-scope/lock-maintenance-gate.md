# Root 隔离诊断验收与维护授权

用户继续测试的授权有效；失败批次20261028T111239+0800/compare-a2保持stopped，不重试。以下属于修复阻断并准备后续新批次的有限维护，不是新实验启动放行。

## 诊断验收

Root读取实际lock-repro.mjs及114700轮原始JSON：调用现有reserveProviderRequest，无锁fixture预留成功；已有空锁fixture准确报budget ledger lock timeout且账本哈希不变；将fixture锁rename至quarantine后同一预留路径成功。脚本只调用预算函数，不调用Pi/provider；global fetch计数0证明的是该隔离脚本没有fetch调用，不能独立证明历史生产请求的网络/账单事实。三轮日志成功退出表示复现断言通过，不冒充修复前缺失行为的红灯。

直接触发条件与preflight漏检已确认，真实锁创建者未知。旧失败时序是相关证据而非owner证明；报告09:54Z应按源日志校准，09:54+08:00对应01:54Z。

## 进程检查与维护边界

Root只读扫描同uid /proc 的账本环境变量、run-rpc-arm.mjs进程参数、ledger/lock FD：没有匹配进程。12个不可读environ条目经独立cmdline/status核对，属于systemd/sd-pam/gpg-agent/ssh-agent/sshd-session和4个zombie，不含活跃实验runner。fuser先前无句柄，历史与本轮实验已终止。该检查不能保证未来无新写者，因此维护期间所有本项目实验保持关闭，动作前立即复查；发现新runner/账本引用、inode或ledger漂移则停止。

## 批准动作

1. 先最小化补充preflight的锁检测：只要ledger旁.lock存在（包括空文件、symlink或非普通文件）便清楚报告路径/类型/inode并拒绝启动；只在ENOENT时继续，权限/其他错误fail closed。只诊断和早停，不删除锁、不按年龄回收、不改变guard/provider请求路径。先测试运行给出因旧预检漏查而失败的真实红灯，再实现与绿灯，加入故障注入。不得削弱既有断言。
2. 测试通过后允许一次性可逆维护：在/project/tmp下同文件系统独立唯一quarantine目录，保留真实lock原始stat/hash、ledger原始完整hash与事件数；即时核对inode78027473、0字节、owner1000、ledger SHA256 6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920、23事件/13.27409902及无活跃相关writer。把锁rename进该新目录，保留原inode，不删除文件、不修改ledger、不自动回滚或重试。移动后核对锁原路径不存在、quarantine inode一致、ledger完整字节与hash不变。任何条件不符即停报Root。不要用真实reserveProviderRequest试写账本验证维护。
3. 可继续新唯一batch/attempt离线准备，保持相同候选、模型、任务、四臂顺序、成对brief和已验收controller/guard字节及原共享ledger；失败批次所有冻结材料/结果不改。新preflight必须绑定此次锁检测。无需更改controller/guard或引入自动回收。完成后提交恢复证据、红绿日志与新batch冻结材料给Root，未另行放行前不启动provider实验。

所有实现/测试/维护动作交worker，Root审查实际差异与证据；继续worker累计USD1分配，接近0.8汇报。TMPDIR在/project/tmp，重命令前slot audit/status保存日志再slot，禁止提交/推送/安装。旧失败报告不可变副本保留。
