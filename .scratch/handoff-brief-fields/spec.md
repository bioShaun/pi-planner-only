# Root handoff：简报字段补齐“已排除方案、验证证据、已知坑”

状态：ready-for-agent，实施票 [01](issues/01-brief-fields.md)。基线 `49e0e9a`。

来源：对照 MiniMax-AI/mcode-stack `stacks/ronny/skills/handoff-doc/SKILL.md`（2026-10-29 阅读）。

## 问题

`handoff` 工具的 `brief` 参数说明（`index.ts:617`）目前要求包含：goal、decisions made、constraints、relevant files/specs、what is done、open items、exact next step。

和参考 skill 相比，缺三项。这三项缺失会直接导致新会话返工或误判：

1. **已排除的方案及原因。** 没写的话，新会话可能重新尝试已经否决的路线。
2. **已完成部分的验证证据。** 应写明"运行的命令 -> 实际结果"。未经验证的内容必须标为 unverified，避免新会话把上一会话的记忆当作事实。新会话注入的 git facts（`handoff.ts:55-66`）只覆盖 status/log，覆盖不到测试结果。
3. **已知的坑。** 包括不稳定的测试、环境问题等。例如 `.scratch/handoff-retention-origin/issues/01` 中记录的 `contract.test.mjs` 需要 `PI_SUBAGENTS_DIR` override，这类信息如果不交接，新会话会重新排查一遍。

## 目标行为

`brief` 参数说明在保留现有各项、顺序不变的前提下，补充以下三项：

- approaches ruled out and why；
- how done work was verified (command -> result)，并注明 mark anything not verified as unverified；
- known pitfalls。

补充后仍是一句话，措辞尽量短。`minLength: 200` 和拒绝逻辑都不变。

## 不做

- **新会话先复述目标和下一步再动手。** auto 模式下没有人在动手前审阅复述内容，复述起不到拦截作用，只会多一轮输出。confirm 模式下，用户本来就会在编辑框里看到简报。`handoffPrompt` 中的 "do the next step now" 保持不变。
- **"同一任务只维护一份交接文档"。** `.handoff/` 已被 gitignore，用于 herdr-pair 的轮次记录和归档，不用于 Root 接续。Root 接续时的简报由工具直接注入，不落盘。
- **对简报结构做硬校验。** 例如检查必须出现哪些标题。这会让正常的简报被拒，带来误拒风险，而收益低；只通过说明文字引导即可。
