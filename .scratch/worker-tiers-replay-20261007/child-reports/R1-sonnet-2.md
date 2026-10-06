Implemented the new `style.py` design system, `assets/make_assets.py` and `style_demo.py`. The render passes and I checked the key frames by eye. I did not view the 3×3 contact sheet or the logo_mark/bg PNGs beyond sizes; the logo_light preview looked correct.

**Changed files:** `style.py` (rewritten), `assets/make_assets.py`, `assets/bg.png` (1920×1080), `assets/logo_light.png` (899×519), `assets/logo_mark.png` (173×519), `style_demo.py`. I did not touch the scene files or the music/assemble/render scripts. The old API is gone, so `scenes_a.py` and `scenes_b.py` will fail to import until they are rewritten.

**Validation**
- `./env/bin/python assets/make_assets.py` prints `ok` and writes all three PNGs.
- `./env/bin/manim -qh --disable_caching style_demo.py StyleDemo` succeeds. The video is 9.15 s, under the 15 s limit, at `media/videos/style_demo/1080p60/StyleDemo.mp4`.
- The only checks I made were visual, on the frames below:
  - **Chapter card:** "02 / 质量体检 / 鱼钩结不结实？" is centred, with no overlap.
  - **Captions:** the highlight lands on the right substrings ("体检", and "生物素"/"磁珠" in sky blue). The bar sits at y=-3.25 and does not touch the stage.
  - **Rail:** the six nodes and labels render at font 21 and step 2 is highlighted. The rail is not clipped.
  - **Widgets:** all of them render cleanly, and the light logo is clear on the dark background.
- Images: `review/w1_chapter.png`, `review/w1_caption.png`, `review/w1_widgets.png`, `review/w1_sheet_1.png` (3×3 contact sheet, 1 frame/s).

**Public API (`style.py`)**
- `zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw)`
- `zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)`
- `fit(mob, w, h, cy=0.0)`
- `glow(mob, color=None, layers=4)`
- `card(w, h, color=BRAND_BLUE)`
- `padlock(h=0.4, color=BRAND_PINK)`
- `probe_strand(n=10, color=BRAND_SKY, biotin=True)`
- `dna_fragment(n=10, color=MUTED, double=True)`
- `bead(r=0.35)`
- `magnet(h=1.6)`
- `db_icon(h=1.2)`
- `sequencer_icon(h=1.3)`
- `doc_icon(h=1.2)`
- `check_mark(size=0.5, color=PASS)`
- `cross_mark(size=0.5, color=FAIL)`
- `grade_badge(g, r=0.3)`
- `stamp(text, color=PASS, size=30)`
- `logo_full(height=1.0)`
- `logo_mark(height=0.6)`
- `class BrandScene(Scene)` with `STEP`, `show_rail(step, animate=True)`, `cap(text, hl=(), hl_color=BRAND_PINK)`, `chapter(n)`, `clear_stage(run_time=0.5)`, `finish()`
- Constants: all colour names, `GRADE`, `BASE`, `FONT`, `STEPS`, `RAIL_Y=3.62`, `CAP_Y=-3.25`, `STAGE_TOP=3.0`, `STAGE_BOTTOM=-2.55`.

**Problems found and fixed**
- The demo's probe strand and DNA fragment overlapped and ran off the left edge. I shortened them and moved them apart.
- The background showed visible gradient rings. I added dithering noise in `make_assets.py`.

**Caveats**
- `glow()` returns only the halo layers, so you add the shape on top yourself.
- `chapter()` fades out any stage content before it shows the card.
- `ImageMobject` is not a `VMobject`, so logos must go in a `Group`, not a `VGroup`.
- The 6-step labels are at font 21, which is above the 20 you asked for but below the 26 label floor in STORYBOARD 1.2.
- The image viewer cached stale pictures by path and sometimes returned ENOENT on fresh files. I worked around it by re-reading under new filenames.
- The `StyleDemo` caption timing is not checked against the `max(2.6, n/5.5)` rule. `finish()` does call the padding step.