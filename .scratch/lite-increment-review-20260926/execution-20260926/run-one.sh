#!/usr/bin/env bash
set -uo pipefail
cd /home/tcuni-claw/pi/pi-planner-only || exit 2
logs=.scratch/lite-increment-review-20260926/execution-20260926
n=${1:?ordinal required}
case "$n" in
  1) arm=direct-opus-calibration ;;
  2) arm=native-opus-calibration ;;
  3) arm=lite-opus-calibration ;;
  *) exit 2 ;;
esac
out=/project/tmp/ppo-bench/results/target-root-t3-opus-calibration-20260926
id=T3-$arm-1
[[ -d /project/tmp/ppo-bench/results && -d /project/tmp/ppo-bench/opus-calibration-20260926 ]] || exit 2
[[ -f $logs/attempt-$n-preflight.log && ! -e $logs/attempt-$n.started ]] || exit 2
[[ ! -e $out/STOP && ! -e $out/runs/$id.meta.json && ! -e $out/runs/$id.jsonl ]] || exit 2
python3 -B - "$logs" "$n" "$out" <<'PY'
from pathlib import Path
import hashlib,json,sys
logs=Path(sys.argv[1]); n=int(sys.argv[2]); out=Path(sys.argv[3]); base=logs.parent
assert json.loads((logs/'authorization.json').read_text())['max_attempts']==3
assert (base/'native.exit').read_text().strip()=='0' and (base/'release.exit').read_text().strip()=='0'
assert (logs/'gold-verify.exit').read_text().strip()=='0'
for p,h in json.loads((logs/'freeze/prepared-source.sha256.json').read_text()).items():
 assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,p
settings=json.loads(Path('/home/tcuni-claw/.pi/agent/settings.json').read_text())
assert {k:settings[k] for k in ['defaultThinkingLevel','defaultProvider','defaultModel','compaction'] if k in settings}==json.loads((logs/'freeze/root-settings.json').read_text())
frozen=json.loads((logs/'freeze/pricing-and-model-provenance.json').read_text())
assert {k:settings.get('subagents',{}).get(k) for k in ['defaultModel','agentOverrides']}==frozen['child_config']
provider=json.loads(Path('/home/tcuni-claw/.pi/agent/models.json').read_text())['providers']['tcuni-claude']
model=next(m for m in provider['models'] if m['id']=='claude-opus-5-5'); cost=model['cost']
assert {'in':cost['input'],'out':cost['output'],'cacheRead':cost['cacheRead'],'cacheWrite':cost['cacheWrite']}==frozen['price_per_million']
plugin=Path('/project/tmp/ppo-bench/plugins/ad51067da379edf5735cb9b03d70f17bda331675')
if plugin.exists():
 for p,h in json.loads((logs/'freeze/prepared-source.sha256.json').read_text()).items():
  if not p.startswith('bench/'):
   assert hashlib.sha256((plugin/p).read_bytes()).hexdigest()==h,p
if n>1:
 prior=json.loads((logs/f'after-attempt-{n-1}.json').read_text())
 assert prior['continue'] is True and prior['attempts']==n-1 and prior['actual_total']<10
else:
 assert not out.exists(), 'New campaign directory must not already exist'
out.mkdir(exist_ok=True)
if n==1:
 plan=json.loads((logs/'freeze/order.json').read_text());plan.update(status='running',budget_basis='actual',checkpoint_budget_usd=10)
 (out/'campaign.json').write_text(json.dumps(plan,indent=2)+'\n')
PY
[[ $? == 0 ]] || exit 2
date -Is > "$logs/attempt-$n.started"
slot cpu -- env TMPDIR=/project/tmp/ppo-bench/opus-calibration-20260926 PYTHONDONTWRITEBYTECODE=1 BENCH_OUT="$out" BENCH_PLUGIN_REF=ad51067da379edf5735cb9b03d70f17bda331675 BENCH_MAX_ATTEMPTS=1 BENCH_ATTEMPT=1 BENCH_SKIP_HEALTH=1 BENCH_KEEP_CLONE=0 bash bench/run.sh T3 "$arm" 1 > "$logs/attempt-$n.console.log" 2>&1
rc=$?
printf '%s\n' "$rc" > "$logs/attempt-$n.exit"
date -Is > "$logs/attempt-$n.finished"
tail -8 "$logs/attempt-$n.console.log"
exit "$rc"
