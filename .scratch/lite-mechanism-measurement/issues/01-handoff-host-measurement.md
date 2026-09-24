# 01: 在宿主上测量自动交接

Status: ready-for-human
Type: task
Blocked by: none

来源：`docs/lite-handoff-measurement-protocol.md`。交接在 `d845501`，12 次大任务测量在 `e8ad415` 的 `docs/lite-measurement-2026-09-24.md`，不覆盖它。

## 要做的事

按协议 §2 跑交接臂和拒绝臂。任务必须真正越过 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS`。数据用宿主会话 jsonl，新会话用 `parentSession` 串回旧会话（`index.ts:307`）。不要读插件镜像，不要把 `type=custom` 计入花费。

保留或删除按协议 §2 的规则。失败则删掉自动交接，不要再加机制。上下文警告按协议 §3 只作记录；在拒绝臂能单独跑起来之前，不要给警告单独做 A/B。

## 拒绝臂现在跑不了

当前没有只关闭 `handoff`、留下 `delegate` 和默认阈值警告的环境变量。`PI_PLANNER_ONLY_HANDOFF` 只有 `auto` 和 `confirm`（`index.ts:305-312`）。抬高 `PI_PLANNER_ONLY_CONTEXT_WARN_TOKENS` 会把警告一起关掉。`PI_PLANNER_ONLY=0` 和 `/planner-only off` 关掉整个插件。细节在协议「关不掉（发现）」。

本票不改代码。人若要跑拒绝臂，先备好这个开关，再开跑。在那之前不要用抬高阈值或关掉插件代替。

## 规模

协议 §1。重写时源码 716 行，`d845501` 为 1316 行。交接本体在 `index.ts` 里合计 96 行（协议 §1.4）。

## Comments

- 2026-09-24 开票。协议已写好。测量要在主人的 pi 宿主上做，本票停在 `ready-for-human`。
