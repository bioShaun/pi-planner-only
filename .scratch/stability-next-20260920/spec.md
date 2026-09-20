# 后续实施契约

用户授权：2026-09-20 按顺序处理 01–05。基线 85bdd2a；P0 的 Request 默认值与停止/恢复语义保持。新改动单独验收。

## P1-A 普通委派

新建 Task 的意图字段继续显式：objective、scope、constraints、acceptanceCriteria、validation、role；canonical taskId 已由程序生成，不重做。`planner_redelegate` 的公开参数收缩为 taskId、role、可选 instructions/envelope/recovery。从 canonical Task 读取完整的已存 TaskSpec，包括 workspace/scope/validation；新一轮 instructions 是临时向下补充，不覆盖原始 spec。旧客户端透传的定义字段不用于重绑定或改变工作区，返回忽略说明；acceptanceMode 仍按既有不可变守卫拒绝。

省略 envelope 的普通 worker/explorer/validator 执行使用程序默认 `maxTokens=100000`、`maxWallMs=300000`，来源可观测为 `default`；可通过 operator 环境变量 `PI_PLANNER_ONLY_EXECUTION_MAX_TOKENS` / `PI_PLANNER_ONLY_EXECUTION_MAX_WALL_MS` 配置有限正整数，来源 `operator-config`。默认 token 值复用现有 session-budget worker 基数，5 分钟单次墙钟在 15 分钟 Request 截止内；它们是待 P3 校准的保守初值，不宣称最优或省钱。（2026-09-20 后续：默认墙钟按 ADR-0008 改为 `maxWallMs=600000`，依据本机历史运行分布；token 默认不变。）显式 envelope 保留原有语义和 `delegation-param` 来源，允许只设一个维度；不因默认值静默抬高显式较小的界限。无论来源，Request 的更早截止先封锁并取消。Reviewer 的已有只读审查路径继续受 Request 截止控制，本轮不假装此前被忽略的 reviewer envelope 已接线。

无效配置在 dispatch 前明确失败，不产生 Task/claim；不要把 controller 存储错误等安全边界放宽。新单进程 fixture 必须加载真实插件入口，模拟 Git 和 child 事件来源，证明 minimal rebind 使用原 spec，旧重复字段无法改变它，省略 envelope 确实到界 CANCEL 并记录来源，显式值优先，默认不影响 Request 上限。

## P1-B 收尾能力边界

安装版 pi-subagents 0.69.0 只公开 REQUEST/STARTED/UPDATE/RESPONSE/CANCEL，非 completed 终态不投影原始 structured 输出。预算前 partial grace 和原文格式修复因此不能在现有 contract 上声称已实现。保留已验证的 terminal error/usage、未验收 typed report 与 cancellation 事实；禁止 raw parsing。将缺口记录为可执行的上游 contract 要求，后续能力矩阵显式标 unsupported。现有一次 report-correction 计数与实际重派发绑定需要核实，不能仅因计数常量存在宣称 report-only 权限被强制。

## 后续验收

按 03 → 04 → 05 顺序推进。无真实 TTY/普通终端、slot、provider 或上游能力时，完成可执行 harness 与离线检查并保留具体阻碍，不能声称实测 PASS。既有 P0 验收只证明 85bdd2a，不覆盖本轮源码。全量 release、真实 host/launcher 与 strict gate 必须由满足项目约束的普通终端/CI 完成。

## P2 角色路由

默认关闭；复用现有 operator role-model 环境策略，不开放模型自选参数。创建 Task 前通过宿主 modelRegistry 确认配置的 provider/model 与 thinking；仅允许显式 fallback。把选择写入公共 REQUEST.model/thinking；按 terminal 的实际身份核对。无实际身份为 unknown、冲突为 mismatched，均禁止采纳 completed 报告，usage/诊断材料保留。session entry 与工具 details 同时携带对照；不宣称真实 provider 验收或更低费用。
