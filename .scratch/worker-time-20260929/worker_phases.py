"""Worker turn phases: turns before first edit, reasoning share, per-turn tool mix.
Same default sample as worker_time.py (sample-manifest.tsv, worker transcripts only, gpt-6-luna only).
"First edit" = first turn calling edit/write/apply_patch; files written through bash are not detected.
"""
import json, os, sys, statistics as st

MUT = {"edit", "write", "apply_patch"}
SHORT = 200  # "short turn" = fewer output tokens than this; same cut as worker_time.py
HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = "/project/tmp/worker-time-20260929/samples"
if sys.argv[1:]:
    paths = sys.argv[1:]
else:
    names = [l.split("\t")[0] for l in open(os.path.join(HERE, "sample-manifest.tsv")) if l.strip()]
    paths = [os.path.join(SAMPLES, n) for n in names if "_worker_" in n]
pre = []  # (turns before first edit, total turns, wall share before first edit), edited runs only
no_edit = 0; tot_turns = []; walls = []; reas = []; outs = []; single_call = 0; nturn = 0
post_edit_bash = []
lat_by_reason = []
for p in paths:
    meta_p = p.replace("_transcript.jsonl", "_meta.json")
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    if "gpt-6-luna" not in meta.get("model", ""): continue
    ev = [json.loads(l) for l in open(p) if l.strip()]
    t0 = ev[0]["ts"]; turns = 0; first_edit_turn = None; first_edit_ts = None; last_in = None
    bash_after = 0
    for e in ev:
        m = e.get("message") or {}; se = e.get("sourceEventType")
        if se == "message_end" and m.get("role") in ("user", "toolResult"): last_in = e["ts"]
        if se == "message_end" and m.get("role") == "assistant":
            turns += 1; nturn += 1
            u = m.get("usage") or {}
            reas.append(u.get("reasoning", 0) or 0); outs.append(u.get("output", 0) or 0)
            lat_by_reason.append(((e["ts"] - (last_in or t0)) / 1000, u.get("reasoning", 0) or 0, u.get("output", 0) or 0))
            calls = [c for c in (m.get("content") or []) if c.get("type") == "toolCall"]
            if len(calls) == 1: single_call += 1
            if first_edit_turn is None and any(c.get("name") in MUT for c in calls):
                first_edit_turn = turns; first_edit_ts = e["ts"]
            if first_edit_turn is not None and any(c.get("name") == "bash" for c in calls): bash_after += 1
    wall = (ev[-1]["ts"] - t0) / 1000
    walls.append(wall); tot_turns.append(turns)
    if first_edit_turn is not None:
        pre.append((first_edit_turn - 1, turns, (first_edit_ts - t0) / 1000 / wall))
        post_edit_bash.append(bash_after)
    else:
        no_edit += 1
print(f"luna workers: n={len(walls)}, median turns={st.median(tot_turns)}; runs with an edit-tool call: {len(pre)}, without: {no_edit}")
print(f"[edited runs] turns before first edit: median={st.median(x[0] for x in pre)} "
      f"(share of that run's turns median {st.median(x[0]/x[1] for x in pre):.0%}); wall share before first edit median={st.median(x[2] for x in pre):.0%}")
print(f"turns with bash after first edit (verify/fix loop): median={st.median(post_edit_bash)}")
print(f"reasoning tokens / output tokens overall: {sum(reas)/max(1,sum(outs)):.0%}; turns with a single tool call: {single_call/nturn:.0%}")
nz = [x for x in lat_by_reason if x[2] < SHORT]
if nz:
    lo = [x[0] for x in nz if x[1] == 0]; hi = [x[0] for x in nz if x[1] > 0]
    print(f"short turns (<{SHORT} out tok): no-reasoning median {st.median(lo) if lo else float('nan'):.1f}s (n={len(lo)}), with-reasoning median {st.median(hi) if hi else float('nan'):.1f}s (n={len(hi)})")
