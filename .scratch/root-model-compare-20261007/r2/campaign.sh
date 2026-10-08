#!/usr/bin/env bash
# usage: campaign.sh [--dry-run] --until <S1|O1|S2|O2>
# Fixed order S1=sonnet-1, O1=opus-1, S2=sonnet-2, O2=opus-2; runs up to and including --until, then ends (a checkpoint).
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BASE=/project/tmp/root-model-compare/r2
DRY=0; UNTIL=
while (( $# )); do
  case $1 in
    --dry-run) DRY=1 ;;
    --until) shift; UNTIL=${1:-} ;;
    *) echo "usage: campaign.sh [--dry-run] --until <S1|O1|S2|O2>" >&2; exit 2 ;;
  esac
  shift
done
ALL=("S1 sonnet 1" "O1 opus 1" "S2 sonnet 2" "O2 opus 2")
ORDER=""
for row in "${ALL[@]}"; do
  ORDER+="$row"$'\n'
  [[ ${row%% *} == "$UNTIL" ]] && break
done
[[ -n $UNTIL && $ORDER == *"$UNTIL "* ]] || { echo "usage: campaign.sh [--dry-run] --until <S1|O1|S2|O2>" >&2; exit 2; }
BUDGET=${R2_BUDGET:-13.0}   # $15 phase cap minus ~$2 spent on preparation; reserves are computed in ledger.py
export R2_BUDGET=$BUDGET
mkdir -p "$BASE/out" "$BASE/lanes"
LANE=$BASE/lanes/lane-$UNTIL.sh
{
echo '#!/usr/bin/env bash'
echo 'set -uo pipefail'
echo "BASE=$BASE; HERE=$HERE; export R2_BUDGET=$BUDGET"
echo 'export TMPDIR=$BASE/tmp; mkdir -p "$TMPDIR"; OUT=$BASE/out'
cat <<'LANE'
stop() { echo "$(date -Is) $1" >>"$BASE/STOP"; echo "STOP: $1"; exit 1; }
LANE
while read -r label arm rep; do
  [[ -n $label ]] || continue
  cat <<LANE
arm=$arm; rep=$rep
if python3 "\$HERE/ledger.py" has-valid "\$OUT" \$arm \$rep; then echo "skip $label R2-\$arm-\$rep (valid current attempt)"; else
  [[ -e \$BASE/STOP ]] && { echo "STOP exists"; exit 1; }
  pf=\$(python3 "\$HERE/ledger.py" preflight "\$OUT" \$arm) || stop "budget: \$pf before $label R2-\$arm-\$rep"
  echo "preflight $label R2-\$arm-\$rep: \$pf"
  bash "\$HERE/run_one.sh" \$arm \$rep
  rc=\$?
  (( rc != 0 )) && stop "$label R2-\$arm-\$rep attempt invalid (run_one.sh rc=\$rc); lane ends for Root inspection"
  st=\$(python3 "\$HERE/ledger.py" streak "\$OUT" \$arm)
  echo "$label R2-\$arm-\$rep rc=\$rc invalid_streak(\$arm)=\$st cumulative_usd=\$(python3 "\$HERE/ledger.py" total "\$OUT")"
  (( st >= 2 )) && stop "arm \$arm has \$st consecutive invalid attempts at $label"
fi
LANE
done <<<"$ORDER"
echo 'echo lane_done'
} >"$LANE"
bash -n "$LANE"
echo "order (until $UNTIL):"; sed 's/^/  /' <<<"$ORDER"
if (( DRY )); then
  while read -r label arm rep; do
    [[ -n $label ]] || continue
    echo "--- $label: run_one.sh $arm $rep --dry-run ---"
    bash "$HERE/run_one.sh" "$arm" "$rep" --dry-run
  done <<<"$ORDER"
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
