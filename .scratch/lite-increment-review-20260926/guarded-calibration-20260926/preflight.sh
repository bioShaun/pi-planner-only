#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/guarded-calibration-20260926
phase=${1:?phase required}
case "$phase" in gold|attempt-[1-3]) ;; *) exit 2 ;; esac
[[ -d $logs && ! -e $logs/$phase-preflight.log ]] || exit 2
python3 -B - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0,'bench')
import temp_guard as g
devices=g.forbidden_devices(reject_outside_aliases=True)
parent=g.safe_temp_directory(Path('/project/tmp/ppo-bench'),Path.cwd(),devices)
directory=parent/'opus-guarded-20260926'
if directory.exists():g.safe_temp_directory(directory,Path.cwd(),devices)
directory.mkdir(exist_ok=True)
g.safe_temp_directory(directory,Path.cwd(),devices)
PY
[[ $? == 0 ]] || exit 3
{ date -Is; slot audit; a=$?; slot status; s=$?; printf 'audit_exit=%s status_exit=%s\n' "$a" "$s"; } > "$logs/$phase-preflight.log" 2>&1
sed -n '1,7p' "$logs/$phase-preflight.log"
rg 'running|queued|audit_exit|^=== 池' "$logs/$phase-preflight.log" || true
(( a == 0 && s == 0 ))
