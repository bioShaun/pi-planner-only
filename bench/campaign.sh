#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
NAME=${1:?usage: campaign.sh <campaign-name> <reps> <tasks-csv> <arms-csv> [--resume] [--dry-run] [--parallel N]}
REPS=${2:?}; TASKS_CSV=${3:?}; ARMS_CSV=${4:?}; shift 4
RESUME=0; DRY=0; PARALLEL=4
while (($#)); do
  case $1 in
    --resume) RESUME=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --parallel) (($# >= 2)) || { echo '--parallel requires N' >&2; exit 2; }; PARALLEL=$2; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ $REPS =~ ^[1-9][0-9]*$ && $PARALLEL =~ ^[1-9][0-9]*$ ]] || { echo 'reps and parallel must be positive integers' >&2; exit 2; }
# Each run gets up to MAX_ATTEMPTS tries; failed attempts go to void/ and only the last one writes STOP.
MAX_ATTEMPTS=${BENCH_MAX_ATTEMPTS:-2}; RETRY_DELAY=${BENCH_RETRY_DELAY:-120}
[[ $MAX_ATTEMPTS =~ ^[1-9][0-9]*$ && $RETRY_DELAY =~ ^[0-9]+$ ]] || { echo 'BENCH_MAX_ATTEMPTS must be a positive integer and BENCH_RETRY_DELAY a non-negative integer' >&2; exit 2; }
IFS=, read -r -a TASKS <<< "$TASKS_CSV"; IFS=, read -r -a ARMS <<< "$ARMS_CSV"
OUT=/project/tmp/ppo-bench/results/$NAME; mkdir -p "$OUT"
if (( RESUME )); then
  if [[ -f $OUT/STOP && $DRY == 0 ]]; then mv "$OUT/STOP" "$OUT/STOP.$(date +%Y%m%dT%H%M%S)"; echo "renamed STOP for resume" | tee -a "$OUT/campaign.log"; fi
elif [[ -f $OUT/STOP ]]; then echo "STOP exists at $OUT/STOP (use --resume)" >&2; exit 2
fi
if [[ -d $OUT/runs ]] && compgen -G "$OUT/runs/*" >/dev/null && (( ! RESUME && ! DRY )); then echo "runs already exist at $OUT/runs (use --resume)" >&2; exit 2; fi
mkdir -p "$OUT/runs" "$OUT/lanes"
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
python3 - "$OUT/campaign.json" "$NAME" "$REPS" "$TASKS_CSV" "$ARMS_CSV" "$sha" "$ORDER" "$PARALLEL" <<'PY'
import json,sys,datetime
p,n,reps,tasks,arms,sha,order,parallel=sys.argv[1:]
data={'name':n,'reps':int(reps),'tasks':tasks.split(','),'arms':arms.split(','),'repo_head':sha,'parallel':int(parallel),'created':datetime.datetime.now().astimezone().isoformat(),'order':[{'rep':int(x.split('\t')[0]),'task':x.split('\t')[1],'seed':int(x.split('\t')[2]),'arms':x.split('\t')[3].split(',')} for x in order.splitlines()]}
open(p,'w').write(json.dumps(data,indent=2)+'\n')
PY
printf 'Order:\n%s\n' "$ORDER" | tee -a "$OUT/campaign.log"
ids=(); declare -A skip=() taskof=() armof=() repof=()
while IFS=$'\t' read -r rep task seed arms_order; do
  IFS=, read -r -a ordered <<< "$arms_order"
  for arm in "${ordered[@]}"; do
    id=$task-$arm-$rep; ids+=("$id"); taskof[$id]=$task; armof[$id]=$arm; repof[$id]=$rep
    if (( RESUME )) && [[ -f $OUT/runs/$id.eval.json ]]; then
      valid=$(python3 - "$OUT/runs/$id.eval.json" "$OUT/runs/$id.jsonl" "$ROOT/bench" <<'PY'
import json,sys
try: e=json.load(open(sys.argv[1]))
except (OSError,ValueError): e={}
if 'valid' in e: print('true' if e['valid'] else 'false')
else:
 sys.path.insert(0,sys.argv[3])
 from runcheck import check
 print('true' if check(sys.argv[2])['valid'] else 'false')
PY
)
      if [[ $valid == true ]]; then skip[$id]=1; fi
    fi
  done
done <<< "$ORDER"
lanes=${#ids[@]}; (( lanes > PARALLEL )) && lanes=$PARALLEL
for ((k=0;k<lanes;k++)); do
  lane=$OUT/lanes/lane-$k.sh
  # No set -e: a failed run must not end the lane; provider errors stop lanes via $OUT/STOP.
  { printf '#!/usr/bin/env bash\nset -uo pipefail\nexec >>%q 2>&1\nOUT=%q\n' "$OUT/lanes/lane-$k.log" "$OUT";
    for ((i=k;i<${#ids[@]};i+=lanes)); do
      id=${ids[i]}; [[ ${skip[$id]:-0} == 1 ]] && continue
      printf '[[ -f "$OUT/STOP" ]] && { echo %q; exit 0; }\n' "lane $k: STOP present, exiting before $id"
      if (( RESUME )); then
        void="$OUT/void/$id-$(date +%Y%m%dT%H%M%S)"
        printf 'mkdir -p %q\n' "$void"
        printf 'shopt -s nullglob; files=("$OUT/runs/%s."*); if ((${#files[@]})); then mv "${files[@]}" %q/; fi\n' "$id" "$void"
      fi
      # run.sh exit 5 = failed attempt with attempts left: archive it, wait, retry unless STOP appeared meanwhile.
      printf 'for attempt in $(seq 1 %d); do\n' "$MAX_ATTEMPTS"
      printf '  env BENCH_OUT=%q BENCH_ATTEMPT="$attempt" BENCH_MAX_ATTEMPTS=%d %q %q %q %q; rc=$?\n' "$OUT" "$MAX_ATTEMPTS" "$ROOT/bench/run.sh" "${taskof[$id]}" "${armof[$id]}" "${repof[$id]}"
      printf '  (( rc == 5 )) || break\n'
      printf '  d="$OUT/void/%s-attempt$attempt-$(date +%%Y%%m%%dT%%H%%M%%S)"; mkdir -p "$d"; shopt -s nullglob; files=("$OUT/runs/%s."*); if ((${#files[@]})); then mv "${files[@]}" "$d"/; fi\n' "$id" "$id"
      printf '  echo %q; sleep %d\n' "lane $k: $id attempt failed, retrying" "$RETRY_DELAY"
      printf '  [[ -f "$OUT/STOP" ]] && { echo %q; exit 0; }\n' "lane $k: STOP present, abandoning retry of $id"
      printf 'done\n'
    done
  } > "$lane"
  chmod +x "$lane"
  lane_ids=(); for ((i=k;i<${#ids[@]};i+=lanes)); do [[ ${skip[${ids[i]}]:-0} == 1 ]] || lane_ids+=("${ids[i]}"); done
  printf -v lane_list '%s ' "${lane_ids[@]}"
  if (( DRY )); then
    { echo "lane $k: ${lane_list% }"; echo "slot cpu -b -- bash $lane"; } | tee -a "$OUT/campaign.log"
  fi
done
if (( DRY )); then exit 0; fi
{
  echo '$ slot audit'; slot audit 2>&1 || true
  echo '$ slot status'; slot status 2>&1 || true
} | tee -a "$OUT/campaign.log"
for ((k=0;k<lanes;k++)); do
  lane=$OUT/lanes/lane-$k.sh
  [[ -s $lane ]] || continue
  output=$(slot cpu -b -- bash "$lane" 2>&1) || { printf '%s\n' "$output" | tee -a "$OUT/campaign.log"; exit 1; }
  printf '%s lane=%s submission=%s slot_job=%s\n' "$(date -Is)" "$k" "$lane" "$output" | tee -a "$OUT/campaign.log"
done
