#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/bench-plugin-fixes/trialrun-cont-20260926/execution-20260926
ordinal=${1:?global ordinal required}
case "$ordinal" in
  2) arm=lite-pds-head; rep=1 ;;
  3) arm=direct-pds; rep=1 ;;
  4) arm=direct-pds; rep=2 ;;
  5) arm=lite-pds-head; rep=2 ;;
  6) arm=native-pds; rep=2 ;;
  *) exit 2 ;;
esac
id=T3-$arm-$rep
out=/project/tmp/ppo-bench/results/native-pilot-t3-cont-20260926
[[ -d /project/tmp/ppo-bench/results && -d /project/tmp/ppo-bench/ticket11-closeout-20260926 ]] || exit 2
[[ -f $logs/attempt-$ordinal-preflight.log && ! -e $logs/attempt-$ordinal.started ]] || exit 2
[[ ! -e $out/STOP && ! -e $out/runs/$id.meta.json && ! -e $out/runs/$id.jsonl ]] || exit 2
python3 -B - "$logs" "$ordinal" "$out" <<'PY'
from pathlib import Path
import json,sys,hashlib
logs=Path(sys.argv[1]); ordinal=int(sys.argv[2]); out=Path(sys.argv[3])
assert json.loads((logs/'acceptance.json').read_text())['final_acceptance']=='PASS'
assert (logs/'gold-verify.exit').read_text().strip()=='0'
config=json.loads(Path('/home/tcuni-claw/.pi/agent/settings.json').read_text()).get('subagents',{})
assert {k:config.get(k) for k in ['defaultModel','agentOverrides']}==json.loads((logs.parent/'freeze-v3/subagents-config.json').read_text())
for name,h in json.loads((logs.parent/'freeze-v3/source.sha256.json').read_text()).items():
 assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==h,name
if ordinal>2:
 prior=json.loads((logs/f'after-attempt-{ordinal-1}.json').read_text())
 assert prior['continue'] is True
 assert prior['attempts']==ordinal-1 and prior['opus_total']<10
plugin=Path('/project/tmp/ppo-bench/plugins/ad51067da379edf5735cb9b03d70f17bda331675')
if plugin.exists():
 for name,h in json.loads((logs.parent/'freeze-v3/source.sha256.json').read_text()).items():
  if not name.startswith('bench/'):
   assert hashlib.sha256((plugin/name).read_bytes()).hexdigest()==h,name
out.mkdir(exist_ok=True)
if not (out/'continuation.json').exists():
 (out/'continuation.json').write_bytes((logs.parent/'freeze-v3/continuation.json').read_bytes())
PY
[[ $? == 0 ]] || exit 2
date -Is > "$logs/attempt-$ordinal.started"
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/ticket11-closeout-20260926 PYTHONDONTWRITEBYTECODE=1 BENCH_OUT="$out" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 BENCH_MAX_ATTEMPTS=1 BENCH_ATTEMPT=1 BENCH_SKIP_HEALTH=1 BENCH_KEEP_CLONE=0 bash bench/run.sh T3 "$arm" "$rep" > "$logs/attempt-$ordinal.console.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/attempt-$ordinal.exit"
date -Is > "$logs/attempt-$ordinal.finished"
tail -8 "$logs/attempt-$ordinal.console.log"
exit "$rc"
