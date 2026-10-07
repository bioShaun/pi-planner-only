<!-- session b3090f1f-6fbf-49ea-8f4c-92612247f514/run-0/session.jsonl; model cline-pass/deepseek-v4.1-flash; last assistant text (timed-out runs: partial) -->
Implemented the v2 design system, assets, and demo scene.

Changed files:
- `assets/make_assets.py` (new) — PIL+numpy, idempotent; generates `assets/bg.png` (1920×1080 radial BG→BG_DEEP + 40px dot grid α≈22 + vignette), `assets/logo_light.png` (899×519, gray pixels → #EAF2F8, colored S kept, alpha-cropped), `assets/logo_mark.png` (173×519, left S mark).
- `style.py` (rewritten) — full public API below.
- `style_demo.py` (new) — `StyleDemo(BrandScene)`, STEP=None, ~9.0 s.
- Left untouched: scenes_a.py, scenes_b.py, make_music.py, assemble.sh, add_music.sh, render_hq.sh.

Public API (one per line):
```
zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw)
zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)
fit(mob, w=STAGE_W, h=STAGE_H)
glow(mob, color=None, layers=4)
card(w, h, color=BRAND_BLUE)
padlock(h=0.4, color=BRAND_PINK)
probe_strand(n=10, color=BRAND_SKY, biotin=True)
dna_fragment(n=10, color=MUTED, double=True)
bead(r=0.35)
magnet(h=1.6)
db_icon(h=1.2) / sequencer_icon(h=1.3) / doc_icon(h=1.2)
check_mark(size=0.5, color=PASS) / cross_mark(size=0.5, color=FAIL)
grade_badge(g, r=0.3) / stamp(text, color=FAIL)
logo_full(height=0.7) / logo_mark(height=0.9)
class BrandScene(Scene): STEP=None; show_rail(step, animate=True); cap(text, hl=(), hl_color=BRAND_PINK); chapter(n); clear_stage(run_time=0.5); finish()
```
Constants: BG_DEEP BG BRAND_RED BRAND_PINK BRAND_BLUE BRAND_CYAN BRAND_SKY BIOTIN BEAD PASS WARN FAIL TEXT_C MUTED GRADE BASE FONT STEPS RAIL_Y=3.62 CAP_Y=-3.25 STAGE_TOP=3.0 STAGE_BOTTOM=-2.55.

Validation:
- `./env/bin/python assets/make_assets.py` → 3 PNGs written.
- `./env/bin/manim -qh --disable_caching style_demo.py StyleDemo` → OK, 12 animations, duration 8.97 s.
- ffmpeg 1fps → `review/w1_sheet_1.png` (5×2 contact sheet) + full-res `review/w1_chapter.png`, `review/w1_caption.png`, `review/w1_widgets.png`. Inspected all: no overlap/out-of-bounds, caption bar clear of stage (bottom row of widgets ends y≈-1.7, bar at y≈-3.25), highlight glyph check = 2 pink glyphs for "体检" (correct), logo legible on dark bg, rail labels readable.
- Fixed: VGroup→Group for ImageMobject row; padlock shackle thickened (r 0.2→0.23, stroke 3→4.5) for a clearer lock silhouette.

Open risks/limits:
- Background dot grid is deliberately very faint (per "不能花"); on some projectors it may be near-invisible.
- `chapter()` card entry+exit ≈1.45 s, rail transition 0.5 s (≈1.95 s total) — slightly above the "约 1.6 s" note.
- scenes_a.py/scenes_b.py still import-fail (old API) as expected; not touched.

Recommended next step: hand style.py API to the scene authors for the rewrite.