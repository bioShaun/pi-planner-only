<!-- 2026-10-06T09:34:13.059Z line 80 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01WAG2fT2t7pLaTbFLCuMpNV -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_a.py 里的 S4Quality 场景（第 2 步 质量体检 ——"鱼钩结不结实？"）。当前它是占位（chapter(2) 后 finish()）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S4Quality（分镜 + 最终字幕文案）；style.py（设计系统：BrandScene、cap、chapter、finish、probe_strand、grade_badge、check_mark、cross_mark、card、glow、zh、zh_hl、GRADE 等，只调用不改；可加通用部件但不改已有签名）；scenes_a.py 中已完成的 S1Opening、S2Principle、S3Targets 作为风格和写法参考（已通过审查，不得修改）。只改 S4Quality 类及其私有辅助函数。

## 要求
- 开头 self.chapter(2)（进度条会从第 1 步切到第 2 步，确认切换正常，若 rail 在这一幕开头不存在也要正确出现），结尾 self.finish()。
- 分镜：
  1. 舞台中央偏左一个发光的"体检扫描门"（竖向圆角框 + glow + 上方小标题"质量体检"），右侧一张检查清单卡片，5 行：GC 含量 / 熔解温度 / 序列复杂度 / 重复序列 / 发夹结构（≥ 28 号），每行右端预留打勾位。
  2. 3 条候选探针（probe_strand，水平）依次从左侧沿一条淡色"传送带"线进入扫描门：扫描线在门内上下扫过探针时，清单逐行亮起并出现 check_mark（第 3 条探针在"重复序列"一行出现 cross_mark，该行闪 FAIL 色）；探针出门停在门右侧，头顶弹出 grade_badge（第 1 条 1 级、第 2 条 2 级、第 3 条 4 级），探针颜色随之变为 GRADE 色。每条结束后清单的勾复位。节奏：第 1 条完整展示（约 2.5 s），第 2、3 条加快（各约 1.5 s）。
  3. 拉远：门、清单、3 条探针淡出/缩小，替换为约 8 列 × 5 行的探针矩阵（小号 probe_strand 或圆角短条），按等级 1–4 上色（1、2 级占多数，3 级少量，4 级极少；固定随机种子），错峰点亮；矩阵下方（字幕区之上）出现大号等级图例：4 个 grade_badge 横排 + 文字"最稳定 → 风险高"（≥ 28 号）；然后 4 级探针变暗、下沉并淡出，1–2 级探针轻微发光（对应字幕 4"优先选用评级好的探针"）。
- 字幕严格用 STORYBOARD 4 条文案，self.cap(text, hl=(...))，【】内是高亮词；字幕 1 在扫描门出现时，字幕 2 在第 1 条探针检查时，字幕 3 在拉远成矩阵时，字幕 4 在 4 级淘汰时。不出现任何具体阈值/参数（不写 GC 百分比、温度数值）。
- 布局：预先确定坐标，元素互不重叠；所有元素在 |x| ≤ 6.75（左右留安全边距）、y ∈ [-2.55, 3.0] 内，不压字幕区与进度条区。
- 时长目标 15–20 s；静止不超过 2 s；不要手写长 wait，字幕时长由 cap 自动补足。

## 迭代与验收（你只有 10 分钟，控制节奏）
- 用 `./env/bin/manim -ql --disable_caching scenes_a.py S4Quality` 迭代，ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_a.py S4Quality`（约 40 s，无需 slot）。从 1080p 产物抽帧：联系表 review/w5_s4_sheet.png（1 帧/秒），关键帧 review/w5_s4_scan.png（第 1 条探针扫描中）、review/w5_s4_fail.png（第 3 条出现 ✗ 与 4 级徽章）、review/w5_s4_grid.png（矩阵 + 图例）。自己看图检查重叠、越界、可读性、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。