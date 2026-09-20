#!/usr/bin/env python3
"""Ordinary-terminal PTY driver; real pi TUI, no emulator of plugin hooks.
The bounded quiet observation ends before Ctrl-D. It is not proof of all future
host activity or of OS grandchildren termination. Only its own group is killed.
"""
import errno, json, os, pty, select, signal, sys, time
command_file, event_file, report_file = sys.argv[1:]
with open(command_file) as f:
    command = json.load(f)
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp(command[0], command)
started = time.monotonic()
quit_at = None
exit_status = None
proof = {}
def inspect():
    try:
        with open(event_file) as f:
            rows = [json.loads(line) for line in f if line.strip()]
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    closed = [e for e in rows if any(r.get('closedReason') for r in e.get('requests', []))]
    settled = [e for e in closed if e.get('hook') == 'agent_settled']
    cancel = [e for e in closed if e.get('kind') == 'launcher' and e.get('event') == 'cancel']
    terminal = [e for e in closed if e.get('event') == 'response' and e.get('status') == 'cancelled'
                and any(all(e.get(k) == c.get(k) for k in ('requestId','ownerRunId','nodeId')) for c in cancel)]
    bad = [e for e in closed if e.get('hook') in ('before_provider_request','tool_call')
           or e.get('kind') == 'launcher' and e.get('event') == 'request']
    return dict(hasUI=any(e.get('hasUI') is True for e in rows), closureObserved=bool(closed),
                cancelObserved=bool(cancel), cancelledTerminal=bool(terminal), settled=bool(settled),
                afterClosureCalls=len(bad), lastEventMs=max((e['t'] for e in rows), default=0))
try:
    while time.monotonic() - started < 150:
        ready, _, _ = select.select([fd], [], [], 0.2)
        if ready:
            try:
                data = os.read(fd, 65536)
                if data:
                    os.write(1, data)
                    # Reply to standard cursor-position query used by terminal detection.
                    if b'\x1b[6n' in data:
                        os.write(fd, b'\x1b[1;1R')
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
        proof = inspect()
        if (quit_at is None and all(proof.get(k) for k in ('hasUI','closureObserved','cancelObserved','cancelledTerminal','settled'))
                and proof.get('afterClosureCalls') == 0 and time.time()*1000-proof['lastEventMs'] >= 3000):
            quit_at = time.monotonic()
            proof['quietBeforeQuitMs'] = 3000
            os.write(fd, b'\x04')
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
    final = inspect()
    passed = quit_at is not None and not forced and exit_status == 0 and final.get('afterClosureCalls') == 0
    with open(report_file,'w') as f:
        json.dump(dict(verdict='PASS' if passed else 'NOT_PROVEN', quietBeforeQuitMs=3000 if quit_at else None,
                       forcedCleanup=forced, exitStatus=exit_status, observations=final),f,indent=2)
sys.exit(0 if passed else 2)
