# Native 隔离发布入口：Root 验收

结论：接受本轮开发验证入口改动。基线为 `69e521c`；未提交、未推送。

## 验收范围

- 新增 `npm run test:release:isolated`，使用独立 fixture lock 在仓库外新建目录安装 pi-subagents 0.83.0 和 pi-ai 1.4.0，再通过 PI_SUBAGENTS_DIR 调用既有 test:release。
- 默认 release 的本机版本契约保持不变；未修改产品代码、产品 peer 或模式配置。
- 双语开发文档说明根项目依赖、TMPDIR、固定版本及清理边界。

## Root 已核对的证据

- 逐项读取 tracked diff、新增入口脚本、CLI 测试、fixture manifest 与锁文件。
- 初始 red.log 为公开 npm 入口缺失引起的行为失败，包含调用未发生和退出码不符；不是语法或模块导入错误。green.log 为原4项通过。
- Root 复查要求补充 TMPDIR 防护、退出码精确传播及清理断言；实现未改动，最终7项CLI测试通过。补测过程曾出现 Node compile cache 导致的过严测试断言，已修正且保留日志，不将其冒充产品缺陷红灯。
- release-final.log：真实 npm ci 安装94包，typecheck与全部既有测试通过，contract实际执行而非跳过，CLI 7/7、host-runtime 5/5、退出码0。
- comparison.log：固定registry包与本机全局包src、agents比较均退出0。
- `sha256sum -c .scratch/native-release-repro/final-sha256.txt` 全部通过，当前文件与最终证据清单一致；`git diff --check` 通过。
- 测试由 Native worker 执行；Root 检查实际diff、源码和输出，没有仅采信worker结论，也没有重复运行已通过测试。

## 边界与试用观察

- 新入口依赖已安装的根项目开发依赖和可访问的registry；固定依赖完整性由fixture lock约束。
- 全局缺少pi-ai的问题没有被修改，新入口解决独立源码验证的复现问题；默认本机验证仍可能因该依赖缺失失败。
- 清理覆盖正常退出和报告失败，不承诺中断信号场景。
- 一次worker初始执行、一次恢复补测；未测得可靠token/费用或完整端到端性能，不能推断Native相较Lite的收益。
- 子任务安装/测试使用/project/tmp；宿主通知仍显示retention目录位于/tmp/pi-subagents-uid-1000。这是本次观察到的宿主临时目录配置问题，未在本轮修改，后续应单独定位和处理，不能声称整个Native宿主已满足禁用/tmp约束。

实现记录：[execution.md](execution.md)。最终测试：[release-final.log](release-final.log)。文件指纹：[final-sha256.txt](final-sha256.txt)。
