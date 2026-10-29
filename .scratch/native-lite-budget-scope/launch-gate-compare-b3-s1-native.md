# Root compare-b3 首臂放行

批准 `/project/tmp/pi-native-lite-20261028T115324+0800/`、attempt `compare-b3` 的 S1-native 一次，20分钟deadline。旧compare-a2保持stopped；其余三臂尚未放行。

## 已验收维护及预检

Root直接读取lock预检helper/test、维护脚本、原始红绿输出和新verify exit0。红灯5项均因新API assertLedgerLockAbsent尚未实现而TypeError，并非语法/模块导入错误；它证明缺少新增检查接口，不单独证明旧verify实际漏检。旧verify在真实lock存在时仍exit0的归档记录另行证明接入缺口。绿灯7/7覆盖ENOENT、空锁、symlink、directory、EACCES、EIO，及源码级调用顺序检查。调用顺序检查是静态断言，不冒充进程级集成故障注入。helper只读lstat，非ENOENT一律拒绝，不自动回收。controller/guard未改。

Root独立重算维护前后JSON及账本hash：before `568cf9f5430c9044e04a0ce735efd9ed0aa762f7d24bf8d0765d59033fe035ca`，after `272a6cf85b0c72b8b44d1f705b6ff6d82e1a401a7d8fa1730f22d9282cc4a505`。quarantine路径 `/project/tmp/pi-native-lite-budget-scope/quarantine-20261028T120000+0800/lock-quarantine/budget-ledger.json.lock` 实际inode78027473/uid1000/0字节/空文件SHA不变；原lock路径不存在。真实ledger仍SHA `6b72f0adfa250179ee3351a3d6e924c1ca224ffd44b3f9f3b6504213d7b47920`、23事件/reserved13.27409902。

维护脚本第一次因目标目录已存在在rename前退出，原lock未动，随后在唯一子目录成功rename一次。没有删除真实lock、真实reserve试写或自动回收。该脚本是一次性授权维护工具，不是通用并发安全锁管理器。

## 新冻结配置

Root逐臂重新计算tree/diff/nonignored files的workspace SHA及实际brief；四臂与manifest/runtime-lock一致，tracked diff空、results无文件；7个controller/extension实际文件和user settings均匹配锁定hash。

- 权威报告SHA256 `8341c75290c797853eb6b6b5eb9a1783fb0e443887268d5158ea3ea71e124bd3`。
- runtime-lock SHA256 `506341447eeb94855d57379fa49586534d83b47dd4e9aa7884e97e33f9cf2e71`。
- S1-native manifest SHA256 `28d7198835b688aa1b700a9e397518eaa42e09e6b371f3dbcaaa3a3429cd3de1`。
- S1 brief SHA256 `87ec6cb933cb65fe9ed7ab6174697ce46c4b057174308a871e92132e48a40797`。
- runner SHA256 `396e8697680f178a077615538a4a94ab16f87a43b017420521ca7a722c6ec809`。
- final verify原始日志SHA256 `5e553f9b38f4dfd459d59c782a8a703e8d4fc09789af3aef7af3463f4710ccbb`。

Root重读控制worker同一session177条unique reported USD0.39261972，无缺失；session SHA256 `7859f19329399aad90a18abf416a01826e598769b3bde0f5eb71b092cfd919b0`。已知纳入reported小计USD5.86162746，旧失败实验无usage账单仍未核实。控制累计USD1分配继续，ledger距16停止线2.72590098。用户测试累计授权30，交互Root排除，金额口径不变。

## 确定性入口及边界

执行cwd `/project/tmp/pi-native-lite-20261028T115324+0800/worktrees/S1-native`。命令：

```sh
env PI_NATIVE_LITE_BATCH_ROOT=/project/tmp/pi-native-lite-20261028T115324+0800 \
  PI_NATIVE_LITE_BATCH_ID=20261028T115324+0800 PI_NATIVE_LITE_ATTEMPT_ID=compare-b3 \
  PI_CODING_AGENT_DIR=/home/tcuni-claw/.pi/agent \
  PI_NATIVE_LITE_SHARED_LEDGER=/project/tmp/pi-native-lite-20261028T054700+0800/budget-ledger.json \
  PI_NATIVE_LITE_MANIFEST=/project/tmp/pi-native-lite-20261028T115324+0800/manifests/S1-native.json \
  PI_NATIVE_LITE_RPC_DEADLINE_MS=1200000 \
  TMPDIR=/project/tmp/pi-native-lite-20261028T115324+0800/tmp \
  TMP=/project/tmp/pi-native-lite-20261028T115324+0800/tmp \
  TEMP=/project/tmp/pi-native-lite-20261028T115324+0800/tmp \
  node --experimental-strip-types /home/tcuni-claw/pi/pi-planner-only/.scratch/native-lite-lifecycle/run-rpc-arm.mjs
```

worker启动前重新确认冻结字节/账本/输出空及lock检测，保存新slot audit/status，再通过slot cpu执行上述命令一次。lock检测不替代实际请求guard锁，发现新锁即停止，不能自动清理。仅guard正常请求可追加共享ledger预留；不人工改账本/配置，不绕16停止线，不重试，不启动其他臂。结束后核对真实session/provider指纹、ledger请求对应、child终态及报告hash、Root acceptance、费用、候选与配置不变，交Root验收。
