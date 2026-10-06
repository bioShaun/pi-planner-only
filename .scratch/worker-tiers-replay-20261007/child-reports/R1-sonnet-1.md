Implemented the new `style.py`, the three assets and `style_demo.py`; the render and frame checks all pass.

**Changed files:** `style.py`, `style_demo.py`, `assets/make_assets.py`, `assets/bg.png`, `assets/logo_light.png` (899×519), `assets/logo_mark.png` (173×519), and the `review/w1_*.png` images. I did not touch the scene files or the music/assemble/render scripts.

**Public API in `style.py`:**
- **Constants:** the colours, `GRADE`, `BASE`, `FONT`, `STEPS`, `RAIL_Y`, `CAP_Y`, `STAGE_TOP`, `STAGE_BOTTOM`.
- **Text:**
  - `zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw)`
  - `zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)`
  - `fit(mob, max_w=None, max_h=None)`
- **BrandScene:** `BrandScene(Scene)` with `STEP`, `show_rail(step, animate=True)`, `cap(text, hl=(), hl_color=BRAND_PINK)`, `chapter(n)`, `clear_stage(run_time=0.5)`, `finish()`.
- **Widgets:**
  - `glow(mob, color=None, layers=4)`, `card(w, h, color=BRAND_BLUE)`, `padlock(h=0.4, color=BRAND_PINK)`
  - `probe_strand(n=10, color=BRAND_SKY, biotin=True)`, `dna_fragment(n=10, color=MUTED, double=True)`
  - `bead(r=0.35)`, `magnet(h=1.6)`, `db_icon(h=1.2)`, `sequencer_icon(h=1.3)`, `doc_icon(h=1.2)`
  - `check_mark(size, color=PASS)`, `cross_mark(size, color=FAIL)`, `grade_badge(g, r=0.3)`, `stamp(text, color)`
  - `logo_full(height)`, `logo_mark(height)`

`RAIL_Y` is 3.55 and `CAP_Y` is -3.4.

**Verification:**
- `./env/bin/python assets/make_assets.py` prints `ok` and writes all three PNGs. On the dark background the Tcuni text is light and the S mark keeps its colours.
- `./env/bin/manim -qh --disable_caching style_demo.py StyleDemo` succeeded: 1080p60, 9.13 s, within the 15 s limit.
- The contact sheet is `review/w1_sheet_1.png`: nine frames at 1 per second, so one sheet is enough.
- Single frames are `review/w1_chapter.png`, `review/w1_caption.png` and `review/w1_widgets.png`. I looked at the sheet, the widgets frame and the caption frame; I viewed the chapter frame only in the first render.
- In the frames I checked:
  - No text overlaps or runs off screen.
  - The caption bar sits below the stage content.
  - The "体检" and "质量检查" highlights land on the right characters.
  - The chapter card and the rail switch to step 2 look right.

**Fixed along the way:** the first render's magnet was too tall and ran into the rail area, so I shrank it to 1.2 in the demo.

**Remaining weaknesses:**
- The caption bar is faint because its 0.72 opacity is close to the background colour. The red side bar and the text still read clearly.
- The small "天成未来" text in `logo_full` is tiny when the logo is at 0.9 height.
- The rail's glow and the caption's timing padding (`cap()` calling `wait`) are only checked on this one demo scene.
- The demo set the `STEP=None` scene's rail via `chapter()`.