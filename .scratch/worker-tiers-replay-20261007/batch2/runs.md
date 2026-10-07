# worker-tiers replay2 log

- 2026-10-07T07:48:33+08:00 worker -> kimi-coding/kimi-for-coding (medium)
| run | status | model (child reported) | tok | $ | turns | s |
|---|---|---|---|---|---|---|
| R1-kimi-1 | completed | kimi-coding/kimi-for-coding:medium | 749k | 0.2527 | 29 | 444 |
| R1-kimi-2 | timed_out | kimi-coding/kimi-for-coding:medium | 1.61M | 0.4456 | 54 | 600 |
| R1-kimi-3 | timed_out | kimi-coding/kimi-for-coding:medium | 1.05M | 0.3278 | 38 | 600 |
| R2-kimi-1 | completed | kimi-coding/kimi-for-coding:medium | 1.25M | 0.3879 | 27 | 454 |
| R2-kimi-2 | timed_out | kimi-coding/kimi-for-coding:medium | 1.04M | 0.3498 | 27 | 600 |
| R2-kimi-3 | timed_out | kimi-coding/kimi-for-coding:medium | 1.29M | 0.4234 | 28 | 600 |

note: kimi runs R1-2/3 and R2-1/2/3 ran 2-3 in parallel; R1-kimi-1 alone.
- 2026-10-07T08:18:24+08:00 worker -> cline/cline-pass/deepseek-v4.1-flash (medium)
| R1-dsflash-1 | completed | cline/cline-pass/deepseek-v4.1-flash:medium | 753k | 0.0631 | 27 | 378 |
| R1-dsflash-2 | timed_out | cline/cline-pass/deepseek-v4.1-flash:medium | 1.6M | 0.0997 | 39 | 600 |
| R1-dsflash-3 | timed_out | cline/cline-pass/deepseek-v4.1-flash:medium | 1.43M | 0.0896 | 39 | 600 |
| R2-dsflash-1 | timed_out | cline/cline-pass/deepseek-v4.1-flash:medium | 891k | 0.0857 | 19 | 600 |
| R2-dsflash-2 | timed_out | cline/cline-pass/deepseek-v4.1-flash:medium | 853k | 0.0886 | 16 | 600 |
| R2-dsflash-3 | timed_out | cline/cline-pass/deepseek-v4.1-flash:medium | 735k | 0.0956 | 15 | 600 |

note: dsflash ran 3 in parallel per batch; first model turn often 3-4 min.
- 2026-10-07T08:40:30+08:00 worker -> tcuni-agy/gemini-3.8-flash-high (medium)
| R1-gemflash-1 | timed_out | tcuni-agy/gemini-3.8-flash-high:medium | 2.43M | 0.7243 | 55 | 600 |
| R1-gemflash-2 | completed | tcuni-agy/gemini-3.8-flash-high:medium | 2.93M | 0.7377 | 59 | 587 |
| R1-gemflash-3 | timed_out | tcuni-agy/gemini-3.8-flash-high:medium | 3.03M | 0.7302 | 61 | 600 |
| R2-gemflash-1 | completed | tcuni-agy/gemini-3.8-flash-high:medium | 2.28M | 0.4322 | 42 | 318 |
| R2-gemflash-2 | completed | tcuni-agy/gemini-3.8-flash-high:medium | 3.39M | 0.6300 | 43 | 573 |
| R2-gemflash-3 | timed_out | tcuni-agy/gemini-3.8-flash-high:medium | 2.88M | 0.6311 | 41 | 600 |
- 2026-10-07T09:02:33+08:00 settings.json restored from settings.json.orig (worker=sonnet)
