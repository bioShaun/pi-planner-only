# Root 通知修复验收与下一批准备范围

## 已验收修复

Root检查实际git diff，行为改动仅stage-a-lifecycle/nativeNotice及run-rpc-arm完成检查两处：允许source===undefined；已登记native-async runId、agent、completed状态仍校验，显式非async拒绝。原有stale/duplicate/failed等断言保留，新增真实通知回放及bad-agent故障注入。

实际通知details与fixture完整相同；安装pi-subagents 0.83.0的buildCompletionDetails确实仅条件复制source。Root核对安装chunk哈希、fixture、原始红绿日志。红灯21 tests/19 pass/2 fail为真实行为断言：nativeNotice完成数0而非1、RPC runner以invalid-native-completion-identity失败。最终22/22通过，包含缺省source的完整mock Root acceptance/cost流程；不代表真实实验已通过。

最终runner SHA256 `83378ce2f839895c43776406ad4a9232665d5399629473b3c1089e2e6bcd2166`；lifecycle `b24158c4336a5260c8ac052851e10ba61ce3c7e6113cfcca9fcb93300db53a9a`。红灯日志 `8c24ae0070938898cb40a2600fbe86f17fd0b9827a00e5cbf4b8c052c989a8c4`；最终绿灯 `30b781b14e982a0d5be46d4411bb6c35437492b4456695863fb42c4c9479cf0b`。原始失败源码和证据已保留；本次未改产品、guard或安装，未跑release。

锁隔离复现证明：在真实guard成功创建文件后由测试门闩暂停，再SIGTERM，能遗留空锁；正常继续则finally释放。但真实compare-b3是Pi exit0，一般failure先end stdin，故不能把该复现归因为真实新锁的确定来源。本次不扩展为自动锁回收或通用锁框架。

## 预算执行决定

用户已授权累计USD30测试费，交互Root排除。旧16请求停止线剩1.21523373，低于上一首臂reserve1.51066725；继续沿用会有明显中途停止风险。批准新批次guard停止线**26**，保持至少4美元余量。不增加用户累计额度，不退历史预留、不清零、不重建账本；旧批次16门及失败证据保持历史事实。

Root重新核对控制worker263条unique assistant reported USD0.73484126，无cost缺失；session SHA256 `e42609b41ea9263ad5b844a8b53ffd42ce413b6ce769af82cca9aa174139ca60`。已知纳入reported小计6.24077142，非最终账单。

将本worker累计内部控制分配从1提高至**2美元**（含已发生费用，不是再加2）。历史控制5.40165224+本worker预留2=7.40165224，仍低于现有控制reserve11.41064652，不新增真实ledger事件；接近1.8报告。额度只是调度限制，不冒充provider硬限。

## 授权下一步（尚未放行实验）

1. 保存16版本guard及源码hash作为不可变基线。以最小变更使新harness guard停止线26（常量及对应诊断），不引入可任意上调的环境变量；provider/model/payload/schema/output cap/请求预留/锁/checksum/并发原子性保持。先写新边界的行为测试并运行真实红灯，再实现绿灯。证明16至26之间合法追加、达到/超过26拒绝且账本不变；保留旧16基线测试及不相关拒绝断言，不通过删除守卫断言恢复绿灯。测试使用fixture账本；真实账本不作试写。预算guard相关测试、controller聚焦测试（含Lite host）及本项目规定test:release按适当隔离环境运行一次，所有TMPDIR仓库外、重命令先slot审计留日志。
2. 测试通过后，一次性维护当前真实lock inode78027492，条件同前次独立维护但绑定新ledger SHA256 `da3444382a03d6db8bff5af57a83e7788e1a658ae0c398ce894499333e8b9a31`、44事件/reserved14.78476627。所有相关实验writer停，重新检查进程/FD、lock inode/uid1000/0字节，发现漂移/占用或相关不可识别进程则停报Root。只rename到全新同文件系统quarantine目录，保留inode/stat/hash与before/after，账本字节完全不变，不删锁、不试真实reserve、不自动回滚或重试。不能运行硬编码旧23事件/旧inode的维护脚本。
3. 准备全新batch/attempt四臂：候选、模型、任务、顺序不变，采用已验收新runner/lifecycle和经过测试的26 guard；严格重算controllerFiles而非复用旧lock hash。依然使用原共享ledger44事件前缀，锁预检必须生效，成对brief同字节、全部manifest/settings/runtime/输出目录检查完整。准备报告只需当前状态、精确启动命令和证据索引，长篇历史指向不可变归档，避免重复旧值。
4. 完成上述准备后提交Root审查；不启动provider实验、不重试旧批次，不新增非协议子代理。当前有效样本仍0。产品源码、全局安装及无关用户修改不动，不提交/推送。需要改变本范围之外的guard语义或停止契约，先向Root报具体问题。
