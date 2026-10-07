<!-- session 93a4a45e-a86e-4454-b42f-5b97f3082099/run-0/session.jsonl; model kimi-for-coding; last assistant text (timed-out runs: partial) -->
实现完成。

**Changed files**: `scenes_a.py`（仅 S4Quality 类，约 190 行；新增私有辅助 `_gate/_checklist/_conveyor/_scanline/_run_probe`），未动 S1/S2/S3/S5 与 style.py。

**实现内容**：chapter(2) 开场（rail 切到第 2 步）→ 发光"质量体检"扫描门 + 右侧 5 行检查清单（28 号字，右端勾位）→ 3 条探针沿淡色传送带入门，门内扫描线上下扫过、清单逐行点亮打勾；第 3 条"重复序列"行出 ✗ 并闪 FAIL 色；探针出门停靠、头顶弹 grade_badge（1/2/4 级）并变为 GRADE 色，勾位逐条复位（第 1 条约 2.5 s，后两条各约 1.5 s）→ 拉远为 8×5 探针矩阵（圆角短条，seed 23，1–2 级占多数、4 级极少，错峰点亮）+ 大号图例"1级…4级 最稳定 → 风险高"→ 4 级变暗下沉淡出、1–2 级加 glow。字幕严格用 STORYBOARD 4 条文案 + cap 高亮，无任何阈值数字。

**Validation**：
- `./env/bin/manim -ql --disable_caching scenes_a.py S4Quality` → 20.4 s，46 animations 正常
- `./env/bin/manim -qh --disable_caching scenes_a.py S4Quality` → **ffprobe 时长 19.63 s**（达标 15–20 s）
- 审查图：`review/w5_s4_sheet.png`（20 帧联系表）、`w5_s4_scan.png`（t=7 扫描打勾）、`w5_s4_fail.png`（t=11.6，✗+FAIL+4级徽章同帧）、`w5_s4_grid.png`（矩阵+图例），均人工看图确认无重叠/越界。

**自检修掉的问题**：①"检查清单"标题与首行重叠（卡片加高、行下移）；②拉远成矩阵时旧徽章未清除压在矩阵上；③Transform(probe, 复制体） 把已出门探针拉回门内（改为 animate.set_color）；④徽章压住上层探针（缩小 r=0.26、下移）；⑤23.7 s 超时（合并尾部播放、缩短扫描/矩阵动画）。

**剩余不足**：✗ 与 4 级徽章同框仅约 0.35 s（节奏需要）；探测元素（矩阵短条）为圆角条而非小号 probe_strand（任务允许二选一）。