#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-t2c-focused-20260927/execution
[[ ! -e $logs/dry-run-verified.log ]] || exit 2
[[ -f $logs/dry-preflight.log && -f $logs/dry-static.json ]] || exit 2
python3 -B - "$logs" <<'PY'
import json,sys
from pathlib import Path
d=Path(sys.argv[1]); assert all(json.loads((d/'dry-static.json').read_text())['checks'].values())
PY
while read -r task arm; do
  env TMPDIR=/project/tmp/pt-668156d8 TMP=/project/tmp/pt-668156d8 TEMP=/project/tmp/pt-668156d8 PYTHONDONTWRITEBYTECODE=1 BENCH_DRY_RUN=1 BENCH_SKIP_HEALTH=1 BENCH_OUT="$PWD/$logs/dry-verified-$task-$arm" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 bash bench/run.sh "$task" "$arm" 1
  rc=$?
  printf '%s %s exit=%s\n' "$task" "$arm" "$rc" >&2
  (( rc == 0 )) || exit "$rc"
done < <(python3 -B - <<'PY'
import json
for row in json.load(open('.scratch/lite-t2c-focused-20260927/execution/plan.json'))['order']:
 print(row['task'],row['arm'])
PY
) > "$logs/dry-run-verified.log" 2>&1
cat "$logs/dry-run-verified.log"
