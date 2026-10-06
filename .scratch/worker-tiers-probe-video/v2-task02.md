<!-- 2026-10-06T09:12:30.305Z line 47 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01Hsk3kJiVyhAZcQHddvMab9 -->
在 /project/tmp/tcuni_probe_video（manim 科普动画工程，非 git 仓库；./env/bin/manim，Manim Community v0.20.1）中，按 STORYBOARD.md 重写 scenes_a.py 里的 S1Opening 与 S2Principle 两个场景。

先读：STORYBOARD.md 全文（第 0、1 节是规范，第 2 节 S1Opening / S2Principle 是分镜与最终字幕文案）、style.py（全片设计系统，只调用不修改；如确需给 style.py 加通用部件，可以加但不得改变已有函数签名和行为）、style_demo.py（API 用法示例）。

## 范围
- 重写 scenes_a.py：文件顶部 `from style import *`；S1Opening、S2Principle 继承 BrandScene（STEP=None）。类名不能改。
- scenes_a.py 里 S3Targets、S4Quality、S5Specificity 稍后由别人重写；本任务把它们替换成占位：继承 BrandScene，各自只做 `self.chapter(n)` 后 `self.finish()`（n=1,2,3），保证文件可以 import、可以渲染。
- 不改 scenes_b.py、make_music.py、assemble.sh、add_music.sh、render_hq.sh。

## 质量要求（这次重做的原因是 v1 太粗糙、像入门作品）
- 目标：外行一看就懂，并且足够吸引人。用"钓鱼"比喻；字幕严格用 STORYBOARD 文案，用 self.cap(text, hl=(...)) 显示，【】内是高亮词（传 hl，不要把【】字符本身显示出来）。
- 主体视觉宽度 ≥ 60% 画框，画面标签字号 ≥ 26，标签带引线、互不重叠，任何元素不得进入字幕条区域（y < -2.6）或越出画框。
- 静止画面不超过 2 秒：等字幕时主体要有轻微动作（漂浮、呼吸、扫描）。字幕停留时长由 cap() 自动补足，你不要手写长 wait。
- 不出现任何具体阈值或参数。
- S1 约 14 s：按分镜做碱基字母浮现 → 拉远成铺满的碱基字海（用缩放内容组模拟镜头拉远，BrandScene 不是 MovingCameraScene）+ 数字滚动到"150 亿+"（可用 ValueTracker/DecimalNumber 再换成"150 亿+"文字）→ 少数位点 BRAND_PINK 发光、其余变暗 → 标题卡"液相捕获探针设计" + 副标题 + logo_mark。
- S2 约 20 s：溶液容器中灰色双链片段漂浮、两段 BRAND_PINK 目标 → 探针游入，与目标"拉链式"逐个扣上碱基对 → 磁珠扣住生物素 → U 形磁铁出现、磁珠连同目标被吸向侧壁 → 其余片段被"冲走" → 目标飞入测序仪图标并吐出数据条 → 6 个步骤节点（STEPS 标题）大号预告排开，然后淡出（S3 开头的 chapter(1) 会把进度条带出来）。
- 两幕结束时都调用 self.finish()，舞台清空。

## 验收（你自己执行并在报告中贴结果）
1. `./env/bin/manim -ql --disable_caching scenes_a.py S1Opening S2Principle` 用于迭代；最终用 `-qh` 渲染这两幕（每幕十几秒，无需 slot）。
2. ffprobe 报告两幕时长（目标 S1 12–17 s、S2 18–24 s）。
3. 从 1080p 产物按 1 帧/秒抽帧拼联系表，保存为 review/w2_s1_sheet.png、review/w2_s2_sheet.png；另存 4–6 张全分辨率关键帧 review/w2_*.png（必须包括：S1 字海高亮帧、S1 标题卡、S2 拉链配对帧、S2 磁铁吸附帧、S2 步骤预告帧）。逐张看图自检：重叠、越界、压字幕、标签可读、是否精致；有问题自己修完再交。
4. 占位的 S3–S5 能渲染：`./env/bin/manim -ql --disable_caching scenes_a.py S3Targets` 成功即可。
5. 报告：两幕时长、关键帧路径、自检发现并修掉的问题、仍有的不足。

## 规则
- 临时/中间文件禁止放 /tmp，放本目录子目录（如 ./work/）。
- 预计超过 1 分钟或超过 2G 内存的命令必须先运行 `slot audit`、`slot status`，把输出追加到 logs/preflight.log，再用 `slot cpu -- <cmd>` 提交；单幕渲染不需要。不要运行 render_hq.sh。
- 注释用中文。