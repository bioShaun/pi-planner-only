#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-t2c-focused-20260927/execution
phase=${1:?phase}
case "$phase" in dry|attempt-[1-2]) ;; *) exit 2 ;; esac
[[ ! -e $logs/$phase-preflight.log ]] || exit 2
python3 -B "$logs/static-check.py" "$phase" || exit 3
python3 -B - <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,'bench')
import temp_guard as g
d=g.forbidden_devices(reject_outside_aliases=True)
import json
parent=g.safe_temp_directory(Path('/project/tmp'),Path.cwd(),d)
plan=json.loads(Path('.scratch/lite-t2c-focused-20260927/execution/plan.json').read_text())
p=Path(plan['short_temp_parent'])
assert p.parent==parent and p.resolve(strict=False)==p
if p.exists():g.safe_temp_directory(p,Path.cwd(),d)
p.mkdir(exist_ok=True)
g.safe_temp_directory(p,Path.cwd(),d)
PY
{ date -Is; slot audit; slot status; } > "$logs/$phase-preflight.log" 2>&1
sed -n '1,7p' "$logs/$phase-preflight.log"
rg 'running|queued|^=== 池' "$logs/$phase-preflight.log" || true
