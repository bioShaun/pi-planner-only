# lite 交接测量协议

**日期：** 2026-09-24，安排更新于 2026-09-27　**历史对照：** `e8ad415`（lite 重写）→ `d845501`（当时 main，自动交接）　**状态：** 协议，等待启动条件，无收益测量结果。

> **历史范围：** 本文 §0–3 保留 2026-09-24 的分析、旧对照设计与行号，均指 `d845501`，不是当前运行说明。`d2e85f7` 已修复开关：`off` 为默认，未知值也按 off，只有用户主动请求才可交接；`confirm` 与实验性 `auto` 允许越过阈值后由 Root 发起。旧文“默认自动”“关不掉”“拒绝臂跑不了”的结论已失效。运行安排以下面的当前计划为准。

<a id="current-plan"></a>
## 当前安排（2026-09-27）

维护者已授权按此顺序推进。2026-09-26 更新：票 09 的六次三臂试跑已完成，有效及质量通过均为 6/6，
费用完整且已独立核验，见 [首轮报告](../.scratch/bench-plugin-fixes/trialrun-cont-20260926/report.md)。
目前没有确定的自然长会话样本，检查点隔离恢复能力也未实测，因此本协议仍延后，handoff 默认 off 不变。

2026-09-27后续更新：目标Root校准、T2c两臂对照及测量入口修复已完成，付费扩样本停止。最新lite样本未观察到上下文警告；两条T2c请求输入加cache的峰值约65k／73k，只是usage回退口径，不冒充宿主完整上下文测量。这些任务已结束且Root使用`--no-session`，没有建立可用于对照的同检查点恢复证据，也不据此断言宿主不支持恢复。见[只读核对](../.scratch/lite-measurement-next/closeout-20260927/handoff-readiness.json)。

当前仍不启动handoff试跑，不降低默认150k阈值造样本；先在真实开发任务中遇到自然长会话，再核实其剩余任务与可隔离检查点。默认off不变。

启动需同时满足：

1. 票 09 的 direct/native/lite 首轮有效比较已完成，Root 与子代理费用、失败和返工可以完整统计；不要求等待全部扩展样本完成。
2. 有正常工作中自然达到 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` 默认阈值、且仍有实质工作未完成的真实任务。不填充无关上下文，不降低阈值凑样本；没有样本就延后。
3. 能保存并隔离恢复同一检查点的会话历史、工作树状态、工具产物和验收目标，两个分支互不看到对方的答案。先验证宿主恢复能力；本协议不宣称 bench 已支持会话分叉。

首轮只比较交接本身：两臂用相同当前插件、Root/子模型、任务、验收命令和检查点。一臂 `HANDOFF=off` 继续原会话，不请求交接；另一臂仍设 off，由操作者在检查点主动运行 `/planner-only handoff`。检查点放在编写交接简报之前，避免把简报准备费用排除在外。各分支在隔离副本运行，保留交接后的完整会话链。

分别报告共享前缀成本与检查点之后的增量成本；后者包含简报准备、新会话加载、重新探索、遗漏及修复、所有子代理和失败尝试。共享前缀不能重复计入配对增量。用同一最终验收检查质量，记录耗时和人工介入；新会话轮数少或 cache-read 下降本身不证明总成本下降。

先做一个真实检查点的一对试跑，检查恢复与计费链路；没有完整证据不下收益结论。确认能公平比较后再固定重复次数和预算。试验前检查并记录 slot audit/status，使用 slot，临时文件放 `/project/tmp`。出现隔离失效、费用缺口或质量失败即停止扩样本。

只有交接本身显示值得继续验证，才另测 confirm/auto 的自动触发及确认体验。单次配对结果不支持启用默认自动交接；默认 off 保持不变。旧 §2 的自动交接保留/删除规则不直接用于当前主动交接接口。

对应删减计划 §0 的判断标准和 §6 的测量设计（`docs/pi-planner-only-subtraction-plan.md`），以及已经做过的 12 次大任务测量（`docs/lite-measurement-2026-09-24.md`）。

## 0. 要回答的问题

§0 的判断标准：每个机制都要回答「它让一个真实大任务少了几轮 Root，或者防住了哪个真实发生过、代价很大的事故？」答不出来的机制就不要。

`e8ad415` 的 `CHANGELOG.md` 把重写后的源码写成 about 700 行。同一天的 12 次测量（3 个任务 × direct/lite × 2，见 `docs/lite-measurement-2026-09-24.md`）只覆盖核心 `delegate` 路径：那份文档就在 `e8ad415` 里，`git log --follow -- docs/lite-measurement-2026-09-24.md` 只有这一次提交。之后加上的机制不在那 12 次里。最大的一块是 `d845501` 的自动交接。`CHANGELOG.md` 0.9.0-lite.0 写了交接在 tmux 里实测过，包括第一次实测里出现的连环交接。那是冒烟，不是 §6。

## 1. 规模基线

行数是物理行。这 9 个文件都以换行结尾，`wc -l` 等于行数。

### 1.1 命令

在仓库根目录执行。`HEAD` 在写本文时是 `d845501`；命令里写死这个提交，避免 main 再往前走之后对不上表。

```bash
git rev-parse e8ad415 d845501

for rev in e8ad415 d845501; do
  for f in delegate.ts index.ts git.ts subagent-delegation-contract.ts \
           contract.test.mjs git.test.mjs delegate.test.mjs index.test.mjs test-helpers.mjs; do
    printf '%s %s %s\n' "$rev" "$(git show "$rev:$f" | wc -l)" "$f"
  done
done

git diff --stat e8ad415 d845501 -- \
  delegate.ts index.ts git.ts subagent-delegation-contract.ts \
  contract.test.mjs git.test.mjs delegate.test.mjs index.test.mjs test-helpers.mjs

git log --reverse --oneline e8ad415..d845501 -- \
  delegate.ts index.ts git.ts subagent-delegation-contract.ts \
  contract.test.mjs git.test.mjs delegate.test.mjs index.test.mjs test-helpers.mjs

git show --numstat --format='%h %s' <commit> -- \
  delegate.ts index.ts git.ts subagent-delegation-contract.ts \
  contract.test.mjs git.test.mjs delegate.test.mjs index.test.mjs test-helpers.mjs
```

交接各块的行数：

```bash
git show d845501:index.ts | sed -n '115,117p' | wc -l
git show d845501:index.ts | sed -n '177,179p' | wc -l
git show d845501:index.ts | sed -n '193,195p' | wc -l
git show d845501:index.ts | sed -n '248,269p' | wc -l
git show d845501:index.ts | sed -n '274,275p' | wc -l
git show d845501:index.ts | sed -n '276,323p' | wc -l
git show d845501:index.ts | sed -n '327p' | wc -l
git show d845501:index.ts | sed -n '343,344p' | wc -l
git show d845501:index.ts | sed -n '349,360p' | wc -l
git show d845501:index.test.mjs | sed -n '109,212p' | wc -l
```

### 1.2 行数

| 文件 | `e8ad415` | `d845501` | 差 |
|---|---:|---:|---:|
| `delegate.ts` | 306 | 578 | +272 |
| `index.ts` | 219 | 404 | +185 |
| `git.ts` | 119 | 254 | +135 |
| `subagent-delegation-contract.ts` | 72 | 80 | +8 |
| **源码合计** | **716** | **1316** | **+600** |
| `contract.test.mjs` | 46 | 46 | 0 |
| `git.test.mjs` | 87 | 205 | +118 |
| `delegate.test.mjs` | 178 | 404 | +226 |
| `index.test.mjs` | 107 | 364 | +257 |
| `test-helpers.mjs` | 39 | 39 | 0 |
| **测试合计** | **457** | **1058** | **+601** |

`git diff --stat e8ad415 d845501` 对上面这些文件的输出：7 files changed, 1287 insertions(+), 86 deletions(-)。1287 − 86 = 1201 = 600 + 601。`contract.test.mjs` 和 `test-helpers.mjs` 没有变化，所以不出现在 `--stat` 里。716 行就是 CHANGELOG 里的 about 700。删减计划 §2.2 的 lite 目标是约 1,500 行源码、约 1,500 行测试。

### 1.3 增长归到哪次提交

净增 = `git show --numstat` 的插入减删除。`e8ad415..d845501` 里不改这 9 个文件的提交不列入：`b25a105`、`235c51f`、`446358e`。

| 提交 | 主题 | `delegate.ts` | `index.ts` | `git.ts` | `subagent-delegation-contract.ts` | 测试净增 | 源码净增 |
|---|---|---:|---:|---:|---:|---:|---:|
| `bdd485f` | 启用时藏起 pi-subagents 的 Root 工具 |  | +22 |  |  | +40 | +22 |
| `23a56ab` | om09 实地修复 F1–F5 | +48 | +11 | +45 | +4 | +146 | +108 |
| `5379e69` | 未完成的子代理报告最后一条进度 | +29 |  |  | +2 | +25 | +31 |
| `9435940` | 最后一条进度清掉 currentTool 时仍保留 Last activity | +6 |  |  | +2 | +16 | +8 |
| `8313a5f` | k/M/B 状态栏与 Root 占比；同一提交还有子代理节奏和 commit 上限 2000 | +15 | +16 |  |  | +25 | +31 |
| `f4b26d9` | 未完成子代理的 transcript tail | +152 | 0 |  |  | +84 | +152 |
| `4f48884` | 排除子代理没碰过的既有脏路径 |  |  | +82 |  | +69 | +82 |
| `e535a57` | transcript tail 里补上慢的模型轮 | +22 |  |  |  | +13 | +22 |
| `52541aa` | 复查：子代理又提交过的旧脏路径仍要可见；没有 usage 的失败子代理也计数 | 0 | +3 | +8 |  | +21 | +11 |
| `792ab78` | Root 上下文大小与一次性建议；同一提交还改了提示词 |  | +33 |  |  | +49 | +33 |
| `d845501` | 自动交接；同一提交还有空 `path` 不当过滤 |  | +100 |  |  | +113 | +100 |
| **合计** |  | **+272** | **+185** | **+135** | **+8** | **+601** | **+600** |

点名的五块（状态栏、transcript tail、脏路径、上下文建议、交接）源码净增 31 + 152 + 82 + 22 + 33 + 100 = 420 行，测试净增 25 + 84 + 69 + 13 + 49 + 113 = 353 行。其余 180 行源码、248 行测试是同一天更早的 `bdd485f`、`23a56ab`、`5379e69`、`9435940`，加上复查提交 `52541aa`。

`8313a5f` 的提交说明还包含 G1（任务文本）、G4（`git_commit` 上限 2000）、G5（归责提示）。那 31 行源码不全是状态栏。`792ab78` 的 33 行里，提示词是原行替换，净增主要在上下文状态和那一条建议。`d845501` 的 100 行里有 2 行不是交接：`index.ts:225-226` 把空的 `path` 当成没有路径过滤。

### 1.4 交接实现在哪些块

交接没有独立的导出函数。它在 `index.ts` 的 `plannerOnly` 里。`delegate.ts` 和 `git.ts` 不实现交接；派发时调用已有的 `gitSafePrefix` 和 `isWorkTree` 来写 git 事实。

当前 `d845501` 的块（含首尾行）：

| 块 | 行 | 行数 |
|---|---|---:|
| 状态 `handoffRequested`、`pendingHandoff`、`delegationsInFlight` | 115–117 | 3 |
| `delegate` 执行期间的 in-flight 计数（有子代理在跑就拒绝交接） | 177–179、193–195 | 6 |
| `handoff` 工具 | 248–269 | 22 |
| `/planner-only handoff` 保留目标原文用的参数拆分 | 274–275 | 2 |
| `handoff drop`，以及建新会话、提交简报 | 276–323 | 48 |
| `/planner-only off` 时丢掉尚未派发的简报 | 327 | 1 |
| `session_start` 清交接状态 | 343–344 | 2 |
| `agent_settled`：回合结束后派发 `/planner-only handoff` | 349–360 | 12 |
| **合计** |  | **96** |

`index.test.mjs:109-212` 是连在一起的交接场景，104 行。提交的测试净增是 +113，因为工具名单里的断言也改过。

依赖它的上下文警告不在这 96 行里，见 §3。

## 2. 交接测量

### 假设

交接应当省下的：

- 长会话越过警告阈值之后，每一轮 Root 的 cache-read token。新会话只带简报和 git 事实（`index.ts:304-312`），不再把旧上下文整段重读。
- Root 轮数。交接臂把 `parentSession` 链上的会话加总，再和拒绝臂比。
- 总花费（Root 加子代理）。

交接可能多花的：

- 简报漏掉旧会话里的事实，新会话重新探索。记新会话里第一次 `delegate` 或第一次改文件之前的 Root 轮数。
- 交接取消或失败。`index.ts:314-321` 把简报留着，要再跑 `/planner-only handoff`，或者 `handoff drop` 丢掉。
- 连环交接。新会话自己再越过阈值后又交一次。页眉写了不要交，除非新会话自己的上下文也越过阈值（`index.ts:304`）。CHANGELOG 写明第一次 tmux 实测里出现过连环情况；页眉是那次之后的限制，不是测量。

### 任务

- 长的、多步的任务，并且这次运行里 Root 上下文要真正超过 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS`（默认 150000，`index.ts` 的 `contextWarnThreshold`）。
- 没越过阈值的任务作废。没人用 `/planner-only handoff` 请求时，工具会拒绝（`index.ts:263`），两臂没有差别。先用一次试跑确认会越过，再纳入正式样本。试跑的数字不写进结果表。
- 每个任务有固定的验收命令。和 §6 一样。
- `docs/lite-measurement-2026-09-24.md` 的 T1–T3 不自动入选。那份文档记了 lite 的 Root 轮数是 15–22，没有记上下文 token，也没有交接。不要用那 12 次的花费比例外推交接。

### 对照

两臂都是 lite（`PI_PLANNER_ONLY=1`，同一份插件，同一份任务提示词）。每臂至少重复 2 次，与 §6 相同。

- 交接臂：默认。`PI_PLANNER_ONLY_HANDOFF` 不设，或设为 `auto`。阈值用默认 150000。
- 拒绝臂：lite 仍开，上下文警告仍按默认阈值发，`handoff` 工具拒绝或不可用。人不要在这一臂发 `/planner-only handoff`。

模型、计价沿用 `docs/lite-measurement-2026-09-24.md`：Root 按那份文档的 opus / astra / sol 三套价，子代理按实际模型价，数据取 message usage，不用宿主报告的 cost 字段。

同任务两次之间花费可以差一倍（那份文档里 T1 的 A 价比是 0.29 对 0.55）。两次分不出差额时，加重复。不用一次的差额决定保留。

### 关不掉（发现）

拒绝臂在当前代码上跑不了。

`PI_PLANNER_ONLY_HANDOFF` 只在 `index.ts:305` 读一次。值经 `trim().toLowerCase()` 之后，只有 `confirm` 会把简报放进编辑框（`index.ts:309-311`）。其他值，包括不设、`auto`、`off`、`0`，都走 `sendUserMessage`，新会话照样开、简报照样提交。README 也只写了 `auto` 和 `confirm`。

把 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` 抬到这次任务到不了的值，会让未经请求的 `handoff` 被拒绝（`index.ts:263`）。同一个 `contextWarnThreshold()` 也关掉上下文警告（`index.ts:123-124`）。警告和交接门被绑在一起，不能当成拒绝臂。`/planner-only handoff` 仍会把 `handoffRequested` 设上，工具照样接受。

`PI_PLANNER_ONLY=0`（以及 `false` / `off`）和 `/planner-only off` 关掉整个插件，`delegate`、`git_audit`、`git_commit` 一起去掉（`isEnabled`，`index.ts:36-39`；`syncTools` 在关闭时摘掉 `PLUGIN_TOOLS`）。`index.test.mjs:182-189` 的 `disabledHandoff` 测的是这个整插件开关，不是只关交接。

本协议不补开关。人要跑拒绝臂，得先有一个只拒绝交接、保留 `delegate` 和默认阈值警告的办法。在那之前，不要用抬高阈值或关掉插件来代替。

### 数据来源

宿主会话 jsonl。新会话用 `parentSession` 指回旧会话文件：`index.ts:307` 的 `ctx.newSession({ parentSession: handoff.sessionFile })`。链上每一段都要读，用这个字段串起来。

花费只从两类记录来，和 `docs/lite-measurement-2026-09-24.md` 相同：Root 的 message usage，以及 delegate 结果里的 `details.usage`。插件的 usage.jsonl 不读。`type=custom` 的镜像条目不计花费（删减计划 §6）。

两条 custom 消息只作事件记录，不进 token 账：

- 上下文警告：`customType: "planner-only-context"`（`index.ts:128`）。
- 交接派发失败：`customType: "planner-only-handoff"`（`index.ts:358`）。

### 指标

- 有没有越过阈值，以及越过时的上下文 token。状态栏用的是同一个数：`getContextUsage().tokens`，否则 `rootUsageOf` 的 context（input + cacheRead + cacheWrite），见 `index.ts:394-397`。
- 越过之后每一轮 Root 的 cacheRead。交接臂看新会话的轮次；拒绝臂看同一会话越过之后的轮次。
- Root 轮数。交接臂把 `parentSession` 链上的会话加总。
- 总花费和 Root 占比。三套 Root 价都报，口径同已有测量文档。
- 验收命令是否通过。
- 交接结果：成功、取消、失败、链长（`parentSession` 的跳数）。
- 重探索轮数：新会话里，第一次 `delegate` 或第一次改文件之前的 Root 轮数。

### 保留规则

在真正越过阈值的任务上：

- 交接臂的总花费 ≤ 拒绝臂，通过率不降，并且取消、失败重试和连环交接没有把这个差额吃掉 → 保留自动交接。
- 否则删掉自动交接：`handoff` 工具、`agent_settled` 里的派发、新会话提交。一次性上下文警告可以留下，让人自己 `/compact` 或开新会话。若 §3 的警告也没有让 Root 少读，警告一起删。不要为了保住交接再加一层机制。

## 3. 上下文警告（交接依赖它）

`792ab78` 加入。越过 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` 时状态栏变红，并向 Root 追加一条消息（`deliverAs: "nextTurn"`，`index.ts:123-132`），系统提示词本身不改。压缩之后重新武装（`session_compact`，`index.ts:385-388`；上下文回到阈值以下时 `contextWarned` 清掉，`index.ts:398`）。

`d845501` 改了这条文案：从「把简报写进文件，请人开新会话」改成「调用 `handoff` 工具」。当前文字在 `index.ts:129`。

当前块：

| 块 | 行 | 行数 |
|---|---|---:|
| `rootContext`、`contextWarned` | 113–114 | 2 |
| `contextWarnThreshold` 与 `sendContextWarning` | 119–133 | 15 |
| `session_compact` 重新武装 | 385–389 | 5 |
| `message_end` 里读取上下文并决定是否发警告 | 394–399 | 6 |

`statusTotals`（134）和 `updateStatus`（136–141）在更早的状态栏上加了 `ctx` 和红色。`rootUsageOf`（78–88）多了一个 context 字段。这些函数不是这次新加的。

假设：越过阈值后的那一条消息，让 Root 把重读工作委派出去，后面几轮的 cacheRead 因此下降。代价是这条消息本身会被下一轮读进去。

它和交接共用一个阈值。在拒绝臂的开关出现之前，不要单独做警告的 A/B：抬高阈值会把交接门一起关掉。交接测量的记录里记下三件事：警告发了没有、发出之后到第一次交接之间 Root 是委派、要求 `/compact`，还是继续自己读、最后有没有真的交出去。

警告若留下、交接若删掉，那时再按 §2 的同一口径测警告：警告开对警告不发，任务仍要越过默认阈值，数据来源和保留规则相同。答不出来就删警告。
