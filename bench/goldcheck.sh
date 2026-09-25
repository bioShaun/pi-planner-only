#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TASK_ID=${1:?usage: bench/goldcheck.sh <task-id>}
TASK_FILE=$ROOT/bench/tasks/$TASK_ID.json
[[ -f $TASK_FILE ]] || { echo "missing task: $TASK_ID" >&2; exit 2; }
readarray -t CONFIG < <(python3 - "$TASK_FILE" <<'PY'
import json,sys
t=json.load(open(sys.argv[1]))
for value in (t['repo'],t['parent'],t['target']): print(value)
PY
)
REPO=${CONFIG[0]} PARENT=${CONFIG[1]} TARGET=${CONFIG[2]}
CLONE=/project/tmp/ppo-bench/clones/gold-$TASK_ID
OUT_PREFIX=/project/tmp/ppo-bench/gold/$TASK_ID
mkdir -p "$(dirname "$CLONE")" "$(dirname "$OUT_PREFIX")"
BASE_LINE=$("$ROOT/bench/prepare-clone.sh" "$TASK_ID" "$CLONE")
BASE=${BASE_LINE#BASE=}
git -C "$REPO" diff --binary "$PARENT" "$TARGET" -- . ':(exclude)tests' | git -C "$CLONE" apply --index
ARM=gold ID=$(basename "$OUT_PREFIX") "$ROOT/bench/evaluate.sh" "$TASK_ID" "$CLONE" "$BASE" "$OUT_PREFIX"
readarray -t RESULT < <(python3 - "$OUT_PREFIX.eval.json" <<'PY'
import json,sys
e=json.load(open(sys.argv[1]))
print('true' if e['pass'] else 'false')
print(json.dumps(e['new_failures']))
print(json.dumps(e['target_failed']))
PY
)
if [[ ${RESULT[0]} == true ]]; then
  echo "GOLD $TASK_ID PASS"
  RC=0
else
  echo "GOLD $TASK_ID FAIL new_failures=${RESULT[1]} target_failed=${RESULT[2]}"
  RC=1
fi
if [[ ${BENCH_KEEP_CLONE:-0} != 1 ]]; then rm -rf "$CLONE"; fi
exit "$RC"
