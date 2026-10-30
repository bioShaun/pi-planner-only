# Native 交接链路收敛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal：** 自动 handoff 连续超过上限（默认 3）时退回 confirm，并让简报区分用户授权与 Root 自行决定，防止上一任 Root 的决定经交接变成默认规则。

**Architecture：** 在 `handoff.ts` 内维护交接链计数：新会话写入插件自定义条目 `planner-only-handoff-chain`，从会话分支恢复；真实用户输入归零，Root 发起的成功投递加一，`auto` 下超过上限的那次改走 confirm 的编辑器路径。`index.ts` 接线 `input` 事件、状态行与 `handoff` 工具说明。不改变委派、子代理生命周期或工具权限。

**Tech Stack：** TypeScript、Node.js 原生 assert 测试、npm release 检查。

**Spec：** `docs/superpowers/specs/2026-10-30-native-handoff-chain-convergence-design.md`（第 3.3 节默认值已由用户确认：上限 3，配置项 `PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT`）。

**基线：** `f363b30`（`feat(native): split delegations by independently acceptable deliverable`）。工作区其余未提交的 bench、`.scratch` 改动属于用户，不碰。

## Global Constraints

- 只改 `config.ts`、`handoff.ts`、`index.ts`、`handoff.test.mjs`、`index.test.mjs`、`CONTEXT.md`、`README.md`、`README.zh-CN.md`。不提交、不安装、不 reload。
- `confirm`、`off` 的现有行为一字不变；用户发起的交接（`origin: "user"`）不受上限影响，并归零。
- 上限只影响 `auto` + Root 发起：使链长超过上限的那一次放入编辑器并通知，不自动提交。
- 链长跨 `newSession` 传递，并从会话记录恢复；条目损坏或无法判断时按已达上限处理，不按 0 处理。全新会话（无交接标记、无条目）按 0 处理。
- 真实用户输入归零；扩展注入输入（`source: "extension"`）、插件交接提示、`/planner-only handoff` 投递消息、子代理通知不归零。
- 不给简报加结构校验或关键词拦截，仍只保留 200 字符下限。
- 先只写测试并运行，保留红灯输出；红灯原因必须是缺目标行为，不能是语法或导入错误。之后实现并保留绿灯输出。不得删除或弱化已有断言；新增 guard 要配 fault-injection 检查。
- 禁止使用 `/tmp`。`TMPDIR` 设为仓库外的 `/project/tmp/ppo-handoff-chain/tmp`，证据放 `/project/tmp/ppo-handoff-chain/`。预计超过 1 分钟或 2GB 内存的命令，先读 `~/.config/agents/slot.md`，记录 `slot audit` 和 `slot status`，再用 slot 提交。

## 目标文本

**B1：`handoff` 工具 `brief` 参数说明**（`index.ts`，在现有说明后追加）：

> Separate user authorization (goal, scope, acceptance criteria, each with its source: a user message or a document path) from Root's own decisions (for example child model overrides, task splits, or scope changes); give each Root decision its reason and mark it as a Root decision.

**B2：交接提示词**（`handoffPrompt`，追加一句）：

> The Root decisions in the brief are the previous Root's choices, not user instructions: keep them only where they still have a basis, and do not pass them on as user rules.

**通知文本**（`auto` 超过上限时）：

> `已连续自动交接 {N} 次，请检查简报后提交`

## 数据格式

- 自定义条目：`customType: "planner-only-handoff-chain"`，`data: { version: 1, count: number }`，`count` 为非负安全整数。
- 读取：从 `ctx.sessionManager.getBranch()` 末尾向前找最后一条该条目。
  - 合法 → 使用其 `count`。
  - 存在但非法（版本不符、`count` 非法）→ `unknown`。
  - 无条目但分支中存在以 `[planner-only handoff]` 开头的用户消息 → `unknown`（升级前创建的交接会话）。
  - 其余（全新会话）→ `0`。
- 写入：新会话投递成功（自动提交或放入编辑器）后，用 `pi.appendEntry` 写入本次结果计数。真实用户输入归零时，若当前计数不为 0 才写入。

## Review Focus

- 第 4 次 Root 连续自动交接在 `auto` 下放入编辑器并通知；第 3 次仍自动提交。
- 用户发起（`/planner-only handoff` 后 Root 调用）不受上限影响，自动提交并把链长归零。
- 链长经 `newSession` 传递；reload/resume 从分支条目恢复；条目损坏或交接会话缺少条目时退回 confirm，不按 0。
- `input` 接线只认非 `extension` 来源；扩展注入不归零。
- B1/B2 文本独立断言，测试期望不引用导出常量；既有 handoff/模式隔离/工具断言不删除、不弱化。
- `off`/`confirm` 行为不变；`off` 下不写链长条目。

---

### Task 1：链长状态、上限与 handoff 行为

**Files：**
- Modify: `config.ts`（`PlannerConfig`、`DEFAULT_CONFIG`、`loadConfig`）
- Modify: `handoff.ts`（条目读写、`userInput`、上限判断、`chain` 查询）
- Test: `handoff.test.mjs`

**Interfaces：**
- `PlannerConfig.handoffAutoLimit: number`，默认 3，来源 `PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT`，沿用 `intEnv`。
- `RootHandoff.userInput(ctx: ExtensionContext): void`：真实用户输入归零。
- `RootHandoff.chain(ctx: ExtensionContext): { count: number | "unknown"; limit: number }`：供状态行读取。
- `HandoffRuntime.pi` 增加 `appendEntry(customType: string, data?: unknown): void`。

- [ ] **Step 1：基线。** 记录 `git status --short`、八个目标文件 SHA-256，跑一次 `handoff.test.mjs` 和 `index.test.mjs` 区分环境失败。
- [ ] **Step 2：只改测试。** 在 `handoff.test.mjs` 扩展 harness：`ctx.sessionManager.getBranch()` 返回可变的 `entries`，`pi.appendEntry` 追加条目；按第 3.2 A 节写断言：
  1. `auto` 下 3 次 Root 交接自动提交，第 4 次进编辑器且通知含 `已连续自动交接 3 次`，`sent` 不增加。
  2. `userInput` 归零后下一次 Root 交接计数为 1；连续两次后归零。
  3. 用户发起的交接在计数已达上限时仍自动提交，并写入 0。
  4. 分支条目非法、或交接会话缺条目时，Root 交接进编辑器。
  5. `chain()` 返回计数与上限，非法条目返回 `"unknown"`。
  6. `handoffPrompt` 的 B2 句子出现在投递内容中。
- [ ] **Step 3：红灯。** `TMPDIR=/project/tmp/ppo-handoff-chain/tmp node --experimental-strip-types handoff.test.mjs` 必须以缺少链长行为而失败（AssertionError 或未实现方法），保存 `red-handoff.log`。
- [ ] **Step 4：实现。** `config.ts` 加上限；`handoff.ts` 实现条目读写、归零、上限判断、`chain()`；`auto` 超限分支复用 `mode === "confirm" && origin === "root"` 的编辑器路径，通知用目标文本。投递成功后在新会话写入计数。
- [ ] **Step 5：绿灯。** 重跑 `handoff.test.mjs`，保存 `green-handoff.log`。
- [ ] **Step 6：fault-injection。** 临时去掉上限判断，确认第 4 次自动提交的断言失败；恢复实现并重跑绿灯，记录在 `fault-injection.log`。

### Task 2：输入接线、状态行与简报说明

**Files：**
- Modify: `index.ts`（`pi.on("input")`、`notifyStatus`、`handoff` 工具 `brief` 说明）
- Test: `index.test.mjs`

**Interfaces：** `before_agent_start`、工具集合与生命周期不变。状态行追加 ` · chain {count}/{limit}`，未知显示 `chain ?/{limit}`。

- [ ] **Step 1：只改测试。** 断言：
  1. `input` 事件 `source: "interactive"` 调用 `userInput`（写 0 条目）；`source: "extension"` 不写。
  2. `off` 模式下 `input` 不写条目。
  3. `/planner-only status` 输出含 `chain 1/3`；非法条目时含 `chain ?/3`。
  4. `brief` 参数说明含 B1 的独立期望文本（不引用实现常量）。
- [ ] **Step 2：红灯。** 运行 index 测试，失败原因必须是缺上述行为；保存 `red-index.log`。
- [ ] **Step 3：实现。** 注册 `input` 处理器（`mode !== "off"` 且 `source !== "extension"` 时归零）；状态行接入 `handoff.chain(ctx)`；更新 `brief` 说明。
- [ ] **Step 4：绿灯。** 重跑 index 测试，保存 `green-index.log`。

### Task 3：文档与完整回归

**Files：**
- Modify: `CONTEXT.md`（Root handoff 条目）
- Modify: `README.md`、`README.zh-CN.md`（handoff-mode 说明与环境变量表）

- [ ] **Step 1：文档。** CONTEXT.md 补一句：`auto` 下连续 Root 交接超过上限（默认 3，`PI_PLANNER_ONLY_HANDOFF_AUTO_LIMIT`）的本次退回编辑器；用户输入或用户发起的交接归零。两份 README 的 `handoff-mode` 行与 env 表同步；中文逐字引用通知文本，英文如实概括。
- [ ] **Step 2：回归。** 运行 `npm run test:release`；若遇已知本机阻塞（pi-subagents 缺 `@earendil-works/pi-ai`），改跑 `npm run test:release:isolated` 并如实记录。保存 `release.log` 或 `release-isolated.log`。
- [ ] **Step 3：证据。** `git diff --check`，保存 `change.patch`、`files.sha256`、`status-after.txt`，确认其他未提交改动与基线一致。

### Task 4：独立复核与 Root 验收

- [ ] **Step 1：reviewer 只读检查。** spec、diff、红绿日志、release 输出、fault-injection 记录，对照 Review Focus。
- [ ] **Step 2：Root 验收。** 核对八个文件的 diff 与证据，确认模式隔离、工具权限和既有断言未被改动；由用户决定是否提交。
