<!-- 2026-10-06T09:23:54.895Z line 63 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01CYXu48t6FqgctPvnT16L6R -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，修整 scenes_a.py 里的 S2Principle 场景（"液相捕获原理：像钓鱼一样"）。规格见 STORYBOARD.md 第 1 节和第 2 节 S2Principle；设计系统在 style.py（只调用，不改；可加通用部件但不改已有签名）。只改 S2Principle 及其私有辅助函数，不动 S1Opening、S3–S5 占位、其它文件。

当前渲染的问题（审查已看过 review/w2_s2_zipper.png、review/w2_s2_magnet.png、review/w2_s2_sheet.png，修完要逐条解决）：
1. 灰色非目标片段之间互相重叠（右上两条叠在一起），探针的生物素球压在灰片段上，磁珠压在灰片段上。要求：任何时刻片段之间、片段与探针/磁珠/标签之间都不重叠。用预先排好的、互不相交的布局位置 + 小幅漂浮（振幅不足以碰撞），不要随机摆放。
2. 磁铁吸附阶段把两条"探针+目标"复合体旋转成竖直方向，看起来别扭。改为：保持水平，平移并上下堆叠到靠磁铁一侧的容器内壁旁，磁珠贴近内壁排列。
3. 磁铁太小、在容器外面像孤立的图标。改为：磁铁更大（高度约为容器高度的 0.5–0.6），紧贴容器右侧外壁，两极朝向容器；吸附时有磁力线/波纹从磁铁向容器内扩散。
4. "统统洗掉"：灰片段在字幕说"洗掉"时要明确地随水流（几条流线/波纹从右向左或向下）流出容器并消失，吸附在壁上的目标留下。不要在吸附完成后还有灰片段残留。
5. 标签（探针、生物素（小把手）、磁珠、目标片段）字号 ≥ 26，引线清楚，彼此不重叠，生物素和磁珠标签在对应事件发生时出现。
6. 结尾的六步预告卡片太小：3×2 卡片网格整体宽度要 ≥ 10 单位，每张卡编号 ≥ 44 号、标题 ≥ 32 号、问题 ≥ 24 号；卡片错峰入场。
7. 保持字幕文案不变（6 条，见 STORYBOARD），时长目标 18–24 s；静止不超过 2 s。

迭代方法（控制时间，你只有 10 分钟）：用 `./env/bin/manim -ql --disable_caching scenes_a.py S2Principle` 迭代（几秒），用 ffmpeg 抽帧查看；只在最后做一次 `-qh` 渲染（约 40 s）。最终从 1080p 产物抽帧：联系表 review/w3_s2_sheet.png（1 帧/秒），关键帧 review/w3_s2_zipper.png、review/w3_s2_magnet.png、review/w3_s2_wash.png、review/w3_s2_steps.png，自己看图确认上述 7 条都已解决。
报告：时长（ffprobe）、7 条逐条结果、关键帧路径、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 写入 logs/preflight.log 再 `slot cpu -- <cmd>`。注释中文。