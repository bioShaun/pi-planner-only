# 01: 每次 Worker 执行的 Evidence 与 Reviewer 验收闭环

**Status:** ready-for-agent

**Blocked by:** None

**What to build:** 实现 [主 spec](../spec.md) 的 Implementation Decisions 01。保存 Root 采集的每次执行前、结果接收时 Evidence，分离 Truth / scope 与 Freshness，覆盖累积执行链、report-only、Validator、Reviewer packet 和接受边界。保留原文件名以兼容链接；原 first-parent 分区方案已被替代。

- [x] baseline-lag 事故形状通过完整 Orchestration 生命周期完成；执行前无关历史不进入 Worker 归因或 Reviewer patch，没有无效重验证。
- [x] 漏报独立提交、空声明与实际修改、如实声明越界均不能 PASS；归因起点只来自 Root 执行前采样。
- [x] 已提交与工作树修改均展示；预先脏文件不变/再改、删除/重命名、子目录及非 ASCII 路径正确处理。
- [x] 多轮累计工作和未关闭 finding 可追溯；后轮重设基线、还原净 diff 均不能自动洗掉前轮问题。
- [x] 报告无效时保留执行证据；report-only 修正继承原变更集合和采样链，期间文件变化转显式漂移处理。
- [x] async 回执不产生 C_report，最终接收采样绑定执行一次；接收延迟期间外部变化不能被无条件认定为 Worker 所为。
- [x] Validator 与 Explorer 不重设归因窗口；验证写入导致 freshness 失效；Reviewer packet 覆盖累积交付且截断/材料不全不能 PASS。
- [x] 新 ledger 恢复保留采样身份和关联，旧记录缺失不以当前状态补造；额外工作区不可读、来源未知变化或缺少比较材料时 fail closed。
- [x] 报告后及接受时漂移拒绝旧 PASS；显式新 revision 绑定来源/scope 判断、验证及复核后可恢复完成。
- [x] 复用主 spec 已确认的生命周期测试 seam，仅必要 Git 边界补下层测试；将用户文档、领域说明和变更记录同步为最终语义。

## Comments

2026-09-10 修订：原“声明不相交的更早提交属于 lag”会排除 Worker 漏报工作，本 issue 不再实现 lagPaths、按报告交集寻找 commit 或 200-commit walker。完整边界和测试矩阵以主 spec 为准。

历史事故：T-20260910-001 记录报告 `changedFiles: []`，实际 tip 提交了 4 个 in-scope 文件；这是漏报验收场景，不能因为没有相交声明而 PASS。

2026-09-11 实现（E01 完成）：

- 数据模型：`TaskRecord.executions[]`（每执行 `A_run`/`C_report`、reportIndex、truth/undeclared/outOfScope/extraDeclared/external 路径、freshness、drift）与 `TaskRecord.findings[]`（kind/paths/status/evidenceResolvedBy），ledger 随 TaskRecord 序列化；restore 对缺失字段补默认并标记 restored 来源。
- 纯函数：`compareExecutionTruth(A_run, C_report, report)`（T1/T2/T3 + 声明交叉核对 + scope 分类 + untracked runtime noise 不归因）与 `compareFreshness(C_report, C_now)`（HEAD/路径集/内容哈希/status，noise 感知）。Orchestration 在有执行材料时以新语义整体替换 legacy 混合比较；无材料且为 restored 记录时 fail closed（missingMaterials → blocked）。
- PASS 门：`rootVerdictRefusal`/reviewer accept/`recordRootVerdict` 全部经新比较；findings 阻断 accept；`evidenceResolvedBy` + PASS 复核才能关闭 finding；净 diff 消失不自动关闭。
- Reviewer packet：`rounds`（分轮归因）+ 累计归因 + `unresolvedFindings`；补丁基线取最早可信 `A_run`；材料缺失 → `attributionIncomplete`/`patchTruncated`。
- Git 边界：`rev-parse --show-toplevel` 入 probe；porcelain 路径按 cwd 归一、committed delta 按 repo root 归一、C 风格引号路径解码（子目录 cwd、非 ASCII 均有真实 git 仓库测试）。
- 测试：新增 6 个 Orchestration 生命周期场景（事故形状、漏报→report-only 修复、两轮 finding 存续+还原关闭、report-only 漂移、validator 写入、ledger 新旧恢复、async 采样绑定一次）与 1 个真实仓库路径归一化测试；全量 17 个测试模块通过，`tsc --noEmit` 干净。
