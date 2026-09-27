#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/tcuni-claw/pi/pi-planner-only
EFFORT=$ROOT/.scratch/lite-t2c-preparation-20260927
PYTHON=/public/scripts/tc-probe-design-v2/.venv/bin/python
TEMP_PARENT=/project/tmp/ppo-bench
[[ -d $EFFORT && -d $TEMP_PARENT && -f $EFFORT/task-source.bundle ]] || exit 2

RUN=$(mktemp -d "$EFFORT/validation.XXXXXXXX")
VALIDATION_TEMP=$(mktemp -d "$TEMP_PARENT/t2c-validation.XXXXXXXX")
export TMPDIR=$VALIDATION_TEMP TMP=$VALIDATION_TEMP TEMP=$VALIDATION_TEMP
export PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=src
printf '%s\n' "run=$RUN" "TMPDIR=$TMPDIR" > "$RUN/metadata.log"
"$PYTHON" -V >> "$RUN/metadata.log" 2>&1
"$PYTHON" -m pytest --version >> "$RUN/metadata.log" 2>&1
slot audit > "$RUN/slot-audit.log" 2>&1
slot status > "$RUN/slot-status.log" 2>&1
if ! rg -q '没发现绕过 slot 的重进程' "$RUN/slot-audit.log"; then
  echo "Inspect $RUN/slot-audit.log before running heavy checks" >&2
  exit 3
fi
echo "Queued validation in slot cpu; evidence: $RUN"
slot cpu -- python3 -B "$EFFORT/validation-temp-guard.py" "$RUN" > "$RUN/guard.log" 2>&1
tail -5 "$RUN/guard.log"
exit $?
