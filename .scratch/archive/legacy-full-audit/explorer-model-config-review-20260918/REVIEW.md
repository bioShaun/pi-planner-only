# Explorer model config 审核

结论：REQUEST_CHANGES。审核对象为 HEAD `f57a4de309a5317dd4ecef6a52ba83c7d7d545ff` 上的相关工作区改动；没有修改源码或工单状态。

## Standards：3 项

### S1 · P1 · 验收目录保留用户凭据

位置：`.scratch/explorer-model-config/acceptance/run-acceptance.sh:39`。

脚本将全局 `models.json` 原样复制到仓库内的验收目录，未保证事后清理。结构检查确认目标包含 6 个 API-key 字段，其中 3 个为长字面量，且复制值与全局来源一致；其余为命令引用。目标文件未被 Git 忽略，存在误提交/交付风险。未输出任何密钥值。

违反票 03 第 20 行“证据只保留必要配置和运行元数据，去除凭据与无关用户内容”。修正方向：凭据仅作为临时运行输入并保证清理；保留脱敏的最小配置元数据，增加忽略规则作为补充保护。

### S2 · P2 · 新模块遗漏于加载指纹

位置：`index.ts:191`，`computeLoadedFingerprint()` 文件清单。

生产路径导入了 `explorer-model.ts`，但该文件未纳入加载指纹。单独修改模型路由逻辑不会改变指纹，破坏已有 RS-01/A01 构建来源核验的完整性。应将新模块加入清单，并覆盖相应回归。

### S3 · P2 · 新增测试默认写系统临时目录且未完整清理

位置：`explorer-model-config.test.mjs:18`、`:856`。

测试使用 `mkdtempSync(join(tmpdir(), ...))`，默认环境下写入 `/tmp`；结束时仅删除 settings.json，残留整个夹具目录及账本。违反用户 AGENTS.md 的 `/tmp` 禁令及特性规格的项目内隔离要求。应使用项目内一次性目录，保证整个夹具目录在异常和正常结束时均被清理。

## Spec：4 项

### R1 · P1 · 没有读取 scout 的有效定义

位置：`explorer-model.ts:369`，错误预期见 `explorer-model-config.test.mjs:322`。

规格第 54 行要求使用包含定义、覆盖、默认值在内的宿主有效 scout 配置。当前实现只读取 settings overrides/defaults。已安装 pi-subagents 的 `agents/scout.md:5` 明确指定 `thinking: low`，宿主仅在定义未提供字段时填充默认值；适配器却在无配置时省略 thinking，在 `defaultThinking: medium` 时选择 medium。用户/项目 scout 定义同样不在这条解析路径中。

修正方向：使用受支持的宿主有效配置接口，或将经核实的定义和默认值顺序集中兼容在适配器；不要将当前错误结果固化为测试预期。

### R2 · P1 · 项目与用户 builtin 覆盖顺序错误

位置：`explorer-model.ts:345`。

规格第 33/54 行要求保持宿主项目/用户优先级。宿主 `src/agents/agents.ts:1472` 的 `applyBuiltinOverrides` 在项目存在 scout override 时整体选用项目 override，未指定字段保留已应用默认值的 builtin。当前实现却逐字段回落到用户 override。

实际探针：用户 defaultModel=p/default、用户 scout.model=p/user、项目 scout.thinking=high 时，适配器返回 p/user/high；宿主 builtin 语义应为 p/default/high。应按宿主顺序计算有效 scout，然后应用 Explorer 专属优先级，并补充部分项目覆盖场景。

### R3 · P1 · 自建模型可用性判断拒绝宿主支持的标识

位置：`explorer-model.ts:377`。

规格第 57 行要求使用宿主解析与可用性语义。当前实现精确匹配且无条件将首个斜杠前段解释为 provider。宿主 resolver 则仅在该段是注册 provider 时如此解释，支持未限定的 owner/name 模型 ID、thinking 后缀及规范化。

实际探针：registry 中有 `{provider: scoutp, id: nested/model-d}`，配置模型为 `nested/model-d` 时，适配器拒绝为 EXPLORER_MODEL_UNAVAILABLE。宿主 `src/runs/shared/model-resolution.ts` 的 exact-ID 路径可以识别该模型。应通过宿主支持的解析边界处理，补充真实宿主语义兼容用例。

### R4 · P2 · 真实宿主验收未满足匹配 WorkerReport 条件

位置：`.scratch/explorer-model-config/issues/03-real-pi-acceptance.md:9`、`:15`；证据为 `evidence/planner-only/ledger/T-20260918-001.json:1`。

票 03 明确要求匹配 Task/run 身份的终态与 WorkerReport。实际 ledger 为 `state: changes_requested`、`reports: []`，报告保存在 `unacceptedReport`，原因是 workerRunId 不匹配；后续 `planner_verdict(pass)` 因 `no-report` 被拒绝。

`executions[0].status: completed` 仅证明执行结束，不能代替 Task 验收通过。关联事故可以解释失败原因，但不能豁免票据明确条件。应将本次标记为模型路由/能力验证通过、完整验收未完成，解除身份前置阻塞后重跑并更新报告。

## 已有证据支持的结论

- Root 实际模型为 tcuni-luna/gpt-5.6-luna，子会话实际模型为 qwen-local/qwen3.8-27b；由 assistant 事件及子会话 model_change 验证。
- 子会话 `run-0/session.jsonl:3` 的 thinking_level_change 记录 low，不只依赖配置期望或代理自述。
- planner-scout 的能力记录声明 read/grep/find/ls，执行分类为 restricted-reader；观察到 read、ls 及结构化输出工具，没有变更工具调用。
- Task/run/用量关联记录存在，但上述报告身份拒收仍未解决。

## 本轮验证与限制

- Standards 与 Spec 分别由无历史 astra_reviewer 审核；宿主证据由 astra_validator_complex 独立交叉核对。
- `git diff --check` 通过。
- 独立适配器探针完成，原始失败尝试和修正后的输出分别保存在 `adapter-probe.log`、`adapter-probe-corrected.log`；这仅是适配器级证据。
- 独立 `slot cpu -- npm run test:release` 在 npm 启动前失败，exit 255。slot 无法写用户作业目录或连接队列 socket，详见 `release.log` 与 `preflight-validator.log`。没有绕过调度直接跑完整套件，故本轮不能确认“31 模块全部通过”。
- 提供的验收目录中没有原始 release/typecheck、版本/preflight、slot audit/status 输出及原始宿主进程退出码记录；报告文字不能替代这些执行证据。
- 必需严格只读 launcher 的执行同样受 slot 基础设施限制，本轮没有取得严格运行时权限隔离 gate 结果。原生 reviewer 的只读约束仅按行为审查认定，不声明严格 gate PASS。
- 项目引用的 `.codex/codex-subagent-config-astra-planner.md` 不存在；已按可读取的用户级 Astra 协议和提供的项目约束执行。
- `before.json` 冻结受审源码哈希；结束时再次比对确认五个受审文件未漂移。新增文件仅为本轮审核产物。

Standards 共 3 项，最高 P1 为凭据残留；Spec 共 4 项，最高 P1 为配置/模型解析与宿主不一致。
