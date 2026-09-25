# 02：git_commit 默认提交范围

Status: ready-for-human
Type: task

Source: `../spec.md`（问题 5）。

## Decision

- 2026-09-25 维护者按 agent 推荐批准方案 B（只做提示和回显）：保留 `add -A` 行为，不扩参数面、不保存状态；提交结果里显式列出本次改动的全部路径，并加一句系统提示。agent 开始实现。

## Problem

`git_commit` 不带 paths 时执行 `git add -A`，会把与本次无关的脏文件
（例如操作者的半成品）一起提交。这个风险真实存在。

## 为什么不用原方案

原方案是：session 按 cwd 记住最近一次委派的"委派前已脏且本次未动"路径表，
`git_commit` 不带 paths 时排除表里的路径。复核时发现两个缺陷：
- 会静默丢掉 Root 自己的改动。例如 Root 先改了文件 X，再委派一个没碰 X 的 worker，
  X 就会进表，之后被排除在提交外，而且没有任何提示。
- 在委派之间保留状态，违背 CONTEXT 的"委派之间不保留任何东西"。另外，表会随后续编辑变旧。

## 替代方案（需要维护者二选一）

A. **显式确认**：不带 paths 时，先用 `git status --porcelain` 列出将要暂存的全部路径，
   然后拒绝提交，要求 Root 带上 paths，或带上 `all: true` 重新调用。
   这个方案不保存状态，但会给参数面加一个字段，每次提交也多一轮往返。
B. **只做提示和回显**：保留 `add -A` 的行为。提交结果里列出本次暂存的全部路径，
   目前 `show --stat` 已经有这些信息，需要确认会被截断的场景。系统提示加一句
   "commit only files you accepted; pass paths when the tree had unrelated changes"。
   参数面和状态都不变。

倾向 B：它符合"不扩参数面、不保存状态"，并且把误交从静默变成可见，Root 可以用 `git_audit` 发现后再修正。

## Acceptance（选定方案后补全）

- 方案 B（2026-09-25 维护者已批准）：保留 `add -A`；提交结果首行显式列出本次改动的全部路径
  （`git diff-tree --name-only -z HEAD`，超 100 文件时 `… N more`）；系统提示加一句
  "commit with git_commit: pass paths when the work tree has unrelated changes"。
- 带 paths 的行为不变；不删改既有断言。

## Comments

- 2026-09-25 agent 实现完成（已提交 059561b）：
  - `git.ts`：`gitCommit` 在 `show --stat` 之前先跑 `diff-tree … -z HEAD`，结果首行回显
    `Committed files (N): …`（路径全部来自 `-z` 全量列表，不受 `--stat` 截断影响）；`diff-tree` 失败时回退到原来的纯 stat 文本。
  - `index.ts`：系统提示 `After accepting changes…` 句追加 `pass paths when the work tree has unrelated changes`（提示长度 1240/1256 字符，仍 <1300）。
  - 测试：`git.test.mjs`（假 runner：tiny `--stat` 下仍列出 3 个文件 + 真仓库断言 `Committed files (1): new.txt`；既有安全前缀循环覆盖 `diff-tree` 的 `--no-ext-diff/--no-textconv`）、`index.test.mjs`（新提示句文本断言）。
  - 验证：typecheck 退出 0；五套件全绿（TMPDIR 在仓库外）；`git diff | grep '^-.*assert'` 无输出。
- 2026-09-25 Root 复核后跟进：
  - `clip(3000)` 只保留开头，文件列表过长时会挤掉提交号那一行。改为先输出 `show --oneline` 的首行，再输出 `Committed files` 行，最后是其余 stat。
  - 补故障注入测试：`diff-tree` 失败时回退到纯 stat；105 个文件时显示 `Committed files (105)`、`… 5 more`，首行仍是提交号。
  - 假 runner 改为按真实前缀剥离，测试覆盖了三段安全前缀（含 `--no-optional-locks`）。
