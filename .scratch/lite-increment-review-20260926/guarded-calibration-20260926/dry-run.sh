#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-increment-review-20260926/guarded-calibration-20260926
[[ ! -e $logs/dry-run.log ]] || exit 2
env TMPDIR=/project/tmp/ppo-bench/opus-guarded-20260926 PYTHONDONTWRITEBYTECODE=1 BENCH_DRY_RUN=1 BENCH_SKIP_HEALTH=1 BENCH_OUT="$PWD/$logs/dry-run-output" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 bash bench/run.sh T3 lite-opus-calibration 1 > "$logs/dry-run.log" 2>&1
cat "$logs/dry-run.log"
