#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-t2c-focused-20260927/execution
n=${1:?ordinal}
case "$n" in 1|2) ;; *) exit 2 ;; esac
[[ -f $logs/preflight-complete.json && -f $logs/attempt-$n-preflight.log && -f $logs/attempt-$n-static.json && ! -e $logs/attempt-$n.started ]] || exit 2
python3 -B "$logs/static-check.py" "attempt-$n" || exit 3
read -r task arm tmp < <(python3 -B - "$n" <<'PY'
import json,sys
r=json.load(open('.scratch/lite-t2c-focused-20260927/execution/plan.json'))['order'][int(sys.argv[1])-1]
paths=json.load(open('.scratch/lite-t2c-focused-20260927/execution/paths.json'))
print(r['task'],r['arm'],paths[f"{r['task']}-{r['arm']}-1"]['tmpdir'])
PY
)
[[ -n $task && -n $arm && -n $tmp ]] || exit 2
out=/project/tmp/ppo-bench/results/opus-t2c-pair-20260927
[[ ! -e $out/STOP && ! -e $out/runs/$task-$arm-1.jsonl && ! -e $out/runs/$task-$arm-1.meta.json && ! -e $out/runs/$task-$arm-1.exit && ! -e $out/runs/$task-$arm-1.native-evidence ]] || exit 2
python3 -B - "$logs" "$n" "$out" "$tmp" <<'PY'
from pathlib import Path
import json,hashlib,sys
sys.path.insert(0,'bench')
import temp_guard as g
logs=Path(sys.argv[1]);n=int(sys.argv[2]);out=Path(sys.argv[3]);tmp=Path(sys.argv[4]);p=logs.parent
plan=json.loads((logs/'plan.json').read_text());authorization=json.loads((logs/'authorization.json').read_text())
assert plan['authorization']['paid_execution'] is True and plan['max_attempts']==2 and plan['parallel']==1 and plan['automatic_retry'] is False
assert plan['checkpoint_budget_usd']==10 and plan['timeout_seconds']==3600 and authorization['scope']==plan['order']
assert authorization.get('external_data_authorized') is True and plan['authorization'].get('external_data_authorized') is True
assert authorization['gateway']==plan['gateway']=='http://<tcuni-claude-proxy>'
assert n in plan['allowed_ordinals']==authorization['allowed_ordinals']==[1,2]
assert plan['prior_attempts']==1 and plan['prior_actual_total']==1.29824603
assert json.loads((p/'acceptance.json').read_text())['final_acceptance']=='PASS'
assert json.loads((logs/'preflight-complete.json').read_text())['ready'] is True
assert all(json.loads((logs/f'attempt-{n}-static.json').read_text())['checks'].values())
for k,v in json.loads((logs/'entry-source.sha256.json').read_text()).items():assert hashlib.sha256(Path(k).read_bytes()).hexdigest()==v,k
for k,v in json.loads((p/'freeze/source.sha256.json').read_text()).items():assert hashlib.sha256(Path(k).read_bytes()).hexdigest()==v,k
s=json.loads(Path('/home/tcuni-claw/.pi/agent/settings.json').read_text())
assert {k:s[k] for k in ['defaultThinkingLevel','defaultProvider','defaultModel','compaction'] if k in s}==json.loads((p/'freeze/root-settings.json').read_text())
assert {k:s.get('subagents',{}).get(k) for k in ['defaultModel','agentOverrides']}==json.loads((p/'freeze/child-config.json').read_text())
if n>1:
 prior=json.loads((logs/f'after-attempt-{n-1}.json').read_text())
 assert prior['continue'] is True and prior['new_attempts']==n-1 and prior['total_attempts']==n and prior['actual_total']<10
 assert (logs/f'attempt-{n-1}.finished').is_file()
else:
 assert not out.exists(),'New segment required; original STOP remains'
 assert plan['prior_actual_total']<10
devices=g.forbidden_devices(reject_outside_aliases=True)
g.safe_output_path(str(out),devices);g.safe_temp_directory(tmp.parent,Path.cwd(),devices)
assert not tmp.exists(),'Fresh per-run temp required'
row=plan['order'][n-1];rid=f"{row['task']}-{row['arm']}-1"
mapping=json.loads((logs/'paths.json').read_text())[rid]
assert mapping['tmpdir']==str(tmp) and mapping['ordinal']==n and tmp.resolve(strict=False)==tmp
clone=Path(mapping['clone'])
assert clone==Path('/project/tmp/ppo-bench/clones')/(out.name+'-'+rid)
assert not clone.exists(),'Refuse to replace any existing clone'
out.mkdir(exist_ok=True);tmp.mkdir(exist_ok=False);g.safe_temp_directory(tmp,Path.cwd(),devices)
if n==1:(out/'campaign.json').write_bytes((logs/'plan.json').read_bytes())
PY
[[ $? == 0 ]] || exit 3
date -Is > "$logs/attempt-$n.started"
slot cpu -- env TMPDIR="$tmp" TMP="$tmp" TEMP="$tmp" PYTHONDONTWRITEBYTECODE=1 BENCH_OUT="$out" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 BENCH_MAX_ATTEMPTS=1 BENCH_ATTEMPT=1 BENCH_SKIP_HEALTH=1 BENCH_KEEP_CLONE=1 bash bench/run.sh "$task" "$arm" 1 > "$logs/attempt-$n.console.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/attempt-$n.exit"
date -Is > "$logs/attempt-$n.finished"
tail -8 "$logs/attempt-$n.console.log"
exit "$rc"
