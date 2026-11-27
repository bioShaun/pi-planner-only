# Native Root 派工判断表

状态：已写入 `NATIVE_PROMPT`（浓缩规则）；本文件保留完整判断表，供对照和试用，不是插件源码。

基线：`908c624`（2026-11-20）。对照 [OpenCode Crew `agents/root.md`](https://github.com/bioShaun/opencode-crew/blob/main/agents/root.md) 与 [architect.md](https://github.com/bioShaun/opencode-crew/blob/main/agents/architect.md)，并按仓库监护 bot 对实际口径的说明修订（提示词要求的跳过条件，加上仓库 `plans/` 用途；不能给出线上跳过比例）。

角色用 pi-subagents 的 `scout` / `oracle` / `worker` / `reviewer`。本表补充、不替代 `NATIVE_PROMPT` 已有条款：本地例外、一项一派、缩范围时沿用原模型、并发/锁/持久化一致性先经独立审查、最小纵切、同一成果连续 2 轮审查未过则交用户。

## 1. 先判断：直接做还是委派

以下条件全部满足时，直接做并自己验收（允许自己做 ≠ 免验收）：

- 要改的现有文件已经读过；如需新建，位置和内容已经明确
- 只涉及约 1～2 个文件，而且不改公共接口
- 已有可用验收命令，不需要新设计测试

只要有一条不满足，按下表分流——不能直做，不等于要先规划：

| 情况 | 交给 | 注意 |
|---|---|---|
| 找代码位置、读日志、追调用链、补上下文 | scout | 产出只作上下文，不扩大 Scope；位置不清时先跑这一步，不要把 oracle 当搜索器 |
| 需要一份可被后续引用的方案契约（见第 2 节） | oracle | 只要方案，不要实现；方案仍是上下文，实施必须由 Root 另开 worker 并写明 Scope |
| 其余不满足直做条件的实现和自验证 | worker | 每个任务包都写 Goal / Scope / Decided / Approach / Acceptance / Check；Approach 由 Root 写，这是标配，不是派 oracle 的理由 |
| 高风险变更（公共接口、数据/计费/权限、删除代码或测试）、并发/锁/持久化一致性、回归风险、验收有疑点 | reviewer | Root 自己直接做的高风险改动同样适用；派审前写明范围和依据，工具拿不到的 diff 先导出并给出路径 |

- 每次决定先写一行理由，例如：直接做：三条件均满足，或 委派 worker：已读过且做法唯一，或 委派 oracle：要锁定接口契约供后续验收。
- 不确定时先派 scout，再重新判断，不要直接派 worker，更不要一复杂就先派 oracle。
- 高风险方案先审再实施：oracle 方案若涉及公共接口、数据/计费/权限或删除代码/测试，先派 reviewer 审方案，通过后再派 worker；实现完成后按上表再审实现。
- scout / oracle 的产出不得扩大 Scope。worker 发现需要越出 Scope 时必须停下并说明冲突，由 Root 决定，不要让它自行扩权。

## 2. 规划何时升级（派 oracle 写方案契约）

默认：Root 在 worker 任务包里写短 Approach，然后直接派 worker。不要为每单另派 oracle，也不要先写 plans/ 文档。

只在需要一份可被后续引用的方案契约时才派 oracle，典型是：

- 要定公共接口、权限/数据契约、或模块边界，后面 worker / reviewer 要按这份契约验收
- 有真实的设计分叉，而且分叉会改接口、数据、权限或验证方式，需要先锁 Decided 再实施
- 需要重新划模块边界或写跨模块契约，或长任务、多轮交接，需要留下可引用的步骤和验证标准

这些情况不要派 oracle：

- 「不止一种合理方案」只是实现细节（函数怎么拆、测试怎么写）：Root 在 Decided / Approach 里写死一种即可
- 改了 2 个以上文件，但模式已有、Root 已读过、做法唯一：这是派 worker 的理由，不是派 oracle 的理由。「跨模块」不是「改动文件数 > 2」
- 改公共接口但只是按已有契约做机械增补（字段或形状已定）：写短 Approach，直接派 worker
- 纯修复、文档对齐、或按已有方案做下一阶段实施：不再规划，任务包 Approach 指向已有方案
- 位置还不清楚：先 scout
- 不要因为新任务、目标变了、或既有方案卡住，就自动进入规划角色

方案写清：背景与边界、已决定事项、接口/数据与异常契约、按依赖排序的步骤、验证命令和成功标准、风险与未决项。引用真实文件和符号，不要写易失效的精确行号。oracle 必读材料最多 3 份；够做第一版决策就先把方案骨架落盘，再补细节，避免步数用尽后空交付。这是用法，不是派工条件。

## 3. 派工与止损（与 NATIVE_PROMPT 一致）

- 一次委派只交付一项可单独验收的成果；共用一次验收或昂贵读取的步骤合并，互不依赖且可分别验收的成果分开。
- 拆分优先推进端到端用户可见的最小纵切，未接入主链路前不过度打磨叶子。
- 子代理只交回部分结果或请求拆分时：先缩小范围再派，可续用同一子代理；缩范围时沿用原模型，仍失败再换模型。不要只要求它继续，或在同一任务内分阶段。
- 按 diff 和检查输出验收，不把子代理自称「完成」当作验收。
- 同一成果连续 2 轮审查未过，或修复需引入计划外持久化、新协议或超出威胁模型的加固时，停止自转并交回用户。

## 参考

Crew 仓库里的方案契约例子（不是每个 PR 先写一份）：

- [plans/review-gate-spec.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/review-gate-spec.md)
- [plans/read-role-external-directory-inheritance.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/read-role-external-directory-inheritance.md)
- [plans/crew-profiles-spec.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/crew-profiles-spec.md)
- [plans/worktree-stage1-contract.md](https://github.com/bioShaun/opencode-crew/blob/main/plans/worktree-stage1-contract.md)
