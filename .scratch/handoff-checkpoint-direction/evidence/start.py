import json, glob, os
base = os.path.expanduser("~/.pi/agent/sessions/--project-glx-app-deliver-workspace-ai--")
full = {}
for f in sorted(glob.glob(base + "/2026-10-30*.jsonl")):
    first = None; brief = None; nturn = 0; supreq = 0; notif = 0; notif_chars = 0; tr_chars = 0
    for line in open(f):
        try: e = json.loads(line)
        except Exception: continue
        if e.get("type") == "custom_message":
            ct = e.get("customType", "")
            if "supervisor_request" in ct: supreq += 1
            if "notify" in ct: notif += 1; notif_chars += len(str(e.get("content")))
        if e.get("type") != "message": continue
        m = e["message"]
        if m.get("role") == "toolResult":
            tr_chars += sum(len(x.get("text", "")) for x in m.get("content") or [] if isinstance(x, dict))
        if m.get("role") == "user" and brief is None:
            c = m.get("content"); brief = c if isinstance(c, str) else "".join(x.get("text", "") for x in c if isinstance(x, dict))
        if m.get("role") == "assistant":
            nturn += 1
            u = m.get("usage") or {}
            if first is None: first = (u.get("input") or 0) + (u.get("cacheRead") or 0)
    name = os.path.basename(f)[:19]
    print(f"{name} first_ctx={first} root_turns={nturn} brief_chars={len(brief or '')} sup_req={supreq} notifies={notif} notify_chars={notif_chars} toolresult_chars={tr_chars}")
    full[name] = brief
f = sorted(full)[1]
print("\n=== FULL handoff message of", f, "\n", full[f][:2500], "\n...\n", full[f][-1500:])
