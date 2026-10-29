# 01：handoff brief 参数说明补齐已排除方案、验证证据、已知坑

Status: ready-for-agent
Type: task
Source: ../spec.md

## 请求

按 [spec](../spec.md) 修改 `index.ts:617` 中 `handoff` 工具 `brief` 参数的 `description`。现有各项（goal、decisions made、constraints、relevant files/specs、what is done、open items、exact next step）全部保留，并补充以下三项：

- approaches ruled out and why
- how done work was verified (command -> result), marking anything not verified as unverified
- known pitfalls

`minLength`、工具的 `description` 和 `promptSnippet`、`handoff.ts` 都不改。

## 验收

- 先在 `index.test.mjs` 中添加断言，写法参照该文件第 163-177 行对 `delegate` 说明的 `assert.match` 风格。断言内容：`h.tools.get("handoff").parameters.properties.brief.description` 包含 ruled out、`command -> result`、unverified、pitfalls；原有的 goal 和 exact next step 仍然存在。运行测试并贴出失败输出，失败原因必须是说明中缺少新增字段。
- 再修改说明，贴出通过输出。
- `TMPDIR=/project/tmp npm run test:release` 全部通过。如果 `contract.test.mjs` 因为已安装的 pi-subagents 无法解析 `@earendil-works/pi-ai` 而失败，按 handoff-retention-origin 票的做法使用 `PI_SUBAGENTS_DIR` override，并在报告中注明。
- 在 `CHANGELOG.md` 的 `0.9.0-lite.0 - unreleased` 下加一行。
- diff 只涉及 `index.ts`、`index.test.mjs`、`CHANGELOG.md`；不删除、不放宽任何既有断言。
- 临时文件放在 `/project/tmp/handoff-brief-fields/`，不放 `/tmp`。

## Comments
