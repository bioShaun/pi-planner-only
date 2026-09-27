#!/usr/bin/env python3
"""Install the common benchmark /tmp write boundary before running Pi.

Landlock ABI and rights: /usr/include/linux/landlock.h and
https://docs.kernel.org/userspace-api/landlock.html
"""
import ctypes
from datetime import datetime
import errno
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tempfile


SYS_CREATE, SYS_ADD, SYS_RESTRICT = 444, 445, 446
PR_SET_NO_NEW_PRIVS = 38
WRITE_RIGHTS = (1 << 1) | sum(1 << bit for bit in range(4, 15))
TMP_ROOT = Path('/project/tmp')
FORBIDDEN = Path('/tmp')


class Ruleset(ctypes.Structure):
    _fields_ = [('handled_access_fs', ctypes.c_uint64)]


class PathRule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('allowed_access', ctypes.c_uint64), ('parent_fd', ctypes.c_int32)]


def syscall(libc, number, *args):
    result = libc.syscall(number, *args)
    if result < 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return result


def inside(path, parent):
    return path == parent or parent in path.parents


def filesystem_device(path):
    return path.stat().st_dev


def parse_mountinfo(text):
    entries = []
    for line in text.splitlines():
        fields = line.split(' - ', 1)
        columns = fields[0].split()
        if len(fields) != 2 or len(columns) < 6 or len(fields[1].split()) < 3:
            raise ValueError('malformed mountinfo record')
        if not re.fullmatch(r'[0-9]+:[0-9]+', columns[2]):
            raise ValueError('malformed mountinfo device')
        raw = columns[4]
        if re.search(r'\\(?!0(?:40|11|12)|134)', raw):
            raise ValueError('malformed mountinfo mountpoint escape')
        mountpoint = Path(re.sub(r'\\(040|011|012|134)',
                                 lambda match: chr(int(match[1], 8)), raw))
        if not mountpoint.is_absolute() or '..' in mountpoint.parts:
            raise ValueError('malformed mountinfo mountpoint')
        major, minor = (int(part) for part in columns[2].split(':'))
        entries.append((mountpoint, os.makedev(major, minor)))
    if not entries:
        raise ValueError('empty mountinfo')
    return entries


def forbidden_devices(reject_outside_aliases=False):
    if FORBIDDEN.resolve(strict=True) != FORBIDDEN or not FORBIDDEN.is_dir():
        raise ValueError('unsupported /tmp layout')
    entries = parse_mountinfo(Path('/proc/self/mountinfo').read_text(encoding='utf-8', errors='surrogateescape'))
    devices = {filesystem_device(FORBIDDEN)}
    devices.update(device for mount, device in entries if inside(mount, FORBIDDEN))
    if reject_outside_aliases:
        for mount, device in entries:
            if not inside(mount, FORBIDDEN) and device in devices:
                raise ValueError(f'/tmp filesystem exposed outside /tmp: {mount}')
    return devices


def safe_temp_directory(path, repo, devices=None):
    if devices is None:
        devices = forbidden_devices()
    resolved = path.resolve(strict=True)
    if not resolved.is_dir() or inside(resolved, repo):
        raise ValueError(f'benchmark temp directory must be outside the source repo: {path}')
    # Fail closed for a bind alias of /tmp, even if this also rejects distinct
    # directories on the same filesystem.
    if filesystem_device(resolved) in devices:
        raise ValueError(f'benchmark temp directory shares /tmp filesystem: {path}')
    return resolved


def select_temp(devices=None):
    if devices is None:
        devices = forbidden_devices(reject_outside_aliases=True)
    root = TMP_ROOT.resolve(strict=True)
    forbidden = FORBIDDEN.resolve(strict=True)
    repo = Path(__file__).resolve(strict=True).parent.parent
    if forbidden != FORBIDDEN or not FORBIDDEN.is_dir():
        raise ValueError('unsupported /tmp alias layout')
    if not root.is_dir() or inside(root, forbidden) or inside(forbidden, root) or root == Path('/'):
        raise ValueError('unsafe /project/tmp layout')
    root = safe_temp_directory(root, repo, devices)
    requested = os.environ.get('TMPDIR')
    if requested and inside(Path(requested).resolve(strict=True), root):
        directory = safe_temp_directory(Path(requested), repo, devices)
        if inside(directory, forbidden):
            raise ValueError('unsafe TMPDIR')
        return directory
    if requested:
        raise ValueError('TMPDIR must resolve under /project/tmp')
    parent = root / 'ppo-bench'
    if inside(parent.resolve(strict=False), repo):
        raise ValueError('benchmark temp parent is inside the source repo')
    if parent.exists():
        safe_temp_directory(parent, repo, devices)
    parent.mkdir(exist_ok=True)
    parent = safe_temp_directory(parent, repo, devices)
    if not inside(parent, root):
        raise ValueError('unsafe benchmark temp parent')
    return safe_temp_directory(Path(tempfile.mkdtemp(prefix='temp-', dir=parent)), repo, devices)


def grant_directories(devices=None):
    """Resolve every root entry; never grant / or an alias of /tmp."""
    if devices is None:
        devices = forbidden_devices(reject_outside_aliases=True)
    forbidden = FORBIDDEN.resolve(strict=True)
    if forbidden != FORBIDDEN or not forbidden.is_dir():
        raise ValueError('unsafe /tmp layout')
    grants = []
    for entry in Path('/').iterdir():
        try:
            target = entry.resolve(strict=True)
            if not target.is_dir():
                continue
        except (FileNotFoundError, PermissionError, OSError) as error:
            if isinstance(error, OSError) and error.errno not in (errno.ENOENT, errno.EACCES, errno.ELOOP):
                raise
            continue
        if entry == FORBIDDEN or inside(target, forbidden):
            continue
        if target == Path('/') or inside(forbidden, target):
            raise ValueError(f'unsafe root entry {entry} -> {target}')
        if os.path.samefile(entry, forbidden) or os.path.samefile(entry, Path('/')):
            raise ValueError(f'unsafe bind alias: {entry}')
        if filesystem_device(entry) in devices:
            raise ValueError(f'/tmp filesystem root alias: {entry}')
        grants.append(entry)
    if TMP_ROOT.parent not in grants:
        raise ValueError('no safe /project grant')
    return grants


def install(grants):
    if platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'aarch64'):
        raise RuntimeError('Landlock syscall architecture unsupported')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.syscall.restype = ctypes.c_long
    abi = syscall(libc, SYS_CREATE, ctypes.c_void_p(), ctypes.c_size_t(0), ctypes.c_uint(1))
    if abi < 3:
        raise RuntimeError(f'Landlock ABI {abi} lacks truncate protection')
    ruleset = syscall(libc, SYS_CREATE, ctypes.byref(Ruleset(WRITE_RIGHTS)), ctypes.c_size_t(8), ctypes.c_uint(0))
    try:
        for directory in grants:
            fd = os.open(directory, os.O_PATH | os.O_CLOEXEC | os.O_DIRECTORY)
            try:
                syscall(libc, SYS_ADD, ruleset, 1, ctypes.byref(PathRule(WRITE_RIGHTS, fd)), 0)
            finally:
                os.close(fd)
        if libc.prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0:
            error = ctypes.get_errno()
            raise OSError(error, os.strerror(error))
        syscall(libc, SYS_RESTRICT, ruleset, 0)
    finally:
        os.close(ruleset)
    return abi


def verify(directory):
    with tempfile.TemporaryDirectory(prefix='guard-check-', dir=directory) as owned:
        allowed = Path(owned) / 'ok'
        allowed.write_text('allowed')
        allowed.unlink()
        probe = FORBIDDEN / ('ppo-guard-denied-' + str(os.getpid()))
        if probe.exists():
            raise RuntimeError('probe path already exists')
        try:
            probe.mkdir()
        except OSError as error:
            if error.errno != errno.EACCES:
                raise RuntimeError(f'/tmp probe failed unexpectedly: {error}') from error
        else:
            probe.rmdir()
            raise RuntimeError('/tmp write was allowed')
        # Require explicit EACCES evidence; an unrelated failure is not proof.
        python_check = ('import errno,os,sys; '
                        '\ntry: os.mkdir(sys.argv[1])'
                        '\nexcept OSError as error:'
                        '\n if error.errno == errno.EACCES: print("DENIED:EACCES")'
                        '\n else: raise'
                        '\nelse: sys.exit("write unexpectedly allowed")')
        result = subprocess.run([sys.executable, '-B', '-c', python_check, str(probe)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0 or result.stdout.strip() != 'DENIED:EACCES' or probe.exists():
            raise RuntimeError(f'Python child /tmp denial unverified: {result.returncode} {result.stderr.strip()}')
        result = subprocess.run(['/bin/bash', '-c', '/bin/mkdir "$1"', 'bash', str(probe)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env={**os.environ, 'LC_ALL': 'C'})
        if result.returncode == 0 or 'Permission denied' not in result.stderr or probe.exists():
            raise RuntimeError(f'Bash child /tmp denial unverified: {result.returncode} {result.stderr.strip()}')


def runtime_python(args):
    if not args or not re.fullmatch(r'[A-Za-z0-9_.-]+', args[0]):
        return sys.executable
    config = Path(__file__).with_name('tasks') / (args[0] + '.json')
    if not config.exists():
        return sys.executable
    task = json.loads(config.read_text())
    executable = task.get('python') if isinstance(task, dict) else None
    if (not isinstance(executable, str) or not executable.strip()
            or executable != executable.strip() or '\x00' in executable
            or '/' in executable and not Path(executable).is_absolute()):
        raise ValueError(f'invalid configured Python runtime: {config}')
    return executable


def verify_runtime_temp(directory, executable):
    check = ('from multiprocessing.connection import Listener\n'
             'with Listener(family="AF_UNIX"):\n'
             '    pass\n'
             'print("AF_UNIX_OK")\n')
    environment = {**os.environ, 'TMPDIR': str(directory), 'TMP': str(directory),
                   'TEMP': str(directory), 'PYTHONDONTWRITEBYTECODE': '1'}
    try:
        result = subprocess.run([executable, '-B', '-c', check], env=environment,
                                capture_output=True, text=True, timeout=10)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f'AF_UNIX runtime temp unsuitable: configured Python socket probe timed out: {executable}') from error
    if result.returncode != 0 or result.stdout.strip() != 'AF_UNIX_OK':
        raise RuntimeError(f'AF_UNIX runtime temp unsuitable for {executable}: '
                           f'exit={result.returncode}; {result.stderr.strip() or result.stdout.strip()}')


def safe_output_path(output, devices=None):
    if devices is None:
        devices = forbidden_devices()
    directory = Path(output)
    if not directory.is_absolute():
        raise ValueError('BENCH_OUT must be an absolute safe directory')
    parent = directory.parent.resolve(strict=True)
    target = directory.resolve(strict=False)
    forbidden = FORBIDDEN.resolve(strict=True)
    if (not parent.is_dir() or target == Path('/') or inside(target, forbidden)
            or filesystem_device(parent) in devices):
        raise ValueError('unsafe BENCH_OUT parent or target')
    if directory.exists() and (not directory.is_dir() or filesystem_device(directory) in devices):
        raise ValueError('unsafe existing BENCH_OUT directory')
    return directory, parent, forbidden


def record_block(message, args):
    print(f'BLOCKED temp guard: {message}', file=sys.stderr)
    output = os.environ.get('BENCH_OUT', '')
    if len(args) < 3 or not all(re.fullmatch(r'[A-Za-z0-9_.-]+', value) and value not in ('.', '..') for value in args[:3]):
        return
    try:
        devices = forbidden_devices()
        directory, parent, forbidden = safe_output_path(output, devices)
        parent_fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            if os.fstat(parent_fd).st_dev in devices:
                return
            try:
                existing = os.stat(directory.name, dir_fd=parent_fd, follow_symlinks=False)
            except FileNotFoundError:
                os.mkdir(directory.name, dir_fd=parent_fd)
            else:
                if not stat.S_ISDIR(existing.st_mode) or existing.st_dev in devices:
                    return
            dir_fd = os.open(directory.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
                             dir_fd=parent_fd)
            try:
                actual = (Path('/proc/self/fd') / str(dir_fd)).resolve(strict=True)
                if (actual == Path('/') or inside(actual, forbidden)
                        or os.fstat(dir_fd).st_dev in devices):
                    return
                try:
                    existing_stop = os.stat('STOP', dir_fd=dir_fd, follow_symlinks=False)
                except FileNotFoundError:
                    pass
                else:
                    if existing_stop.st_dev in devices or not stat.S_ISREG(existing_stop.st_mode):
                        return
                stop_fd = os.open('STOP', os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW
                                  | os.O_CLOEXEC | os.O_NONBLOCK, 0o600, dir_fd=dir_fd)
                try:
                    stop_stat = os.fstat(stop_fd)
                    if stop_stat.st_dev in devices or not stat.S_ISREG(stop_stat.st_mode):
                        return
                    with os.fdopen(stop_fd, 'a') as stream:
                        stop_fd = -1
                        stamp = datetime.now().astimezone().isoformat(timespec='seconds')
                        stream.write(f'{stamp} {args[0]}-{args[1]}-{args[2]} BLOCKED temp guard: {message}\n')
                finally:
                    if stop_fd != -1:
                        os.close(stop_fd)
            finally:
                os.close(dir_fd)
        finally:
            os.close(parent_fd)
    except (OSError, ValueError):
        pass


def main(args):
    try:
        devices = forbidden_devices(reject_outside_aliases=True)
        if os.environ.get('BENCH_OUT'):
            safe_output_path(os.environ['BENCH_OUT'], devices)
        directory = select_temp(devices)
        grants = grant_directories(devices)
        abi = install(grants)
        verify(directory)
        verify_runtime_temp(directory, runtime_python(args))
        resource = {'backend': 'landlock', 'abi': abi, 'policy': 'deny /tmp writes; allow safe root directories', 'tmpdir': str(directory)}
        os.environ.update(TMPDIR=str(directory), TMP=str(directory), TEMP=str(directory), BENCH_TEMP_RESOURCE=json.dumps(resource))
        print('temp guard: ' + json.dumps(resource, sort_keys=True), file=sys.stderr)
        os.execv('/bin/bash', ['bash', str(Path(__file__).with_name('run-body.sh')), *args])
    except (OSError, ValueError, RuntimeError) as error:
        record_block(str(error), args)
        return 3


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
