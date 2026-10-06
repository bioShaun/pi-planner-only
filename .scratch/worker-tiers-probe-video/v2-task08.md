<!-- 2026-10-06T09:51:55.563Z line 122 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_017c8mPmnTaTC6N7BpQFMKui -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_b.py 里的 S7Selection 场景（第 5 步 择优布局 ——"有限的探针怎么摆？"）。当前它是占位（chapter(5) 后 finish()）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S7Selection（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、padlock、card、glow、zh 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py（S1–S5）和 scenes_b.py 中的 S6Annotation 作为风格参考（都已通过审查，不得修改）。只改 S7Selection 类及其私有辅助函数。

## 要求
- 开头 self.chapter(5)，结尾 self.finish()。字幕：把 STORYBOARD 4 条文案原样传给 self.cap()，包括【】（cap 自动高亮并去括号）。
- 分镜：
  1. 字幕 1"预算有限……刀刃上"：一条贯穿全宽的大染色体（圆角带，宽 ≥ 11 单位，高约 0.6，可复用 S3 风格的分带），上方密密麻麻约 45 条 MUTED 候选刻度——刻意不均匀：有 3 处明显扎堆、2 处明显空白（固定坐标或固定种子）。染色体上方右侧一个小"预算"计数牌（card + 文字"探针预算"，不写具体数字；可以用一个进度条/格子表示容量）。2 个必选位点用 BRAND_PINK padlock 钉在染色体上（与刻度同一行，略高）。
  2. 字幕 2"均匀铺开"：筛选动画——扎堆处多余刻度变暗下落淡出，空白处从候选里补上（或新刻度从上方落下），最终留下约 16 条大致均匀分布、BRAND_SKY 发光的刻度；染色体下方出现几段等长的双向小箭头/刻度尺示意"间距均匀"（不写数值）。
  3. 字幕 3"必选锁定"：一个 FAIL 色"替换"虚线箭头从侧面撞向一个锁，锁发光 + 轻微震动，箭头被弹开淡出；锁旁出现小标签"必选 · 锁定"（≥ 26 号）。
  4. 字幕 4"嵌套面板"：画面转换为三行同一染色体（缩短为宽约 8.5，左端标签"10K / 50K / 100K"，≥ 30 号，BRAND_SKY/BRAND_CYAN），10K 行只有 BRAND_PINK 点（约 6 个）；50K 行 = 同样位置的粉点 + 新增天蓝点；100K 行 = 再加青色点（点更密）。每个粉点从 10K 行拉一条竖向虚线贯穿到 100K 行，体现"同一批位点"；右侧注释"小面板 ⊂ 大面板"（≥ 30 号，可用两层嵌套圆角框小图标辅助）。三行依次出现，粉点虚线最后画出。
- 布局：预先确定坐标，元素互不重叠；所有元素在 |x| ≤ 6.75、y ∈ [-2.55, 3.0] 内，不压字幕区与进度条区。
- 时长目标 17–22 s；静止不超过 2 s；不要手写长 wait，字幕时长由 cap 自动补足。不出现任何具体参数（10K/50K/100K 允许）。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_b.py S7Selection` 迭代，ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_b.py S7Selection`（约 40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w8_s7_sheet.png（1 帧/秒），关键帧 review/w8_s7_before.png（筛选前）、review/w8_s7_after.png（均匀后）、review/w8_s7_lock.png（锁弹开箭头）、review/w8_s7_nested.png（嵌套三行）。自己看图检查重叠、越界、字幕无【】、可读性、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。