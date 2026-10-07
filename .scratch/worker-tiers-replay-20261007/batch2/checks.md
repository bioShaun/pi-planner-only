# Objective checks (unblinded)


## R1

| check | R1-dsflash-1 | R1-dsflash-2 | R1-dsflash-3 | R1-gemflash-1 | R1-gemflash-2 | R1-gemflash-3 | R1-kimi-1 | R1-kimi-3 | R1-luna-1 | R1-luna-2 | R1-luna-3 | R1-sonnet-1 | R1-sonnet-2 | R1-sonnet-3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| duration | 8.97 | 9.67 | 8.60 | 9.17 | 10.70 | 9.77 | 11.08 | 11.18 | 8.52 | 9.32 | 10.12 | 9.13 | 9.15 | 8.65 |
| review_images | pass | fail | fail | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| style_import | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| names_exist | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| brandscene_methods | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| signatures | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| grade | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| steps | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| colors | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| assets | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| make_assets_exists | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| style_demo_exists | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| duration_le_15s | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| baseline_untouched | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |

### Details

**R1-dsflash-1** mp4: `/project/tmp/worker-tiers-replay2/all/R1-dsflash-1/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; check_mark: size has default 0.5 (spec none); cross_mark: size has default 0.5 (spec none); stamp: color has default '#FF5A5F' (spec none); logo_full: height has default 0.7 (spec none); logo_mark: height has default 0.9 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 519) RGBA; logo_mark.png: ok (173, 519) RGBA
- duration_le_15s [pass]: 8.97s
- baseline_untouched [pass]: all 6 identical

**R1-dsflash-2** mp4: `/project/tmp/worker-tiers-replay2/all/R1-dsflash-2/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [fail]: missing: review/w1_chapter.png, review/w1_caption.png, review/w1_widgets.png
- signatures [pass]: all match
  - notes: zh: **kw
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (911, 531) RGBA; logo_mark.png: ok (185, 531) RGBA
- duration_le_15s [pass]: 9.67s
- baseline_untouched [pass]: all 6 identical

**R1-dsflash-3** mp4: `/project/tmp/worker-tiers-replay2/all/R1-dsflash-3/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [fail]: missing: review/w1_sheet_*.png
- signatures [pass]: all match
  - notes: zh: **kw; db_icon: extra param color; sequencer_icon: extra param color; doc_icon: extra param color; stamp: color has default '#FF5A5F' (spec none); logo_full: height has default 0.9 (spec none); logo_mark: height has default 0.6 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 519) RGBA; logo_mark.png: ok (179, 122) RGBA
- duration_le_15s [pass]: 8.60s
- baseline_untouched [pass]: all 6 identical

**R1-gemflash-1** mp4: `/project/tmp/worker-tiers-replay2/all/R1-gemflash-1/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; zh_hl: extra param weight; zh_hl: **kw; check_mark: size has default 0.4 (spec none); cross_mark: size has default 0.4 (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 0.8 (spec none); logo_mark: height has default 0.8 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (173, 520) RGBA
- duration_le_15s [pass]: 9.17s
- baseline_untouched [pass]: all 6 identical

**R1-gemflash-2** mp4: `/project/tmp/worker-tiers-replay2/all/R1-gemflash-2/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; zh_hl: **kw; check_mark: size has default 0.4 (spec none); cross_mark: size has default 0.4 (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 0.8 (spec none); logo_mark: height has default 0.8 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (173, 520) RGBA
- duration_le_15s [pass]: 10.70s
- baseline_untouched [pass]: all 6 identical

**R1-gemflash-3** mp4: `/project/tmp/worker-tiers-replay2/all/R1-gemflash-3/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; zh_hl: **kw; card: w has default 3.0 (spec none); card: h has default 2.0 (spec none); check_mark: size has default 0.4 (spec none); cross_mark: size has default 0.4 (spec none); stamp: text has default '保留' (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 0.8 (spec none); logo_mark: height has default 0.8 (spec none); BrandScene.cap: text has default None (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (173, 520) RGBA
- duration_le_15s [pass]: 9.77s
- baseline_untouched [pass]: all 6 identical

**R1-kimi-1** mp4: `/project/tmp/worker-tiers-replay2/all/R1-kimi-1/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; db_icon: extra param color; sequencer_icon: extra param color; doc_icon: extra param color; check_mark: size has default 0.4 (spec none); cross_mark: size has default 0.4 (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 1.0 (spec none); logo_mark: height has default 1.0 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (911, 531) RGBA; logo_mark.png: ok (185, 531) RGBA
- duration_le_15s [pass]: 11.08s
- baseline_untouched [pass]: all 6 identical

**R1-kimi-3** mp4: `/project/tmp/worker-tiers-replay2/all/R1-kimi-3/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; zh_hl: **kw; card: **kw; db_icon: extra param color; sequencer_icon: extra param color; doc_icon: extra param color; check_mark: size has default 0.5 (spec none); cross_mark: size has default 0.5 (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 1.0 (spec none); logo_mark: height has default 1.0 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (911, 531) RGBA; logo_mark.png: ok (181, 528) RGBA
- duration_le_15s [pass]: 11.18s
- baseline_untouched [pass]: all 6 identical

**R1-luna-1** mp4: `/project/tmp/worker-tiers-replay2/all/R1-luna-1/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (173, 520) RGBA
- duration_le_15s [pass]: 8.52s
- baseline_untouched [pass]: all 6 identical

**R1-luna-2** mp4: `/project/tmp/worker-tiers-replay2/all/R1-luna-2/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (247, 520) RGBA
- duration_le_15s [pass]: 9.32s
- baseline_untouched [pass]: all 6 identical

**R1-luna-3** mp4: `/project/tmp/worker-tiers-replay2/all/R1-luna-3/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 520) RGBA; logo_mark.png: ok (173, 520) RGBA
- duration_le_15s [pass]: 10.12s
- baseline_untouched [pass]: all 6 identical

**R1-sonnet-1** mp4: `/project/tmp/worker-tiers-replay2/all/R1-sonnet-1/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; db_icon: extra param color; sequencer_icon: extra param color; doc_icon: extra param color; check_mark: size has default 0.4 (spec none); cross_mark: size has default 0.4 (spec none); stamp: color has default '#2BB673' (spec none); logo_full: height has default 1.0 (spec none); logo_mark: height has default 0.6 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 519) RGBA; logo_mark.png: ok (173, 519) RGBA
- duration_le_15s [pass]: 9.13s
- baseline_untouched [pass]: all 6 identical

**R1-sonnet-2** mp4: `/project/tmp/worker-tiers-replay2/all/R1-sonnet-2/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; check_mark: size has default 0.5 (spec none); cross_mark: size has default 0.5 (spec none); stamp: color has default '#2BB673' (spec none); stamp: extra param size; logo_full: height has default 1.0 (spec none); logo_mark: height has default 0.6 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 519) RGBA; logo_mark.png: ok (173, 519) RGBA
- duration_le_15s [pass]: 9.15s
- baseline_untouched [pass]: all 6 identical

**R1-sonnet-3** mp4: `/project/tmp/worker-tiers-replay2/all/R1-sonnet-3/media/videos/style_demo/1080p60/StyleDemo.mp4`
- review_images [pass]: all present
- signatures [pass]: all match
  - notes: zh: **kw; check_mark: size has default 0.5 (spec none); cross_mark: size has default 0.5 (spec none); stamp: color has default '#2BB673' (spec none); stamp: extra param size; logo_full: height has default 0.8 (spec none); logo_mark: height has default 0.6 (spec none)
- grade [pass]: {1: '#2BB673', 2: '#52A9D8', 3: '#F2C94C', 4: '#FF5A5F'}
- colors [pass]: BEAD(gradient in spec #C9A27E) actual=#C9A27E
- assets [pass]: bg.png: ok (1920, 1080) RGB; logo_light.png: ok (899, 519) RGBA; logo_mark.png: ok (173, 519) RGBA
- duration_le_15s [pass]: 8.65s
- baseline_untouched [pass]: all 6 identical


## R2

| check | R2-dsflash-3 | R2-gemflash-1 | R2-gemflash-2 | R2-gemflash-3 | R2-kimi-1 | R2-kimi-2 | R2-luna-1 | R2-luna-2 | R2-luna-3 | R2-sonnet-1 | R2-sonnet-2 | R2-sonnet-3 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| duration | 19.15 | 20.00 | 18.02 | 18.40 | 19.63 | 18.83 | 22.03 | 20.27 | 23.57 | 21.48 | 20.85 | 22.38 |
| review_images | pass | pass | pass | fail | pass | pass | pass | pass | pass | pass | pass | pass |
| scenes_a_outside_s4 | pass | pass | pass | fail | pass | pass | pass | pass | pass | pass | pass | pass |
| scenes_b_untouched | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| style_py | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_duration_15_20s | pass | pass | pass | pass | pass | pass | fail | fail | fail | fail | fail | fail |
| s4_chapter2 | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_finish | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_captions | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass | pass |
| s4_digit_leak | unknown | unknown | unknown | pass | unknown | unknown | pass | pass | pass | pass | pass | pass |

### Details

**R2-dsflash-3** mp4: `/project/tmp/worker-tiers-replay2/all/R2-dsflash-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 19.15s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 第 2 步 质量体检 ——"鱼钩结不结实？"：扫描门体检 3 条探针 → 探针矩阵 + 等级图例。 | 右侧检查清单卡片：标题 + 5 行（左标签 + 右端打勾位）。 | 一条探针的体检：进闸 → 扫描并逐行判定 → 出门停靠 → 等级徽章 → 清单复位。

        rt 为节奏系数：第 1 条 1.0（完整展示），第 2、3 条更快。

**R2-gemflash-1** mp4: `/project/tmp/worker-tiers-replay2/all/R2-gemflash-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 20.00s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片，5 行（字号 ≥ 28），右端预留打勾位。

**R2-gemflash-2** mp4: `/project/tmp/worker-tiers-replay2/all/R2-gemflash-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.02s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：5 行指标（≥ 28 号）+ 右侧打勾槽。

**R2-gemflash-3** mp4: `/project/tmp/worker-tiers-replay2/all/R2-gemflash-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [fail]: missing: review/w5_s4_fail.png
- scenes_a_outside_s4 [fail]: differs outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.40s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-kimi-1** mp4: `/project/tmp/worker-tiers-replay2/all/R2-kimi-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 19.63s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 检查清单卡片：5 行（≥28 号），右端预留打勾位；返回 (整体, 行标签, 勾位中心列表)。

**R2-kimi-2** mp4: `/project/tmp/worker-tiers-replay2/all/R2-kimi-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [pass]: 18.83s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [unknown]: possible leaks (manual review): 右侧检查清单卡片：标题 + 5 行 + 右端打勾位。返回 (整体, 行文字, 行 y)。 | 矩阵下方大号等级图例：1→4 级徽章横排 + 文字。

**R2-luna-1** mp4: `/project/tmp/worker-tiers-replay2/all/R2-luna-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 22.03s
- s4_captions [pass]: match ignoring whitespace only; whitespace differs in: 综合评为1–4级：级别越低，捕获表现越稳定
- s4_digit_leak [pass]: no stray digits

**R2-luna-2** mp4: `/project/tmp/worker-tiers-replay2/all/R2-luna-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 20.27s
- s4_captions [pass]: match ignoring whitespace only; whitespace differs in: 综合评为1–4级：级别越低，捕获表现越稳定
- s4_digit_leak [pass]: no stray digits

**R2-luna-3** mp4: `/project/tmp/worker-tiers-replay2/all/R2-luna-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 23.57s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-sonnet-1** mp4: `/project/tmp/worker-tiers-replay2/all/R2-sonnet-1/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 21.48s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-sonnet-2** mp4: `/project/tmp/worker-tiers-replay2/all/R2-sonnet-2/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 20.85s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits

**R2-sonnet-3** mp4: `/project/tmp/worker-tiers-replay2/all/R2-sonnet-3/media/videos/scenes_a/1080p60/S4Quality.mp4`
- review_images [pass]: all present
- scenes_a_outside_s4 [pass]: identical outside S4 range
- style_py [pass]: unchanged
- s4_duration_15_20s [fail]: 22.38s
- s4_captions [pass]: 4/4 match
- s4_digit_leak [pass]: no stray digits
