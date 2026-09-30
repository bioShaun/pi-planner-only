"""Root assistant-turn duration vs output tokens / content kind (5 T2 runs).

Message timestamps are creation times (message_start == message_end), and an assistant message
is stamped when its LLM request starts. So (next message ts - assistant ts) = model generation
(+ tool time for the batch). For non-delegate turns with fast tools (read/git_audit) this is
essentially Root model generation. Output tokens include reasoning.
"""
import json, statistics as st, collections
R = "/project/tmp/ppo-bench/results/"
runs = {"o2-1": "o2-t2/runs/T2-lite-tds-strict-o2-1", "o2-2": "o2-t2/runs/T2-lite-tds-strict-o2-2",
        "r2t": "rdt-r2t/runs/T2-lite-tds-strict-treat-1", "r3t": "rdt-r3t/runs/T2-lite-tds-strict-treat-1",
        "r5s": "rdt-r5s/runs/T2-lite-tds-strict-treat-1"}
allrows = []; kinds = collections.Counter()
for k, b in runs.items():
    msgs = [json.loads(l)["message"] for l in open(R + b + ".jsonl") if l.startswith("{") and '"message_end"' in l[:40] or False]
    msgs = []
    for l in open(R + b + ".jsonl"):
        if l.startswith("{"):
            e = json.loads(l)
            if e.get("type") == "message_end": msgs.append(e["message"])
    rows = []
    for i, m in enumerate(msgs):
        if m.get("role") != "assistant": continue
        names = [c["name"] for c in m.get("content") or [] if c.get("type") == "toolCall"]
        nxt = msgs[i + 1]["timestamp"] if i + 1 < len(msgs) else None
        rows.append((names, (nxt - m["timestamp"]) / 1000 if nxt else None, (m.get("usage") or {}).get("output") or 0))
        for c in m.get("content") or []:
            if c.get("type") == "thinking": kinds["thinking_chars"] += len(c.get("thinking") or "")
            elif c.get("type") == "text": kinds["text_chars"] += len(c.get("text") or "")
            elif c.get("type") == "toolCall": kinds["args_" + c["name"] + "_chars"] += len(json.dumps(c.get("arguments")))
    wall = float(open(R + b + ".wall").read())
    fast = [r for r in rows if r[1] is not None and "delegate" not in r[0]]
    tf = sum(r[1] for r in fast)
    print(f"{k} wall={wall:.0f}s root_turns={len(rows)} non-delegate_turns={len(fast)} their_seconds={tf:.0f} ({tf/wall:.0%} of wall) out_tok={sum(r[2] for r in fast)}")
    allrows += fast
print("median s/turn", st.median(r[1] for r in allrows), "median out tok", st.median(r[2] for r in allrows))
for lo, hi in [(0, 200), (200, 500), (500, 1000), (1000, 10**7)]:
    b = [r[1] for r in allrows if lo <= r[2] < hi]
    if b: print(f"out_tok [{lo},{hi}) n={len(b)} mean={sum(b)/len(b):.1f}s median={st.median(b):.1f}s")
print(dict(kinds))
