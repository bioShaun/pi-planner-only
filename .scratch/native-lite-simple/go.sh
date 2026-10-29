#!/usr/bin/env bash
# The one command: bash .scratch/native-lite-simple/go.sh
set -euo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BATCH_DIR=/project/tmp/pi-native-lite-simple/$(date +%Y%m%dT%H%M%S)
mkdir -p "$BATCH_DIR/tmp"
export TMPDIR=$BATCH_DIR/tmp TMP=$BATCH_DIR/tmp TEMP=$BATCH_DIR/tmp
{
  echo "## $(date -Iseconds) slot audit"; slot audit || echo "(slot audit exit $?)"
  echo "## $(date -Iseconds) slot status"; slot status || echo "(slot status exit $?)"
} >"$BATCH_DIR/slot-preflight.log" 2>&1
cat "$BATCH_DIR/slot-preflight.log"
echo "go: batch $BATCH_DIR (log: $BATCH_DIR/run-all.log)"
slot cpu -- bash "$HERE/run-all.sh" "$BATCH_DIR" 2>&1 | tee "$BATCH_DIR/run-all.log"
