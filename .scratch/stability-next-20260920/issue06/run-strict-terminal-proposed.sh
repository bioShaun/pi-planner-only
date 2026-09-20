#!/usr/bin/env bash
# Experiment launcher for issue 06: identical to ../run-strict-terminal.sh except
# that it calls the PROPOSED entry in this directory instead of the global entry.
# Results are experiment evidence for the proposal, not a gate pass.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
task_dir="$(cd -- "$here/.." && pwd)"
repo_dir="$(cd -- "$task_dir/../.." && pwd)"
cd -- "$repo_dir"
test -d /project/tmp
run_dir="$(mktemp -d "$here/strict-run-XXXXXX")"
tmp_root="$(mktemp -d /project/tmp/planner-strict-XXXXXX)"
export TMPDIR="$tmp_root" TMP="$tmp_root" TEMP="$tmp_root"
date -u +%Y-%m-%dT%H:%M:%S.%NZ > "$run_dir/launched-at.txt"
slot audit > "$run_dir/slot-audit.txt" 2> "$run_dir/slot-audit.stderr"
slot status > "$run_dir/slot-status.txt" 2>&1
node "$task_dir/slot-audit-gate.mjs" "$run_dir/slot-audit.txt" "$run_dir/slot-audit.stderr"
set +e
slot cpu -- bash "$here/review-readonly-proposed.sh" "$task_dir/ReviewRequest.md" > "$run_dir/events.jsonl" 2> "$run_dir/stderr.txt"
review_status=$?
set -e
printf '%s\n' "$review_status" > "$run_dir/exit-code.txt"
date -u +%Y-%m-%dT%H:%M:%S.%NZ > "$run_dir/finished-at.txt"
printf 'Proposed strict launcher exit: %s; evidence: %s\n' "$review_status" "$run_dir"
exit "$review_status"
