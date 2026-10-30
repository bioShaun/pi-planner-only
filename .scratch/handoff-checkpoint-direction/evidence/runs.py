import json, glob, os
from datetime import datetime
d = os.path.expanduser("~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--/subagent-artifacts")
rows = []
for f in glob.glob(d + "/*_meta.json"):
    if os.path.getmtime(f) < datetime(2026, 10, 30, 11).timestamp():
        continue
    try:
        m = json.load(open(f))
    except Exception:
        continue
    rows.append((os.path.getmtime(f), os.path.basename(f), m))
rows.sort()
keys = set()
for _, n, m in rows[:1]:
    print("KEYS", list(m.keys()))
tot = 0
for mt, n, m in rows:
    dur = m.get("durationMs") or m.get("duration_ms") or 0
    tot += dur
    u = m.get("usage") or {}
    print(f"{datetime.fromtimestamp(mt):%H:%M} {n[:45]:45} {m.get('agent','?'):8} {m.get('model','?')!s:28} {dur/60000:6.1f}m exit={m.get('exitCode', m.get('status'))} tok_in={u.get('input', u.get('inputTokens'))} cost={u.get('cost')}")
print("count", len(rows), "sum minutes", round(tot / 60000, 1))
