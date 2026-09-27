#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/guarded-calibration-20260926
n=${1:?ordinal required}
case "$n" in 1|2|3) ;; *) exit 2 ;; esac
[[ -f $logs/preflight-complete.json && -f $logs/gold-verify.exit ]] || { echo 'BLOCKED: execution preflight incomplete'; exit 3; }
[[ -f $logs/attempt-$n-preflight.log && ! -e $logs/attempt-$n.started ]] || exit 2
arm=$(python3 -B - "$logs/plan.json" "$n" <<'PY'
import json,sys
print(json.load(open(sys.argv[1]))['order'][int(sys.argv[2])-1])
PY
) || exit 2
out=/project/tmp/ppo-bench/results/target-root-t3-opus-guarded-20260926
temp_root=/project/tmp/ppo-bench/opus-guarded-20260926
id=T3-$arm-1
[[ ! -e $out/STOP && ! -e $out/runs/$id.meta.json && ! -e $out/runs/$id.jsonl ]] || exit 2
python3 -B - "$logs" "$n" "$out" "$temp_root/$id" <<'PY'
from pathlib import Path
import hashlib,json,sys
sys.path.insert(0,'bench')
import temp_guard as g
logs=Path(sys.argv[1]); n=int(sys.argv[2]); out=Path(sys.argv[3]); tmp=Path(sys.argv[4])
assert json.loads((logs/'preflight-complete.json').read_text())['ready'] is True
assert (logs/'gold-verify.exit').read_text().strip()=='0'
assert json.loads((logs/'freeze/guard-acceptance.json').read_text())['final_acceptance']=='PASS'
for p,h in json.loads((logs/'freeze/source.sha256.json').read_text()).items():
 assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,p
settings=json.loads(Path('/home/tcuni-claw/.pi/agent/settings.json').read_text())
assert {k:settings[k] for k in ['defaultThinkingLevel','defaultProvider','defaultModel','compaction'] if k in settings}==json.loads((logs/'freeze/root-settings.json').read_text())
cfg=json.loads((logs/'freeze/pricing-and-model-provenance.json').read_text())
assert {k:settings.get('subagents',{}).get(k) for k in ['defaultModel','agentOverrides']}==cfg['child_config']
if n>1:
 prior=json.loads((logs/f'after-attempt-{n-1}.json').read_text())
 assert prior['continue'] is True and prior['attempts']==n-1 and prior['actual_total']<10
else:
 assert not out.exists(),'New campaign required; no reuse or resume'
devices=g.forbidden_devices(reject_outside_aliases=True)
g.safe_output_path(str(out),devices)
g.safe_temp_directory(tmp.parent,Path.cwd(),devices)
out.mkdir(exist_ok=True)
tmp.mkdir(exist_ok=False)
g.safe_temp_directory(tmp,Path.cwd(),devices)
if n==1:(out/'campaign.json').write_bytes((logs/'plan.json').read_bytes())
PY
[[ $? == 0 ]] || exit 3
date -Is > "$logs/attempt-$n.started"
slot cpu -- env TMPDIR="$temp_root/$id" TMP="$temp_root/$id" TEMP="$temp_root/$id" PYTHONDONTWRITEBYTECODE=1 BENCH_OUT="$out" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 BENCH_MAX_ATTEMPTS=1 BENCH_ATTEMPT=1 BENCH_SKIP_HEALTH=1 BENCH_KEEP_CLONE=0 bash bench/run.sh T3 "$arm" 1 > "$logs/attempt-$n.console.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/attempt-$n.exit"
date -Is > "$logs/attempt-$n.finished"
tail -8 "$logs/attempt-$n.console.log"
exit "$rc"
