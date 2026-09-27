# 运行内临时目录约束：修复完成

2026-09-26，独立最终审查 PASS；仅验收本次执行入口修复，没有新增付费样本。
[验收状态](acceptance.json) · [最终审查](reviewer-round-4.txt) · [验证汇总](round4/validation-summary.json)。

## 已实现

- bench/run.sh 成为共同入口，在任何 Pi 调用之前由 temp_guard.py 安装并实测 Landlock 限制，再进入 run-body.sh。模型列表、版本、可选健康请求和三臂执行都处于同一进程树限制内。
- /tmp 写入限制由本地进程及其后代继承；明确设置经验证的仓库外 TMPDIR/TMP/TEMP，并给三臂同一资源说明。Root 转发提示词是行为要求，内核限制不依赖模型转发。
- 统一读取 /proc/self/mountinfo，收集 /tmp 及其子挂载的文件系统设备。目录选择、权限授予、BENCH_OUT 和 STOP 都使用同一禁用集合；若存在向 /tmp 外暴露这些设备的挂载，则启动前拒绝。
- 限制不可建立或验证失败时，任何 Pi 调用之前 BLOCKED；仅在证明安全的目录/常规文件上写 STOP，不进入 RETRY。路径、目录描述符和文件描述符均检查，避免失败记录自身写入禁用存储。
- 原有 arm 路由、Pi 退出码、评测结果和计费接口保留。新增 tempResource 元数据，记录 backend/ABI/临时目录。

## 验证

- 29 项离线回归通过；原有 14 个测试方法和断言表达式完整保留。
- 当前内核上的真实父进程、Python 子进程、bash 后代拒绝 /tmp 创建/写入，允许指定项目临时目录。
- 三臂真实 Pi dry-run 通过，只查询模型列表/版本，没有生成请求。
- 无保护启动的安全红对照被测试捕获；该对照只写自有测试标记，不尝试未受保护的 /tmp 写入。
- test:release 的 typecheck、contract/git/delegate/host/index 全过，所需重任务均先记录 slot audit/status 再经 slot 执行。
- 历史 72 个原始运行文件哈希未变。真实 bind mount 没有创建，别名和特殊布局用自有模拟夹具注入验证。

前几轮审查发现的选定目录别名、STOP 记录别名和权限授予别名均已关闭，历史评审及失败对照保留。

## 适用范围

要求 Linux x86_64/aarch64、Landlock ABI 3+、可读的挂载信息及安全的 /project/tmp；本机实测 x86_64、ABI7。
同设备拒绝是保守规则，可能拒绝实际并非别名的路径；无法确认安全时不降级运行。
它限制本地进程树的文件写入等操作，不是通用沙箱，不约束已经打开的描述符、所有元数据操作、既有外部守护进程或远程执行器；不承诺抵御预检后由高权限宿主发起的挂载变更。
参考：[Linux Landlock 文档](https://docs.kernel.org/userspace-api/landlock.html)。

## 与旧实验的关系

此前三次 Opus 的“任务质量/计费 PASS、执行规程 FAIL”原样保留。本修复不追认旧结果，也不自动补跑或使用剩余预算。
新保护和公共资源说明属于新的冻结条件。未来付费样本须另定范围、预算并重新冻结。
当前工作树改动及复现材料在 accepted-freeze/；accepted-implementation.patch 仅包含本次修复差异。此前 final-freeze/ 是第二轮候选历史，并非本次最终版本。
