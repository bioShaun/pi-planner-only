import json, sys, glob, os
from datetime import datetime

def ts(e):
    t = e.get("timestamp") or (e.get("message") or {}).get("timestamp")
    if t is None:
        return None
    if isinstance(t, (int, float)):
        return datetime.fromtimestamp(t / 1000 if t > 1e11 else t)
    try:
        return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    except Exception:
        return None

def text_of(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return ""

files = sorted(glob.glob(os.path.expanduser(sys.argv[1])))
for f in files:
    if os.path.getmtime(f) < datetime(2026, 10, 30).timestamp():
        continue
    times, users, ntool, model = [], [], 0, set()
    for line in open(f):
        try:
            e = json.loads(line)
        except Exception:
            continue
        t = ts(e)
        if t:
            times.append(t)
        if e.get("type") == "message":
            m = e["message"]
            if m.get("role") == "user":
                users.append((t, text_of(m)[:160].replace("\n", " ")))
            if m.get("role") == "toolResult":
                ntool += 1
            if m.get("role") == "assistant" and m.get("model"):
                model.add(m["model"])
        if e.get("type") == "model_change":
            model.add(e.get("modelId"))
    if not times:
        continue
    times.sort()
    gaps = sorted(((b - a).total_seconds(), a, b) for a, b in zip(times, times[1:]))[-3:]
    active = sum(min((b - a).total_seconds(), 300) for a, b in zip(times, times[1:]))
    print(f"\n### {os.path.basename(f)}")
    print(f"  span {times[0]:%m-%d %H:%M} -> {times[-1]:%m-%d %H:%M}  wall={(times[-1]-times[0]).total_seconds()/3600:.2f}h active(gap<=5m)={active/3600:.2f}h  tools={ntool} users={len(users)} models={model}")
    print("  top gaps:", [(round(g/60, 1), f"{a:%H:%M}") for g, a, b in gaps])
    for t, u in users[:6]:
        print(f"  U {t:%H:%M} {u}")
