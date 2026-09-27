import json
import os
import sys
from pathlib import Path
sys.path.insert(0, 'bench')
import temp_guard as g

devices = g.forbidden_devices(reject_outside_aliases=True)
tmp = g.select_temp(devices)
abi = g.install(g.grant_directories(devices))
g.verify(tmp)
os.environ.update(TMPDIR=str(tmp), TMP=str(tmp), TEMP=str(tmp), PYTHONDONTWRITEBYTECODE='1')
print(json.dumps({'gold_guard': 'landlock', 'abi': abi, 'tmpdir': str(tmp)}), flush=True)
os.execv('/bin/bash', ['bash', str(Path(__file__).with_name('gold-verify.sh'))])
