Implemented the new `style.py` (design system), the assets script and `style_demo.py`.

**Changed files:** `assets/make_assets.py`, `assets/bg.png`, `assets/logo_light.png` (899x519), `assets/logo_mark.png` (173x519), `style.py` (rewritten), `style_demo.py`. I did not touch `scenes_a.py`, `scenes_b.py` or any of the `.sh`/`make_music.py` files.

**Validation:**
- `./env/bin/python assets/make_assets.py` runs and writes all three pngs.
- `./env/bin/manim -qh --disable_caching style_demo.py StyleDemo` succeeds. The video is 8.65 s, in `media/videos/style_demo/1080p60/StyleDemo.mp4`.
- Frames are in `review/`:
  - `w1_sheet_1.png`: contact sheet, 9 frames at 1 fps.
  - `w1_chapter.png`: the "02 质量体检" card.
  - `w1_caption.png`: the first caption with its highlight.
  - `w1_widgets.png`: the full widget rows.
- I checked these by eye:
  - The chapter card and rail switch look right.
  - The caption highlight "体检" lands on the correct characters, and the caption bar clears the stage.
  - The logo is clear on the dark background, and the S mark crops cleanly.
- I did not check frame-to-frame motion of the particles.

**Public API** (`style.py`; the docstring lists the same):
- Constants: `BG_DEEP, BG, BRAND_RED, BRAND_PINK, BRAND_BLUE, BRAND_CYAN, BRAND_SKY, BIOTIN, BEAD, PASS, WARN, FAIL, TEXT_C, MUTED, GRADE, BASE, FONT, STEPS, RAIL_Y, CAP_Y, STAGE_TOP, STAGE_BOTTOM`
- `zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw)`
- `zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)`
- `class BrandScene(Scene)` with `STEP`, `show_rail(step, animate=True)`, `cap(text, hl=(), hl_color=BRAND_PINK)`, `chapter(n)`, `clear_stage(run_time=0.5)`, `finish()`
- Widgets: `fit(mob, w, h)`, `glow(mob, color=None, layers=4)`, `card(w, h, color)`, `padlock(h, color)`, `probe_strand(n, color, biotin)`, `dna_fragment(n, color, double)`, `bead(r)`, `magnet(h)`, `db_icon(h)`, `sequencer_icon(h)`, `doc_icon(h)`, `check_mark(size, color)`, `cross_mark(size, color)`, `grade_badge(g, r)`, `stamp(text, color, size)`, `logo_full(height)`, `logo_mark(height)`

**Problem fixed:** the background gradient showed concentric colour bands, so I added light dithering noise in `assets/make_assets.py`.

**Remaining weaknesses:**
- `glow()` returns the halo layers plus a copy of the mob, so don't also add the original.
- `logo_full` and `logo_mark` return `ImageMobject`, so they can't go inside a `VGroup` (use `Group`).
- `dna_fragment` and `probe_strand` are fairly plain, and there is no `bead` + `magnet` interaction.
- The demo is only 8.65 s because the second caption is padded to its minimum display time.
- `glow()` and `card()` aren't shown in the demo.