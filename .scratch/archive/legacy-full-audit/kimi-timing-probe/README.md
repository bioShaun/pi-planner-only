# kimi-timing-probe（临时分析材料）

分支 `kimi-timing-probe` 只为换机器继续分析 2026-09-07 那次 Kimi 单票探测。**不要合并进 `main`。**

分析结束后从 GitHub 删掉整个分支即可：

```bash
git push origin --delete kimi-timing-probe
git branch -D kimi-timing-probe
```

| 路径 | 内容 |
|---|---|
| `run-2026-09-07.md` | 过程、时间线、token/费用、对照 GLM |
| `pi-session/` | 当时 Pi 会话与全部 subagent artifacts（约 2.4MB） |
| `snapshots/` | 该 Task 的 usage 一行、当时 `settings.json` |
| `../oracle-status-line/` | 探测用的 spec / 票 / Root prompt |
| `../planner-only-cost-control/` | 费用控制规格（尚未实施） |
| `../planner-only-hardening-gaps/` | GLM 那轮实现的两张 leftover 票 + spec |

本分支另有探测 Worker 提交的 `1b103f6`（`/planner-only status` 打印 oracle suite）。若分析后不要这行功能，随分支一起丢掉。
