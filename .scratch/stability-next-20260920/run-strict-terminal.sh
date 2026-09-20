#!/usr/bin/env bash
# Ordinary terminal only. Supply updated real acceptance logs in ReviewRequest.
set -euo pipefail
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$task_dir/../.." && pwd)"
cd -- "$repo_dir"
test -d "$task_dir"
test -d /project/tmp
run_dir="$(mktemp -d "$task_dir/strict-run-XXXXXX")"
tmp_root="$(mktemp -d /project/tmp/planner-strict-XXXXXX)"
export TMPDIR="$tmp_root" TMP="$tmp_root" TEMP="$tmp_root"
slot audit > "$run_dir/slot-audit.txt" 2> "$run_dir/slot-audit.stderr"
slot status > "$run_dir/slot-status.txt" 2>&1
node "$task_dir/slot-audit-gate.mjs" "$run_dir/slot-audit.txt" "$run_dir/slot-audit.stderr"
set +e
slot cpu -- bash /home/tcuni-claw/.codex/review-readonly.sh "$task_dir/ReviewRequest.md" > "$run_dir/events.jsonl" 2> "$run_dir/stderr.txt"
review_status=$?
set -e
printf '%s\n' "$review_status" > "$run_dir/exit-code.txt"
printf 'Strict launcher exit: %s; evidence: %s\n' "$review_status" "$run_dir"
exit "$review_status"
