#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/temp-guard-fix-20260926/round4
phase=${1:?phase required}
case "$phase" in
  preflight-native|preflight-release|preflight-runtime)
    [[ -d $logs && -d /project/tmp/ppo-bench && ! -e $logs/$phase.log ]] || exit 2
    mkdir -p /project/tmp/ppo-bench/temp-guard-verify-20260926 || exit 2
    { date -Is; slot audit; a=$?; slot status; s=$?; printf 'audit_exit=%s status_exit=%s\n' "$a" "$s"; } > "$logs/$phase.log" 2>&1
    sed -n '1,7p' "$logs/$phase.log"
    rg 'running|queued|audit_exit|^=== 池' "$logs/$phase.log" || true
    (( a == 0 && s == 0 )); exit $?
    ;;
  native) cmd=(python3 -B bench/test_native.py) ;;
  release) cmd=(npm run test:release) ;;
  runtime) cmd=(python3 -B "$logs/runtime-check.py") ;;
  *) exit 2 ;;
esac
[[ -f $logs/preflight-$phase.log && ! -e $logs/$phase.log ]] || exit 2
date -Is > "$logs/$phase.started"
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/temp-guard-verify-20260926 PYTHONDONTWRITEBYTECODE=1 "${cmd[@]}" > "$logs/$phase.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/$phase.exit"
date -Is > "$logs/$phase.finished"
cat "$logs/$phase.log"
exit "$rc"
