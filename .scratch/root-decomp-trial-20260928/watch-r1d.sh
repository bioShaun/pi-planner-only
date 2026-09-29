#!/usr/bin/env bash
# Wait for rdt-r1d lane (slot cpu job 2552, T3+T2b only) then write summary. Light process; no slot needed.
set -uo pipefail
REPO=/home/tcuni-claw/pi/pi-planner-only
LOG=$REPO/.scratch/root-decomp-trial-20260928/trial.log
R1D=/project/tmp/ppo-bench/results/rdt-r1d
cd "$REPO"
while slot queue cpu 2>&1 | grep -Eq '^2552 +(running|queued)'; do sleep 300; done
TMPDIR=/project/tmp python3 bench/summarize.py $R1D/runs --weight actual --json /project/tmp/rdt/r1d-summary.json > /project/tmp/rdt/r1d-summary.txt 2>&1
printf '%s watch: r1d lane (slot job 2552) finished; STOP=%s; summary in /project/tmp/rdt/r1d-summary.txt\n' "$(date -Is)" "$([[ -f $R1D/STOP ]] && echo yes || echo no)" >> "$LOG"
