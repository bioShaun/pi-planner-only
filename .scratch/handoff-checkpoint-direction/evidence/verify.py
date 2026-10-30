import json, glob, os, re
base = os.path.expanduser("~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--")
def load(f):
    out = []
    for line in open(f):
        try: out.append(json.loads(line))
        except Exception: pass
    return out
def txt(m):
    c = m.get("content"); return c if isinstance(c, str) else "".join(x.get("text", "") for x in c or [] if isinstance(x, dict))
files = sorted(glob.glob(base + "/2026-10-30*.jsonl"))
briefs = {}
for f in files:
    for e in load(f):
        if e.get("type") == "message" and e["message"].get("role") == "assistant":
            for c in e["message"].get("content") or []:
                if isinstance(c, dict) and c.get("type") == "toolCall" and c["name"] == "handoff":
                    briefs[os.path.basename(f)[:19]] = c["arguments"]["brief"]
# 1. 17:51 brief vs 20:42 submitted message
src = briefs.get("2026-10-30T07-51-37")
f5 = [f for f in files if "09-51-27" in f][0]
sub = next(txt(e["message"]) for e in load(f5) if e.get("type") == "message" and e["message"].get("role") == "user")
print("capped brief in submitted msg verbatim:", src is not None and src in sub, len(src or ""), len(sub))
# 2/3. per brief: model override and planner-only attribution
for k, b in briefs.items():
    print(f"\n== brief from {k} len={len(b)}")
    for pat in [r"[^。\n]{0,60}(terra|gpt-6\.1-sol|模型覆盖|显式model|model=)[^。\n]{0,80}", r"[^。\n]{0,40}用户[^。\n]{0,10}planner-only[^。\n]{0,60}", r"[^。\n]{0,30}不要再次handoff[^。\n]{0,60}"]:
        for m in list(re.finditer(pat, b))[:3]:
            print("  *", m.group(0).replace("\n", " ")[:200])
