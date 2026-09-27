#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-cross-task-next-20260926/execution
n=${1:?ordinal}
case "$n" in 1|2|3|4) ;; *) exit 2 ;; esac
[[ -f $logs/preflight-complete.json && -f $logs/attempt-$n-preflight.log && ! -e $logs/attempt-$n.started ]] || exit 2
read -r task arm < <(python3 -B - "$n" <<'PY'
import json,sys
r=json.load(open('.scratch/lite-cross-task-next-20260926/plan.json'))['order'][int(sys.argv[1])-1]
print(r['task'],r['arm'])
PY
)
[[ -n $task && -n $arm ]] || exit 2
out=/project/tmp/ppo-bench/results/opus-cross-task-t1-t2b-20260926
tmp=/project/tmp/ppo-bench/opus-cross-task-t1-t2b-20260926/$task-$arm-1
[[ ! -e $out/STOP && ! -e $out/runs/$task-$arm-1.jsonl && ! -e $out/runs/$task-$arm-1.meta.json ]] || exit 2
python3 -B - "$logs" "$n" "$out" "$tmp" <<'PY'
from pathlib import Path
import json,hashlib,sys
sys.path.insert(0,'bench')
import temp_guard as g
logs=Path(sys.argv[1]);n=int(sys.argv[2]);out=Path(sys.argv[3]);tmp=Path(sys.argv[4]);p=logs.parent
plan=json.loads((p/'plan.json').read_text())
assert plan['authorization']['paid_execution'] is True and plan['max_attempts']==4
assert json.loads((logs/'preflight-complete.json').read_text())['ready'] is True
for k,v in json.loads((p/'freeze/execution-source.sha256.json').read_text()).items():assert hashlib.sha256(Path(k).read_bytes()).hexdigest()==v,k
s=json.loads(Path('/home/tcuni-claw/.pi/agent/settings.json').read_text())
assert {k:s[k] for k in ['defaultThinkingLevel','defaultProvider','defaultModel','compaction'] if k in s}==json.loads((p/'freeze/root-settings.json').read_text())
assert {k:s.get('subagents',{}).get(k) for k in ['defaultModel','agentOverrides']}==json.loads((p/'freeze/child-config.json').read_text())
if n>1:
 prior=json.loads((logs/f'after-attempt-{n-1}.json').read_text())
 assert prior['continue'] is True and prior['attempts']==n-1 and prior['actual_total']<10
else:assert not out.exists(),'New campaign required'
devices=g.forbidden_devices(reject_outside_aliases=True)
g.safe_output_path(str(out),devices);g.safe_temp_directory(tmp.parent,Path.cwd(),devices)
out.mkdir(exist_ok=True);tmp.mkdir(exist_ok=False);g.safe_temp_directory(tmp,Path.cwd(),devices)
clone=Path('/project/tmp/ppo-bench/clones')/(out.name+'-'+tmp.name)
assert not clone.exists(),'Refuse to replace any existing clone'
if n==1:(out/'campaign.json').write_bytes((p/'plan.json').read_bytes())
PY
[[ $? == 0 ]] || exit 3
date -Is > "$logs/attempt-$n.started"
slot cpu -- env TMPDIR="$tmp" TMP="$tmp" TEMP="$tmp" PYTHONDONTWRITEBYTECODE=1 BENCH_OUT="$out" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 BENCH_MAX_ATTEMPTS=1 BENCH_ATTEMPT=1 BENCH_SKIP_HEALTH=1 BENCH_KEEP_CLONE=1 bash bench/run.sh "$task" "$arm" 1 > "$logs/attempt-$n.console.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/attempt-$n.exit"
date -Is > "$logs/attempt-$n.finished"
tail -8 "$logs/attempt-$n.console.log"
exit "$rc"
