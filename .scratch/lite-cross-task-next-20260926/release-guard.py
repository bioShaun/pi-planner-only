import os
import sys
sys.path.insert(0,'bench')
import temp_guard as g
devices=g.forbidden_devices(reject_outside_aliases=True)
tmp=g.select_temp(devices)
abi=g.install(g.grant_directories(devices))
g.verify(tmp)
os.environ.update(TMPDIR=str(tmp),TMP=str(tmp),TEMP=str(tmp),PYTHONDONTWRITEBYTECODE='1')
print(f'Landlock ABI={abi}; TMPDIR={tmp}',flush=True)
os.execvp('npm',['npm','run','test:release'])
