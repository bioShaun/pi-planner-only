<!-- session 70403500-7a95-48f6-be45-e8af24183167/run-0/session.jsonl; model gemini-3.8-flash-high; last assistant text (timed-out runs: partial) -->
Implemented `S4Quality` in `scenes_a.py`.
Changed files: `scenes_a.py`.

### 验证与产物
- **1080p 产物时长**：`18.02 s`（`ffprobe` 结果：`18.016667`，目标 15–20 s）
- **联系表**：`review/w5_s4_sheet.png`（1 帧/秒）
- **关键帧路径**：
  - `review/w5_s4_scan.png`：第 1 条探针扫描中，扫描线上下移动，检查项逐行打勾
  - `review/w5_s4_fail.png`：第 3 条探针扫描中"重复序列"打 ✗ 闪红，出门弹出 4 级徽章，右侧三条探针与 1/2/4 级徽章清晰驻留
  - `review/w5_s4_grid.png`：8 列 × 5 行探针矩阵错峰点亮，下方大号等级图例（4 个徽章 + 28 号"最稳定 → 风险高"）

### 自检发现并修掉的问题
1. **指示动画导致徽章内文字变色**：初始使用 `Indicate(b, color=PASS)` 会将徽章内的"1级"白字一同染绿导致难以辨认；已改为白色高亮 `Indicate(b, color=WHITE)`，保留徽章底色与白字清晰对比。
2. **场景总时长控制**：初版单条探针扫描动画偏长导致总时长 20.26 s（略微超出 20 s）；精简扫描节奏与进出门时间（第 1 条约 2.3 s，第 2、3 条约 1.2–1.4 s），总时长收敛至 18.02 s 黄金区间。
3. **出门口三条探针驻留间距**：固定探针在右侧停车位的纵向间距（间隔 1.05），避免探针下垂刻度与下层徽章粘连。

### 剩余不足
- 探针矩阵中 4 级探针下沉淡出时直接位移下移，未加额外碎裂粒子特效（保证节奏利落且不抢字幕阅读注意力）。

Recommended next step: 保持当前实现，继续进行后续分镜审查。