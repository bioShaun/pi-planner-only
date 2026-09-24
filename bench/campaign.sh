#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAME=${1:?usage: campaign.sh <campaign-name> <reps> <tasks-csv> <arms-csv> [--resume|--dry-run]}
REPS=${2:?}; TASKS_CSV=${3:?}; ARMS_CSV=${4:?}; MODE=${5:-}
[[ $REPS =~ ^[1-9][0-9]*$ ]] || { echo 'reps must be positive integer' >&2; exit 2; }
[[ -z $MODE || $MODE == --resume || $MODE == --dry-run ]] || { echo 'fifth arg must be --resume or --dry-run' >&2; exit 2; }
IFS=, read -r -a TASKS <<< "$TASKS_CSV"; IFS=, read -r -a ARMS <<< "$ARMS_CSV"
OUT=/project/tmp/ppo-bench/results/$NAME; mkdir -p "$OUT"
if [[ -d $OUT/runs ]] && compgen -G "$OUT/runs/*" >/dev/null && [[ $MODE != --resume && $MODE != --dry-run ]]; then echo "runs already exist at $OUT/runs (use --resume)" >&2; exit 2; fi
mkdir -p "$OUT/runs"
{
  printf '\n=== %s campaign=%s ===\n' "$(date -Is)" "$NAME"
  echo '$ slot audit'; slot audit 2>&1 || true
  echo '$ slot status'; slot status 2>&1 || true
} | tee -a "$OUT/campaign.log"
ORDER=$(python3 - "$NAME" "$REPS" "$TASKS_CSV" "$ARMS_CSV" <<'PY'
import hashlib,random,sys
name,reps,tasks,arms=sys.argv[1:]; tasks=tasks.split(','); arms=arms.split(',')
for rep in range(1,int(reps)+1):
 for task in tasks:
  seed=int.from_bytes(hashlib.sha256(f'{name}+{rep}+{task}'.encode()).digest()[:8],'big')
  order=arms[:]; random.Random(seed).shuffle(order)
  print(f'{rep}\t{task}\t{seed}\t'+','.join(order))
PY
)
sha=$(git -C "$ROOT" rev-parse HEAD)
python3 - "$OUT/campaign.json" "$NAME" "$REPS" "$TASKS_CSV" "$ARMS_CSV" "$sha" "$ORDER" <<'PY'
import json,sys,datetime
p,n,reps,tasks,arms,sha,order=sys.argv[1:]
data={'name':n,'reps':int(reps),'tasks':tasks.split(','),'arms':arms.split(','),'repo_head':sha,'created':datetime.datetime.now().astimezone().isoformat(),'order':[{'rep':int(x.split('\t')[0]),'task':x.split('\t')[1],'seed':int(x.split('\t')[2]),'arms':x.split('\t')[3].split(',')} for x in order.splitlines()]}
open(p,'w').write(json.dumps(data,indent=2)+'\n')
PY
printf 'Order:\n%s\n' "$ORDER" | tee -a "$OUT/campaign.log"
while IFS=$'\t' read -r rep task seed arms_order; do
  IFS=, read -r -a ordered <<< "$arms_order"
  for arm in "${ordered[@]}"; do
    id=$task-$arm-$rep
    if [[ $MODE == --resume && -f $OUT/runs/$id.eval.json ]]; then echo "skip $id (evaluated)" | tee -a "$OUT/campaign.log"; continue; fi
    cmd=(env "BENCH_OUT=$OUT" "$ROOT/bench/run.sh" "$task" "$arm" "$rep")
    if [[ $MODE == --dry-run ]]; then { printf 'DRY RUN slot cpu -b --'; printf ' %q' "${cmd[@]}"; printf '\n'; } | tee -a "$OUT/campaign.log"; else
      output=$(slot cpu -b -- "${cmd[@]}" 2>&1) || { printf '%s\n' "$output" | tee -a "$OUT/campaign.log"; exit 1; }
      printf '%s submission=%s slot_job=%s\n' "$(date -Is)" "$id" "$output" | tee -a "$OUT/campaign.log"
    fi
  done
done <<< "$ORDER"
