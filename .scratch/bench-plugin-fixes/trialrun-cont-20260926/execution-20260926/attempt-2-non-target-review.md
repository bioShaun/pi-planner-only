# 非目标测试改动复核

Non-target test change reviewed: exactly two fixture filenames regions.bed -> cds.bed; no assertions deleted/weakened. T3 prompt forbids editing its three named target tests, not all tests. This benchmark file is outside frozen pytest testpaths (unit/contracts/pipelines) and benchmark-skip is enabled, so target/masked evaluation is unaffected. Raw successful edit patch and failed first edit preserved. Root accepts quality; this signal is disclosed, not a spec stopping condition.

Evidence: attempt-2-test-edits.json; frozen parent pyproject.toml testpaths; target 30 passed; masked 14 failed / 1116 passed, identical baseline failure set.
