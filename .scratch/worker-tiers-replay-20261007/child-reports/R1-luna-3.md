已实现新版统一视觉系统及演示场景，未修改 `scenes_a.py`、`scenes_b.py` 或渲染/配乐脚本。
变更：`style.py`；`assets/make_assets.py`（生成 `assets/bg.png`、`assets/logo_light.png`、`assets/logo_mark.png`）；`style_demo.py`。
公开 API：颜色常量 `BG_DEEP, BG, BRAND_RED, BRAND_PINK, BRAND_BLUE, BRAND_CYAN, BRAND_SKY, BIOTIN, BEAD, PASS, WARN, FAIL, TEXT_C, MUTED, GRADE, BASE, FONT`；布局常量 `RAIL_Y, CAP_Y, STAGE_TOP, STAGE_BOTTOM`；`STEPS`。
公开 API：`zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw)`；`zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)`；`BrandScene`（`setup/show_rail/cap/chapter/clear_stage/finish`）。
公开 API：`glow(mob, color=None, layers=4)`；`card(w, h, color=BRAND_BLUE)`；`padlock(h=0.4, color=BRAND_PINK)`；`probe_strand(n=10, color=BRAND_SKY, biotin=True)`；`dna_fragment(n=10, color=MUTED, double=True)`；`bead(r=0.35)`；`magnet(h=1.6)`。
公开 API：`db_icon(h=1.2)`；`sequencer_icon(h=1.3)`；`doc_icon(h=1.2)`；`check_mark(size, color=PASS)`；`cross_mark(size, color=FAIL)`；`grade_badge(g, r=0.3)`；`stamp(text, color)`；`logo_full(height)`；`logo_mark(height)`。
验证通过：素材脚本成功；`./env/bin/manim -qh --disable_caching style_demo.py StyleDemo` 成功，时长 10.12 秒。抽帧检查结果：`review/w1_sheet_1.png`、`review/w1_chapter.png`、`review/w1_caption.png`、`review/w1_widgets.png`。
修复问题：演示布局原先使用不接受图片对象的 `VGroup`，改用 `Group`；将中文关键词高亮改为 `Text(t2c=...)`，抽帧确认“体检”正确着色。未发现越界或字幕压住组件；小部件仍是演示级图形，数据库/测序/报告图标为文字式简化图标。