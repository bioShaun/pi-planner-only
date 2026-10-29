# 01：handoff 拒绝不留稿、新稿替换旧稿、按发起方决定是否确认

Status: resolved
Type: task
Source: ../spec.md

## 请求

按 [spec](../spec.md) 实现 A、B、C 三项：

- **A**：Native 在提交时（`schedule`）被拒，不保留简报，并恢复调用前的 `#requested`；busy 和 unknown 使用不同的提示文案。
- **B**：Lite 和 Native 中，失败后保留的 `manualOnly` 简报可以被 Root 的下一次 handoff 调用替换。替换前必须通过全部拒绝检查；正在查询状态、正在派发或尚未派发的正常简报不可替换。
- **C**：`PendingHandoff` 记录 `origin`。在 confirm 模式下，用户通过 `/planner-only handoff` 发起的交接自动发送；Root 自行发起的交接填入编辑框。

用户已于 2026-10-28 确认 spec，同时授权改写 spec 中列出的三处既有断言。除这三处外，不删除、不放宽任何断言。

## 验收

- 先写 spec 中的测试并运行，贴出失败输出。失败原因必须是缺少目标行为，语法或导入错误不算。之后再实现，贴出通过输出。
- B2 的故障注入失败输出已贴出，注入代码没有提交。
- `TMPDIR=/project/tmp npm run test:release` 全部通过。
- diff 只涉及 `handoff.ts`、测试文件、`CONTEXT.md`、`README.md`、`README.zh-CN.md`、`CHANGELOG.md`。

## Comments

### 2026-10-29 Root 验收

实施：worker `cfa464c1-3e78-4de4-8ae4-a5c5b6f12eea`，分支 `fix/handoff-retention-origin`，尚未提交。

Root 已逐项核对以下内容。

- **红灯**（`/project/tmp/handoff-retention-origin/red.log`）：失败原因是缺少目标行为，例如返回文案仍是 `brief retained`、不含 `/not kept/`，以及用户发起的 confirm 用例发送数为 `0`、预期为 `1`。无语法或导入错误。`handoff.test.mjs` 是顶层脚本，遇到第一处失败即停止，因此该文件只显示了首个红灯。
- **故障注入**（`fault.log`）：去掉 `#dispatching` 保护后，B2 收到 `Handoff scheduled; it replaces...`，而不是预期的 `/already pending/`。注入代码未留在 diff 中。
- **diff**：仅涉及 8 个允许修改的文件；三处授权改写之外，无删除或放宽的断言；A1–C4 均有对应测试。
- **绿灯**（Root 自己重跑）：`PI_SUBAGENTS_DIR=/project/tmp/handoff-retention-origin/pi-subagents TMPDIR=/project/tmp npm run test:release` exit 0，日志见 `root-verify2.log`。该副本与已安装的 pi-subagents 经 `diff -rq` 核对一致（排除 `node_modules`）。

环境问题（与本票无关）：不设 override 时，`contract.test.mjs` 会因为已安装的 pi-subagents 无法解析 `@earendil-works/pi-ai`（`ERR_MODULE_NOT_FOUND`）而失败，见 `root-verify.log`。该错误发生在已安装包的模块加载阶段，执行到本仓库代码之前。
