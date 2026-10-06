<!-- 2026-10-06T09:40:37.943Z line 100 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_011HUjnzVGpLTtEptLaHWwN8 -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_a.py 里的 S5Specificity 场景（第 3 步 特异性检查 ——"会不会钓错鱼？"）。当前它是占位（chapter(3) 后 finish()）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S5Specificity（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、probe_strand、stamp、check_mark、cross_mark、glow、zh 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py 中已完成的 S1–S4 作为风格和写法参考（已通过审查，不得修改）。只改 S5Specificity 类及其私有辅助函数。

## 要求
- 开头 self.chapter(3)（确认进度条切到第 3 步），结尾 self.finish()。
- 字幕：把 STORYBOARD 文案原样传给 self.cap()，包括【】——cap 会自动把【】内文字高亮并去掉括号；不要另传 hl，除非想换高亮色。
- 分镜：
  1. 三条长亚基因组轨道横贯舞台（宽 ≥ 9 单位），左端标签"A 亚基因组 / B 亚基因组 / D 亚基因组"（≥ 28 号），轨道是圆角细带（可用三种相近但可区分的蓝色调）。
  2. 字幕 1 时：三条轨道同一相对位置亮起形状相同的片段（同一图案的小色块序列），用一个竖向虚线圆角框把三处框在一起，旁边小标注"相似片段"（≥ 26 号），体现"高度相似"。
  3. 字幕 2 时：探针甲（probe_strand，BRAND_SKY）出现在轨道下方左侧，标签"探针甲"；一道竖向扫描光从左向右扫过三条轨道；扫到 A 轨道某处时只在 A 上亮一个 PASS 绿色命中点，并从探针甲连一条细线到命中点；扫描结束后探针甲旁盖章 stamp("✓ 唯一命中 · 保留", PASS)。
  4. 字幕 3 时：探针乙出现在轨道下方右侧，标签"探针乙"；扫描后在 A/B/D 三条轨道（相似片段处）各亮一个 FAIL 红色命中点，三条连线；探针乙变 FAIL 色、盖章 stamp("✗ 多处命中 · 淘汰", FAIL)，然后探针乙与连线、红点碎裂/抖动后淡出（可把探针拆成几段向下散开淡出）。探针甲保持并轻微发光。
- 布局：预先确定坐标，元素互不重叠（尤其盖章、探针标签、轨道标签之间）；所有元素在 |x| ≤ 6.75、y ∈ [-2.55, 3.0] 内，不压字幕区与进度条区。
- 时长目标 14–19 s；静止不超过 2 s；不要手写长 wait，字幕时长由 cap 自动补足。不出现任何具体比对参数。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_a.py S5Specificity` 迭代，ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_a.py S5Specificity`（约 40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w6_s5_sheet.png（1 帧/秒），关键帧 review/w6_s5_similar.png、review/w6_s5_keep.png、review/w6_s5_reject.png。自己看图检查重叠、越界、字幕里没有【】字符、可读性、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。