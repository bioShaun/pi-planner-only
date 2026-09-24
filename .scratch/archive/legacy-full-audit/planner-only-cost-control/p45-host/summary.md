# 工单 45 宿主终验 summary（2026-09-14，新一轮运行）

被验构建：clone HEAD bfc70e904928264311dd7e49ad4e876128c01a32 ✓ / tree eaa121f6487a25ab7a06b6e1c2c522ddc9d774c9 ✓（shell 核验，clone 干净）；settings pin = git:github.com/bioShaun/pi-planner-only@fix/ticket-45-validation-judgment（pi 管理 clone，非本地仓库）。
重算加载指纹 = 338d419fdc3a43d994a11b7b4e963423e9ceeddff75b8d5fa3e28439d5fdf854（待与 /planner-only status 的 loaded= 核对——agent 无法触发 slash 命令，步骤 0.1 见 00-step0-gate.md）。

| 检查 | 判定 | 逐字 block reason（或「未拦」） | 证据文件 |
|---|---|---|---|
| A | PASS | "Planner-only guard: embedded TaskSpec is invalid (validation.commands must be a non-empty array of strings when validation.required is true)." + TaskSpec repair summary + Outstanding（全文见日志） | check-a.log |
| B | PASS | 同 A 逐字一致（空白串被可用命令判据抓住） | check-b.log |
| C | PASS | 同 A 逐字一致，role=worker 也准入即拒（行为变更确认） | check-c.log |
| D | PASS | 未拦（非 validation 拒绝）。首次被并发写锁拦："task T-20260913-046 already holds the write lock for /public/pi/pi-planner-only."；锁释放后准入通过并实际执行 npm run typecheck exit=0 | check-d.log |
| E | PASS | 未拦（required:false 准入通过，执行 git rev-parse HEAD exit=0） | check-e.log |
| F | FAIL | 未拦。遗留 spec 存在（T-20260911-001.json：{"required":true} 无 commands，直取证实），两种 task-id-only probe 均返回 "Async delegation for task T-20260913-046 has started (runId: …)"；预期的 "create a new Task" 拒绝未出现。拒绝代码在 clone 源码中存在（orchestrate.ts:2710-2727, :273）但本轮未命中 | check-f.log |
| G | PASS | A/B/C 无子进程、无新 ledger 文件、git status/HEAD 前后不变（D/E/F 的副作用为准入通过任务的预期行为；F 副作用归入 F 的 FAIL） | check-g.log |

## 总判定：**FAIL**（检查 F 未按预期拦截遗留 spec 的 task-id-only validator 委派）

## 遗留事项（交回人工，不做任何修复）
1. 检查 F：确认 stored-task 解析为何未命中 T-20260911-001（lookup 终态过滤？promptTaskIds 形状？绑定到 046 的归并逻辑？）。
2. 步骤 0.1：操作员补跑 /planner-only status 核对 loaded=338d419fdc3a43d994a11b7b4e963423e9ceeddff75b8d5fa3e28439d5fdf854 与 source 路径。
3. ledger 计数 118→119 与可见新增文件数差 1，因前置 listing 截断未能完全对账（不影响 A/B/C 结论）。
4. reviewer 内建 agent 配置模型 tcuni-ds/deepseek/deepseek-v4.1-flash 不在活动注册表，委派启动失败（lane 基建问题，与工单 45 无关，本轮以 oracle 兜底）。
5. T-20260914-007 无 WorkerReport 落账，planner_verdict 无法记录（扩展拒绝：no recorded WorkerReport）。
