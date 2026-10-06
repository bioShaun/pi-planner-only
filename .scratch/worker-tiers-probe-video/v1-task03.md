<!-- 2026-10-05T23:47:22.132Z line 51 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01Rcuaw2saXAGTSVbrG6LRTd -->
修改 /project/tmp/tcuni_probe_video/scenes_a.py（Manim 科普动画的 S1–S5 场景），解决版面问题。只改 scenes_a.py。style.py、scenes_b.py、assemble.sh 都不要动。

环境：
- `./env/bin/manim`（Manim 0.20.1，conda 环境，不要另装任何东西）。
- 临时文件不放 /tmp。只做 -ql 低清渲染。

问题：抽帧显示，主体内容普遍又小又挤在画面上半部分，下半部分大片空白。
style.py 新增了 `fit_main(mob)`：把一个 VGroup 等比缩放到主体区（宽 12、高 5.2，中心 y≈0，位于左上标题之下、底部字幕之上）并居中。
做法：每个场景先把主体元素（不含 step_title 和 caption）在静态位置上排好，组成一个 VGroup，调用 fit_main 后再开始动画；后续动画的位移目标也要基于缩放后的坐标计算（例如用 `.get_center()` 之类取实际位置，不要写死旧坐标）。

需要逐项修复：
1. S2Principle：整组太小（只占画面约 1/5）。要放大到撑满主体区，让左侧片段、探针、磁珠、右侧"测序"框横向铺开。"磁珠"、"目标片段"、"探针（带生物素）"三个标签目前和图形或彼此重叠，要分开摆放（标签放在对应图形的上方或下方，留出空隙，可用细引线）。标签字号不小于 24。
2. S3Targets：清单卡片、染色体、数据库图标整体偏上、偏小，要放大并垂直居中。卡片文字字号不小于 22。
3. S4Quality：内容整体偏小，要放大居中。左侧待检探针和检测台有重叠，要拉开间距。右侧徽章和已出台的探针要水平对齐。
4. S5Specificity：内容挤在上半屏，要放大并垂直居中。三条亚基因组线和下方探针之间的间距拉开一些。
5. S1Opening：最后一帧的碱基海洋偏小、偏右上，要居中并铺到主体区，宽度大于 10 单位。

字幕原文、场景顺序、各场景时长（±2 秒内）保持不变。

验收（脚本产出任务，不需要 TDD）：
1. 逐个运行 `./env/bin/manim -ql --disable_caching scenes_a.py <Scene>`（S1Opening S2Principle S3Targets S4Quality S5Specificity），全部无报错；报告各场景时长（ffprobe）。
2. 每个场景抽 3 帧（约 25%/60%/95%）覆盖写入 `frames/a/<场景名>_<n>.png`，并用读图工具亲自查看。确认主体占画面中部的大部分，没有重叠、越界或被字幕遮挡；不满足就继续改。
3. 报告每个场景改了什么，以及还剩哪些问题。