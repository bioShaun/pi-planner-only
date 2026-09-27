"""Remove only this completed and independently inspected clone after checking archives."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
logs=Path(__file__).resolve().parent
rid='T2b-native-opus-calibration-1'
archive=logs/'evidence'/rid
m=json.loads((archive/'manifest.json').read_text())
clone=Path('/project/tmp/ppo-bench/clones/opus-cross-task-t1-t2b-20260926-T2b-native-opus-calibration-1')
assert str(clone)==m['clone'] and clone.is_dir() and not clone.is_symlink()
assert (logs/'independent-validation.txt').is_file() and (logs/'attempt-1.exit').read_text().strip()=='4'
assert json.loads((logs/'after-attempt-1.json').read_text())['continue'] is False
sys.path.insert(0,'bench')
import temp_guard as g
devices=g.forbidden_devices(reject_outside_aliases=True)
g.safe_temp_directory(clone,Path.cwd(),devices)
g.install(g.grant_directories(devices))
def git(*args):return subprocess.check_output(['git','-C',str(clone),*args])
assert git('rev-parse','HEAD').decode().strip()==m['base']==m['head']
assert git('diff','--binary',m['base'])==(archive/'changes.patch').read_bytes()
untracked=[x.decode() for x in git('ls-files','--others','--exclude-standard','-z').split(b'\0') if x]
assert untracked==m['untracked']
for row in m['files']:
    for phase in ('before','after'):
        key=phase+'_sha256'
        if key in row:
            assert hashlib.sha256((archive/phase/row['path']).read_bytes()).hexdigest()==row[key]
    if 'after_sha256' in row:
        assert not (clone/row['path']).is_symlink()
        assert hashlib.sha256((clone/row['path']).read_bytes()).hexdigest()==row['after_sha256']
shutil.rmtree(clone)
(logs/'cleanup.json').write_text(json.dumps({'clone':str(clone),'archive_verified':True,'independent_check_complete':True,'removed':not clone.exists(),'child_artifacts_and_raw_runs_retained':True},indent=2)+'\n')
print('Verified archive and removed only completed T2b native clone; raw/child artifacts retained.')
