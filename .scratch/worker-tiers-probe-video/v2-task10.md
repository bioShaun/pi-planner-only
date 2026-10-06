<!-- 2026-10-06T10:05:18.327Z line 146 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_013ibbt3EaZ7gSnmrD4yhEuV -->
在 /project/tmp/tcuni_probe_video（manim 科普动画，非 git；./env/bin/manim，Manim CE v0.20.1）中，实现 scenes_b.py 里的 S9Ending 片尾场景。当前它是占位（只显示 logo 2 秒）。

先读：STORYBOARD.md 第 0、1 节（规范）和第 2 节 S9Ending；style.py（设计系统：BrandScene、STEPS、logo_full、logo_mark、glow、zh、品牌色常量等，只调用不改）；scenes_a.py 的 S1Opening 标题卡与 S2Principle 结尾的六步卡片（作为风格呼应，不得修改）。只改 S9Ending 类及其私有辅助函数，不动其它场景。

## 要求（约 9–11 s，无字幕条，不显示进度条：STEP=None，不调用 cap/chapter）
1. 回顾（约 1.8 s）：6 个步骤节点横排在画面中部（圆点 + 下方 STEPS 标题，≥ 26 号），从左到右依次点亮（BRAND_SKY 发光，节点间连线逐段画亮），全部点亮后整体闪一下。
2. 汇聚（约 0.8 s）：6 个节点向中心收拢成一个光点（可带一圈扩散光环），光点淡出的同时官方 logo 展开出现：logo_full，高度约 2.0，位于 y≈1.0，可配合 scale 0.85→1 + FadeIn，背后一层很淡的 BRAND_SKY 径向光晕。
3. 文案依次淡入（logo 下方，居中，互不重叠）：
   - 标语"好的捕获，从好的探针设计开始"（44 号，TEXT_C，粗体；"好的探针设计"用 BRAND_PINK 高亮，可用 zh_hl）
   - "靶向捕获测序 · 为育种加速"（30 号，MUTED）
   - 联系方式一行："www.tcuni.com    market@tcuni.com    028-85923313"（24 号，MUTED），上方加一条细分隔线。
4. 停留约 3 s（期间粒子漂浮、logo 光晕缓慢呼吸，不能完全静止），最后 1 s 内全部（含背景粒子以外的内容）淡出到背景。
- 所有元素在 |x| ≤ 6.75、y ∈ [-3.3, 3.4] 内，互不重叠。

## 迭代与验收（你只有 10 分钟）
- 用 `./env/bin/manim -ql --disable_caching scenes_b.py S9Ending` 迭代，ffmpeg 抽帧看图。
- 最后做一次 `./env/bin/manim -qh --disable_caching scenes_b.py S9Ending`（无需 slot）。从 1080p 产物抽帧：联系表 review/w10_s9_sheet.png（2 帧/秒），关键帧 review/w10_s9_recap.png、review/w10_s9_final.png（全部文案出齐时）。自己看图检查重叠、越界、logo 清晰度、精致度，修完再交。
- 报告：ffprobe 时长、关键帧路径、自检发现并修掉的问题、剩余不足。

规则：临时文件不放 /tmp，放 ./work/；不要运行 render_hq.sh 或渲染全片；超过 1 分钟的命令先 `slot audit`、`slot status` 追加写入 logs/preflight.log，再 `slot cpu -- <cmd>`。注释中文。