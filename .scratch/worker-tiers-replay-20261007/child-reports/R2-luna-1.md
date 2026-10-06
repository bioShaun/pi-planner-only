已实现 [scenes_a.py](/project/tmp/worker-tiers-replay/R2-luna-1/scenes_a.py:519) 中的 `S4Quality`，只修改该场景。包含扫描门、五项检查清单、三条分级探针及固定种子的 8×5 等级矩阵。

验证：低质量与 1080p 渲染均通过，`py_compile` 通过；1080p 片长 22.03 秒。关键帧与联系表见 [w5_s4_sheet.png](/project/tmp/worker-tiers-replay/R2-luna-1/review/w5_s4_sheet.png)、[w5_s4_scan.png](/project/tmp/worker-tiers-replay/R2-luna-1/review/w5_s4_scan.png)、[w5_s4_fail.png](/project/tmp/worker-tiers-replay/R2-luna-1/review/w5_s4_fail.png)、[w5_s4_grid.png](/project/tmp/worker-tiers-replay/R2-luna-1/review/w5_s4_grid.png)。

自检修正了清单底行越界、探针入场跳帧和图例等级重复。剩余不足：片长超过 15–20 秒目标，受字幕自动阅读时长影响；未缩短字幕停留。