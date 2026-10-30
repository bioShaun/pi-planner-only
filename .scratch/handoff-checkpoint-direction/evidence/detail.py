import json, sys, glob, os
from datetime import datetime

def ts(e):
    t = e.get("timestamp")
    if isinstance(t, str):
        return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    return None

def text_of(m):
    c = m.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        return " ".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")
    return ""

mode = sys.argv[2]
for f in sorted(glob.glob(os.path.expanduser(sys.argv[1]))):
    if os.path.getmtime(f) < datetime(2026, 10, 30, 11).timestamp():
        continue
    print(f"\n######## {os.path.basename(f)[:19]}")
    calls = {}
    last_asst = None
    for line in open(f):
        try:
            e = json.loads(line)
        except Exception:
            continue
        if e.get("type") != "message":
            continue
        m = e["message"]; t = ts(e)
        if m.get("role") == "user" and mode == "brief":
            print(f"--- USER {t:%H:%M}\n{text_of(m)[:int(sys.argv[3])]}")
        if m.get("role") == "assistant":
            tx = text_of(m)
            if tx.strip():
                last_asst = (t, tx)
            for c in m.get("content") or []:
                if isinstance(c, dict) and c.get("type") == "toolCall":
                    calls[c["id"]] = (t, c["name"], json.dumps(c.get("arguments"), ensure_ascii=False))
        if m.get("role") == "toolResult" and mode == "tools":
            cid = m.get("toolCallId")
            if cid in calls:
                t0, name, args = calls[cid]
                dur = (t - t0).total_seconds() / 60
                if dur >= float(sys.argv[3]):
                    print(f"  {t0:%H:%M} +{dur:5.1f}m {name}: {args[:260]}")
                    print(f"        -> {text_of(m)[:200]!r}")
    if mode == "last" and last_asst:
        print(f"--- LAST ASSISTANT {last_asst[0]:%H:%M}\n{last_asst[1][:int(sys.argv[3])]}")
