在 /project/tmp/worker-tiers-replay/R1-luna-2（manim 科普动画工程，非 git 仓库，Python 环境 ./env/bin/python、./env/bin/manim，Manim Community v0.20.1，字体 "Noto Sans CJK SC"）中，按 STORYBOARD.md 第 1 节重写设计系统 style.py，并新增素材与演示场景。先完整阅读 STORYBOARD.md（尤其第 1 节视觉系统）。场景文件 scenes_a.py / scenes_b.py 稍后会由别人按新 API 重写，本任务不要改它们（它们暂时 import 失败也可以接受）；不要改 make_music.py / assemble.sh / add_music.sh / render_hq.sh。v1 已备份在 v1_backup/。

## 交付物
1. assets/make_assets.py（PIL + numpy，可重复运行）生成：
   - assets/bg.png 1920x1080：BG(#0B1E33) 中心 → BG_DEEP(#06121F) 外圈的径向渐变 + 极淡的点阵网格（间距约 40px，点不透明度很低，不能花）+ 暗角。
   - assets/logo_light.png：源 /project/report-check/KPS014/TC-GTS-20260420-KPS014_report/image/logo.png（RGBA，透明底，彩色 S 标 + 灰色 "Tcuni" 文字与"天成未来"）。把灰色（低饱和度）像素改成 #EAF2F8，保留彩色 S 标原色与 alpha，裁掉多余透明边。
   - assets/logo_mark.png：只裁出左侧彩色 S 标（透明底）。
2. style.py（全片唯一设计系统，模块 docstring 中文写明用途与公开 API）。必须提供以下名字（场景作者只会用这些）：
   - 颜色常量：BG_DEEP, BG, BRAND_RED, BRAND_PINK, BRAND_BLUE, BRAND_CYAN, BRAND_SKY, BIOTIN, BEAD, PASS, WARN, FAIL, TEXT_C, MUTED；GRADE = {1: PASS, 2: BRAND_SKY, 3: WARN, 4: FAIL}；BASE = A/T/G/C 降饱和的 绿/红/黄/蓝。色值见 STORYBOARD 1.1。FONT 常量。
   - STEPS：6 元组列表 [(标题, 外行问题)]：("明确目标","钓什么？"), ("质量体检","鱼钩结不结实？"), ("特异性检查","会不会钓错鱼？"), ("功能注释","哪些位点更有价值？"), ("择优布局","有限的探针怎么摆？"), ("交付报告","凭什么相信这套设计？")。
   - 文本：zh(s, size=36, color=TEXT_C, weight=NORMAL, **kw) ；zh_hl(s, hl=(), size=34, color=TEXT_C, hl_color=BRAND_PINK)：用 t2c 高亮 hl 里的子串（中文子串需验证高亮位置正确）。
   - class BrandScene(Scene)：所有场景的基类。STEP 类属性（None 或 1–6）。setup() 中：铺 assets/bg.png 全屏背景（最底层）；加 24 个左右低透明度、缓慢漂浮并在边界环绕的氛围粒子（updater 基于 dt，保证 wait 时画面也在动）；若 STEP 非空，静态显示顶部进度条（rail）。方法：
     - show_rail(step, animate=True)：顶部 y≥3.25 区域，6 个节点 + 短标题（字号≥20），当前步高亮放大（BRAND_SKY 发光），已完成实心，未到空心；可从无到有动画出现，也可切换步骤。
     - cap(text, hl=(), hl_color=BRAND_PINK)：底部字幕条（半透明 BG_DEEP 圆角条，不透明度≈0.72，左侧品牌色竖条，字号 34，y≤-2.75，条宽随文本自适应），与上一条字幕交叉淡化。调用时若上一条字幕显示未满 max(2.6, 字数/5.5) 秒，先 self.wait 补足再切换。cap(None) 收起字幕（同样先补足时间）。cap 本身只播放约 0.35 s 的切换动画，之后立即返回，调用方可以在字幕显示期间继续播放其它动画。用 self.renderer.time 计时。
     - chapter(n)：章节卡约 1.6 s：大号 "0n"（BRAND_RED→BRAND_PINK 渐变或品牌红）+ STEPS[n-1] 标题（56 号）+ 外行问题（MUTED，34 号），居中入场，然后收起并让 rail 切到第 n 步（rail 不存在则出现）。
     - clear_stage(run_time=0.5)：淡出除背景、粒子、rail、字幕外的所有 mobject。
     - finish()：补足当前字幕时长、收起字幕、clear_stage。
   - 图形小部件（统一风格：圆角、细描边 + 半透明填充，必要时 glow）：glow(mob, color=None, layers=4)（返回带多层递减透明度描边光晕的 VGroup）；card(w, h, color=BRAND_BLUE)；padlock(h=0.4, color=BRAND_PINK)（像样的锁：锁体圆角矩形 + 锁环弧 + 锁孔）；probe_strand(n=10, color=BRAND_SKY, biotin=True)（单链：主干线 + 一排朝下的短碱基刻度，左端橙色生物素小球）；dna_fragment(n=10, color=MUTED, double=True)（双链片段：两条平行主干 + 碱基对短线）；bead(r=0.35)（带高光的球）；magnet(h=1.6)（U 形磁铁，红/灰两极）；db_icon(h=1.2)；sequencer_icon(h=1.3)；doc_icon(h=1.2)；check_mark(size, color=PASS) / cross_mark(size, color=FAIL)；grade_badge(g, r=0.3)（圆形徽章，内写"g级"，字号足够清晰）；stamp(text, color)（盖章风格圆角框文字）；logo_full(height) / logo_mark(height)（ImageMobject，读取 assets）。
   - 保留 fit 等你认为必要的布局辅助，但 STORYBOARD 1.2 的区域常量也要以常量形式提供：RAIL_Y, CAP_Y, STAGE_TOP, STAGE_BOTTOM。
3. style_demo.py：class StyleDemo(BrandScene)，STEP=None，演示：chapter(2) → 依次 cap 两条带高亮字幕（例如"每条候选探针，都要先做一次【体检】"，hl=("体检",)）→ 舞台上一排展示各小部件（probe_strand、dna_fragment、bead、magnet、padlock、db_icon、sequencer_icon、doc_icon、grade_badge 1–4、stamp、logo_full）→ finish()。总长 ≤ 15 s。

## 验收（你自己执行并在报告里贴结果）
- ./env/bin/python assets/make_assets.py 成功；三个 png 存在。
- ./env/bin/manim -qh --disable_caching style_demo.py StyleDemo 成功（单幕约十几秒，无需 slot）。用 ffmpeg 从产出的 1080p 视频按 1 帧/秒抽帧，再拼成 1-2 张联系表，保存到 review/w1_sheet_*.png；另外单独保存 3 张全分辨率关键帧 review/w1_chapter.png、review/w1_caption.png、review/w1_widgets.png。自己逐张看图检查：文字无重叠/越界、字幕条不压舞台内容、高亮子串正确、logo 在深色背景上清晰、小部件看起来精致而非简陋。发现问题自己修完再交。
- 报告：style.py 公开 API 清单（签名一行一个）、各图片路径、你发现并修掉的问题、仍存在的不足。

## 规则
- 临时/中间文件禁止放 /tmp，放本目录下子目录（如 ./work/）或 /project/tmp。
- 预计超过 1 分钟或超过 2G 内存的命令必须先运行 `slot audit`、`slot status`，把输出追加到 logs/preflight.log，再用 `slot cpu -- <cmd>` 提交；本任务的单幕渲染不需要。
- 不要渲染全片，不要运行 render_hq.sh。
- 注释/docstring 用中文。

隔离要求：只在 /project/tmp/worker-tiers-replay/R1-luna-2 内读写；不要读取 /project/tmp/tcuni_probe_video 或 /project/tmp/worker-tiers-replay 下的其它目录。
