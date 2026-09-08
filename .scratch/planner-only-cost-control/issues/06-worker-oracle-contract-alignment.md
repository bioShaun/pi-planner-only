# 06: Worker 合同禁依赖安装，Oracle 合同与正文一致化

**What to build:** Worker 合同明确禁止运行会修改 lockfile 的依赖安装命令（除非 TaskSpec 明确要求），给出 lockfile 只读的安装方式作为替代，并要求任何被迫修改的 lockfile 写进 changedFiles。Root 对 undeclared 文件的纠偏委派必须写明目标状态（干净树或指定提交），插件在纠偏提示里默认建议 revert，不让 Worker 自行决定。Oracle bounded 合同允许运行 WorkerReport 点名的测试文件、禁止全量套件；Root 正文要求全量套件而模式是 bounded 时，委派前给出冲突警告。

**Blocked by:** None (can start immediately).

**Status:** done（p05-r023 落地，planner 复核后逐条勾选）

- [x] Worker 合同文本包含依赖安装禁令、替代做法与 lockfile 申报要求（集成测试断言注入的任务文本）。
- [x] 插件生成的纠偏提示包含目标状态与 revert 优先建议。
- [x] bounded Oracle 合同措辞允许 named test、禁止全量；Root 正文出现全量套件命令且模式为 bounded 时，委派结果首行含冲突警告。
- [x] full 模式下不产生该警告。
- [x] 现有 Evidence 新鲜度与 undeclared 文件检查行为不变。

## Comments

Parent: `.scratch/planner-only-cost-control/spec.md`（问题 4、8，User Stories 6、10，阶段 A 决策第 7–8 条）。证据：analysis P4、P8。
round_id=p05-r023
Planner patch after r023: conflict scan must use Root prose before wrap; plugin packet TaskSpec `validation.commands` is not a full-suite request.
