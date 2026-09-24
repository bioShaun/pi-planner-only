#!/usr/bin/env python3
"""Ordinary-terminal driver for the real pi TUI. Cleanup never counts as PASS."""
import errno, json, os, pty, select, signal, sys, time
from tui_proof import inspect_rows
command_file, event_file, report_file = sys.argv[1:4]
scenario = sys.argv[4] if len(sys.argv) > 4 else "plain"
if scenario not in ("plain", "queued", "scheduled", "combined"):
    raise ValueError("invalid TUI scenario")
with open(command_file) as f:
    command = json.load(f)
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execvp(command[0], command)
started = time.monotonic()
quit_at = None
exit_status = None
injections = []
def read_rows():
    try:
        with open(event_file) as f:
            return [json.loads(line) for line in f if line.strip()]
    except (FileNotFoundError, json.JSONDecodeError):
        return []
try:
    while time.monotonic() - started < 150:
        ready, _, _ = select.select([fd], [], [], 0.05)
        if ready:
            try:
                data = os.read(fd, 65536)
                if data:
                    os.write(1, data)
                    if b"\x1b[6n" in data:
                        os.write(fd, b"\x1b[1;1R")
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
        rows = read_rows()
        proof = inspect_rows(rows, scenario)
        if scenario in ("queued", "combined") and not injections:
            request = next((e for e in rows if e.get("kind") == "launcher" and e.get("event") == "request"), None)
            if request and not proof.get("closureObserved"):
                injections.append({"kind": "queued", "atMs": time.time()*1000, "requestId": proof.get("originalRequestId")})
                os.write(fd, b"__study_tui_queued__ Continue the previous bounded task.\x1b\r")
        if quit_at is None and proof.get("ready") and time.time()*1000-proof["lastEventMs"] >= 3000:
            quit_at = time.monotonic()
            # Pi restores an aborted queued message into the editor. Clear that
            # unsent text only after stop/quiet evidence, then use normal exit.
            os.write(fd, b"\x03\x04")
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            exit_status = os.waitstatus_to_exitcode(status)
            break
        if quit_at is not None and time.monotonic()-quit_at > 10:
            break
finally:
    forced = exit_status is None
    if forced:
        try: os.killpg(pid, signal.SIGTERM)
        except ProcessLookupError: pass
        deadline = time.monotonic()+2
        while time.monotonic()<deadline:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_status=os.waitstatus_to_exitcode(status)
                break
            time.sleep(0.1)
        else:
            try: os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError: pass
            _, status=os.waitpid(pid,0)
            exit_status=os.waitstatus_to_exitcode(status)
    os.close(fd)
    final = inspect_rows(read_rows(), scenario)
    passed = quit_at is not None and not forced and exit_status == 0 and final.get("ready") is True
    with open(report_file,"w") as f:
        json.dump(dict(verdict="PASS" if passed else "NOT_PROVEN", scenario=scenario, injections=injections,
                       quietBeforeQuitMs=3000 if quit_at else None, quitKeys=["Ctrl-C (clear editor)", "Ctrl-D"], forcedCleanup=forced,
                       exitStatus=exit_status, observations=final), f, indent=2)
sys.exit(0 if passed else 2)
