"""Compare per-delegation child behaviour between bench runs (O2 check).

Usage: python3 o2_compare.py <label>=<run.jsonl>[,<run.jsonl>...] ...
For each label: valid runs, pass/fail, wall, per-role delegation counts, and for workers:
turns, tool calls, calls per turn, duration per delegation (median and totals).
"""
import json, os, sys, statistics as st

def load(path):
    base = path[:-len(".jsonl")]
    ev = json.load(open(base + ".eval.json")) if os.path.exists(base + ".eval.json") else {}
    wall = float(open(base + ".wall").read()) if os.path.exists(base + ".wall") else None
    dels = []
    for l in open(path):
        try: e = json.loads(l)
        except Exception: continue
        if e.get("type") != "message_end": continue
        m = e["message"]
        if m.get("role") == "toolResult" and m.get("toolName") == "delegate":
            d = m.get("details") or {}; u = d.get("usage") or {}
            dels.append(dict(role=d.get("role"), status=d.get("status"), turns=u.get("turns") or 0,
                             calls=u.get("toolCalls") or 0, dur=(u.get("durationMs") or 0) / 1000))
    return ev, wall, dels

for arg in sys.argv[1:]:
    label, files = arg.split("=", 1)
    runs = [load(f) for f in files.split(",")]
    valid = [r for r in runs if r[0].get("valid") is True]
    print(f"== {label}: runs={len(runs)} valid={len(valid)}")
    for ev, wall, dels in valid:
        roles = {}
        for d in dels: roles[d["role"]] = roles.get(d["role"], 0) + 1
        w = [d for d in dels if d["role"] == "worker"]
        print(f"   pass={ev.get('pass', ev.get('passed'))} wall={wall} delegations={roles} "
              f"worker_turns={sum(d['turns'] for d in w)} worker_s={sum(d['dur'] for d in w):.0f}")
    w = [d for _, _, dels in valid for d in dels if d["role"] == "worker"]
    if w:
        print(f"   worker delegations n={len(w)}: median turns={st.median(d['turns'] for d in w)}, "
              f"median calls={st.median(d['calls'] for d in w)}, calls/turn={sum(d['calls'] for d in w)/max(1,sum(d['turns'] for d in w)):.2f}, "
              f"median dur={st.median(d['dur'] for d in w):.0f}s, s/turn={sum(d['dur'] for d in w)/max(1,sum(d['turns'] for d in w)):.1f}, "
              f"non-completed={sum(d['status']!='completed' for d in w)}")
    a = [d for _, _, dels in valid for d in dels]
    if a:
        print(f"   all children: total turns={sum(d['turns'] for d in a)}, calls/turn={sum(d['calls'] for d in a)/max(1,sum(d['turns'] for d in a)):.2f}, total child s={sum(d['dur'] for d in a):.0f}")
