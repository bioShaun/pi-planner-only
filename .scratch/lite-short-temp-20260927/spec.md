# 短临时目录修复与剩余三条续跑

Scope: 用户要求继续推进，直到确需其决定；本轮保持原4次尝试／$10 actual运行间检查点，不增加模型尝试，不修改任务或质量标准。

## 已确认原因与修复

真实 multiprocessing.Manager 复现与2×2离线对照确认：83字节物理TMPDIR导致任务Python3.12的AF_UNIX路径超限，18个失败同时出现在未改源码与本次产物；使用短路径后两者都消失。本次产物短路径下目标30通过、masked1111通过/12项既有失败；未改源码masked1110通过/13项既有失败。该结果仅为离线反事实证据，原付费运行、质量FAIL、STOP和$1.29824603支出不改写。

入口增加真实AF_UNIX listener预检，保持原Landlock及/tmp禁止写保护。预检使用任务JSON中的Python解释器；系统Python3.13与任务Python3.12的socket路径生成方式不同，不能用前者替代后者。无task配置的通用guard测试fixture使用guard解释器；存在配置但python字段无效则拒绝。失败发生在任何Pi预检/调用之前，退出3、写STOP、不写RETRY。探针在新子进程中运行，显式TMPDIR/TMP/TEMP相同，10秒超时，listener关闭后退出，不派生Manager服务进程。

## 剩余范围与归属

保留原顺序的第2–4条：T1 lite、T2c lite、T2c native。第1条T1 native禁止重跑。新环境单独冻结为 `opus-cross-task-t1-t2c-short-20260927`，原campaign STOP保留；不对原campaign使用 `--resume` 或改写原结果。

[execution/paths.json](execution/paths.json)固定完整runId到短物理目录的映射，位于 `/project/tmp/ps-3d74eb12/r2`、`r3`、`r4`。执行前目录必须不存在；创建后核对真实路径，metadata的tempResource.tmpdir必须与映射一致。归档从该metadata与冻结映射定位child文件，不再拼接长任务名称作为TMPDIR。clone和结果目录仍保留完整campaign/runId，便于追溯。

原尝试已占1次及$1.29824603。所有后续费用与原支出相加后用于$10检查点；剩余最多3次，串行、无重试/补样本/付费健康请求。单次3600秒沿用原方案，不将运行间检查点称为实时硬限额。预算、结果不完整、质量、隔离或资源任一门槛失败即停。第2条必须在本轮独立验收通过后才能启动；第3/4条必须有Root上一条continue=true且累计费用低于10的记录。

模型、插件、任务定义、child配置与中性提示词不变，strict/handoff关闭。T2c附加链路检查仍必须完成，不能只看54项目标测试。T1两次处于不同运行条件，原native也未通过原质量门槛，因此不构成公平费用配对；T2c两臂统一短路径环境，可以在两臂均有效合格时并列结果，但不发布稳定节省比例。

## 验收与证据要求

- 2×2日志中18个环境失败集合精确对应；旧源码/产物字节分别与BASE/归档一致，原157项证据不变。
- 新真实入口故障注入先RED后GREEN：任务Python3.12长83路径在body前拒绝，短路径的真实Manager可用且/tmp仍拒绝。已有35项断言不删不弱化；当前36项回归及完整release通过。
- 独立三条dry-run只做入口/模型列表/版本检查，无Pi模型任务。新82项源码冻结、11项执行入口和161项历史证据哈希均需核对。
- 所有真实重任务先记录并检查slot audit/status，再经slot cpu。保留克隆、完整diff、改动测试before/after、child终态及raw，用独立证据核对后再做清理决定。
- 修复代码和剩余清单独立审查通过后，按最新用户授权继续执行。若需超出原4次/$10、改任务定义/质量标准或追认历史结果，才交由用户决定。
