# 04: Worker 与 Validator 默认 fresh，状态里显示实际 model:thinking

**What to build:** Root 委派 Worker 或 Validator 时，插件默认把上下文设为 fresh，并传入有界执行包：TaskSpec、适用仓库规则与领域约束、必要文件线索、验收要求、可定位 Evidence。不复制 Root 历史。settings 里为这些角色配置的 thinking 因此真正生效。显式请求复用同一 Task 的修正上下文仍然允许，但受 Task 身份与范围限制；跨 Task、身份失效或误请求 Root 历史时回到 fresh 并解释原因。`/planner-only status` 与 Usage 记录显示每次委派宿主实际使用的 model 与 thinking。Reviewer 已有的 fresh 隔离保持不变。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Root 历史中放入与 Task 无关的标记后委派 Worker：Worker 收到的执行包含 TaskSpec 与仓库约束，不含该标记；Validator 同理。
- [ ] settings 为 worker 配置 thinking high、oracle 配置 medium：宿主 meta 中实际值与之一致（通过真实 pi-subagents 公开入口或受控本地提供方验证，不以插件写入字段为证）。
- [ ] 同 Task 显式复用修正上下文：保留上一轮执行的必要上下文；跨 Task 或身份失效时回到 fresh 并在结果中说明。
- [ ] status 输出每次委派的角色、实际 model 与 thinking；Usage 记录保留同样字段。
- [ ] Reviewer 行为与改动前一致。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 6，User Stories 8、18–20，阶段 A 决策第 5 条）。证据：analysis P6（fork 上下文 6/6 落到 off，fresh 2/2 拿到 override）。
