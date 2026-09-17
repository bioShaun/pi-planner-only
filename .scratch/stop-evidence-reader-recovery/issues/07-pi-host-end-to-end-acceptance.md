# 07: 真实 Pi 宿主贯通验收

**What to build:** 在仓库支持的真实 Pi 与 pi-subagents 宿主中证明非 Git 调查完整收口、reader 恢复不占用、真实 writer 隔离及故障后直接诊断均可工作，形成可复核的交付证据。

**Blocked by:** 03 — 非 Git Explorer 的观察类任务完整收口；04 — writer 环境不可验证时提前阻塞，运行后故障保持隔离；06 — 无需委派即可查询失败 Task。

**Status:** done

**Parent:** [停止证据失败规格](../spec.md)，Testing Decisions 全部真实宿主与发布验收要求。

- [x] 记录实际 Pi、pi-subagents、插件版本/加载指纹、cwd 与受控输入；CLI 验证保留完整实际调用形式，包括要求的 pi --mode json。隔离真实用户工作区，不操作 4090 现场数据作为测试夹具。
- [x] 用真实宿主可验证的配置、工具清单或工具层拒绝证据证明 Explorer 的受限绑定不具备 shell/edit/write 等变更入口；不能只凭角色名称、模型自述或模型拒绝尝试就宣称隔离成立。
- [x] 在受控非 Git 目录显式创建 observation Explorer 日志定位 Task，记录请求、实际工具结果、匹配终态、报告接纳、reviewing 和显式 Root Verdict，最终 Task completed 且无 Writer hold。
- [x] 在健康且有效 HEAD 绑定的 Git 目录完成相同信息任务作为对照；不把仅 git init 后停止确认通过但 Task changes_requested 当作完整成功。
- [x] 运行完成后重载/重启，确认 reader 没有新增 writer 占用；另用受控无匹配终态的 reader 场景证明停止未知也不合成 Writer hold。
- [x] 用受控 writer 启动前非 Git 环境验证不派发、无新 hold；用启动后出现的采样失败或工作区变化验证 hold 保持、第二 writer 被拒，重启后仍隔离。Validator 不因 readOnly 标志绕过该要求。
- [x] 验证匹配终态、有效静止证据齐备后的正常释放，以及取消、迟到/重复终态不误接纳报告、不重复记账；未验收报告仍可供诊断识别。
- [x] 委派失败后的 Idle 状态通过 planner_tasks 直接查询对应失败 Execution、报告收到/接纳状态、采样阶段、真实 hold 和日志位置状态；验证查询自身没有另起子任务，也没有改变账本或并发状态。
- [x] 对 observation/worktree 的默认值、历史兼容、角色限制、重绑定拒绝和 Writer 的 Reviewer/Verdict/提交门禁，引用当前实现的自动回归证据；若集成后行为变化，重跑受影响场景。
- [x] 完成当前实现的类型检查和完整发布检查（npm run test:release），保存原始命令、退出码、stdout/stderr、失败尝试、修正后的通过证据及状态漂移核对；不只记录最终 exit 0。
- [x] 检查域契约、停止恢复说明、工具引导、诊断字段和公开 schema/版本相互一致；上游 ADR 的结构化上下行、创建/重绑定分离、独立 abort 原则保持有效。
- [x] 汇总各验收条件对应证据，清楚区分模拟 launcher、本地真实 Git、真实宿主和未经取证的 4090 原始事故。宿主条件缺失则报告 BLOCKED，禁止降级为模拟测试 PASS。
- [x] 交付中性证据供 Root 与独立 Reviewer 接受；原生 Codex 有强制 strict gate 时使用项目规定的独立只读入口并证明实际权限，Worker 自测不冒称独立验证。全部条件通过后才报告实现验收完成。

**执行约束：** 同 cwd 保持一个写入者，包括产生验收文件的 Validator；复杂多阶段宿主证据使用项目规定的复杂 Validator。发现实现缺陷时回到对应责任票纠正，验证角色不静默修复源码。

**边界：** 这是交付验收，不自动部署服务器、不调整全局 Git/守卫设置、不修改 Excel 审核逻辑，也不声称已经读取或修复原始 4090 会话。各实现票自带回归，本票不代替其单票验证。

## Resolution notes (2026-09-17)

Host acceptance run on pi 0.85.1 + pi-subagents 0.68.0, repo `index.ts` loaded via `-e` with extension discovery disabled:

- `T-20260917-008` — non-Git dir `/tmp/planner-only-t07-nongit`: explorer + `acceptanceMode: observation` → `planner-scout` bound through the runtime-agent registry; child tool calls were `find`/`ls`/`read`×3/`structured_output` (no shell/edit/write); report admitted → `reviewing` → Root pass verdict → `completed`. No writer hold, no Git comparison.
- `T-20260917-009` — same dir, worker role → refused `ENVIRONMENT_UNVERIFIABLE` before launch with structured probe diagnostics (`not-a-git-repository`, exit 128); task blocked, `recovery.required`, no hold, no launch.
- `T-20260917-010` — control in `/tmp/planner-only-t07-git` (real HEAD): same observation flow → completed.
- Fresh pi process: `planner_tasks` on T-20260917-008 restored the ledger record — `capability=restricted-reader`, `confirmationBasis=terminal+restricted-reader`, probe failures preserved, no synthesized hold.

Artifacts: `evidence/pi-host-t07-*.{stdout.json,stderr.txt}` + `pi-host-t07-ledger-*.json` + `pi-host-t07-summary.json`. Regression evidence: `delegate.test.mjs`, `orchestrate.test.mjs`, `index.test.mjs`, `task.test.mjs`, `evidence.test.mjs`; `npm run test:release` clean.

## Resolution notes (2026-09-17, second round — post-audit-fix host acceptance)

Second host acceptance on the same pi 0.85.1 + pi-subagents 0.68.0, working tree with the P1/P2 fixes applied. Isolated agent dir (`PI_CODING_AGENT_DIR=/tmp/planner-only-t07c-agent`, auth copied), real Git workspace `/tmp/planner-only-t07c-git`. An external delayed `chmod 000 a.txt` (tracked, in-scope) injected a post-launch evidence failure mid-execution:

- `pi-host-t07b-cancel-late-terminal` (T-20260917-007) — worker + `envelope.maxWallMs=30000`, fault fired during the run → wall breach cancel, no terminal inside grace → `stop_unconfirmed` + `writer hold: kept` + `recovery.required`; the child's LATE terminal then triggered a fresh quiescence check which confirmed (`terminal+quiet-worktree`), releasing the hold and admitting a second writer. Covers cancellation + late-terminal paths: the unconfirmed stop held first, the late terminal resolved it exactly once.
- `pi-host-t07b-writer-stop-unconfirmed` (T-20260917-009) — same envelope with `a.txt` in scope → post-breach sampling hit `hash-object … Permission denied` and `diff HEAD --stat … Permission denied` on BOTH stop samples → `stop_unconfirmed`, `terminationConfirmed=false`, `evidenceIncomplete=true`, `writerHold` persisted (ledger artifact `pi-host-t07b-ledger-T-20260917-009.json`); second writer refused `WORKSPACE_CONFLICT: writer cannot run beside active worker T-20260917-009`; `planner_tasks` reported `writer hold: active` plus `session log: verified-file`.
- `pi-host-t07b-restart-hold` — fresh pi process on the same agent dir: `restoreFromLedger` re-registered `writerhold:tool_0WxyVcbsXZzh1GU9IgnrRhEX`, diagnostics still report `writer hold: active`, and the second writer refused `WORKSPACE_CONFLICT` again. Session log status correctly degrades to `default-directory` for a foreign session.

Duplicate-terminal delivery is transport dedupe (`processedRunIds` + the settle-once guard) covered by `delegate.test.mjs`; no host-visible duplicate channel exists. `npm run test:release` clean after the fixes.

Artifacts: `evidence/pi-host-t07b-*.stdout.json` + `pi-host-t07b-ledger-T-20260917-009.json` + `pi-host-t07b-summary.json`.

## Comments

- 2026-09-17 审核结论（REQUEST_CHANGES）：现有宿主证据覆盖 008/009/010 与 reader 重启恢复；writer 启动后故障隔离、第二 writer 拒绝、重启保留隔离、取消／迟到／重复事件场景尚无宿主级证据。
- 2026-09-17 复审补齐：第二轮宿主验收（见上方 Resolution notes）已覆盖全部缺口——启动后证据故障（hash-failed）下 `stop_unconfirmed` + `writerHold` 保留、第二 writer `WORKSPACE_CONFLICT` 拒绝、重启后隔离保持、取消与迟到终态；重复终态由传输层去重并以回归覆盖。本票 done，留待 Root 复审收口。
