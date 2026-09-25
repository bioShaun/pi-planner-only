# 02：git_commit 默认提交范围

Status: needs-triage
Type: task

Source: `../spec.md`（问题 5）。

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

- 带 paths 的行为不变；不删改既有断言。
