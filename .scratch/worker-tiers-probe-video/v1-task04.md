<!-- 2026-10-05T23:57:11.842Z line 61 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01A7ATK2GHEUvH54pYbr1HEm -->
修改 /project/tmp/tcuni_probe_video/scenes_b.py（Manim 科普动画的 S6–S8 场景），解决版面问题。只改 scenes_b.py 里的 S6Annotation、S7Selection、S8Delivery 三个类。S9Ending、style.py、scenes_a.py、assemble.sh 都不要动。

环境：
- `./env/bin/manim`（Manim 0.20.1，conda 环境，不要另装任何东西）。
- 临时文件不放 /tmp。只做 -ql 低清渲染。

背景：style.py 提供 `fit_main(mob)`：把一个 VGroup 等比缩放到主体区（宽 12、高 5.2，中心 y≈0，位于左上标题之下、底部字幕之上）并居中。
做法：每个场景先把主体元素（不含 step_title 和 caption）在静态位置上排好，组成 VGroup，调用 fit_main 后再开始动画；后续动画的位移目标基于缩放后的实际坐标（用 get_center/get_top 等），不要写死旧坐标。scenes_a.py 已按这个方式改好，可以参考。

需要逐项修复（来自抽帧检查）：
1. S6Annotation：基因结构和标签全挤在画面上方约 1/3 处，下方大片空白。要整体放大、垂直居中（基因示意横跨约 12 单位宽，外显子矩形高度至少 0.8）。"基因"标签离外显子标签太近，要拉开。"高影响/中等影响"在上方，"低影响/非编码"在下方，所有标签字号不小于 26，彼此不重叠。
2. S7Selection：
   - 嵌套面板的 "100K"、"50K"、"10K" 标签目前压在相邻矩形的边框上。改为每个标签放在各自矩形内部的左上角（或上边框正上方），并保证与其他矩形的边框至少留 0.15 单位间距；三个矩形之间的间隔加大到至少 0.5 单位。
   - 第二部分中，染色体条、嵌套面板、"升级面板，无需重新设计" 三者要整体居中、铺满主体区，不要偏左上。
   - 第一部分的染色体条也要垂直居中、宽度大于 11 单位，"保持合理间距"标签字号不小于 24。
3. S8Delivery：4 个小图卡片偏小、偏上，要放大到 2×2 网格整体铺满主体区（宽约 11、高约 5）。每个卡片的标题放在卡片内顶部，图形放在标题下方，二者不能重叠（目前 "GC 分布" 标题压在了直方图上）。标题字号不小于 26。"设计报告" 文档卡片要居中并放大。

字幕原文和时长（±2 秒内）保持不变。

验收（脚本产出任务，不需要 TDD）：
1. 逐个运行 `./env/bin/manim -ql --disable_caching scenes_b.py <Scene>`（S6Annotation S7Selection S8Delivery），全部无报错；报告时长（ffprobe）。
2. 每个场景抽 3 帧（约 25%/60%/95%）覆盖写入 `frames/b/<场景名>_<n>.png`（n=1,2,3），并用读图工具亲自查看。确认主体占画面中部的大部分，没有重叠、越界或被字幕遮挡；不满足就继续改。
3. 最后运行 `bash assemble.sh l`，确认 output/probe_design_l.mp4 重新生成，报告总时长。
4. 报告每个场景改了什么，以及还剩哪些问题。