#!/usr/bin/env bash
# Overnight chain: wait for rdt-r1c lane (slot cpu job 2551) to finish, then launch rep 2 (rdt-r1d)
# only if r1c ended without STOP. Summaries go to /project/tmp/rdt/. Light process; no slot needed.
set -uo pipefail
REPO=/home/tcuni-claw/pi/pi-planner-only
LOG=$REPO/.scratch/root-decomp-trial-20260928/trial.log
R1C=/project/tmp/ppo-bench/results/rdt-r1c
cd "$REPO"
while slot queue cpu 2>&1 | grep -Eq '^2551 +(running|queued)'; do sleep 120; done
TMPDIR=/project/tmp python3 bench/summarize.py $R1C/runs --weight actual --json /project/tmp/rdt/r1c-summary.json > /project/tmp/rdt/r1c-summary.txt 2>&1
printf '%s chain: r1c lane finished; summary in /project/tmp/rdt/r1c-summary.txt\n' "$(date -Is)" >> "$LOG"
if [[ -f $R1C/STOP ]]; then
  printf '%s chain: r1c has STOP (%s); NOT launching r1d\n' "$(date -Is)" "$(tail -1 $R1C/STOP | cut -c1-200)" >> "$LOG"
  exit 0
fi
out=$(BENCH_RUN_TIMEOUT=5400 BENCH_MAX_ATTEMPTS=1 TMPDIR=/project/tmp bench/campaign.sh rdt-r1d 1 T3,T2b,T2 lite-tds-strict-base,lite-tds-strict-treat --parallel 1 2>&1)
printf '%s chain: launched rdt-r1d\n%s\n' "$(date -Is)" "$(tail -3 <<<"$out")" >> "$LOG"
job=$(grep -o 'slot_job=[0-9]*' <<<"$out" | tail -1 | cut -d= -f2)
[[ -n $job ]] || exit 1
while slot queue cpu 2>&1 | grep -Eq "^$job +(running|queued)"; do sleep 300; done
TMPDIR=/project/tmp python3 bench/summarize.py /project/tmp/ppo-bench/results/rdt-r1d/runs --weight actual --json /project/tmp/rdt/r1d-summary.json > /project/tmp/rdt/r1d-summary.txt 2>&1
printf '%s chain: r1d lane (slot job %s) finished; STOP=%s; summary in /project/tmp/rdt/r1d-summary.txt\n' "$(date -Is)" "$job" "$([[ -f /project/tmp/ppo-bench/results/rdt-r1d/STOP ]] && echo yes || echo no)" >> "$LOG"
