#!/usr/bin/env bash
# usage: campaign.sh [--dry-run]   9 serial runs (3 reps x 3 arms), submitted as one slot lane.
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BASE=/project/tmp/root-model-compare/r1
DRY=0; [[ ${1:-} == --dry-run ]] && DRY=1
SEED=${R1_SEED:-20261007}; BUDGET=${R1_BUDGET:-28}   # $30 phase cap minus ~$2 spent on preparation; per-arm reserves live in ledger.py (opus 8, sonnet 5, dsflash 1.5)
mkdir -p "$BASE/out" "$BASE/lanes"
ORDER=$(python3 - "$SEED" <<'PY'
import random, sys
r = random.Random(int(sys.argv[1]))
for rep in (1, 2, 3):
    arms = ['opus', 'sonnet', 'dsflash']; r.shuffle(arms)
    for a in arms: print(a, rep)
PY
)
python3 -c '
import json,sys
rows=[l.split() for l in sys.stdin.read().splitlines()]
json.dump({"seed":int(sys.argv[2]),"budgetUsd":float(sys.argv[3]),"order":[{"arm":a,"rep":int(r),"id":f"R1-{a}-{r}"} for a,r in rows]},open(sys.argv[1],"w"),indent=2)
' "$BASE/campaign.json" "$SEED" "$BUDGET" <<<"$ORDER"
LANE=$BASE/lanes/lane.sh
{
echo '#!/usr/bin/env bash'
echo 'set -uo pipefail'
echo "BASE=$BASE; HERE=$HERE; BUDGET=$BUDGET"
echo 'export TMPDIR=$BASE/tmp; mkdir -p "$TMPDIR"; OUT=$BASE/out'
cat <<'LANE'
stop() { echo "$(date -Is) $1" >>"$BASE/STOP"; echo "STOP: $1"; exit 1; }
LANE
while read -r arm rep; do
  cat <<LANE
arm=$arm; rep=$rep
if python3 "\$HERE/ledger.py" has-valid "\$OUT" \$arm \$rep; then echo "skip R1-\$arm-\$rep (valid current attempt)"; else
  [[ -e \$BASE/STOP ]] && { echo "STOP exists"; exit 1; }
  pf=\$(python3 "\$HERE/ledger.py" preflight "\$OUT" \$arm "\$BUDGET") || stop "budget: \$pf before R1-\$arm-\$rep"
  echo "preflight R1-\$arm-\$rep: \$pf"
  bash "\$HERE/run_one.sh" \$arm \$rep
  rc=\$?
  st=\$(python3 "\$HERE/ledger.py" streak "\$OUT" \$arm)
  echo "R1-\$arm-\$rep rc=\$rc invalid_streak(\$arm)=\$st cumulative_usd=\$(python3 "\$HERE/ledger.py" total "\$OUT")"
  (( st >= 2 )) && stop "arm \$arm has \$st consecutive invalid attempts at R1-\$arm-\$rep"
fi
LANE
done <<<"$ORDER"
echo 'echo lane_done'
} >"$LANE"
bash -n "$LANE"
echo "order:"; sed 's/^/  /' <<<"$ORDER"
if (( DRY )); then
  echo "--- lane script ($LANE) ---"; cat "$LANE"
  echo "--- would run: slot cpu -b -- bash $LANE (after slot audit/status logged to $BASE/campaign.log)"
  exit 0
fi
audit_out=$(slot audit 2>&1) || true
status_out=$(slot status 2>&1) || true
printf '%s preflight\n$ slot audit\n%s\n$ slot status\n%s\n' "$(date -Is)" "$audit_out" "$status_out" >>"$BASE/campaign.log"
if grep -qF '绕过了 slot' <<<"$audit_out"; then
  echo "REFUSED: heavy processes bypass slot (see $BASE/campaign.log)" >&2; exit 6
fi
job=$(slot cpu -b -- bash "$LANE" 2>&1) || { echo "$job" | tee -a "$BASE/campaign.log"; exit 1; }
printf '%s lane submission=%s slot_job=%s\n' "$(date -Is)" "$LANE" "$job" | tee -a "$BASE/campaign.log"
