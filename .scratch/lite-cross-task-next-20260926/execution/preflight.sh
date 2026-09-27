#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-cross-task-next-20260926/execution
phase=${1:?phase}
case "$phase" in dry|attempt-[1-4]) ;; *) exit 2 ;; esac
[[ ! -e $logs/$phase-preflight.log ]] || exit 2
python3 -B - <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,'bench')
import temp_guard as g
d=g.forbidden_devices(reject_outside_aliases=True)
parent=g.safe_temp_directory(Path('/project/tmp/ppo-bench'),Path.cwd(),d)
p=parent/'opus-cross-task-t1-t2b-20260926'
if p.exists():g.safe_temp_directory(p,Path.cwd(),d)
p.mkdir(exist_ok=True)
g.safe_temp_directory(p,Path.cwd(),d)
PY
{ date -Is; slot audit; slot status; } > "$logs/$phase-preflight.log" 2>&1
sed -n '1,7p' "$logs/$phase-preflight.log"
rg 'running|queued|^=== 池' "$logs/$phase-preflight.log" || true
