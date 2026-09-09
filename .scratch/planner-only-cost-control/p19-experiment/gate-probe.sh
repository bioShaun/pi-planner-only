#!/usr/bin/env bash
set -euo pipefail

ROOT=/home/tcuni-claw/pi/pi-planner-only
BASE="$ROOT/.scratch/planner-only-cost-control/p19-experiment"
RUN="$BASE/runs"
WORK="$BASE/gate-probe-work"
FAKE="$WORK/bin"
mkdir -p "$FAKE"
cat > "$FAKE/pi" <<'FAKE_PI'
#!/usr/bin/env bash
set -euo pipefail
printf 'invoked\n' > "${PI_GATE_PROBE_WORK}/pi-was-invoked"
exit 42
FAKE_PI
chmod +x "$FAKE/pi"
export PI_GATE_PROBE_WORK="$WORK"
export PATH="$FAKE:$PATH"

run_probe() {
  local name=$1
  shift
  set +e
  "$@" >"$WORK/$name.stdout" 2>"$WORK/$name.stderr"
  local code=$?
  set -e
  printf '%s exit=%s\n' "$name" "$code"
  printf '%s stdout: ' "$name"
  tail -n 2 "$WORK/$name.stdout" 2>/dev/null || true
  printf '%s stderr: ' "$name"
  tail -n 2 "$WORK/$name.stderr" 2>/dev/null || true
  PROBE_CODE=$code
  return 0
}

rm -rf "$RUN/session-SEED"
rm -f "$WORK/pi-was-invoked"
run_probe A env CAP_USD=0.12 bash "$BASE/run.sh" SMOKE
A=$PROBE_CODE
[[ $A -eq 1 && ! -e "$WORK/pi-was-invoked" ]]

rm -f "$WORK/pi-was-invoked"
unset CAP_USD
run_probe B bash "$BASE/run.sh" SMOKE
B=$PROBE_CODE
[[ $B -ne 0 && -e "$WORK/pi-was-invoked" ]]

rm -f "$WORK/pi-was-invoked"
mkdir -p "$RUN/session-SEED"
printf '%s\n' '{"type":"message","message":{"usage":{"cost":{"total":0.10}}}}' > "$RUN/session-SEED/seed.jsonl"
unset CAP_USD
run_probe C bash "$BASE/run.sh" SMOKE
C=$PROBE_CODE
[[ $C -eq 1 && ! -e "$WORK/pi-was-invoked" ]]
grep -q 'SPEND GATE' "$WORK/C.stdout" "$WORK/C.stderr"
rm -rf "$RUN/session-SEED"

printf 'gate probes passed: A=%s B=%s C=%s\n' "$A" "$B" "$C"
