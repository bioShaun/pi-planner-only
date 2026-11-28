# 01: architect 派工规范、验证前置冻结与审方案偏批准门闩

Status: done
Type: task
Blocked by: none

Source: `../spec.md` W1。

## Scope

- 同步 `.scratch/native-root-dispatch/spec.md` 的方案契约角色口径：方案契约由 `architect` 撰写；pi-subagents 内置 `oracle` 仅保留作按需决策一致性顾问。
- 修订 `agents/architect.md` 正文：CLEAR / UNCLEAR 业主决策过滤、最多 3 份必读材料、验证命令与可证伪完成断言先于实施步骤冻结、可勾选步骤、建议角色仅限 `worker` / `scout` / `reviewer`、交回前五项遗漏自检。
- 在派工表第 6 至 7 节写入审方案「偏批准、仅查证属实阻塞项可驳回、仅剩备注即通过、一次一过」。
- frontmatter 保持不变；`index.ts` 与 `NATIVE_PROMPT` 不变。

## Acceptance

- `contract.test.mjs` 对 `architect` 工具白名单、`bash` 故障注入和方案模板守卫全绿。
- `NATIVE_PROMPT.length` 保持 1,167 字符，仍低于 1,200 上限。
- `TMPDIR=/project/tmp npm run test:release`（或按 AGENTS.md 使用 `:isolated`）通过。

## Comments

- 2026-11-28：已完成。`agents/architect.md` 改为 CLEAR/UNCLEAR 业主决策过滤、六项固定方案模板、验证先于实施步骤冻结、`- [ ]` 可勾选步骤、角色仅限 `worker` / `scout` / `reviewer` 与五项遗漏自检；`.scratch/native-root-dispatch/spec.md` 已统一切换为 architect 口径，并写入审方案「偏批准」一次一过门闩。红灯证据：`/project/tmp/stage3-orchestration-polish/release-red.log` 中 contract 守卫按缺少目标行为失败（缺第 4/5/6 节新标题、验证前置句、`- [ ] 步骤 N` 与五项自检）。绿灯证据：`slot cpu -- env TMPDIR=/project/tmp npm run test:release:isolated` 退出码 0，日志 `/project/tmp/stage3-orchestration-polish/release-green.log`；`NATIVE_PROMPT.length=1167`，未改 `index.ts` 的提示词文本。
