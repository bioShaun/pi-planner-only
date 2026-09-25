# lite 交接测量协议

**日期：** 2026-09-24　**对照：** `e8ad415`（lite 重写）→ `d845501`（当前 main，自动交接）　**状态：** 协议。没有测量结果，下面也不填任何一次运行的花费或轮数。

> **行号说明：** 本文所有 `index.ts:N`、`*.test.mjs:N` 行号都指提交 `d845501`（用 `git show d845501:index.ts` 查看），不是当前 main。之后合并的重构 PR #16–#23 改了结构：交接状态进了 `index.ts` 的 `PlannerSession`，`PI_PLANNER_ONLY_*` 解析进了 `config.ts`（`handoffMode` 仍然只有 `auto` / `confirm`），宿主调用进了 `host.ts`。行为未变，「关不掉」的结论仍成立。

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
