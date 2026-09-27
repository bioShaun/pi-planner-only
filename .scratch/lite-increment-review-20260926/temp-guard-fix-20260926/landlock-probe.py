import ctypes
import errno
import json
import os
import subprocess
import sys
from pathlib import Path

assert os.uname().machine == 'x86_64'
libc = ctypes.CDLL(None, use_errno=True)
libc.syscall.restype = ctypes.c_long
mask = (1 << 1) | sum(1 << b for b in range(4, 15))

class Ruleset(ctypes.Structure):
    _fields_ = [('handled_access_fs', ctypes.c_uint64)]

class Rule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int32)]

def call(number, *args):
    result = libc.syscall(number, *args)
    if result < 0:
        raise OSError(ctypes.get_errno(), os.strerror(ctypes.get_errno()))
    return result

abi = call(444, ctypes.c_void_p(), ctypes.c_size_t(0), ctypes.c_uint(1))
assert abi >= 3
fd = call(444, ctypes.byref(Ruleset(mask)), ctypes.c_size_t(8), ctypes.c_uint(0))
grants = []
for p in Path('/').iterdir():
    if p.resolve() == Path('/tmp') or not p.is_dir():
        continue
    assert Path('/tmp') != p.resolve() and p.resolve() != Path('/')
    parent = os.open(p, os.O_PATH | os.O_CLOEXEC)
    try:
        call(445, fd, 1, ctypes.byref(Rule(mask, parent)), 0)
        grants.append(str(p))
    finally:
        os.close(parent)
assert libc.prctl(38, 1, 0, 0, 0) == 0
call(446, fd, 0)
os.close(fd)
allowed = Path(__file__).resolve().parent / 'allowed-probe.txt'
allowed.write_text('allowed\n')
allowed.unlink()
# The kernel policy is now installed: no rule grants /tmp or a parent of it.
probe = '/tmp/ppo-temp-guard-probe-must-not-exist-20260926'
assert not Path(probe).exists()
try:
    os.mkdir(probe)
except OSError as e:
    assert e.errno == errno.EACCES, e
else:
    raise AssertionError('Kernel did not deny forbidden mkdir')
child = subprocess.run([sys.executable, '-B', '-c',
    'import os,errno; p="/tmp/ppo-temp-guard-child-must-not-exist-20260926"; '
    '\ntry: os.mkdir(p)\nexcept OSError as e: assert e.errno==errno.EACCES\nelse: raise AssertionError("not denied")'],
    capture_output=True, text=True)
assert child.returncode == 0, child.stderr
print(json.dumps({'abi': abi, 'grants': grants, 'allowed_write': True, 'tmp_mkdir_denied': True, 'child_denied': True}))
