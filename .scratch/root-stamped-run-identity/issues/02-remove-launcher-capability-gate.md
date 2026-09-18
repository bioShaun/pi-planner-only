# 02: 删除 `LAUNCHER_CAPABILITY_UNSUPPORTED` 门禁、`childRunIdentity` 探针与身份下发 fixture

Status: resolved
Type: removal
Blocked by: 01
来源：../spec.md §Problem Statement 末三段、§Implementation Decisions 4

**What to build：** 让 `planner_delegate` / `planner_redelegate` 在已安装的 `pi-subagents@0.68.0` 上重新能够启动 child。删除 `200985e` / `4fa55e3` 引入的整套 launcher 能力机器——它守卫的需求（child 在首轮前得知 runId）在 01 之后不存在。

## 现状（写票时核过，HEAD 33a5c2c）

`delegate.ts`

- 503-509 `interface LauncherCapabilities`
- 511-515 `interface ChildRunIdentityDelivery`
- 517-524 `deliverChildRunIdentity`
- 526-546 `extractChildRunIdentity`
- 548-555 `interface CapableLauncherOptions`
- 557-612 `createCapableLauncher`（仅测试使用；`(launcher as {...}).capabilities = { childRunIdentity: true }`）
- 621-625 `DelegationDeps.launcherCapabilities?`
- 812-824 门禁：`if (role !== "reviewer" && launcherCapabilities?.childRunIdentity !== true) throw new DelegationRefused("LAUNCHER_CAPABILITY_UNSUPPORTED", ...)`

`index.ts`

- 481-498 `let launcherCapabilities` + `ensureLauncherCapabilities()`，内含 `pi.events.emit("pi-subagents:delegation-capability-probe:v1", probe)`
- 1014 `const currentCapabilities = ensureLauncherCapabilities();`
- 1022 `launcherCapabilities: currentCapabilities,`

已安装 launcher（`/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents`，0.68.0）源码与 `docs/extension-api.md` 中 `delegation-capability-probe` 零命中；该事件名是本插件发明的，没有任何监听者。

测试引用：`delegate.test.mjs` 24 处（13、83、876、2827-3019），`index.test.mjs` 6 处（167、1118-1141）。

`.gitignore` / `package.json` / 指纹列表：`4fa55e3` 已回退 explorer-model 接线；确认本票不需再动。

## 设计

- 删除上面列出的 `delegate.ts` 503-612、621-625、812-824 全部代码与注释；`index.ts` 481-498、1014、1022。`randomUUID` import 保留（784 行 `requestId` 仍在用）。`warnings` 数组声明在 786 行，01 的盖章点（1502）可直接使用。
- `DelegationDeps` 不保留任何 capabilities 字段；不加 feature flag、不加 env 开关。
- `ensureRestrictedReaderAgent` / `RESTRICTED_READER_AGENT` / `READER_CAPABILITY_UNPROVEN`（`delegate.ts:805-810`）**保留**——那是对 explorer 只读能力的真实证明，上游 `pi-subagents:runtime-agent-register:v1` 存在。
- 拒绝码枚举、breaker 模式列表、`refusal-breaker.ts` 中若有 `LAUNCHER_CAPABILITY_UNSUPPORTED` 的引用一并删（写票时 `rg` 只在 delegate.ts 命中，实施时再确认一次）。

## 测试

删除：

- `delegate.test.mjs:2827-2890` 三段（capability false 拒绝、探针 true/false 矩阵）。
- `index.test.mjs:1118-1141`（capability 拒绝 + 探针监听器）、`index.test.mjs:167` 断言。

改写：

- `delegate.test.mjs:83` `makeDeps` 默认值删掉 `launcherCapabilities`；876 同。
- `delegate.test.mjs:2896-3019` 用 `createCapableLauncher` 的用例（两个 Explorer Task + 纠正轮、Worker Task、5 种非法身份拒绝）：
  - 身份链路用例改用普通 fake launcher（报告不含 workerRunId），断言盖章值——与 01 的用例 1/5 合并去重，不留两套。
  - "5 种非法身份拒绝"用例**整体删除**：这些值不再是 child 可以发出的字段；01 的用例 3/10 已覆盖"透传被剥离"。不要把它改写成任何形式的拒绝断言。
- 所有 `piEvents.on("pi-subagents:delegation-capability-probe:v1", ...)` 绕过删除。

新增：

- `index.test.mjs`：不注册任何探针监听器、不设置任何 capabilities，`planner_delegate` role=worker 成功启动 fake launcher（断言 launcher 被调用一次，`details.taskId` 存在，无 `LAUNCHER_CAPABILITY_UNSUPPORTED`）。这条在 HEAD 上必红。
- `architecture.test.mjs` 或 `naming.test.mjs`（择既有更合适者）：全仓 `*.ts` 与 `*.test.mjs` 对 `childRunIdentity`、`delegation-capability-probe`、`LAUNCHER_CAPABILITY_UNSUPPORTED`、`SUBAGENT_RUN_IDENTITY`、`createCapableLauncher`、`deliverChildRunIdentity`、`extractChildRunIdentity` 零命中（`.scratch/` 排除）。

## 验收

1. `npm run typecheck` exit 0；`delegate.test.mjs`、`index.test.mjs`、`architecture.test.mjs`（或 naming）exit 0。
2. `rg -n "childRunIdentity|delegation-capability-probe|LAUNCHER_CAPABILITY_UNSUPPORTED|SUBAGENT_RUN_IDENTITY|CapableLauncher|ChildRunIdentity" --glob '!.scratch/**' .` 零命中（README/CHANGELOG 的历史描述由 03 处理，本票结束时允许暂留在 md 中，但 `*.ts` / `*.mjs` 必须为零）。
3. `index.ts` 中对 `pi.events.emit` 的调用只剩 restricted-reader 注册与既有事件。
4. `git diff --check` 空。

## Comments

- 2026-09-18 开票。删除时不要"保守地留个 optional 字段以备将来"——spec §Out of Scope 已明确：上游下发身份不再是需求。若实施中发现别的代码把 `launcherCapabilities` 当作通用扩展点使用，停下来在本票 Comments 记录，不要顺手扩大范围。
- 2026-09-18 已完成：完全移除 `LauncherCapabilities`、`ChildRunIdentityDelivery`、`deliverChildRunIdentity`、`extractChildRunIdentity`、`CapableLauncherOptions`、`createCapableLauncher`、`DelegationDeps.launcherCapabilities`、`LAUNCHER_CAPABILITY_UNSUPPORTED` 门禁与 `delegation-capability-probe`。测试套件已清理并全数通过，`architecture.test.mjs` 全仓扫描 0 命中。
