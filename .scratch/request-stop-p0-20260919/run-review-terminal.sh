#!/usr/bin/env bash
# Run from an ordinary terminal after release validation, not this sandbox.
set -euo pipefail
task_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$task_dir/../.." && pwd)"
test -d "$task_dir"
cd -- "$repo_dir"
sha256sum -c "$task_dir/evidence/review-r4/source.sha256"
run_dir="$(mktemp -d "$task_dir/strict-run-XXXXXX")"
# Temp root lives outside the worktree (same rule as the release script); never /tmp.
test -d /project/tmp
tmp_root="$(mktemp -d /project/tmp/pi-planner-only-strict-XXXXXX)"
printf '%s\n' "$tmp_root" > "$run_dir/tmp-root.txt"
export TMPDIR="$tmp_root" TMP="$tmp_root" TEMP="$tmp_root" SLOT_TMPDIR="$tmp_root"
date -u +%FT%TZ > "$run_dir/started-at.txt"
slot audit > "$run_dir/slot-audit.txt" 2>&1
slot status > "$run_dir/slot-status.txt" 2>&1
cat "$run_dir/slot-audit.txt" "$run_dir/slot-status.txt"
set +e
slot cpu -- bash /home/tcuni-claw/.codex/review-readonly.sh "$task_dir/evidence/review-r4/strict-request.md" > "$run_dir/events.jsonl" 2> "$run_dir/launcher.stderr"
review_status=$?
set -e
printf '%s\n' "$review_status" > "$run_dir/exit-code.txt"
sha256sum -c "$task_dir/evidence/review-r4/source.sha256" > "$run_dir/source-check-after.txt"
printf 'Review launcher exit: %s; inspect verdict and permission proof in %s\n' "$review_status" "$run_dir"
exit "$review_status"
