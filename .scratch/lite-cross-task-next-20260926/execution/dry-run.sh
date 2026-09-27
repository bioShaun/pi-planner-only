#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-cross-task-next-20260926/execution
[[ ! -e $logs/dry-run.log ]] || exit 2
while read -r task arm; do
  env TMPDIR=/project/tmp/ppo-bench/opus-cross-task-t1-t2b-20260926 PYTHONDONTWRITEBYTECODE=1 BENCH_DRY_RUN=1 BENCH_SKIP_HEALTH=1 BENCH_OUT="$PWD/$logs/dry-$task-$arm" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 bash bench/run.sh "$task" "$arm" 1
done < <(python3 -B - <<'PY'
import json
for row in json.load(open('.scratch/lite-cross-task-next-20260926/plan.json'))['order']:
 print(row['task'],row['arm'])
PY
) > "$logs/dry-run.log" 2>&1
cat "$logs/dry-run.log"
