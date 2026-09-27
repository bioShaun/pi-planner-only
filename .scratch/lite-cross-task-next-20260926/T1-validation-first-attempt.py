"""Offline candidate check with the accepted local temp boundary; never invokes Pi."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

repo = Path.cwd()
logs = Path(__file__).resolve().parent
task_id = sys.argv[1]
assert task_id in ('T1', 'T2')
sys.path.insert(0, str(repo / 'bench'))
import temp_guard as g
devices = g.forbidden_devices(reject_outside_aliases=True)
tmp = g.select_temp(devices)
abi = g.install(g.grant_directories(devices))
g.verify(tmp)
os.environ.update(TMPDIR=str(tmp), TMP=str(tmp), TEMP=str(tmp), PYTHONDONTWRITEBYTECODE='1')
task = json.loads((repo / f'bench/tasks/{task_id}.json').read_text())
clone = Path('/project/tmp/ppo-bench/clones') / f'cross-task-check-20260926-{task_id}'
assert clone.parent.is_dir() and not clone.exists()
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
print(json.dumps({'task': task_id, 'guard': 'landlock', 'abi': abi, 'tmp': str(tmp), 'started': started}), flush=True)
def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)
def output(args):
    return subprocess.check_output(args, text=True).strip()
base = output([str(repo/'bench/prepare-clone.sh'), task_id, str(clone)]).removeprefix('BASE=')
refs = sorted({task['target'], *task.get('testRefs', {}).values()})
isolation = {}
for ref in refs:
    for value in (ref, ref[:7]):
        rc = subprocess.run(['git', '-C', str(clone), 'cat-file', '-e', value+'^{commit}'], capture_output=True).returncode
        assert rc != 0, f'Answer/test source commit reachable: {value}'
        isolation[value] = rc
assert not output(['git','-C',str(clone),'remote'])
assert not output(['git','-C',str(clone),'for-each-ref'])
tests = {}
for name in task['tests']:
    ref = task.get('testRefs', {}).get(name, task['target'])
    expected = subprocess.check_output(['git','-C',task['repo'],'show',ref+':'+name])
    assert (clone/name).read_bytes() == expected
    tests[name] = {'ref':ref,'sha256':hashlib.sha256(expected).hexdigest()}
env = {**os.environ, 'PYTHONPATH':'src'}
def pytest(label, args):
    path = logs / f'{task_id}-{label}.log'
    with path.open('w') as f:
        r = subprocess.run([task['python'],'-m','pytest',*args],cwd=clone,env=env,stdout=f,stderr=subprocess.STDOUT)
    return r.returncode, path
red_exit, red_log = pytest('base-target', task['tests'])
assert red_exit in (1,2), ('Parent must fail target assertions or collection', red_exit)
baseline_exit, baseline_log = pytest('base-suite', [item for name in task['tests'] for item in ('--ignore', name)])
def failures(path):
    return {m.group(1) for line in path.read_text().splitlines() if (m:=re.match(r'^(?:FAILED|ERROR) (\S+)',line))}
expected_failures={line.strip() for line in (repo/'bench/tasks'/task['baseline']).read_text().splitlines() if line.strip() and not line.startswith('#')}
assert baseline_exit in (0,1) and failures(baseline_log)==expected_failures, ('Baseline drift',baseline_exit,sorted(failures(baseline_log)-expected_failures),sorted(expected_failures-failures(baseline_log)))
gold_patch = subprocess.check_output(['git','-C',task['repo'],'diff','--binary',task['parent'],task['target'],'--','.',':(exclude)tests'])
(logs/f'{task_id}-gold.patch').write_bytes(gold_patch)
run(['git','-C',str(clone),'apply','--index'],input=gold_patch)
prefix = logs/f'{task_id}-gold'
run([str(repo/'bench/evaluate.sh'),task_id,str(clone),base,str(prefix)],env={**os.environ,'ARM':'gold','ID':f'cross-task-{task_id}'})
ev=json.loads(prefix.with_suffix('.eval.json').read_text())
assert ev['pass'] is True and ev['target_test_exit']==0 and ev['suite_exit'] in (0,1) and not ev['target_failed'] and not ev['new_failures']
assert failures(prefix.with_suffix('.eval-suite.log'))==expected_failures
result={'task':task_id,'status':'PASS','started':started,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat(),'guard':{'backend':'landlock','abi':abi,'tmpdir':str(tmp)},'clone_base':base,'answer_refs_unreachable':isolation,'no_refs':True,'no_remotes':True,'tests':tests,'base_target_exit':red_exit,'base_suite_exit':baseline_exit,'baseline_failures':sorted(expected_failures),'gold_evaluation':ev,'gold_patch_sha256':hashlib.sha256(gold_patch).hexdigest(),'paid_model_calls':0}
(logs/f'{task_id}-result.json').write_text(json.dumps(result,indent=2)+'\n')
assert clone.parent==Path('/project/tmp/ppo-bench/clones') and clone.name==f'cross-task-check-20260926-{task_id}' and not clone.is_symlink()
shutil.rmtree(clone)
print(json.dumps({'task':task_id,'status':'PASS','base_target_exit':red_exit,'baseline_count':len(expected_failures),'clone_removed':True}),flush=True)
