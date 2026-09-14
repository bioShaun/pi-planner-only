# 批次宿主终验 46/48/49/50 — summary

- 被验构建：`aacd59ab427e708ec2a5fafd85360a594248b552`（分支 `fix/tickets-46-48-49-50`，插件 checkout 分支 `fix/host-validation-cumulative-patch`）
- 验证运行时间：2026-09-14 19:53–20:10 (+0800)
- 总体判定：**FAIL**（检查 2 FAIL）

## 步骤 0 门禁

| # | 项 | 判定 | 证据 |
|---|---|---|---|
| 1 | loaded= 必须是 50c0f30e66f2 | PASS（重构验证） | root 无法直接执行 `/planner-only status`；按插件 `computeLoadedFingerprint()`（index.ts:82-126）对 pin 的 checkout 的 24 文件清单重算 sha256 = `50c0f30e66f2fb57b7b03bc6639f0f05858a408d67e6aa72a76e291eb4eb6257`，前 12 位 `50c0f30e66f2` 与预期一致；settings.json 无 629b4b6133e9 残留 |
| 2 | task provenance source= 指向 ~/.pi/agent/git/github.com/bioShaun/pi-planner-only/index.ts | PASS（代码路径验证） | `SOURCE_PATH = fileURLToPath(import.meta.url)`（index.ts:78），`Plugin provenance: source=${versionInfo.sourcePath}`（index.ts:1665）；插件加载自该 pin 的 checkout（门禁 3 已证其 HEAD/tree） |
| 3 | 插件 checkout HEAD/tree | PASS | HEAD=`aacd59ab427e708ec2a5fafd85360a594248b552`；HEAD^{tree}=`1806afac832510e042feba30f125053c55699a37`；`status --porcelain` 空 |
| 4 | status 行 disk HEAD 不作加载证据 | 遵守 | 未使用会话 cwd 的 HEAD 作为插件身份证据（仅作交叉记录：会话仓 HEAD 同为 aacd59a） |

## 基线记录

- 操作员预期基线：ledger .json 计数 120；016 mtime `2026-09-14 08:09:30.166140555 +0800`。
- 实测（检查开始前）：ledger 计数 **120** ✓；016 mtime **2026-09-14 19:58:47.919719877 +0800** —— 已偏离操作员预期值，原因见「污染披露 1」。操作基线（后续比对用）：count=120，mtime(016)=19:58:47.919719877。
- 会话仓：`aacd59a` @ fix/tickets-46-48-49-50；status=`?? .scratch/c13-repo/`、`?? .scratch/nx-followups/host-validation/`。插件仓：`aacd59a`，干净。
- 结束复测：ledger 计数 **120**（无非标准命名新文件，无 T-p46-pos.json）；两仓 HEAD/status 与基线逐字一致（详见检查 7）。

## 检查结果

| 编号 | 判定 | 逐字 reason（或「未拦」） | 证据 |
|---|---|---|---|
| 1 (46) | **PASS** | `Planner-only guard: 需补充验证定义。 validation.required is true, but validation.commands is missing or empty. Task T-20260912-016 is stored with validation.required = true but no usable validation.commands, so no Validator delegation for it can start. The stored TaskSpec is not editable: create a new Task that carries a complete validation definition. TaskSpec repair summary: - role: kept the reviewed Task's role "worker" - objective: kept the submitted objective - validation: validation.required is true but no usable validation.commands were supplied Outstanding — supply these before resubmission: - validation: validation.required is true but no usable validation.commands were supplied The original submission stays refused until the outstanding fields are supplied; validation requirements are never relaxed to make a template pass.` | 同步拒绝，无 `Async delegation … has started`（无 run）；本会话工具回执 |
| 2 (48) | **FAIL** | 「未拦」——预期 VALIDATOR_SPEC_CONFLICT，实际：`[PLANNER-ONLY] Async delegation for task T-20260912-016 has started (runId: 9c8f0a2d-ed92-4e61-8f55-45f5e5eea085).`；oracle 子进程实际执行 `npm test` 并 passed；收据停放：`Late validator receipt for blocked task T-20260912-016 was parked into history.` | run session: ~/.pi/agent/sessions/--public-pi-pi-planner-only--/2026-09-14T11-53-56-917Z_01a09fc4-4bb5-70c7-8911-a01571c41f9b/6ea1ca20-5f31-4ae1-b176-69be53006265/run-0/session.jsonl |
| 3 (49) | **PASS**（目标解析；mtime 子断言见备注） | planner_verdict 未回 `unknown task`，返回：`[PLANNER-ONLY REVIEW STATE] taskId: T-20260912-016 state: blocked round: 0/3 review mode: root decision: blocked failure: environment (worker-reported-blocked) usage: root 8.7k (4 turns) · children 133.3k · cost unknown reason: worker reported blocked. A blocked worker is not a failed worker; no correction round was consumed. …` | 本会话工具回执；无新 ledger 文件（计数仍 120）；016 mtime 在检查窗口内由 19:58:47.919719877 变为 20:06:00.825259118，与检查 2 收据停放及/或本探针写入时间重叠，无法唯一归因（见「污染披露 4」） |
| 4 (46/50) | **PASS** | `Planner-only guard: Task T-20260911-001 belongs to workspace /public/scripts/tc-probe-design-v2, while this delegation runs in /public/pi/pi-planner-only; cross-workspace binding is refused. No Validator run is started against a substitute Task. Name a Task in this workspace, or embed its TaskSpec.` | 以 workspace 为主诉起头，与预期逐字一致；不含 `names unknown Task`；同步拒绝无 run |
| 5 (50) | **PASS** | 角色行逐字：`- role: kept the reviewed Task's role "worker"`（取自检查 1 的 reason）；整个 reason 未出现 `kept the submitted role` | 同检查 1 回执 |
| 6 (50 正向对照) | **INCONCLUSIVE** | 三次委派（嵌入 `taskId: T-p46-pos`、`validation: {"required":false}`、`role: validator`）均**未**被 VALIDATOR_SPEC_CONFLICT 拒绝；但三次全部被回退绑定到既有 `T-20260913-046` 并启动（runId: 003f8cfa-…、9c9968d0-…），`T-p46-pos` 未铸出（ledger 无新文件）。「未绑定 validator 不受 48 影响」的未绑定路径未能受测 | runId 003f8cfa（session 654b8e4f-…）、9c9968d0（session e1a7732f-…）；side-effect run 的 ledger 计数与非标准文件名检查 |
| 7 (G 类副作用) | **PASS（含备注）** | 检查 1/4/5 同步拒绝无 run；无新 ledger 文件（120→120，无非标准命名文件）；两仓 HEAD/status 前后逐字一致（插件仓 `aacd59a`+空；会话仓 `aacd59a`+同两条 `?? .scratch/`）；016 mtime 两次变更均为「run 真实启动」之果（门禁取证 + 检查 2），已归因披露，非独立守卫破口；run-state 计数 248（运行中首次采集，无前置基线，仅备查） | side-effect run（runId 1a4ee5cf, session 31cd982c-…）逐字输出 |

## 总判定

**FAIL** —— 检查 2：提交 spec（`validation.commands=["npm test"]`）指向已存储 Task T-20260912-016（stored: required=true, commands none）未被 VALIDATOR_SPEC_CONFLICT 拒绝，子进程真实执行了 npm test。工单 48 所修之洞在 aacd59a 上仍然敞开。

## 污染与意外行为披露（诚实性要求）

1. **门禁基线污染（本运行自致）**：步骤 0 的取证委派任务文本中含 016 的 ledger 文件名，被账本感知 lookup 绑定到 T-20260912-016 并启动（runId 3e1fc9ad）；其收据停放把 016 mtime 从操作员预期基线 `08:09:30.166140555` 改为 `19:58:47.919719877`（该时点仅可能来自本次收据停放；同目录 T-20260912-010.json 仍为 `08:09:30.211195513`，佐证原基线值的真实形态）。后续检查一律以 `19:58:47.919719877` 为操作基线。
2. **T-pending 回退绑定**：四次未命名委派（taskId T-pending，含两次嵌入全新 spec 指定 `T-p46-pos`）全部被绑定到 `T-20260913-046` 而非按 spec 铸新 Task；嵌入 spec 的 objective/cwd/validation 被继承，但 taskId 绑定未按 spec 生效。此行为干扰检查 6，且本身值得作为 46 号工单范畴的后续核查点。
3. **检查 2 的成本**：oracle 子进程真实执行了仓库完整 `npm test` 链（passed），耗时数分钟、费用照实发生；这正是该检查判 FAIL 的直接证据。
4. **016 mtime 第二次变更（20:06:00.825259118）**：与检查 2 收据停放及/或检查 3 verdict 探针写入时间重叠，无法唯一归因；检查 3 的「mtime 不变」子断言因此记为不可干净归因（检查 3 主断言——非 unknown、走账本解析——成立）。
5. 检查 3 的 usage 行显示 `children 133.3k · cost unknown` 为 016 的历史累计值，非本探针新增。

## 证据文件清单

- 门禁 explorer run：/tmp/pi-subagents-uid-1000/async-subagent-runs/3e1fc9ad-b14d-4ac9-a77c-c3f7fb5d454c/output-0.log
- 门禁 oracle run：c52ec1bd-19ad-4314-b7a9-8e3efcb6f06c（会话 ba4e0ddc-…/run-0/session.jsonl）
- 检查 2 实际执行 run：9c8f0a2d-ed92-4e61-8f55-45f5e5eea085（会话 6ea1ca20-…）
- 检查 6 两次 run：003f8cfa-…（654b8e4f-…）、9c9968d0-…（e1a7732f-…）
- 副作用复核 run：1a4ee5cf-…（31cd982c-…）
- 指纹重构 run：fc455d49-…（04169a7b-…）
- 检查 1/3/4/5 的逐字回执：本会话消息记录（同步拒绝/工具返回，无落盘文件）


## 2026-09-14 23:33 检查 2 复跑（构建 `54a0dd5`）

| 检查 | 结果 | 逐字回执 | 备注 |
|---|---|---|---|
| 2 (48) | **PASS** | `Planner-only guard: the submitted TaskSpec disagrees with Task T-20260912-016's stored validation — validation.required differs (submitted true, stored false). A Validator is judged against the Task's stored definition: resubmit with that definition, or name the Task without embedding one.` | 同步拒绝，无 `Async delegation … has started`；会话 `2026-09-14T15-30-59-307Z`，tool_call `tool_53FabCHnDbCDTOkkGaurx3K3`；同会话随后按 stored `{required:false}` 重提的两次（tool_6OE31…、tool_EyBUX…）放行，为一致定义的正向对照 |

前次 FAIL 的根因与修复见 48 票 23:30 更正（packet 外层对象上找不到 `validation` 键）。检查 3/4/5 的 PASS 采集于 `aacd59a`；此后的改动（`144ed9e`、`13cd8d6`）只触及 48 门与 `ExtractedTaskSpecResult.submitted`，不在 49/50 的路径上。
