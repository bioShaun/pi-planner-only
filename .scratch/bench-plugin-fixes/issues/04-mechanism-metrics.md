# 04：summarize 加机制指标

Status: done
Type: task

## Problem

现在只能看到费用和通过率。Root 费用约占总费用 97%，那些由插件机制带来的额外开销在这两个指标里看不出来。

## Changes

`bench/summarize.py` 给每条 run 加下面这些字段，按 arm 汇总时给出中位数，JSON 里也一并输出：
- `refused`：结果文本含 `still running` 的委派数；
- `detached`：结果文本含 `Detached for intercom` 的委派数；
- `truncated`：结果文本含 `chars omitted` 的委派数；
- `root_reads`：Root 调 read 的次数；`root_bash`：Root 调 bash 的次数；
- `root_cache_read`：Root 的 cacheRead token 数；`turns_per_delegate`：Root 轮数除以已启动的委派数；
- `extra_tools`：Root 调用 `subagent_supervisor` 和 `bg_wait` 的次数。

实现可以参考 `.scratch/bench-review/metrics.py`。另外，`--baseline` 的配对比较要能对上面任一指标做（新增 `--metric` 参数，默认仍比较费用）。

## Acceptance

- 对 `control-cpass-ds-strict/runs` 跑出的 refused 合计为 11、truncated 合计为 117（与复盘数字一致）。
- 原有输出行和 JSON 字段保持不变，只做追加。

## Comments
Implemented mechanism metrics and selectable paired-comparison metric in `bench/summarize.py`; verified against reference metrics for valid runs.
- 2026-09-25 Root 验收：runcheck 现在会把泄漏的 run 判为无效，cpass-ds 只剩 17 条有效 run，所以合计是 refused=5、truncated=51，不是 11 和 117；在同样 17 条 run 上逐条核对，和 metrics.json 一致。修了一处崩溃：某个计数指标全为 0 时，bootstrap 没有样本，会抛 IndexError，现在返回 CI=None。
