#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/bench-plugin-fixes/trialrun-cont-20260926/execution-20260926
phase=${1:?phase required}
case "$phase" in native-tests|release|gold-verify|final-review|attempt-[2-6]) ;; *) exit 2 ;; esac
[[ -d $logs && -d /project/tmp/ppo-bench ]] || exit 2
[[ ! -e $logs/$phase-preflight.log ]] || { echo "Existing preflight evidence; choose a new execution round."; exit 2; }
mkdir -p /project/tmp/ppo-bench/ticket11-closeout-20260926 || exit 2
{
  date -Is
  slot audit
  audit_rc=$?
  slot status
  status_rc=$?
  printf 'audit_exit=%s status_exit=%s\n' "$audit_rc" "$status_rc"
} > "$logs/$phase-preflight.log" 2>&1
sed -n '1,7p' "$logs/$phase-preflight.log"
rg 'running|queued|audit_exit|^=== 池' "$logs/$phase-preflight.log" || true
(( audit_rc == 0 && status_rc == 0 ))
