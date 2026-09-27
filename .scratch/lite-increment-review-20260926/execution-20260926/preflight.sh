#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/execution-20260926
phase=${1:?phase required}
case "$phase" in environment|gold|attempt-[1-3]) ;; *) exit 2 ;; esac
[[ -d $logs && -d /project/tmp/ppo-bench ]] || exit 2
[[ ! -e $logs/$phase-preflight.log ]] || exit 2
mkdir -p /project/tmp/ppo-bench/opus-calibration-20260926 || exit 2
if [[ $phase == environment ]]; then
  pi --list-models > "$logs/model-list.log" 2>&1
  rc=$?
  printf '%s\n' "$rc" > "$logs/model-list.exit"
  exit "$rc"
fi
{ date -Is; slot audit; a=$?; slot status; s=$?; printf 'audit_exit=%s status_exit=%s\n' "$a" "$s"; } > "$logs/$phase-preflight.log" 2>&1
sed -n '1,7p' "$logs/$phase-preflight.log"
rg 'running|queued|audit_exit|^=== 池' "$logs/$phase-preflight.log" || true
(( a == 0 && s == 0 ))
