<!-- 2026-10-06T00:04:09.380Z line 76 role=worker cwd=/project/tmp/tcuni_probe_video id=toolu_01MG1xwNwyZwgwJVHqdBxuTP -->
为 /project/tmp/tcuni_probe_video 的科普动画（Manim 渲染，无音轨，约 137 秒，9 个场景）合成一段原创背景音乐，并混入视频。
为了避免版权问题，音乐必须用代码从零合成，不得下载或使用任何外部音频素材。

环境：
- Python 用 `./env/bin/python`（conda 环境，已有 numpy；若需要 scipy，先检查是否已装，没有的话用 `mamba install -y -p ./env -c conda-forge scipy` 安装）。
- ffmpeg 在 /usr/bin/ffmpeg。
- 临时文件全部放本目录下，禁止 /tmp。不要修改 scenes_a.py、scenes_b.py、style.py、assemble.sh。

视频结构：
- 场景 mp4 位于 media/videos/scenes_a/480p15/{S1Opening,S2Principle,S3Targets,S4Quality,S5Specificity}.mp4 和 media/videos/scenes_b/480p15/{S6Annotation,S7Selection,S8Delivery,S9Ending}.mp4。
- 拼接成片：output/probe_design_l.mp4。
- 高清版以后会在 1080p60 目录下产出同名文件，时长与低清相同。

交付物：
1. `make_music.py`
   - 用法：`./env/bin/python make_music.py --video <成片mp4> --scenes-dir-a <dir> --scenes-dir-b <dir> --out music/bgm.wav`。
   - 用 ffprobe 读取成片总时长和 9 个场景各自的时长，算出场景切换时间点。
   - 合成 44.1kHz 立体声 wav，时长等于成片时长。
   - 风格：温和、明亮、有科技感的企业科普背景乐，不抢字幕的注意力。约 92 BPM，C 大调，和弦进行 Cmaj7 – Am7 – Fmaj7 – G(add9) 循环。
   - 编配：
     - 柔和 pad 铺底（几个略微失谐的锯齿波或三角波叠加，加简单低通滤波，攻击/释放各 0.3 秒以上）；
     - 低音跟随和弦根音（正弦波）；
     - 从 S2 开始加入轻柔的拨弦琶音（衰减正弦波或简单 Karplus-Strong），八分音符；
     - 从 S3（"第 1 步"）开始加入很轻的节奏：柔和底鼓（正弦下滑）+ 轻 hi-hat（高通噪声短包络）；
     - 每个场景切换点加一个很轻的"swish"过渡音效（滤波噪声扫频，约 0.4 秒，音量低）；
     - S9Ending 开始时去掉鼓，回到 pad + 一个明亮的长和弦（Cmaj9）作为收尾。
   - 整体：开头淡入 1.5 秒，结尾淡出 3 秒；加一点简单混响（几条 comb/allpass 或卷积衰减噪声都可以）；输出峰值不超过 -1 dBFS，避免削波。
   - 设定固定随机种子，保证结果可复现。
2. `add_music.sh`
   - 用法：`bash add_music.sh <输入视频mp4> <music wav> <输出mp4>`。
   - 用 ffmpeg 混入音轨：视频流直接 copy，音频编码 AAC 192k；音乐响度用 loudnorm 归一到约 -20 LUFS（背景乐偏轻）；用 `-shortest` 或精确截断，使音轨与视频等长。
   - set -euo pipefail。
3. 实际产出 `music/bgm.wav` 和 `output/probe_design_l_music.mp4`（基于 output/probe_design_l.mp4）。

验收（脚本产出任务，不需要 TDD）：
1. 运行上面两条命令，均无报错。
2. 报告：ffprobe 显示 output/probe_design_l_music.mp4 同时有视频流和音频流，以及两者的时长（相差应小于 0.1 秒）。
3. 用 `ffmpeg -i output/probe_design_l_music.mp4 -af ebur128 -f null -` 报告 Integrated loudness 和 True peak（如果可得）；`volumedetect` 的 max_volume 应 ≤ -1 dB。
4. 生成整段音频的波形图或频谱图 PNG（`ffmpeg -i music/bgm.wav -filter_complex showwavespic=s=1600x300 -frames:v 1 music/wave.png`），用读图工具查看并说明：开头有淡入、结尾有淡出，中段没有明显削波或突兀的大幅跳变。
5. 报告列出：文件路径，用到的场景切换时间点，以及遗留问题。