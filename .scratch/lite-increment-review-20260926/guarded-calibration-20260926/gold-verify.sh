#!/usr/bin/env bash
set -euo pipefail
root=/home/tcuni-claw/pi/pi-planner-only
cd "$root"
logs=$root/.scratch/lite-increment-review-20260926/guarded-calibration-20260926
clone=/project/tmp/ppo-bench/clones/gold-T3-opus-guarded-20260926
[[ -d /project/tmp/ppo-bench/clones && ! -e $clone ]] || exit 2
export TMPDIR=/project/tmp/ppo-bench/opus-guarded-20260926
export PYTHONDONTWRITEBYTECODE=1
date -Is > "$logs/gold-verify.started"
base_line=$(bench/prepare-clone.sh T3 "$clone")
base=${base_line#BASE=}
python3 -B - "$clone" "$logs" <<'PY'
import json,sys,subprocess
from pathlib import Path
clone,logs=map(Path,sys.argv[1:]); task=json.loads(Path('bench/tasks/T3.json').read_text())
probes={}
for ref in [task['target'],task['target'][:7]]:
 r=subprocess.run(['git','-C',str(clone),'cat-file','-e',ref+'^{commit}'],capture_output=True,text=True)
 probes[ref]=r.returncode
 assert r.returncode!=0,'Answer commit is reachable'
assert subprocess.check_output(['git','-C',str(clone),'remote'],text=True).strip()==''
assert subprocess.check_output(['git','-C',str(clone),'for-each-ref'],text=True).strip()==''
for name in task['tests']:
 assert (clone/name).read_bytes()==subprocess.check_output(['git','-C',task['repo'],'show',task['target']+':'+name])
(logs/'isolation-current.json').write_text(json.dumps({'answer_unreachable':probes,'no_remotes':True,'no_refs':True,'target_tests_match':True,'parent':task['parent'],'clone_base':subprocess.check_output(['git','-C',str(clone),'rev-parse','HEAD'],text=True).strip()},indent=2)+'\n')
patch=subprocess.check_output(['git','-C',task['repo'],'diff','--binary',task['parent'],task['target'],'--','.',':(exclude)tests'])
subprocess.run(['git','-C',str(clone),'apply','--index'],input=patch,check=True)
PY
ARM=gold ID=gold-T3-opus-guarded-20260926 bench/evaluate.sh T3 "$clone" "$base" "$logs/gold-T3"
python3 -B - "$logs" <<'PY'
import json,sys,re
from pathlib import Path
logs=Path(sys.argv[1]); ev=json.loads((logs/'gold-T3.eval.json').read_text())
assert ev['pass'] is True and ev['target_test_exit']==0 and not ev['target_failed'] and not ev['new_failures'],ev
baseline={s.strip() for s in Path('bench/baselines/T3.failures.txt').read_text().splitlines() if s.strip() and not s.startswith('#')}
failures={m.group(1) for s in (logs/'gold-T3.eval-suite.log').read_text().splitlines() if (m:=re.match(r'^(?:FAILED|ERROR) (\S+)',s))}
assert failures==baseline,(failures-baseline,baseline-failures)
print('GOLD T3 PASS; masked-suite failures exactly match baseline; answer commit unreachable in clone.')
PY
date -Is > "$logs/gold-verify.finished"

python3 -B - "$clone" <<'CLEANUP'
from pathlib import Path
import shutil,sys
p=Path(sys.argv[1])
assert p==Path('/project/tmp/ppo-bench/clones/gold-T3-opus-guarded-20260926') and p.is_dir() and not p.is_symlink()
shutil.rmtree(p)
print('Removed isolated gold clone after verification; evidence retained.')
CLEANUP
