# 03: 保留 validation.commands，并允许真实参数修正

**What to build:** delegate 与 redelegate 的完整 validation 参数抵达子会话；缺失 commands 会得到可定位的拒绝，补上或改变命令后的合法调用不会被旧的重复拒绝计数封锁。相同错误仍被限次阻止，诊断只陈述实际观察到的边界。

**Blocked by:** None (can start immediately).

**Status:** resolved

Parent: Delegation 契约事故修复：运行身份、准入一致性与参数保真（2026-09-18）。范围 C；User Stories 13–20、24–25。

- [x] 先记录实际暴露的 delegate/redelegate schema、加载版本与相关宿主组合；用同一 toolCallId 关联可取得的原始 tool-call 参数、宿主解析/转换结果、execute 输入及下发的 TaskSpec。
- [x] 在两种工具入口提交 required=true 和非空合法 commands，证明数组顺序、各命令字符串从输入到执行 TaskSpec 与 child 可见输入保持一致；覆盖创建及已有 Task 的非 Reviewer 重入。
- [x] 将父规格提供的事故命令用作字符串往返 fixture，禁止因此实际执行另一个项目的测试；真实执行验收使用隔离、受控且满足本票验证目的的命令。
- [x] required=true 且 commands 缺失或不合法仍在启动前拒绝，不启动 child；参数拒绝不新增 Task 或篡改已绑定 Task。不得自动改成 required=false，也不得把命令挪到 acceptanceCriteria 规避结构化契约。
- [x] 重入不覆盖存储的原始 TaskSpec，不在缺参数时静默借用旧 commands；Reviewer 仍使用存储的审核上下文，维持既有角色契约。
- [x] 从工具入口演示缺失 commands 被拒、随后补齐 commands 的合法调用得到执行机会；新增、删除、重排或修改 commands 都参与参数身份，不被误当成此前规范化参数相同的调用。
- [x] 保留相同工具、规范化参数和拒绝码的现有计数规则，第三次停止提示及后续相同调用拦截有效；仅改变对象键序仍视为相同，拒绝码变化与成功后的计数行为不回归。
- [x] 提示改为“本边界收到的规范化参数相同”，提供观察边界、前次 toolCallId、拒绝码和缺失字段摘要；不再用 byte-identical 暗示原始传输字节相同，不断言模型没有发出修改或已证明 transport 丢字段。
- [x] 用受控转换 fixture 演示上游存在、下游缺失 commands 时能将问题限制在两个观察边界之间；没有上游可见性时明确说明。诊断有界并脱敏，不默认记录完整敏感命令或凭证。
- [x] 通过真实 Pi host 的工具参数路径及实际 launcher 验证合法 commands 重入到达 child；保留版本、有效 schema 与脱敏关联证据，不以 mock 或 schema 静态存在性代替验收。
- [x] 原事故原始记录不可得时将历史丢失位置保持为未定位，但证明当前受支持组合的参数保真；若发现上游缺陷，限定证据和依赖，未完成实际修复/验收不得声称该组合已通过。
- [x] 重复保护触发后 status、planner_tasks 和其他合法调用仍可用；相关回归同时覆盖参数修正与重复保护不被绕过，不通过禁用 breaker 解锁。

Testing seam: 主测已注册工具入口、宿主参数边界和真实 child 输入；复用既有 TaskSpec 拒绝与 RefusalBreaker 用例。本票可在已存在、可重入的 Task fixture 上启动验证，不依赖 01 的报告接纳修复或 02 的容量拒绝修复；跨缺陷完整链路由 05 验收。
