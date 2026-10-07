<!-- session 9fb0573d-2982-4a57-8a10-212bc259aaa9/run-0/session.jsonl; model kimi-for-coding; last assistant text (timed-out runs: partial) -->
所有关键帧检查通过。最终验证完成，写报告。

实现完成。

**Changed files**: `scenes_a.py:519-693`（仅 S4Quality 类及其私有辅助 `_gate/_checklist/_scan_line/_legend`，另有 4 处节奏微调）

**实现内容**：
- `chapter(2)` 开头（rail 从 None 正确 FadeIn 切换到第 2 步），`finish()` 结尾
- 发光扫描门（圆角框+glow+"质量体检"标题）+ 右侧 5 行检查清单卡（GC 含量/熔解温度/序列复杂度/重复序列/发夹结构，28 号，右端打勾位）
- 3 条探针沿传送带虚线依次进门：扫描线门内 5 步下扫、清单逐行 GrowFromCenter 打勾；第 3 条在"重复序列"行出 ✗ 并 Indicate 闪 FAIL；出门停右侧头顶弹 grade_badge（1/2/4 级）并变 GRADE 色，勾复位；节奏 0.22s/0.13s 每行
- 旧景缩小淡出、8×5 矩阵（种子 21：18×1级 14×2级 5×3级 3×4级）错峰点亮；图例 4 徽章横排+箭头+"最稳定 → 风险高"（28 号）；4 级下沉淡出、1–2 级 glow
- 4 条字幕严格用 STORYBOARD 文案，时机分别对应门出现/第 1 条检查/拉远矩阵/4 级淘汰；无任何阈值数字

**Validation**：
- `-ql` 迭代 3 轮，`-qh` 最终渲染成功，ffprobe 时长 **18.83 s**（15–20 目标内）
- 关键帧：`review/w5_s4_sheet.png`（1fps 联系表）、`w5_s4_scan.png`（t=5.5 扫描中）、`w5_s4_fail.png`（t=10.2 ✗+红行+1/2级徽章）、`w5_s4_grid.png`（t=17.3 矩阵+图例）

**自检修复的问题**：
1. 矩阵初版不可见——`set_opacity(0)` 预置被 FadeIn 记成目标透明度，改为 `animate.set_opacity(1)` 错峰
2. 总时长 21.7s 超目标 + cap1 后约 1.3s 静止——字幕 2 