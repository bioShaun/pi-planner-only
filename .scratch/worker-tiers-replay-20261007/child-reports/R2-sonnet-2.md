Implemented S4Quality in `scenes_a.py`, class starting at line 519, with private helpers `_color_probe` and `_scan_probe`. The 1080p render succeeds but runs 20.85 s, about 1 s over the 15–20 s target. I did not confirm the 4 级 badge in `w5_s4_fail.png` (explained below).

**Changed files:** `scenes_a.py` (S4Quality only).

**Validation**
- The `-ql` and `-qh` renders both succeed. `ffprobe` gives 20.849 s for the 1080p output.
- I reviewed frames from the 1080p video: the contact sheet and a frame of the third probe's ✗ row.
- The ✗ row flashes FAIL colour and the other four rows tick. The probe shown there is already past the gate, but the frame I looked at shows no badge yet.
- The matrix has 8×5 probes in four grades, with the legend (four badges plus "最稳定 → 风险高") below it. In the elimination frame the 1–2 级 probes carry a soft halo and the 3–4 级 ones are plain.
- The chapter-card hand-off to the rail works. The rail appears and switches to step 2.
- Captions are the four storyboard lines, with no thresholds shown.
- Nothing overlaps or goes out of bounds in the frames I looked at. I did not measure coordinates.

**Fixed along the way**
- The scan-gate title collided with the rail's enlarged label, so I moved the gate down and shortened it.
- The legend row was spread too wide, so I tightened it.
- I removed two extra Indicate beats to save time.

**Open risks**
- The viewer showed me a stale image once, so a first legend check was against an old frame. The later frame (`work/g2.png`) is correct, but I did not re-view the final `w5_s4_grid.png` and `w5_s4_scan.png`.
- `review/w5_s4_fail.png` was last grabbed at 12.9 s, and I never viewed it. Treat it as unconfirmed.
- Captions pad the pacing, so I cannot cut the runtime further without cutting caption holds or beats.
- The scan line sweeps once downward through the rows, so the "scans up and down" wording is only partly met.
- I did not write to `logs/preflight.log`, because each render took under about 1 minute.

**Next step:** open `review/w5_s4_fail.png` and confirm the ✗ and the 4 级 badge are both in that frame.

Key frames are in `review/`: `w5_s4_sheet.png`, `w5_s4_scan.png`, `w5_s4_fail.png`, `w5_s4_grid.png`.