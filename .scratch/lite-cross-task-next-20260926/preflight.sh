#!/usr/bin/env bash
set -euo pipefail
cd /home/tcuni-claw/pi/pi-planner-only
logs=.scratch/lite-cross-task-next-20260926
task=${1:?T1, T2b or release}
[[ $task == T1 || $task == T2b || $task == release ]] || exit 2
[[ ! -e $logs/$task-resource-preflight.log ]] || exit 2
python3 -B - "$task" <<'PY'
from pathlib import Path
import sys
sys.path.insert(0,'bench')
import temp_guard as g
devices=g.forbidden_devices(reject_outside_aliases=True)
parent=g.safe_temp_directory(Path('/project/tmp/ppo-bench'),Path.cwd(),devices)
root=parent/'cross-task-preflight-20260926'
if root.exists():g.safe_temp_directory(root,Path.cwd(),devices)
root.mkdir(exist_ok=True)
tmp=root/sys.argv[1]
if tmp.exists():g.safe_temp_directory(tmp,Path.cwd(),devices)
tmp.mkdir(exist_ok=True)
g.safe_temp_directory(tmp,Path.cwd(),devices)
PY
{ date -Is; slot audit; slot status; } > "$logs/$task-resource-preflight.log" 2>&1
sed -n '1,7p' "$logs/$task-resource-preflight.log"
rg 'running|queued|^=== 池' "$logs/$task-resource-preflight.log" || true
