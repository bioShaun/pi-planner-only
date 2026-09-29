#!/usr/bin/env bash
# Wait for rdt-r2m (slot jobs 2553,2554), set worker thinking=high, run rdt-r2h, ALWAYS restore worker thinking=medium.
set -uo pipefail
REPO=/home/tcuni-claw/pi/pi-planner-only
LOG=$REPO/.scratch/root-decomp-trial-20260928/trial.log
SET=$HOME/.pi/agent/settings.json
R2M=/project/tmp/ppo-bench/results/rdt-r2m
R2H=/project/tmp/ppo-bench/results/rdt-r2h
export TMPDIR=/project/tmp
cd "$REPO"
say() { printf '%s chain-r2h: %s\n' "$(date -Is)" "$*" >> "$LOG"; }
setw() { python3 - "$SET" "$1" <<'PY'
import json,sys
p,v=sys.argv[1:]
s=json.load(open(p)); s['subagents']['agentOverrides']['worker']['thinking']=v
json.dump(s,open(p,'w'),indent=2,ensure_ascii=False)
PY
}
while slot queue cpu 2>&1 | grep -Eq '^(2553|2554) +(running|queued)'; do sleep 60; done
python3 bench/summarize.py $R2M/runs --weight actual --json /project/tmp/rdt/r2m-summary.json > /project/tmp/rdt/r2m-summary.txt 2>&1
say "r2m finished; STOP=$([[ -f $R2M/STOP ]] && echo yes || echo no); summary /project/tmp/rdt/r2m-summary.txt"
if [[ -f $R2M/STOP ]]; then say "r2m has STOP, NOT launching r2h"; exit 0; fi
trap 'setw medium; say "restored worker thinking=medium"' EXIT
setw high; say "worker thinking=high set"
out=$(BENCH_RUN_TIMEOUT=5400 BENCH_MAX_ATTEMPTS=1 bench/campaign.sh rdt-r2h 1 T3,T2b lite-tds-strict-treat --parallel 2 2>&1)
say "launched r2h: $(tail -2 <<<"$out" | tr '\n' ' ')"
jobs=$(grep -o 'slot_job=[0-9]*' <<<"$out" | cut -d= -f2 | paste -sd'|')
[[ -n $jobs ]] || { say "no slot jobs found, abort"; exit 1; }
while slot queue cpu 2>&1 | grep -Eq "^($jobs) +(running|queued)"; do sleep 60; done
python3 bench/summarize.py $R2H/runs --weight actual --json /project/tmp/rdt/r2h-summary.json > /project/tmp/rdt/r2h-summary.txt 2>&1
say "r2h finished; STOP=$([[ -f $R2H/STOP ]] && echo yes || echo no); summary /project/tmp/rdt/r2h-summary.txt"
