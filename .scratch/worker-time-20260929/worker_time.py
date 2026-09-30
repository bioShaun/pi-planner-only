"""Split child (subagent) wall time into model time vs tool time, from pi-subagents transcripts.

Usage: python3 worker_time.py [transcript.jsonl ...]
Default sample: the 79 transcripts listed in sample-manifest.tsv (first column), read from the frozen copies in
/project/tmp/worker-time-20260929/samples (copied 2026-09-29; originals may be pruned by pi-subagents).
Model step = time from the previous input (prompt or last toolResult) to the assistant message_end.
Tool step  = time from that assistant message_end to the last toolResult of its batch.
"""
import glob, json, os, sys, statistics as st
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = "/project/tmp/worker-time-20260929/samples"

def default_paths():
    names = [l.split("\t")[0] for l in open(os.path.join(HERE, "sample-manifest.tsv")) if l.strip()]
    return [os.path.join(SAMPLES, n) for n in names]

paths = sys.argv[1:] or default_paths()
rows = []
tool_tot = defaultdict(float); tool_n = defaultdict(int)
slow_cmds = []
turn_lat = []  # (latency_s, output_tokens, context_tokens, model)
for p in paths:
    meta_p = p.replace("_transcript.jsonl", "_meta.json")
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    ev = [json.loads(l) for l in open(p) if l.strip()]
    if not ev: continue
    agent = ev[0].get("agent"); t0 = ev[0]["ts"]; t_end = ev[-1]["ts"]
    last_input = None; model_t = tool_t = 0.0; turns = 0; errs = 0; out_tok = 0; ctx_max = 0; calls = 0
    starts = {}; batch_start = None; first_model = None
    for e in ev:
        m = e.get("message") or {}; role = m.get("role"); se = e.get("sourceEventType")
        if se == "message_end" and role == "user" and last_input is None:
            last_input = e["ts"]
        elif se == "message_end" and role == "assistant":
            if batch_start is not None and last_input is not None and last_input > batch_start:
                tool_t += (last_input - batch_start) / 1000
            lat = (e["ts"] - (last_input or t0)) / 1000
            model_t += lat; turns += 1
            if first_model is None: first_model = (last_input or t0) - t0
            u = m.get("usage") or {}
            o = u.get("output", 0); ctx = u.get("input", 0) + u.get("cacheRead", 0)
            out_tok += o; ctx_max = max(ctx_max, ctx)
            if m.get("stopReason") == "error": errs += 1
            turn_lat.append((lat, o, ctx, meta.get("model", "?"), agent))
            batch_start = e["ts"]; last_input = e["ts"]
        elif se == "message_end" and role == "toolResult":
            last_input = e["ts"]
        elif se == "tool_execution_start":
            starts[e.get("toolCallId")] = (e["ts"], e.get("toolName"), e.get("argsPreview") or "")
            calls += 1
        elif se == "tool_execution_end":
            s = starts.pop(e.get("toolCallId"), None)
            if s:
                d = (e["ts"] - s[0]) / 1000
                tool_tot[(agent, s[1])] += d; tool_n[(agent, s[1])] += 1
                if d >= 20: slow_cmds.append((d, agent, s[1], s[2][:140].replace("\n", " ")))
    if batch_start is not None and last_input is not None and last_input > batch_start:
        tool_t += (last_input - batch_start) / 1000
    wall = (t_end - t0) / 1000
    rows.append(dict(agent=agent, model=meta.get("model", "?"), wall=wall, model_t=model_t, tool_t=tool_t,
                     other=wall - model_t - tool_t, turns=turns, calls=calls, errs=errs, out=out_tok, ctx=ctx_max,
                     dur=(meta.get("durationMs") or 0) / 1000, exit=meta.get("exitCode"), f=os.path.basename(p)[:8]))

def pct(a, b): return f"{100*a/b:4.0f}%" if b else "  - "
print(f"{'agent':8} {'model':28} {'n':>3} {'wall_s':>8} {'model%':>7} {'tool%':>6} {'other%':>7} {'turns':>6} {'calls':>6} {'out_tok':>8} {'ctx_max':>8} {'s/turn':>7}")
by = defaultdict(list)
for r in rows: by[(r["agent"], r["model"])].append(r)
for (a, mdl), rs in sorted(by.items()):
    W = sum(r["wall"] for r in rs); M = sum(r["model_t"] for r in rs); T = sum(r["tool_t"] for r in rs); O = sum(r["other"] for r in rs)
    print(f"{a:8} {mdl[:28]:28} {len(rs):3} {st.median([r['wall'] for r in rs]):8.0f} {pct(M,W):>7} {pct(T,W):>6} {pct(O,W):>7} "
          f"{st.median([r['turns'] for r in rs]):6.0f} {st.median([r['calls'] for r in rs]):6.0f} {st.median([r['out'] for r in rs]):8.0f} "
          f"{st.median([r['ctx'] for r in rs]):8.0f} {M/max(1,sum(r['turns'] for r in rs)):7.1f}")
print("\nper-run (worker):")
for r in sorted([r for r in rows if r["agent"] == "worker"], key=lambda r: -r["wall"]):
    print(f"  {r['f']} {r['model'][:24]:24} wall={r['wall']:6.0f} model={r['model_t']:6.0f} tool={r['tool_t']:6.0f} turns={r['turns']:3} calls={r['calls']:3} errs={r['errs']} out={r['out']:6} ctx_max={r['ctx']:7} exit={r['exit']}")
print("\ntool time by (agent, tool): total_s / count / mean_s")
for k, v in sorted(tool_tot.items(), key=lambda kv: -kv[1])[:15]:
    print(f"  {k[0]:8} {k[1]:12} {v:8.0f} {tool_n[k]:5} {v/tool_n[k]:7.1f}")
print("\nslow tool calls (>=20s), top 25:")
for d, a, t, c in sorted(slow_cmds, reverse=True)[:25]:
    print(f"  {d:6.0f}s {a:8} {t:6} {c}")
lat = [x for x in turn_lat if x[4] == "worker"]
if lat:
    ls = sorted(x[0] for x in lat)
    print(f"\nworker turn latency: n={len(ls)} median={st.median(ls):.1f}s p90={ls[int(.9*len(ls))]:.1f}s max={ls[-1]:.0f}s")
    for lo, hi in [(0, 200), (200, 1000), (1000, 4000), (4000, 10**9)]:
        b = [x for x in lat if lo <= x[1] < hi]
        if b: print(f"  out_tok {lo:>5}-{hi:<10} n={len(b):4} median_lat={st.median(x[0] for x in b):6.1f}s")
    for lo, hi in [(0, 20000), (20000, 50000), (50000, 100000), (100000, 10**9)]:
        b = [x for x in lat if lo <= x[2] < hi]
        if b: print(f"  ctx {lo:>6}-{hi:<10} n={len(b):4} median_lat={st.median(x[0] for x in b):6.1f}s")
    fast = [x for x in lat if x[1] < 200]
    if fast: print(f"  floor (turns with <200 out tokens): median {st.median(x[0] for x in fast):.1f}s")
