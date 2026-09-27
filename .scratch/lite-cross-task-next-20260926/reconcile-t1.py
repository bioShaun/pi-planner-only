"""Reconcile the completed T1 logs with the benchmark's no-new-failures rule."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys

logs=Path(__file__).resolve().parent
sys.path.insert(0,str(Path.cwd()/'bench'))
import temp_guard as g
devices=g.forbidden_devices(reject_outside_aliases=True)
tmp=g.safe_temp_directory(Path('/project/tmp/ppo-bench/cross-task-preflight-20260926/T1'),Path.cwd(),devices)
abi=g.install(g.grant_directories(devices));g.verify(tmp)
os.environ.update(TMPDIR=str(tmp),TMP=str(tmp),TEMP=str(tmp),PYTHONDONTWRITEBYTECODE='1')
task=json.loads(Path('bench/tasks/T1.json').read_text())
clone=Path('/project/tmp/ppo-bench/clones/cross-task-check-20260926-T1')
assert clone.is_dir() and not clone.is_symlink()
def output(args):return subprocess.check_output(args,text=True).strip()
def failures(path):return {m.group(1) for s in path.read_text().splitlines() if (m:=re.match(r'^(?:FAILED|ERROR) (\S+)',s))}
expected={s.strip() for s in Path('bench/baselines/T1.failures.txt').read_text().splitlines() if s.strip() and not s.startswith('#')}
base=failures(logs/'T1-base-suite.log');gold=failures(logs/'T1-gold.eval-suite.log')
fixed={'tests/unit/test_io_and_cli.py::TestExternalCommandFailureHandling::test_run_command_timeout_raises_alignment_error'}
assert base==expected and gold==base-fixed
assert "cannot import name 'ExternalToolTimeoutError'" in (logs/'T1-base-target.log').read_text()
ev=json.loads((logs/'T1-gold.eval.json').read_text());assert ev['pass'] and ev['target_test_exit']==0 and ev['suite_exit']==1 and not ev['target_failed'] and not ev['new_failures']
assert '30 passed' in (logs/'T1-gold.eval-target.log').read_text()
assert (logs/'T1-validation.exit').read_text().strip()=='1'
assert 'assert failures(prefix.with_suffix' in (logs/'T1-validation.log').read_text()
isolation={}
for ref in sorted({task['target'],*task['testRefs'].values()}):
 for val in (ref,ref[:7]):
  rc=subprocess.run(['git','-C',str(clone),'cat-file','-e',val+'^{commit}'],capture_output=True).returncode
  assert rc!=0;isolation[val]=rc
assert not output(['git','-C',str(clone),'remote']) and not output(['git','-C',str(clone),'for-each-ref'])
tests={}
for name in task['tests']:
 ref=task['testRefs'].get(name,task['target']);blob=subprocess.check_output(['git','-C',task['repo'],'show',ref+':'+name]);assert blob==(clone/name).read_bytes()
 tests[name]={'ref':ref,'sha256':hashlib.sha256(blob).hexdigest()}
gold_patch=(logs/'T1-gold.patch').read_bytes()
assert gold_patch==subprocess.check_output(['git','-C',str(clone),'diff','HEAD','--binary','--','.',':(exclude)tests'])
record={'task':'T1','status':'PASS','validation_method':'read-only reconciliation of retained executed tests; no test rerun','guard':{'backend':'landlock','abi':abi,'tmpdir':str(tmp)},'clone_base':output(['git','-C',str(clone),'rev-parse','HEAD']),'answer_refs_unreachable':isolation,'no_refs':True,'no_remotes':True,'tests':tests,'base_target_exit':2,'base_suite_exit':1,'baseline_failures':sorted(base),'gold_fixed_baseline_failures':sorted(fixed),'gold_evaluation':ev,'gold_patch_sha256':hashlib.sha256(gold_patch).hexdigest(),'first_harness_exit':1,'harness_issue':'Exact unchanged failure-set requirement was inappropriate for T1; gold fixes an existing timeout failure. Frozen baseline and all original test assertions retained.','paid_model_calls':0,'finished':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(logs/'T1-result.json').write_text(json.dumps(record,indent=2)+'\n')
shutil.rmtree(clone)
print('T1 PASS: target30; baseline13 -> gold12 (timeout fixed); original harness failure retained; clone removed.')
