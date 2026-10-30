import json, glob, os, re
from datetime import datetime
base = os.path.expanduser("~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--")
since = datetime(2026, 10, 30, 11).timestamp()
child = 0; cats = {}
for f in glob.glob(base + "/subagent-artifacts/*_meta.json"):
    if os.path.getmtime(f) < since: continue
    m = json.load(open(f)); child += (m.get("usage") or {}).get("cost") or 0
    t = m.get("task") or ""
    head = t[:400]
    if re.search(r"归档|archive|入口更新|erratum|勘误", head, re.I): c = "归档/入口"
    elif re.search(r"审查|review|复核|audit|核验", head, re.I): c = "审查/复核"
    elif re.search(r"设计|design|只读|read-only|critique", head, re.I): c = "设计/只读调研"
    elif re.search(r"真实模型|real model|matrix|矩阵|评测|eval", head, re.I): c = "真实模型评测"
    else: c = "实现/其他"
    cats.setdefault(c, []).append(head[:90].replace("\n", " "))
print("child cost", round(child, 2))
for c, v in cats.items():
    print(c, len(v))
    for x in v[:4]: print("   ", x)
root = 0; gapinfo = []
for f in glob.glob(base + "/2026-10-30*.jsonl"):
    for line in open(f):
        try: e = json.loads(line)
        except Exception: continue
        if e.get("type") == "message" and e["message"].get("role") == "assistant":
            root += ((e["message"].get("usage") or {}).get("cost") or {}).get("total", 0) if isinstance((e["message"].get("usage") or {}).get("cost"), dict) else 0
print("root cost", round(root, 2))
f = glob.glob(base + "/2026-10-30T09-51-27*.jsonl")[0]
for line in list(open(f))[:12]:
    e = json.loads(line); print(e.get("type"), e.get("timestamp"), str(e)[:200])
