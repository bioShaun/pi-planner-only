#!/usr/bin/env bash
# Usage: run-all.sh [BATCH_DIR]   env: MODES="native lite" REPS=3 MAX_TOTAL_USD=8 RUN_TIMEOUT_SEC=1800 PI_BIN=...
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BATCH_DIR=${1:-/project/tmp/pi-native-lite-simple/$(date +%Y%m%dT%H%M%S)}
mkdir -p "$BATCH_DIR/tmp" && BATCH_DIR=$(cd "$BATCH_DIR" && pwd)
export TMPDIR=$BATCH_DIR/tmp TMP=$BATCH_DIR/tmp TEMP=$BATCH_DIR/tmp
MODES=${MODES:-native lite}; REPS=${REPS:-3}; MAX=${MAX_TOTAL_USD:-8}
echo "run-all: batch $BATCH_DIR modes=[$MODES] reps=$REPS max=\$$MAX"
for rep in $(seq 1 "$REPS"); do
  for mode in $MODES; do
    if ! spent=$(node "$HERE/summarize.mjs" --budget "$BATCH_DIR" "$MAX"); then
      msg="reported total \$${spent:-?} exceeds MAX_TOTAL_USD=\$$MAX before $mode-$rep; remaining runs skipped"
      echo "run-all: STOP: $msg" | tee "$BATCH_DIR/STOPPED.txt"
      break 2
    fi
    bash "$HERE/run-one.sh" "$mode" "$rep" "$BATCH_DIR" || echo "run-all: $mode-$rep failed (exit $?), continuing"
  done
done
node "$HERE/summarize.mjs" "$BATCH_DIR"
echo "run-all: results in $BATCH_DIR/results.md"
