# 10：2026-09-25 本仓库 Root session 暴露的插件问题

Status: needs-triage
Type: task

来源：维护者在本仓库用 planner-only 做票 01–09。整个 session 共委派 11 次（worker 7 次，explorer 4 次），Root 上下文涨到约 151k。

## 发现

1. **"排除在外"清单每次都重复，占用 Root 上下文。**
   仓库里有 63 个与任务无关、之前就未提交的 `.scratch` 文件。每次委派返回的结果都附一行 `Unchanged by the child (already uncommitted before; excluded above): <10 个路径>, … 53 more`（git.ts:265），每次约 700 字符，之后每一轮 Root 都要重读。
   建议：这些路径和上一次委派时完全相同的话，只显示数量（`63 pre-existing uncommitted paths unchanged`），或者只在第一次显示清单。

2. **explorer 的报告被截断，丢了关键内容。**
   第 2 次 explorer 调查 pi-subagents 能否按次关闭输出文件，返回结果里恰好有 `… [320 chars omitted] …`，被截掉的正是 `output`、`outputMode` 这些选项名。Root 只好自己 grep 上游代码补查了 6 次。
   这是票 06 之前的 4000 字符上限造成的；06 已经改为 6000 字符、保留前 60%，效果还没测。

3. **explorer 没干活就返回，状态却是 completed。**
   第 1 次 explorer 做 transcript 分析，只跑了 4 轮、32 秒，返回的是一份占位报告（写着"Detailed findings not yet assembled"），状态却是 completed。Root 只能自己写脚本重做。
   scout 的系统提示是"快速代码侦察"，输出模板是 Files Retrieved/Key Code/Architecture/Start Here，不适合日志或 transcript 分析；但系统提示又让 Root 把"读日志"这类活交给 explorer。
   可选方向：
   - explorer 的结尾说明写明"没完成就说没完成，并列出还缺什么"；
   - 为分析类任务换一个 agent（例如 researcher、delegate）；
   - 在系统提示里说明 explorer 适合做什么、不适合做什么。

4. **worker 不按要求修改票文件，自述也不可靠。**
   - 01：worker 说自己写了 Comments，其实没写。
   - 02、04：要求只追加 Comments，worker 却删掉了票头的 Status/Type/Blocked 行。
   - Root 验收时还发现 2 个实际 bug（run.sh 没把 ARM/ID 传给评测脚本；summarize 在计数指标全为 0 时崩溃），子 agent 自述里都没提到。
   这些是按设计靠 Root 验收拦下来的，不算插件缺陷。但说明：一、对 bench 脚本这类没有测试的改动，Root 的 diff 审查不能省；二、可以考虑在 worker 的结尾说明里加一句"只按要求修改，不要改动与任务无关的行"。

5. **Root 上下文增长主要来自 Root 自己读资料，不是子报告。**
   Root 自己做了大量读取：跑分析脚本、grep 上游 pi-subagents、看 diff、`slot status` 的完整输出（两次，每次几十行）。`campaign.sh` 会把整段 `slot audit` 和 `slot status` 打到 stdout。
   建议 bench 侧改一下：campaign.sh 把 audit 和 status 只写进 campaign.log，stdout 只输出一行摘要。插件侧不用改。

6. **（Root 自己的失误，不是插件问题）** Root 在 bash 里执行 `git add` 的同时调用了 git_commit，撞上 `index.lock`，重试一次就成功了。

## 待定

先做第 1 条（git.ts，改动小，收益确定）和第 5 条（只改 bench）。第 3 条要先查清 scout 为什么提前返回：看 artifact 目录里那次 run 的 transcript。
