# Root 验收与当前建议

2026-10-27。**接受 P1 同步候选和 P2 证据归档；P3/P6 仍阻断，P4/P5 只完成当前可取得的观察，P7 尚未触发。** 本文件是阶段交付，不宣称整份计划或模式对照已完成。

## 验收依据与决定

Root 亲自读取实际 merge commit 与完整 `git diff main f818cc9`：`f818cc91c98d6129a152fb28161e00d2f601e494` 的父提交准确为本地 `3db1846aedb23a6b5552f69ffb70b552cdb94c7a` 和 fetch 后 `8168e126bed60d5a7f485718f17d7114d1322bfa`。净差异只有 CHANGELOG.md 四行新增，没有产品、测试或锁文件修改。Root 接受该候选，决定通过 fast-forward 更新本地 main，保留既有 SHA；这是验收后的独立决定，不是 child 自动更新。之后仅将本目录新增证据单独提交，不混入其他未跟踪材料。

独立 reviewer 首轮给出 [BLOCK](review-initial.md)，原因是缺少可移植的实际命令输出。原 worker 以新 run `b034a4f8-93c1-4bf7-816e-c0e70d8ca87c` 补齐 [checks.log](checks.log)，Root 已读实际输出并关闭此证据缺陷。日志 SHA-256 为 `30977f7bf39b513d6d5c00188f2c17722aaca22df36c1c9f9f7b64d9800c9f4d`；含命令、cwd、时间、TMPDIR、stdout 与 actual exit，不冒充首次 fetch 的原始输出。本轮没有第二份 reviewer PASS，最终接受由 Root 作出。

关键结果：

- 两个父提交的祖先检查均 exit 0；原本地工作树的 192 项历史指纹全部匹配；候选为 191/192，唯一差异是预期的 CHANGELOG.md，原始 exit 1 保留。
- 六份归档逐一 SHA-256 与 cmp 均通过；review BLOCK 报告也逐字节保存。原未跟踪文件清单除预先排除的生成缓存外复核通过，缓存与 ignored 文件不在指纹覆盖内。
- Root 已读历史完整 release 输出，包含 typecheck、CLI 7/7、contract、git/reviewer-range、delegate、host、host-runtime 5/5、handoff、status-color、index 成功；真实 shell exit 0 由历史 acceptance 提供，日志本身未嵌入 shell exit。
- 本轮仅纯文档同步与证据归档，不重跑产品 release。没有证明依赖/环境完全一致，因此不宣称当前安装已通过旧 release 或完整复用。
- 归档原文的 11 处历史链接失效保留；[链接记录](link-check.md) 提供原始位置映射。八份 supervisor 原日志只是本机补充，尚未审查/归档其原始内容；归档的是研究结论和来源，不是完整复现包。`checks.log` 中缺少 recommendation.md 的链接检查是创建本文件之前的历史结果，最终检查另存，不改写历史日志。

## 各阶段状态

| 阶段 | 状态 | 交付与恢复条件 |
| --- | --- | --- |
| P1 | accepted | [同步记录](sync.md)，外部 merge 已验收；本地主线按上述决定 fast-forward |
| P2 | accepted with limits | [证据入口](evidence-index.md)，六份原字节归档与可移植检查输出；全量 supervisor 原日志不在归档范围 |
| P3 | blocked | [协议草案](protocol.md) 已具体化两种场景、角色、顺序、验收和建议时限；费用金额与计价/止损、实际会话配置/隔离尚未冻结 |
| P4 | incomplete | [观察记录](observations.md) 只有本次 1 个真实任务，后续还需 1–2 个，不拆阶段凑数量 |
| P5 | partial / environment blocked | [安装盘点](native-runtime.md) 已完成；dirty 安装不等于候选，实际加载状态 unknown；没有真实 supervisor 请求，回复链路未验证 |
| P6 | blocked, 0 pairs | 等 P3 冻结及同基线的独立新 Root 会话可验证后启动 |
| P7 | not triggered | 没有首批结果，不具备补测理由，当前 0 对 |
| P8 | provisional | 当前建议与发布准备见下文；不声称模式胜负 |

## 按任务类型的暂定建议

简单有界调查或修改：两模式都从一个 child 开始，保持用户现有模式偏好；没有受控数据支持切换模式。固定候选需要验证与独立源码审查：两模式都可在锁和只读条件满足时并行，不能把并行作为 Native 独有收益。需要有依赖的多步组合、恢复或真实中途 supervisor 交互：Native 的工作流/生命周期接口适用，但这只是能力和任务匹配判断，不是速度或费用优越性的测量结论。

本轮看到了证据遗漏后的恢复，也看到了 Root 给无 shell reviewer 分配命令检查的不匹配。将命令运行交 validator/worker、reviewer 保持独立源码审查，Root 最终汇总，属于可直接采用的调度纠正。Native 与 Lite 的质量、墙钟、费用优劣继续 unknown。

## 运行、发布与下一步

运行安装只读检查发现：安装 HEAD 为 `8168e12`，本地 `index.ts` 含 Native 状态栏补丁；相对候选还缺部分 Lite 提示词更新和 reviewer 的 `base` 工具入口。安装 lock 的未提交差异仅版本字段从 0.8.0 改为 0.9.0-lite.0，但与候选完整依赖是否相同没有证明。Root 读了实际 diff；没有覆盖这些修改。安装更新与 reload 未执行，push/release/部署未执行。

首批建议两对只读任务、每臂 20 分钟、总 80 分钟，建议费用止损 US$10；这不是已批准金额，也不是当前工具可保证的硬账单上限。下一步需要用户确定费用边界，并先核实能否让独立新会话加载同一冻结副本。若必须更新现有安装，应另行明确授权并先备份/审查 dirty 安装。普通准备、证据提交及本地主线同步已有授权，不再请求重复确认。
