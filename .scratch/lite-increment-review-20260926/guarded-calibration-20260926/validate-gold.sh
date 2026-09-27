#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/guarded-calibration-20260926
[[ -f $logs/gold-preflight.log && ! -e $logs/gold-verify.log ]] || exit 3
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/opus-guarded-20260926 PYTHONDONTWRITEBYTECODE=1 python3 -B "$logs/guarded-gold.py" > "$logs/gold-verify.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/gold-verify.exit"
tail -5 "$logs/gold-verify.log"
exit "$rc"
