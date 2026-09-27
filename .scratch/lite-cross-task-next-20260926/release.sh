#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-cross-task-next-20260926
[[ -f $logs/release-resource-preflight.log && ! -e $logs/release.log ]] || exit 2
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/cross-task-preflight-20260926/release PYTHONDONTWRITEBYTECODE=1 python3 -B "$logs/release-guard.py" > "$logs/release.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/release.exit"
tail -8 "$logs/release.log"
exit "$rc"
