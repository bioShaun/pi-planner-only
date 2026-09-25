# 09：A/B 测量

Status: needs-triage
Type: task
Blocked by: 01, 02, 03, 04, 05, 06

用 cpass-ds 做 Root，对比 `297b065` 和修复后的 HEAD。任务用 T2、T3（和 08 的新任务），每格至少重复 6 次。
主要看 refused、detached、truncated、root_reads、root_cache_read，其次看费用和通过率。受 ClinePass 额度限制。
