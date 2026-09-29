#!/usr/bin/env bash
# Serial: rdt-r4b (T2 base x2), then rdt-r4s (T2 treat x1). Stop chain on STOP. No retry, no settings changes.
set -uo pipefail
REPO=/home/tcuni-claw/pi/pi-planner-only
LOG=$REPO/.scratch/root-decomp-trial-20260928/trial.log
RES=/project/tmp/ppo-bench/results
export TMPDIR=/project/tmp BENCH_RUN_TIMEOUT=5400 BENCH_MAX_ATTEMPTS=1
cd "$REPO"
say() { printf '%s chain-r4: %s\n' "$(date -Is)" "$*" >> "$LOG"; }
run() { # name reps arm
  local out jobs
  out=$(bench/campaign.sh "$1" "$2" T2 "$3" --parallel 1 2>&1)
  jobs=$(grep -o 'slot_job=[0-9]*' <<<"$out" | cut -d= -f2 | paste -sd'|')
  say "launched $1: slot_job=${jobs:-NONE}"
  [[ -n $jobs ]] || return 1
  while slot queue cpu 2>&1 | grep -Eq "^($jobs) +(running|queued)"; do sleep 60; done
  python3 bench/summarize.py $RES/$1/runs --weight actual --json /project/tmp/rdt/$1-summary.json > /project/tmp/rdt/$1-summary.txt 2>&1
  say "$1 finished; STOP=$([[ -f $RES/$1/STOP ]] && echo yes || echo no); summary /project/tmp/rdt/$1-summary.txt"
  [[ ! -f $RES/$1/STOP ]]
}
run rdt-r4b 2 lite-tds-strict-base || { say "r4b failed or STOP; NOT launching r4s"; exit 0; }
run rdt-r4s 1 lite-tds-strict-treat
say "chain done"
