已实现 `S4Quality`，范围仅限该类。修改位于 [scenes_a.py](/project/tmp/worker-tiers-replay/R2-luna-3/scenes_a.py:519)。

- 包含章节切换、扫描门与五项清单、三条探针分级、矩阵图例及 4 级探针淘汰。
- 验证通过：低质与高质 Manim 渲染、`py_compile`；片长 `23.57` 秒。
- 抽帧自检确认章节进度条、失败标记与 4 级徽章、矩阵和图例可见；修正了标记重复加入警告及扫描到矩阵时旧探针残留。
- 关键帧：`review/w5_s4_sheet.png`、`review/w5_s4_scan.png`、`review/w5_s4_fail.png`、`review/w5_s4_grid.png`。
- 剩余不足：片长超出 15–20 秒目标；自动字幕阅读时长占比较大。