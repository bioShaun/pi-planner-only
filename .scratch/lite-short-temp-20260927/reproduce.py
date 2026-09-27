"""Exercise the actual multiprocessing AF_UNIX listener under benchmark guard."""
import multiprocessing
import os
from pathlib import Path
import sys
import traceback

ROOT = Path('/home/tcuni-claw/pi/pi-planner-only')
sys.path.insert(0, str(ROOT / 'bench'))
import temp_guard

devices = temp_guard.forbidden_devices(reject_outside_aliases=True)
directory = temp_guard.select_temp(devices)
abi = temp_guard.install(temp_guard.grant_directories(devices))
temp_guard.verify(directory)
print(f'guard=Landlock ABI {abi} verified; physical_temp={directory} length={len(str(directory))}', flush=True)
try:
    with multiprocessing.Manager() as manager:
        shared = manager.list([42])
        assert shared[0] == 42
    print('manager should start: PASS', flush=True)
except Exception:
    traceback.print_exc()
    print('manager should start: FAIL', flush=True)
    sys.exit(1)
