"""Archive a terminal run's real files, full diff, and test assertions before cleanup."""
import ast
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

logs=Path(__file__).resolve().parent
n=int(sys.argv[1]);plan=json.loads((logs.parent/'plan.json').read_text());row=plan['order'][n-1]
rid=f"{row['task']}-{row['arm']}-1"
assert (logs/f'attempt-{n}.exit').exists(),'Runner must be terminal'
match=re.search(r'^base=([0-9a-f]{40}) clone=(.+)$',(logs/f'attempt-{n}.console.log').read_text(),re.M)
assert match,'Missing clone provenance'
base,clone=match[1],Path(match[2])
assert clone==Path('/project/tmp/ppo-bench/clones')/(plan['campaign']+'-'+rid) and clone.is_dir() and not clone.is_symlink()
def git(*args):return subprocess.check_output(['git','-C',str(clone),*args])
root=logs/'evidence';root.mkdir(exist_ok=True);dest=root/rid;dest.mkdir(exist_ok=False)
(dest/'changes.patch').write_bytes(git('diff','--binary',base))
(dest/'status.txt').write_bytes(git('status','--short'))
changed=[x.decode() for x in git('diff','--name-only','-z',base).split(b'\0') if x]
untracked=[x.decode() for x in git('ls-files','--others','--exclude-standard','-z').split(b'\0') if x]
task=json.loads(Path(f"bench/tasks/{row['task']}.json").read_text())
names=sorted(set(changed+untracked+task['tests']))
records=[]
for name in names:
    rel=Path(name)
    assert not rel.is_absolute() and '..' not in rel.parts
    path=clone/rel
    rec={'path':name,'changed':name in changed,'untracked':name in untracked,'symlink':path.is_symlink()}
    assert not path.is_symlink(),'Symlink requires explicit archive review'
    before=subprocess.run(['git','-C',str(clone),'show',base+':'+name],capture_output=True)
    if before.returncode==0:
        out=dest/'before'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(before.stdout)
        rec['before_sha256']=hashlib.sha256(before.stdout).hexdigest()
    if path.is_file():
        assert path.stat().st_size<100_000_000,'Large artifact needs explicit archival'
        blob=path.read_bytes();out=dest/'after'/rel;out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(blob)
        rec['after_sha256']=hashlib.sha256(blob).hexdigest()
        if name.startswith('tests/') and name.endswith('.py') and before.returncode==0:
            def assertions(data):return [ast.dump(x,include_attributes=False) for x in ast.walk(ast.parse(data)) if isinstance(x,ast.Assert)]
            rec['assert_statements_identical']=assertions(before.stdout)==assertions(blob)
    records.append(rec)
head=git('rev-parse','HEAD').decode().strip()
isolation={}
for ref in sorted({task['target'],*task.get('testRefs',{}).values()}):
    rc=subprocess.run(['git','-C',str(clone),'cat-file','-e',ref+'^{commit}'],capture_output=True).returncode
    isolation[ref]=rc
manifest={'run':rid,'base':base,'head':head,'head_unchanged':head==base,'clone':str(clone),'answer_refs_unreachable':isolation,'changed':changed,'untracked':untracked,'files':records,'canonical_target_files_unchanged_after_evaluation':all(r.get('before_sha256')==r.get('after_sha256') for r in records if r['path'] in task['tests']),'note':'Snapshot after canonical test restoration by evaluate.sh. Review tool events for prior protected-test mutations and actual tests run.'}
(dest/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'run':rid,'head_unchanged':head==base,'changed':changed,'untracked':untracked,'archive':str(dest)},indent=2))
