"""Install the benchmark Landlock temp policy for offline T2c validation."""

import os
from pathlib import Path
import sys

ROOT = Path('/home/tcuni-claw/pi/pi-planner-only')
sys.path.insert(0, str(ROOT / 'bench'))
import temp_guard  # noqa: E402

devices = temp_guard.forbidden_devices(reject_outside_aliases=True)
directory = temp_guard.select_temp(devices)
grants = temp_guard.grant_directories(devices)
abi = temp_guard.install(grants)
temp_guard.verify(directory)
print(f'offline temp guard: Landlock ABI {abi}; /tmp write denied; TMPDIR={directory}', file=sys.stderr, flush=True)
environment = {**os.environ, 'TMPDIR': str(directory), 'TMP': str(directory), 'TEMP': str(directory)}
os.execve('/bin/bash', ['/bin/bash', str(ROOT / '.scratch/lite-t2c-preparation-20260927/validate-t2c-body.sh'), sys.argv[1]], environment)
