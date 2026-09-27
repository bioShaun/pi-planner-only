"""Install and verify the frozen benchmark temp guard, then run evaluator."""
import os
from pathlib import Path
import sys

ROOT = Path('/home/tcuni-claw/pi/pi-planner-only')
sys.path.insert(0, str(ROOT / 'bench'))
import temp_guard

devices = temp_guard.forbidden_devices(reject_outside_aliases=True)
directory = temp_guard.select_temp(devices)
abi = temp_guard.install(temp_guard.grant_directories(devices))
temp_guard.verify(directory)
print(f'guard=Landlock ABI {abi} verified; physical_temp={directory} length={len(str(directory))}', flush=True)
os.execve('/bin/bash', ['/bin/bash', str(ROOT / 'bench/evaluate.sh'), *sys.argv[1:]], os.environ)
