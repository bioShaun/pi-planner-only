<!-- 2026-10-06T09:30:34.825Z line 69 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01NiKKgpEHUCxpkWNj3jTAbd -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_a.py 里的 S3Targets 场景（第 1 步 明确目标 ——"钓什么？"）。当前它是占位（chapter(1) 后 finish()）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S3Targets（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、padlock、db_icon、card、glow、zh、zh_hl 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py 中已完成的 S1Opening、S2Principle 作为风格和写法参考（已通过审查，不得修改）。只改 S3Targets 类及其私有辅助函数。

## 要求
- class S3Targets(BrandScene)，STEP=None 或 1 均可，但开头必须 self.chapter(1)（它会让顶部进度条出现并定位到第 1 步；确认进度条正确出现），结尾 self.finish()。
- 分镜：3 条大号染色体（圆角带状 + 浅色分带，标签 Chr1/Chr2/Chr3 ≥ 28 号）横贯舞台，宽度 ≥ 9 单位；左侧"客户需求"卡片（三行：指定基因 / 指定区间 / 关键位点，每行配小图标，≥ 26 号）；三行依次飞出 BRAND_PINK 锁钉（padlock）钉到染色体上，并出现"必选"小标签；右侧 db_icon"群体数据"吐出一群灰点（约 30–40 个）撒到染色体上，筛子/扫描光扫过：约一半变 BRAND_SKY 发光留下，其余下落淡出。最后三类元素（锁钉、蓝点）共同闪一下，对应字幕 3"它们一起组成候选目标"。
- 布局：预先确定坐标，元素互不重叠（卡片、染色体、数据库图标、标签、锁钉之间都不重叠）；任何元素不进字幕区（y < -2.6）、不进进度条区（y > 3.0）、不越界。灰点用固定随机种子，且点只落在染色体带上。
- 字幕严格用 STORYBOARD 3 条文案，self.cap(text, hl=(...))，【】内是高亮词。不出现任何具体阈值/参数（例如不要写坐标区间 chr2:1.2–1.5 Mb 这种）。
- 时长目标 13–18 s；静止不超过 2 s（等字幕时要有呼吸/脉冲等轻微动作）。不要手写长 wait，字幕时长由 cap 自动补足。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_a.py S3Targets` 迭代（几秒一次），ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_a.py S3Targets`（约 30–40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w4_s3_sheet.png（1 帧/秒），关键帧 review/w4_s3_locks.png（锁钉落定）、review/w4_s3_filter.png（筛选后）。自己看图检查重叠、越界、可读性、精致度，有问题修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。