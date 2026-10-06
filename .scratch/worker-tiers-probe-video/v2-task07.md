<!-- 2026-10-06T09:45:22.752Z line 109 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01CxdbT8hehP1uV8eiJMq2sW -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，重写 scenes_b.py：实现 S6Annotation（第 4 步 功能注释 ——"哪些位点更有价值？"），并把 S7Selection、S8Delivery、S9Ending 暂时替换为占位。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S6Annotation（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、card、glow、zh 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py 中已完成的 S1–S5 作为风格和写法参考（不得修改 scenes_a.py）。当前 scenes_b.py 是旧版（基于旧 style API，已无法运行），整体替换。

## 要求
- scenes_b.py 顶部 `from style import *`；类名必须是 S6Annotation、S7Selection、S8Delivery、S9Ending（assemble.sh / make_music.py 依赖）。
- 占位：S7Selection、S8Delivery 继承 BrandScene，只做 self.chapter(5)/self.chapter(6) 后 self.finish()；S9Ending 继承 BrandScene，只显示 logo_full(1.6) 2 秒后淡出。
- S6Annotation：开头 self.chapter(4)（确认进度条切到第 4 步——注意这是新文件里的第一个场景，rail 需要在 chapter 时正确出现并显示 1–3 步已完成），结尾 self.finish()。
- 字幕：把 STORYBOARD 文案原样传给 self.cap()，包括【】——cap 会自动把【】内文字高亮并去掉括号。
- 分镜：
  1. 舞台上方先出现一条细染色体，其中一小段被放大框选，"放大"成下方一条大号基因结构（宽 ≥ 9 单位）：两端窄块为非编码区（MUTED），中间 3–4 个高块为外显子（BRAND_BLUE 填充 + BRAND_SKY 描边），之间细线为内含子；基因下方标注"非编码区""外显子""内含子"（≥ 26 号，带短引线，互不重叠）。可在基因上方左侧加标签"基因"。
  2. 字幕 1 时：5 个位点钉子（细竖线 + 圆头）依次从上方落到基因上的不同位置（外显子上 2 个、内含子上 1 个、非编码区 1 个、外显子上 1 个），落定时各自弹出标签：高影响（BRAND_PINK，发光）、中等影响（WARN）、低影响（MUTED）×2、非编码（MUTED），标签 ≥ 26 号、互不重叠。
  3. 字幕 2 时：舞台右侧出现"优先级"卡片（card），5 个位点按影响从高到低排序飞入列表（小圆点 + 标签），高影响排在最上方并加星（★，BRAND_PINK），低影响/非编码在下方变暗；同时基因上高影响、中等影响两个钉子轻微脉冲发光。如右侧空间不足，可在此步把基因结构整体左移/缩小给卡片让位（动画过渡）。
- 布局：预先确定坐标，元素互不重叠；所有元素在 |x| ≤ 6.75、y ∈ [-2.55, 3.0] 内，不压字幕区与进度条区。
- 时长目标 13–17 s；静止不超过 2 s；不要手写长 wait，字幕时长由 cap 自动补足。不出现任何具体参数。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_b.py S6Annotation` 迭代，ffmpeg 抽帧看图；确认 `./env/bin/manim -ql --disable_caching scenes_b.py S7Selection S8Delivery S9Ending` 能跑通。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_b.py S6Annotation`（约 40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w7_s6_sheet.png（1 帧/秒），关键帧 review/w7_s6_gene.png（基因结构 + 标注）、review/w7_s6_pins.png（5 个位点标签）、review/w7_s6_rank.png（优先级卡片）。自己看图检查重叠、越界、字幕无【】、可读性、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。