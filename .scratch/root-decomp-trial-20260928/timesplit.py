import json, sys
# Split a bench run's wall time: child (delegate durationMs), Root failed requests (error until next request),
# Root successful steps minus child time (= Root LLM + light tools). Assistant timestamp = request start.
for path in sys.argv[1:]:
    steps = []  # (start_ts, stopReason, [delegate durations])
    user_ts = None; end_ts = None
    for l in open(path):
        try: e = json.loads(l)
        except Exception: continue
        if e.get('type') != 'message_end': continue
        m = e['message']; r = m.get('role'); t = m.get('timestamp')
        if r == 'user' and user_ts is None: user_ts = t
        if r == 'assistant': steps.append([t, m.get('stopReason'), []])
        if r == 'toolResult':
            end_ts = t
            if m.get('toolName') == 'delegate' and steps:
                steps[-1][2].append(((m.get('details') or {}).get('usage') or {}).get('durationMs', 0) / 1000)
    wall_file = path.replace('.jsonl', '.wall')
    try: wall = float(open(wall_file).read())
    except Exception: wall = None
    child = err = root = 0; root_steps = []
    for i, (s, stop, ds) in enumerate(steps):
        nxt = steps[i + 1][0] if i + 1 < len(steps) else s
        dur = (nxt - s) / 1000
        if stop == 'error': err += dur
        else:
            child += sum(ds); r = max(dur - sum(ds), 0); root += r; root_steps.append(r)
    n_err = sum(1 for s in steps if s[1] == 'error')
    root_steps.sort()
    print(f"{path.split('/')[-1]:40s} wall={wall} child={child:.0f} root_ok={root:.0f} (steps={len(root_steps)}, median={root_steps[len(root_steps)//2]:.0f}s, max={root_steps[-1]:.0f}s) root_err={err:.0f} (n={n_err})")
