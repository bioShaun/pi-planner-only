import json, glob, os, re
from datetime import datetime
base = os.path.expanduser("~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--")
def lt(t):
    return datetime.fromisoformat(t.replace("Z", "+00:00")).astimezone().strftime("%H:%M:%S")
for f in sorted(glob.glob(base + "/2026-10-30*.jsonl")):
    print("\n####", os.path.basename(f)[:19])
    for line in open(f):
        try: e = json.loads(line)
        except Exception: continue
        ty = e.get("type")
        if ty == "custom":
            print(" ", lt(e["timestamp"]), "custom", e.get("customType"), json.dumps(e.get("data"), ensure_ascii=False)[:200])
        elif ty == "custom_message":
            print(" ", lt(e["timestamp"]), "custom_msg", e.get("customType"), str(e.get("content"))[:300].replace("\n", " "))
        elif ty == "message":
            m = e["message"]
            if m.get("role") in ("user", "system"):
                c = m.get("content")
                tx = c if isinstance(c, str) else " ".join(x.get("text", "") for x in c or [] if isinstance(x, dict))
                if re.search(r"context|上下文|handoff|阈值", tx[:3000], re.I) and m.get("role") == "user":
                    i = tx.find("planner-only"); print(" ", lt(e["timestamp"]), "USER", tx[:200].replace("\n", " "))
            if m.get("role") == "assistant":
                u = m.get("usage") or {}
                last_usage = (lt(e["timestamp"]), u.get("input"), u.get("cacheRead"), u.get("totalTokens"))
        elif ty not in ("model_change", "thinking_level_change", "session"):
            print(" ", lt(e.get("timestamp", "1970-01-01T00:00:00Z")), ty, str(e)[:200])
    print("  last usage", last_usage)
