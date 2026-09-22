#!/usr/bin/python3
"""Trusted Linux supervisor for the v1 closeout validation sandbox."""

from __future__ import annotations

import base64
import ctypes
import errno
import hashlib
import json
import os
import re
from pathlib import Path
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time
from typing import Any


DENIED_SYSCALLS = (
    "socket", "socketpair", "connect", "mount", "umount2", "setns", "unshare",
    "ptrace", "bpf", "keyctl", "perf_event_open", "open_by_handle_at",
    "process_vm_writev", "pidfd_getfd", "io_uring_setup",
)


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def timestamp(wall: float | None = None) -> str:
    wall = time.time() if wall is None else wall
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(wall)) + f".{int(wall % 1 * 1000):03d}Z"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_mount(source: str, kind: str) -> str:
    root = Path(source).resolve(strict=True)
    rows: list[dict[str, Any]] = []

    def file_row(item: Path, relative: str) -> None:
        info = item.stat()
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError(f"runtime mount is not regular: {item}")
        rows.append({"path": relative, "type": "file", "mode": stat.S_IMODE(info.st_mode),
                     "size": info.st_size, "sha256": sha256(item.read_bytes())})

    if kind == "file":
        file_row(root, ".")
    elif kind == "directory":
        root_info = root.stat()
        rows.append({"path": ".", "type": "directory", "mode": stat.S_IMODE(root_info.st_mode)})
        for directory, dirs, files in os.walk(root, topdown=True, followlinks=False):
            dirs.sort()
            files.sort()
            base = Path(directory)
            for name in list(dirs):
                item = base / name
                if item.is_symlink():
                    info = item.lstat()
                    rows.append({"path": item.relative_to(root).as_posix(), "type": "symlink",
                                 "mode": stat.S_IMODE(info.st_mode), "target": os.readlink(item)})
                    dirs.remove(name)
                else:
                    info = item.stat()
                    rows.append({"path": item.relative_to(root).as_posix(), "type": "directory",
                                 "mode": stat.S_IMODE(info.st_mode)})
            for name in files:
                item = base / name
                relative = item.relative_to(root).as_posix()
                if item.is_symlink():
                    info = item.lstat()
                    rows.append({"path": relative, "type": "symlink",
                                 "mode": stat.S_IMODE(info.st_mode), "target": os.readlink(item)})
                else:
                    file_row(item, relative)
    else:
        raise RuntimeError(f"unknown runtime mount kind: {kind}")
    rows.sort(key=lambda row: row["path"])
    return sha256(canonical(rows))


def verify_profile(profile: dict[str, Any]) -> None:
    profile_core = dict(profile)
    claimed_profile_hash = profile_core.pop("isolationProfileSha256")
    if sha256(canonical(profile_core)) != claimed_profile_hash:
        raise RuntimeError("runtime isolation profile hash mismatch")
    mounts = profile["readonlyMounts"]
    for mount in mounts:
        if hash_mount(mount["source"], mount["kind"]) != mount["manifestSha256"]:
            raise RuntimeError(f"runtime profile changed: {mount['source']}")
    if sha256(canonical(mounts)) != profile["dependencyManifestSha256"]:
        raise RuntimeError("runtime dependency manifest mismatch")
    for tool in profile["hostTools"].values():
        if sha256(Path(tool["path"]).read_bytes()) != tool["sha256"]:
            raise RuntimeError(f"closeout host tool changed: {tool['path']}")


def make_seccomp_fd() -> int:
    lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7FFF0000)
    if not context:
        raise RuntimeError("libseccomp initialization failed")
    fd = os.memfd_create("closeout-seccomp", os.MFD_CLOEXEC)
    try:
        for name in DENIED_SYSCALLS:
            number = lib.seccomp_syscall_resolve_name(name.encode())
            if number < 0 or lib.seccomp_rule_add(context, 0x00050000 | errno.EPERM, number, 0) != 0:
                raise RuntimeError(f"unable to deny syscall: {name}")
        if lib.seccomp_export_bpf(context, fd) != 0:
            raise RuntimeError("unable to export seccomp filter")
        os.lseek(fd, 0, os.SEEK_SET)
        return fd
    except BaseException:
        os.close(fd)
        raise
    finally:
        lib.seccomp_release(context)


def proc_start_ticks(pid: int) -> str:
    raw = Path(f"/proc/{pid}/stat").read_text()
    return raw.rsplit(")", 1)[1].split()[19]


def cgroup_for_pid(pid: int) -> tuple[str, Path]:
    lines = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    unified = [line.split("::", 1)[1] for line in lines if "::" in line]
    if len(unified) != 1 or not unified[0].startswith("/"):
        raise RuntimeError("process is not in one cgroup v2 path")
    relative = unified[0]
    directory = Path("/sys/fs/cgroup") / relative.lstrip("/")
    return relative, directory


def read_controls(directory: Path) -> tuple[dict[str, int], dict[str, str]]:
    raw = {name: (directory / name).read_text().strip()
           for name in ("memory.max", "memory.swap.max", "pids.max", "cpu.max")}
    if any(value == "max" for value in raw.values()):
        raise RuntimeError("unlimited cgroup control")
    quota, period = raw["cpu.max"].split()
    controls = {"memoryMaxBytes": int(raw["memory.max"]),
                "memorySwapMaxBytes": int(raw["memory.swap.max"]),
                "pidsMax": int(raw["pids.max"]), "cpuQuotaUs": int(quota),
                "cpuPeriodUs": int(period)}
    return controls, raw


def scratch_limit_reason(root: Path, byte_limit: int, entry_limit: int,
                         interrupted: Any) -> str | None:
    logical_bytes = 0
    allocated_bytes = 0
    entries = 0
    pending = [root]
    while pending:
        if interrupted():
            return "interrupted"
        directory = pending.pop()
        try:
            children = os.scandir(directory)
        except FileNotFoundError:
            if directory == root:
                return "unavailable"
            continue
        with children:
            for child in children:
                if interrupted():
                    return "interrupted"
                try:
                    info = child.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue
                entries += 1
                logical_bytes += info.st_size
                allocated_bytes += getattr(info, "st_blocks", 0) * 512
                if entries > entry_limit:
                    return "entries"
                if logical_bytes > byte_limit or allocated_bytes > byte_limit:
                    return "bytes"
                if stat.S_ISDIR(info.st_mode):
                    pending.append(Path(child.path))
    return None


def mkdir_args(destination: str) -> list[str]:
    current = Path(destination).parent
    parents: list[str] = []
    while str(current) != "/":
        parents.append(str(current))
        current = current.parent
    args: list[str] = []
    for parent in reversed(parents):
        args.extend(("--dir", parent))
    return args


def send_result(result: dict[str, Any]) -> None:
    sys.stdout.write("CLOSEOUT_RESULT " + json.dumps(result, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def main() -> int:
    config_line = sys.stdin.readline()
    if not config_line:
        raise RuntimeError("missing supervisor config")
    config = json.loads(config_line)
    cancel_reason: list[str] = []
    ack = threading.Event()

    def commands() -> None:
        for line in sys.stdin:
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                cancel_reason.append("invalid-control-message")
                continue
            if message.get("type") == "ack":
                ack.set()
            elif message.get("type") in ("cancel", "abort-seal"):
                cancel_reason.append(str(message.get("reason", message["type"])))

    threading.Thread(target=commands, daemon=True).start()
    profile = config["runtimeProfile"]
    expected = config["expectedControls"]
    identity = config["identity"]
    started_wall = time.time()
    started_at = timestamp(started_wall)
    started_mono = time.monotonic()
    outcome = "startup_failed"
    exit_code: int | None = None
    signal_name: str | None = None
    timed_out = False
    cancelled = False
    startup_error: str | None = None
    process_tree_stopped = False
    stdout = bytearray()
    stderr = bytearray()
    stdout_overflow = False
    stderr_overflow = False
    scratch_overflow = False
    before = None
    after = None
    scope_unit = config["scopeUnit"]
    cgroup_path = ""
    cgroup_id = ""
    init_pid = 0
    init_ticks = ""
    host_boot_id = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    evidence: list[dict[str, Any]] = []
    proc: subprocess.Popen[bytes] | None = None
    cgroup_dir: Path | None = None
    scratch_fd: int | None = None
    observation_complete = False

    try:
        cgroup_path, cgroup_dir = cgroup_for_pid(os.getpid())
        if Path(cgroup_path).name != scope_unit:
            raise RuntimeError(f"supervisor entered unexpected cgroup scope: {cgroup_path}")
        supervisor_directory_info = cgroup_dir.stat()
        cgroup_id = f"{supervisor_directory_info.st_dev}:{supervisor_directory_info.st_ino}"
        evidence.append({"phase": "supervisor", "scopeUnit": scope_unit,
                         "hostBootId": host_boot_id, "cgroupPath": cgroup_path,
                         "cgroupId": cgroup_id,
                         "procCgroup": Path("/proc/self/cgroup").read_text(),
                         "cgroupDirectoryStat": {"device": supervisor_directory_info.st_dev,
                                                  "inode": supervisor_directory_info.st_ino}})
        verify_profile(profile)
        if time.time() >= config["deadlineMs"] / 1000:
            timed_out = True
            raise RuntimeError("deadline expired before sandbox startup")
        seccomp_fd = make_seccomp_fd()
        status_read, status_write = os.pipe()
        mounts: list[str] = []
        created: set[str] = set()
        for mount in profile["readonlyMounts"]:
            for index in range(0, len(mkdir_args(mount["destination"])), 2):
                directory = mkdir_args(mount["destination"])[index + 1]
                if directory not in created:
                    mounts.extend(("--dir", directory))
                    created.add(directory)
            mounts.extend(("--ro-bind", mount["source"], mount["destination"]))
        original = config["originalCwd"]
        for index in range(0, len(mkdir_args(original)), 2):
            directory = mkdir_args(original)[index + 1]
            if directory not in created:
                mounts.extend(("--dir", directory))
                created.add(directory)
        barrier_token = hashlib.sha256(
            f"{scope_unit}:{config['attemptSequence']}:{time.monotonic_ns()}".encode()
        ).hexdigest()
        barrier_marker = f"CLOSEOUT_EXEC_READY {barrier_token}\n".encode()
        exec_shim = (
            "import os,sys;"
            "os.write(1,('CLOSEOUT_EXEC_READY '+sys.argv[1]+'\\n').encode());"
            "gate=os.read(0,1);"
            "os.execv(sys.argv[2],sys.argv[2:]) if gate==b'1' else os._exit(125)"
        )
        stdlib = next(mount["destination"] for mount in profile["readonlyMounts"]
                      if mount["kind"] == "directory" and re.fullmatch(r"/usr/lib/python3\.\d+", mount["destination"]))
        # Pin validators and stdlib before project imports. Safe-path suppresses
        # Python's implicit cwd prepend; cwd is explicitly last so unittest
        # named tests and pytest project imports still work.
        python_paths = [stdlib, stdlib + "/lib-dynload", original]
        if profile["id"] == "system-python-tools-v1":
            python_paths.insert(0, "/opt/planner-closeout/python-tools")
        tool_environment: list[str] = ["--setenv", "PYTHONPATH", ":".join(python_paths)]
        if profile["id"] == "system-python-tools-v1":
            # All values are host literals; no ambient plugin, PATH, HOME or
            # cache settings cross this boundary. Explicit project plugins
            # still load from the immutable source/dependency closure.
            for key, value in {
                "PYTEST_ADDOPTS": "-o cache_dir=/scratch/pytest-cache",
                "RUFF_CACHE_DIR": "/scratch/ruff-cache",
                "MYPY_CACHE_DIR": "/scratch/mypy-cache",
                "XDG_CACHE_HOME": "/scratch/cache",
                "RAYON_NUM_THREADS": "1",
            }.items():
                tool_environment.extend(("--setenv", key, value))
        argv = [
            profile["hostTools"]["bwrap"]["path"], "--unshare-all", "--unshare-user", "--disable-userns",
            "--cap-drop", "ALL", "--new-session", "--die-with-parent", "--clearenv",
            "--proc", "/proc", "--dev", "/dev", *mounts,
            "--ro-bind", config["snapshotRoot"], original,
            "--size", str(config["limits"]["scratchBytes"]), "--tmpfs", "/scratch",
            "--dir", "/scratch/home", "--dir", "/scratch/tmp", "--chdir", original,
            "--setenv", "PATH", "/usr/bin", "--setenv", "HOME", "/scratch/home",
            "--setenv", "TMPDIR", "/scratch/tmp", "--setenv", "TMP", "/scratch/tmp",
            "--setenv", "TEMP", "/scratch/tmp", "--setenv", "PYTHONDONTWRITEBYTECODE", "1",
            "--setenv", "PYTHONNOUSERSITE", "1", "--setenv", "PYTHONSAFEPATH", "1",
            *tool_environment, "--seccomp", str(seccomp_fd),
            "--remount-ro", "/proc", "--remount-ro", "/dev", "--remount-ro", "/",
            "--json-status-fd", str(status_write), "--", profile["executables"]["python3"],
            "-I", "-S", "-c", exec_shim, barrier_token,
            # -S prevents project sitecustomize/usercustomize startup hooks
            # from exiting or replacing runpy before the pinned validator runs.
            config["command"]["executable"], "-S", *config["command"]["argv"],
        ]
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, pass_fds=(seccomp_fd, status_write),
                                start_new_session=True, env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
        os.close(seccomp_fd)
        os.close(status_write)
        os.set_blocking(status_read, False)
        status_selector = selectors.DefaultSelector()
        status_selector.register(status_read, selectors.EVENT_READ)
        status_buffer = bytearray()
        status_line = ""
        while not status_line:
            if time.time() >= config["deadlineMs"] / 1000:
                timed_out = True
                raise RuntimeError("deadline expired during sandbox startup")
            if cancel_reason:
                cancelled = True
                raise RuntimeError("cancelled during sandbox startup")
            events = status_selector.select(0.03)
            for key, _ in events:
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    raise RuntimeError("bwrap exited before namespace init identity")
                status_buffer.extend(chunk)
                if len(status_buffer) > 65536:
                    raise RuntimeError("bwrap status evidence overflow")
                newline = status_buffer.find(b"\n")
                if newline >= 0:
                    status_line = status_buffer[:newline].decode("utf-8", "strict")
                    break
            if proc.poll() is not None and not events:
                raise RuntimeError("bwrap exited before namespace init identity")
        status_selector.close()
        if not status_line:
            raise RuntimeError("bwrap exited before namespace init identity")
        status_event = json.loads(status_line)
        init_pid = int(status_event["child-pid"])
        init_ticks = proc_start_ticks(init_pid)
        child_cgroup_path, child_cgroup_dir = cgroup_for_pid(init_pid)
        directory_info = child_cgroup_dir.stat()
        child_cgroup_id = f"{directory_info.st_dev}:{directory_info.st_ino}"
        if child_cgroup_path != cgroup_path or child_cgroup_id != cgroup_id:
            raise RuntimeError(f"sandbox entered unexpected cgroup scope: {child_cgroup_path}")
        assert proc.stdout is not None and proc.stderr is not None and proc.stdin is not None
        os.set_blocking(proc.stdout.fileno(), False)
        os.set_blocking(proc.stderr.fileno(), False)
        ready_selector = selectors.DefaultSelector()
        ready_selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
        ready_selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
        ready_buffer = bytearray()
        ready = False
        while not ready:
            if time.time() >= config["deadlineMs"] / 1000:
                timed_out = True
                raise RuntimeError("deadline expired waiting for exec barrier")
            if cancel_reason:
                cancelled = True
                raise RuntimeError("cancelled waiting for exec barrier")
            for key, _ in ready_selector.select(0.03):
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    ready_selector.unregister(key.fileobj)
                    continue
                if key.data == "stderr":
                    room = config["limits"]["outputBytes"] - len(stderr)
                    stderr.extend(chunk[:max(0, room)])
                    stderr_overflow = stderr_overflow or len(chunk) > room
                    if stderr_overflow:
                        raise RuntimeError("exec barrier stderr overflow")
                    continue
                ready_buffer.extend(chunk)
                if len(ready_buffer) > 65536:
                    raise RuntimeError("exec barrier output overflow")
                newline = ready_buffer.find(b"\n")
                if newline >= 0:
                    line = bytes(ready_buffer[:newline + 1])
                    if line != barrier_marker:
                        raise RuntimeError("invalid exec barrier marker")
                    stdout.extend(ready_buffer[newline + 1:])
                    ready = True
                    break
            if proc.poll() is not None:
                raise RuntimeError("sandbox exited before exec barrier")
        ready_selector.close()
        namespace_scratch_view = Path(f"/proc/{init_pid}/root/scratch")
        scratch_fd = os.open(namespace_scratch_view, os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        scratch_view = Path(f"/proc/self/fd/{scratch_fd}")
        scratch_vfs = os.statvfs(scratch_view)
        scratch_capacity = scratch_vfs.f_blocks * scratch_vfs.f_frsize
        if scratch_capacity != config["limits"]["scratchBytes"]:
            raise RuntimeError(f"scratch tmpfs capacity mismatch: {scratch_capacity}")
        if scratch_limit_reason(scratch_view, config["limits"]["scratchBytes"],
                                config["limits"]["scratchEntries"], lambda: False) is not None:
            raise RuntimeError("scratch tmpfs cannot be inspected before exec")
        controls, raw_controls = read_controls(cgroup_dir)
        observed_at = timestamp()
        before = {"observedAt": observed_at, "controls": controls}
        evidence.append({"phase": "before", "pid": init_pid, "startTicks": init_ticks,
                         "scopeUnit": scope_unit, "hostBootId": host_boot_id,
                         "procCgroup": Path(f"/proc/{init_pid}/cgroup").read_text(),
                         "procStat": Path(f"/proc/{init_pid}/stat").read_text(),
                         "cgroupPath": cgroup_path, "cgroupId": cgroup_id,
                         "cgroupDirectoryStat": {"device": directory_info.st_dev,
                                                  "inode": directory_info.st_ino},
                         "scratch": {"namespaceView": str(namespace_scratch_view),
                                     "capacityBytes": scratch_capacity,
                                     "fragmentSize": scratch_vfs.f_frsize,
                                     "blocks": scratch_vfs.f_blocks},
                         "rawControls": raw_controls})
        if controls != expected:
            raise RuntimeError(f"effective cgroup controls mismatch: {controls!r}")
        verify_profile(profile)
        if time.time() >= config["deadlineMs"] / 1000:
            timed_out = True
            raise RuntimeError("deadline expired before exec barrier")
        if cancel_reason:
            cancelled = True
            raise RuntimeError("cancelled before exec barrier")
        proc.stdin.write(b"1")
        proc.stdin.flush()
        proc.stdin.close()

        selector = selectors.DefaultSelector()
        selector.register(proc.stdout, selectors.EVENT_READ, stdout)
        selector.register(proc.stderr, selectors.EVENT_READ, stderr)
        command_deadline = config["deadlineMs"] / 1000
        killed = False
        termination_deadline: float | None = None
        while selector.get_map() or proc.poll() is None:
            now = time.time()
            if now >= command_deadline and not killed:
                timed_out = True
                killed = True
                os.killpg(proc.pid, signal.SIGKILL)
                termination_deadline = time.monotonic() + 5
            elif cancel_reason and not killed:
                cancelled = True
                killed = True
                os.killpg(proc.pid, signal.SIGKILL)
                termination_deadline = time.monotonic() + 5
            elif not killed and proc.poll() is None:
                scratch_reason = scratch_limit_reason(
                    scratch_view, config["limits"]["scratchBytes"],
                    config["limits"]["scratchEntries"],
                    lambda: bool(cancel_reason) or time.time() >= command_deadline,
                )
                if scratch_reason in ("bytes", "entries", "unavailable"):
                    scratch_overflow = True
                    killed = True
                    os.killpg(proc.pid, signal.SIGKILL)
                    termination_deadline = time.monotonic() + 5
            if termination_deadline is not None and time.monotonic() >= termination_deadline and proc.poll() is None:
                raise RuntimeError("sandbox process tree did not stop after termination")
            events = selector.select(0.03) if selector.get_map() else ()
            if not events and not selector.get_map() and proc.poll() is None:
                time.sleep(0.03)
            for key, _ in events:
                chunk = os.read(key.fd, 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                target: bytearray = key.data
                room = config["limits"]["outputBytes"] - len(target)
                if len(chunk) > room:
                    target.extend(chunk[:max(0, room)])
                    if target is stdout:
                        stdout_overflow = True
                    else:
                        stderr_overflow = True
                    if not killed:
                        killed = True
                        os.killpg(proc.pid, signal.SIGKILL)
                        termination_deadline = time.monotonic() + 5
                else:
                    target.extend(chunk)
        return_code = proc.poll()
        if return_code is None:
            raise RuntimeError("sandbox process status unavailable after output drain")
        os.close(status_read)
        if return_code < 0:
            signal_name = signal.Signals(-return_code).name
        else:
            exit_code = return_code

        final_scratch_reason = scratch_limit_reason(
            scratch_view, config["limits"]["scratchBytes"], config["limits"]["scratchEntries"],
            lambda: False,
        )
        final_scratch_vfs = os.statvfs(scratch_view)
        evidence.append({"phase": "scratch-after", "limitReason": final_scratch_reason,
                         "capacityBytes": final_scratch_vfs.f_blocks * final_scratch_vfs.f_frsize,
                         "freeBytes": final_scratch_vfs.f_bfree * final_scratch_vfs.f_frsize})
        if final_scratch_reason is not None:
            scratch_overflow = True
        os.close(scratch_fd)
        scratch_fd = None
        verify_profile(profile)
        after_path, after_dir = cgroup_for_pid(os.getpid())
        after_info = after_dir.stat()
        if after_path != cgroup_path or f"{after_info.st_dev}:{after_info.st_ino}" != cgroup_id:
            raise RuntimeError("transient scope identity changed")
        after_controls, after_raw = read_controls(after_dir)
        after = {"observedAt": timestamp(),
                 "controls": after_controls}
        remaining = [int(value) for value in (after_dir / "cgroup.procs").read_text().split()]
        process_tree_stopped = remaining == [os.getpid()]
        try:
            same_init = proc_start_ticks(init_pid) == init_ticks
        except (FileNotFoundError, ProcessLookupError):
            same_init = False
        process_tree_stopped = process_tree_stopped and not same_init
        evidence.append({"phase": "after", "cgroupPath": after_path, "cgroupId": cgroup_id,
                         "rawControls": after_raw, "remainingPids": remaining,
                         "cgroupProcs": (after_dir / "cgroup.procs").read_text(),
                         "namespaceInitStillSameProcess": same_init})
        if after_controls != expected:
            raise RuntimeError("after controls do not match expected controls")
        observation_complete = True
        if stdout_overflow or stderr_overflow or scratch_overflow or not process_tree_stopped:
            outcome = "evidence_failed"
        elif timed_out:
            outcome = "timed_out"
        elif cancelled:
            outcome = "cancelled"
        elif exit_code == 0:
            outcome = "passed"
        else:
            outcome = "failed"
    except BaseException as error:
        if not cancelled and not timed_out:
            startup_error = f"{type(error).__name__}: {error}"
        if proc is not None and proc.poll() is None:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait(timeout=5)
            except BaseException:
                process_tree_stopped = False
        if cgroup_dir is not None:
            try:
                after_path, after_dir = cgroup_for_pid(os.getpid())
                after_info = after_dir.stat()
                if after_path != cgroup_path or f"{after_info.st_dev}:{after_info.st_ino}" != cgroup_id:
                    raise RuntimeError("transient scope identity changed during termination")
                after_controls, after_raw = read_controls(after_dir)
                after = {"observedAt": timestamp(),
                         "controls": after_controls}
                remaining = [int(value) for value in (after_dir / "cgroup.procs").read_text().split()]
                try:
                    same_init = proc_start_ticks(init_pid) == init_ticks
                except (FileNotFoundError, ProcessLookupError):
                    same_init = False
                process_tree_stopped = remaining == [os.getpid()] and not same_init
                evidence.append({"phase": "after-termination", "cgroupPath": after_path,
                                 "cgroupId": cgroup_id, "rawControls": after_raw,
                                 "remainingPids": remaining,
                                 "cgroupProcs": (after_dir / "cgroup.procs").read_text(),
                                 "namespaceInitStillSameProcess": same_init})
                observation_complete = (before is not None and process_tree_stopped
                                        and before["controls"] == expected and after_controls == expected)
            except BaseException as cleanup_error:
                process_tree_stopped = False
                startup_error = startup_error or f"termination evidence failed: {cleanup_error}"
        if cancelled:
            outcome = "cancelled"
        elif timed_out:
            outcome = "timed_out"
        elif before is not None:
            outcome = "evidence_failed"
        else:
            outcome = "startup_failed"

    if scratch_fd is not None:
        try:
            os.close(scratch_fd)
        except OSError:
            pass
    ended_wall = time.time()
    ended_at = timestamp(ended_wall)
    observation_state = "complete" if observation_complete else "unknown"
    observation: dict[str, Any] = {
        **identity, "version": 1, "attemptSequence": config["attemptSequence"],
        "isolationProfileSha256": config["isolationProfileSha256"], "state": observation_state,
        "scopeUnit": scope_unit, "cgroupPath": cgroup_path, "cgroupId": cgroup_id,
        "hostBootId": host_boot_id,
        "namespaceInitPid": init_pid, "namespaceInitStartTicks": init_ticks,
        "before": before, "after": after,
        "kernelEvidenceBase64": base64.b64encode(canonical(evidence)).decode(),
    }
    if observation_state == "unknown":
        observation["unknownReason"] = startup_error or "incomplete runtime observation"
    result = {
        "outcome": outcome, "exitCode": exit_code, "signal": signal_name,
        "timedOut": timed_out, "cancelled": cancelled, "startupError": startup_error,
        "processTreeStopped": process_tree_stopped, "startedAt": started_at, "endedAt": ended_at,
        "durationMs": round((time.monotonic() - started_mono) * 1000),
        "stdoutBase64": base64.b64encode(stdout).decode(),
        "stderrBase64": base64.b64encode(stderr).decode(),
        "stdoutComplete": not stdout_overflow, "stderrComplete": not stderr_overflow,
        "runtimeObservation": observation,
    }
    send_result(result)
    while not ack.wait(0.1):
        if cancel_reason and "abort-seal" in cancel_reason:
            return 74
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BaseException as exc:
        sys.stderr.write(f"closeout supervisor fatal: {type(exc).__name__}: {exc}\n")
        raise
