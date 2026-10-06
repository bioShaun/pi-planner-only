# worker-tiers replay log

- settings backup: settings.json.orig (worker=tcuni-claude/claude-sonnet-5-5:medium)
- 2026-10-07T00:08:25+08:00 switched worker -> tcuni/gpt-6-luna (thinking medium)
| run | status | model (child reported) | tok | $ | turns | s |
|---|---|---|---|---|---|---|
| R1-luna-1 | completed | tcuni/gpt-6-luna:medium | 455k | 0.0138 | 20 | 527 |
| R1-luna-2 | completed | tcuni/gpt-6-luna:medium | 328k | 0.0111 | 14 | 170 |
| R1-luna-3 | completed | tcuni/gpt-6-luna:medium | 438k | 0.0139 | 17 | 169 |
| R2-luna-1 | completed | tcuni/gpt-6-luna:medium | 1.37M | 0.0305 | 20 | 333 |
| R2-luna-2 | completed | tcuni/gpt-6-luna:medium | 625k | 0.0170 | 14 | 187 |
| R2-luna-3 | completed | tcuni/gpt-6-luna:medium | 437k | 0.0136 | 12 | 180 |

- 2026-10-07T00:22:22+08:00 switched worker back -> tcuni-claude/claude-sonnet-5-5 (settings identical to original)
| R1-sonnet-1 | completed | tcuni-claude/claude-sonnet-5-5:medium | 311k | 0.3473 | 12 | 187 |
| R1-sonnet-2 | completed | tcuni-claude/claude-sonnet-5-5:medium | 643k | 0.5221 | 17 | 262 |
| R1-sonnet-3 | completed | tcuni-claude/claude-sonnet-5-5:medium | 397k | 0.3795 | 13 | 195 |
| R2-sonnet-1 | completed | tcuni-claude/claude-sonnet-5-5:medium | 240k | 0.2557 | 10 | 268 |
| R2-sonnet-2 | completed | tcuni-claude/claude-sonnet-5-5:medium | 567k | 0.3556 | 18 | 281 |
| R2-sonnet-3 | completed | tcuni-claude/claude-sonnet-5-5:medium | 256k | 0.2307 | 11 | 291 |

- contamination check: no child tool call referenced /project/tmp/tcuni_probe_video or another replay dir
- eval kit: eval/make_eval.py (worker sonnet $0.2448); programmatic checks: all 12 pass except R2 duration >20 s for all 6
- blind reviewer (tcuni/gpt-6.1-sol:high): R1 $0.2726, R2 $0.2706; results sealed in ../worker-tiers-replay-key/
