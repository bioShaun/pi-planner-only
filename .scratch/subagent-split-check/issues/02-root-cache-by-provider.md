Status: done

# 02 Root 缓存分析按 provider/model 拆分

Spec：`../spec.md` 中的 P1 第 1–2 步。依赖 issue 01（已完成）。

## 为什么

不同 provider 的缓存语义不同：Anthropic 显式写缓存并按写入计费（`cacheWrite` > 0）；OpenAI 类（含本机 `tcuni` 代理，api `openai-responses`）自动缓存，`cacheWrite` 通常为 0。混在一起的命中率无法判断"等待子代理是否让缓存过期"，`cold_starts`（cacheWrite > cacheRead）对 OpenAI 类也永远为 0。

## 行为（在 `bench/root_cache.py` 上增量修改）

1. **新增每组指标 `low_hit_turns`**：单轮命中率 cacheRead / (input + cacheRead + cacheWrite) 低于阈值的轮数；分母为 0 的轮不计入。阈值默认 0.5，可用 `--low-hit 0.5` 修改（须在 0 与 1 之间，否则 argparse 报错）。文本输出每行加 `low_hit=N`。
2. **按 provider/model 拆分**：键为 `"<provider>/<model>"`（取 assistant `message.provider`、`message.model`，缺失用 `unknown`）。JSON 新增 `by_provider`：`{key: {"groups": {间隔组: 指标}, "by_trigger": {触发原因: {间隔组: 指标}}, "structural": 指标}}`，指标结构与现有相同。只出现被统计到的 key。
3. 文本输出在现有内容之后，按 key 排序，为每个 provider 输出一个小节：标题行 `== <key> ==`，随后 structural、各间隔组、以及 `subagent / <间隔组>` 各行（其他触发原因只在 JSON 中给出，文本里省略，避免过长）。
4. 现有字段和文本行保持不变（`groups`、`by_trigger`、`structural` 仍是全体合计）。

## 验收

- 在 `bench/test_root_cache.py` 新增测试（合成 JSONL）：
  1. 两个 provider/model 混合的会话，`by_provider` 两个 key 的间隔组轮数和命中率各自正确，且合计与 `groups` 一致；
  2. 缺 provider/model 时归入 `unknown/unknown`（或对应一侧为 `unknown`）；
  3. `low_hit_turns` 在默认阈值和 `--low-hit` 修改后计数正确，分母为 0 的轮不计；
  4. 文本输出含 `== <key> ==` 小节和 `low_hit=`。
- 先只写测试并运行，失败原因须是缺少该行为（KeyError/断言失败），不得是语法或导入错误；再实现到通过。
- `TMPDIR=/project/tmp/ppo-root-cache python3 -B bench/test_root_cache.py` 全部通过；`bench/test_guidance_metrics.py` 仍通过。原有 9 个测试不得删除或削弱。
- 只修改 `bench/root_cache.py` 和 `bench/test_root_cache.py`。

## Comments

### 2026-10-29 Root 验收：通过

run 0d92b62e。红灯：13 个测试中新增 4 个里有 3 个失败（KeyError `by_provider` ×2；`--low-hit` 未识别，argparse 退出码 2），均因缺少新行为。绿灯 13 OK、`test_guidance_metrics.py` OK，Root 复跑确认。worker 自定：`--low-hit` 接受端点 0 和 1；provider/model 空值归 `unknown`；`params.low_hit` 记录阈值。
