#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-cross-task-next-20260926
task=${1:?T1 or T2b}
[[ $task == T1 || $task == T2b ]] || exit 2
[[ -f $logs/$task-resource-preflight.log && ! -e $logs/$task-validation.log ]] || exit 2
slot cpu -- env TMPDIR="/project/tmp/ppo-bench/cross-task-preflight-20260926/$task" PYTHONDONTWRITEBYTECODE=1 python3 -B "$logs/check-task.py" "$task" > "$logs/$task-validation.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/$task-validation.exit"
tail -5 "$logs/$task-validation.log"
exit "$rc"
