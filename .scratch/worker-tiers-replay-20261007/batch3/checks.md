# Objective checks (unblinded)


## R2

| check | R2-gemp-1 | R2-gemp-2 | R2-gemp-3 | R2-gems-1 | R2-gems-2 | R2-gems-3 | R2-kimip-1 | R2-kimip-2 | R2-kimip-3 | R2-kimis-1 | R2-kimis-2 | R2-kimis-3 | R2-sonnet-1 | R2-sonnet-2 | R2-sonnet-3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| duration | 20.00 | 18.02 | 18.40 | MISSING | 18.58 | 18.85 | 19.63 | 18.83 | MISSING | 19.18 | 19.76 | MISSING | 21.48 | 20.85 | 22.38 |
| review_images | pass | pass | fail | fail | pass | pass | pass | pass | fail | pass | pass | fail | pass | pass | pass |
| scenes_a_outside_s4 | pass | pass | fail | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| scenes_b_untouched | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| style_py | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_duration_15_20s | pass | pass | pass | unknown | pass | pass | pass | pass | unknown | pass | pass | unknown | fail | fail | fail |
| s4_chapter2 | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_finish | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_captions | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_digit_leak | unknown | unknown | pass | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown | unknown | pass | pass | pass |

### Details

**R2-gemp-1** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-gemp-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 20.00s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片，5 行（字号 ≥ 28），右端预留打勾位。

**R2-gemp-2** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-gemp-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.02s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：5 行指标（≥ 28 号）+ 右侧打勾槽。

**R2-gemp-3** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-gemp-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [fail]: missing: review/w5_s4_fail.png
- scenes_a_outside_s4 [fail]: differs outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.40s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-gems-1** mp4: `MISSING`
- review_images [fail]: missing: review/w5_s4_sheet.png, review/w5_s4_scan.png, review/w5_s4_fail.png, review/w5_s4_grid.png
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [unknown]: no mp4
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 质量体检清单卡片：外框 + 标题 + 5 行项目与右侧预留打勾圈。

**R2-gems-2** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-gems-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.58s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片（5 行，≥ 28 号）。 | 约 8 列 × 5 行探针矩阵，按 1–4 级上色（固定种子）。 | 矩阵下方大号等级图例：4 个 grade_badge + 文字'最稳定 → 风险高'（≥ 28 号）。

**R2-gems-3** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-gems-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.85s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片，5 行，右端预留打勾位。

**R2-kimip-1** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-kimip-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 19.63s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 检查清单卡片：5 行（≥28 号），右端预留打勾位；返回 (整体, 行标签, 勾位中心列表)。

**R2-kimip-2** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-kimip-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.83s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：标题 + 5 行 + 右端打勾位。返回 (整体, 行文字, 行 y)。 | 矩阵下方大号等级图例：1→4 级徽章横排 + 文字。

**R2-kimip-3** mp4: `MISSING`
- review_images [fail]: missing: review/w5_s4_sheet.png, review/w5_s4_scan.png, review/w5_s4_fail.png, review/w5_s4_grid.png
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [unknown]: no mp4
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：5 行（初始暗色），右端预留打勾位。

**R2-kimis-1** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-kimis-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 19.18s
- s4_captions [pass]: match ignoring whitespace only; whitespace differs in: 综合评为1–4级：级别越低，捕获表现越稳定
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：标题 + 5 行（高亮底板 + 文字 + 右端打勾位）。

**R2-kimis-2** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-kimis-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 19.76s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 第 2 步 质量体检：扫描门 + 检查清单，3 条候选探针评级，拉远成探针矩阵。 | 右侧检查清单卡片：标题 + 5 行（每行右端预留打勾位）。 | 8×5 探针矩阵（固定随机种子：1、2 级占多数，4 级极少）+ 大号等级图例。

**R2-kimis-3** mp4: `MISSING`
- review_images [fail]: missing: review/w5_s4_sheet.png, review/w5_s4_scan.png, review/w5_s4_fail.png, review/w5_s4_grid.png
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [unknown]: no mp4
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 检查清单卡片：标题 + 5 行（文字 + 高亮底板），返回 (卡片, 行文字, 行底板)。

**R2-sonnet-1** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-sonnet-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 21.48s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-sonnet-2** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-sonnet-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 20.85s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-sonnet-3** mp4: `/project/tmp/worker-tiers-replay3-eval/root/R2-sonnet-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 22.38s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits
