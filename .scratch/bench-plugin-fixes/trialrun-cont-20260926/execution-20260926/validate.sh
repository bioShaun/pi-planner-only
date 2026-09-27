#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/bench-plugin-fixes/trialrun-cont-20260926/execution-20260926
phase=${1:?phase required}
case "$phase" in
  native-tests) cmd=(python3 -B bench/test_native.py) ;;
  release) cmd=(npm run test:release) ;;
  *) exit 2 ;;
esac
[[ -d /project/tmp/ppo-bench/ticket11-closeout-20260926 ]] || exit 2
[[ -f $logs/$phase-preflight.log && ! -e $logs/$phase.log ]] || exit 2
date -Is > "$logs/$phase.started"
printf '%q ' slot cpu -- env TMPDIR=/project/tmp/ppo-bench/ticket11-closeout-20260926 PYTHONDONTWRITEBYTECODE=1 "${cmd[@]}" > "$logs/$phase.command"
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/ticket11-closeout-20260926 PYTHONDONTWRITEBYTECODE=1 "${cmd[@]}" > "$logs/$phase.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/$phase.exit"
date -Is > "$logs/$phase.finished"
cat "$logs/$phase.log"
exit "$rc"
