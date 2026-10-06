<!-- 2026-10-06T10:00:39.308Z line 134 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01WtuNzvMSopbqt3nZeby2UC -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_b.py 里的 S8Delivery 场景（第 6 步 交付报告 ——"凭什么相信这套设计？"）。当前它是占位（chapter(6) 后 finish()）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S8Delivery（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、card、doc_icon、logo_mark、glow、zh、PASS/FAIL 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py 和 scenes_b.py 中已完成的场景作为风格参考（不得修改）。只改 S8Delivery 类及其私有辅助函数。

## 要求
- 开头 self.chapter(6)，结尾 self.finish()。字幕：把 STORYBOARD 2 条文案原样传给 self.cap()，包括【】（cap 自动高亮并去括号）。
- 分镜：
  1. 字幕 1"交付完整的设计报告和探针清单"：一份报告封面（竖版圆角纸张，浅色描边 + 深色半透明底，宽约 2.6、高约 3.4；顶部 logo_mark 小标，标题"探针设计报告"≥ 28 号，下方几条灰色占位文字线）从下方飞入舞台中央，然后封面"翻开"：3 页内页从封面位置扇形散开到左中右（略带不同旋转角，±4° 以内），每页上方页名（≥ 26 号）：
     - "覆盖分布"：多根柱子从底部逐个长出（BRAND_SKY，高度大致均匀，体现均匀覆盖）；
     - "GC 分布"：一条平滑钟形曲线被描出（Create），曲线下浅色填充；
     - "功能分类"：一个环形图逐段画出（4 段：BRAND_PINK / WARN / BRAND_SKY / MUTED）。
     封面随后缩小移到右侧或淡出，为第 2 步让位。
  2. 字幕 2"每条探针为何保留、为何淘汰，都有据可查"：三页内页缩小并上移/左移，舞台出现一张"探针清单"表格卡片（card，宽约 7，表头 + 5 行，每行：小探针图标、灰色占位条、状态胶囊——3 行 PASS"保留"、2 行 FAIL"淘汰"，≥ 24 号），表格逐行从上到下填充；然后一个放大镜（圆环 + 手柄，自绘）从左扫到一行"淘汰"上停住，该行高亮，旁边弹出一个小气泡卡片"淘汰原因：多处命中"（≥ 26 号）；接着放大镜移到一行"保留"，弹出"保留原因：唯一命中 · 1 级"。气泡互不重叠，第二个出现时第一个淡出或缩到一边。
- 不出现任何具体阈值/参数（不写百分比、温度、个数）。
- 布局：预先确定坐标，元素互不重叠；所有元素在 |x| ≤ 6.75、y ∈ [-2.55, 3.0] 内，不压字幕区与进度条区。
- 时长目标 12–16 s；静止不超过 2 s；不要手写长 wait，字幕时长由 cap 自动补足（必要时可加短的轻微动作填充）。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_b.py S8Delivery` 迭代，ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_b.py S8Delivery`（约 40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w9_s8_sheet.png（1 帧/秒），关键帧 review/w9_s8_pages.png（三页内页图表画完）、review/w9_s8_table.png（清单 + 放大镜 + 气泡）。自己看图检查重叠、越界、字幕无【】、可读性、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。