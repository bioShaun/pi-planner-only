# 02: 同一天其余机制已有的证据

Status: ready-for-human
Type: task
Blocked by: none

来源：`docs/lite-handoff-measurement-protocol.md` §1.3。判断标准仍是删减计划 §0：少了几轮 Root，或者防住了哪次真实的贵事故。12 次测量不覆盖这些提交。

主人用下面的证据决定：凭已有事故保留，还是补一次测量。本票不替这个决定作结论，也不改代码。

`.scratch/om09-run4/` 里目前只有 `spec.md`。spec 写「records copied here」，原始会话不在这个目录。

## 状态栏（k/M/B，Root 的 token 占比和花费占比）

- 提交：`8313a5f`。复查 `52541aa` 让没有 usage 的失败子代理也计入状态栏。
- 证据：`.scratch/om09-run4/spec.md` 的 G6，会话 `01a0d383`。当时的状态栏是 `root 4166k … root 97%`：数字以 k 计，占比只有花费。
- `8313a5f` 的提交说明同时包含 G1（任务文本）、G4（`git_commit` 上限 2000）、G5（归责提示）。协议 §1.3 里该提交的 +31 行源码不全是状态栏。
- spec 没有给这条难读的状态栏写花费，也没有写它少了多少 Root 轮。

## transcript tail（未完成的子代理）

- 提交：`f4b26d9`（慢工具、最近 12 次工具调用、最后的助手文本），`e535a57`（没有工具在跑的慢模型轮）。更早的 F4 兜底是 `5379e69` 和 `9435940`（最后一条进度、artifact 文本），见 `.scratch/om09-field-fixes/spec.md` 的 F4。
- 证据：`.scratch/om09-run4/spec.md` 的 G2，会话 `01a0d383`。超时结果只有 "Subagent timed out"，已经通过的检查输出丢了，Root 重跑了那次检查（约 $0.84）。
- `e535a57` 的提交说明另记了一次：一次 20k token 的思考轮（8 分 21 秒，没有工具在跑）让那次会话自己的 G3 worker 超时，而当时的 tail 里看不见这段空档。
- 这两处是加上 tail 时所依据的事故，不是 tail 落地之后的对照测量。

## 既有脏路径排除

- 提交：`4f48884`。复查 `52541aa`：子代理又提交过的旧脏路径不能被当成「没变」而藏起来。两个提交的说明都写了在 om09 的 git 1.8.3.1 上重跑过 `git.test`。
- 证据：`.scratch/om09-run4/spec.md` 的 G3，会话 `01a0d383`。委派前就脏、子代理没碰过的 `README.md` 被算进了工作区摘要。
- spec 没有给 G3 写花费。同一份 spec 的 G5（Root 撤回了自己要求的 lnc 改动，并说是 worker 自己改的）是 `8313a5f` 里的一句提示词，不是这段排除代码。

## Comments

- 2026-09-24 开票。只引用上述 spec 和提交说明。没有新的测量数字。
