# 03: 部署 reviewer 用户配置并端到端验证

Status: needs-triage
Type: task
Blocked by: 02，以及 01+02 合并后 A14 门禁通过

Source: `../spec.md` 第 7 节“用户配置”、第 8 节 A15。由 Root 执行，不委派写入。

## 交付
- 先把 `~/.pi/agent/settings.json`、`~/.pi/agent/agents/reviewer.md` 备份到 `/project/tmp/reviewer-git-tool-backup/`。
- 修改 reviewer 的 `subagentOnlyExtensions` 和 `tools`（不含 bash），并改写 reviewer.md 第 4、25–27 行。
- 对真实配置跑 A13 的检查；派 reviewer 审查一个超过 32 KiB 的已提交范围，按 A15 核验。

## Comments
