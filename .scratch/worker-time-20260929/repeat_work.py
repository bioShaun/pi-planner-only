#!/usr/bin/env python3
"""Link T2 Root delegations to child transcripts and measure repeated work."""
import datetime as dt
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

DEFAULTS = [
    "/project/tmp/ppo-bench/results/o2-t2/runs/T2-lite-tds-strict-o2-1.jsonl",
    "/project/tmp/ppo-bench/results/o2-t2/runs/T2-lite-tds-strict-o2-2.jsonl",
    *[f"/project/tmp/ppo-bench/results/{c}/runs/T2-lite-tds-strict-treat-1.jsonl"
      for c in ("rdt-r2t", "rdt-r3t", "rdt-r5s")],
]
ARTIFACTS = "/project/tmp/pi-subagents-uid-1000/artifacts"
ROLE_AGENT = {"explorer": "scout", "researcher": "scout", "planner-scout": "scout"}


def parts(x):
    if isinstance(x, str): return x
    if isinstance(x, list): return "\n".join(parts(v) for v in x)
    if isinstance(x, dict): return str(x.get("text", x.get("content", "")))
    return ""


def root_rows(path):
    calls, results = {}, []
    for line in open(path):
        try: e = json.loads(line)
        except ValueError: continue
        m = e.get("message") or {}
        if e.get("type") != "message_end": continue
        if m.get("role") == "assistant":
            for c in m.get("content", []) if isinstance(m.get("content"), list) else []:
                if c.get("type") in ("toolCall", "tool_call") and c.get("name") == "delegate":
                    calls[c.get("id")] = c.get("arguments") or {}
        if m.get("role") == "toolResult" and m.get("toolName") == "delegate":
            d = m.get("details") or {}
            results.append((m, d, calls.get(m.get("toolCallId"), {}), e.get("timestamp", 0)))
    out = []
    for i, (m, d, a, ts) in enumerate(results, 1):
        u = d.get("usage") or {}
        out.append({"i": i, "role": d.get("role", "?"), "agent": d.get("agent", ""),
                    "task": parts(a.get("task", "")),
                    "report": parts(d.get("content") or d.get("result") or d.get("text") or m.get("content")),
                    "usage": u, "ts": ts})
    return out


def load_index():
    index = defaultdict(list)
    for mp in glob.glob(os.path.join(ARTIFACTS, "*_meta.json")):
        try:
            meta = json.load(open(mp))
            tr = mp.replace("_meta.json", "_transcript.jsonl")
            if os.path.isfile(tr): index[meta.get("agent", "")].append((mp, tr, meta))
        except (OSError, ValueError): pass
    return index


def parse_transcript(path):
    calls, texts, timestamps, cwd = [], [], [], set()
    for line in open(path, errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        if e.get("cwd"): cwd.add(e["cwd"])
        if e.get("ts"): timestamps.append(e["ts"])
        m = e.get("message") or {}
        if m.get("role") == "assistant":
            for c in m.get("content", []) if isinstance(m.get("content"), list) else []:
                if c.get("type") not in ("toolCall", "tool_call"): continue
                args = c.get("arguments") or {}
                calls.append((c.get("name", ""), args, e.get("ts")))
        elif m.get("role") == "assistant'": pass
        if m.get("role") in ("assistant", "user"):
            txt = parts(m.get("content"))
            if txt: texts.append(txt)
    return calls, "\n".join(texts), timestamps, cwd


def parse_time(s):
    try: return dt.datetime.fromisoformat(s).timestamp()
    except (ValueError, TypeError): return 0


def match_transcript(row, index, run_id, run_meta):
    agent = row["agent"] or ROLE_AGENT.get(row["role"], row["role"])
    u = row["usage"]
    ranked = []
    run_start = parse_time(run_meta.get("start"))
    for mp, tp, meta in index.get(agent, []):
        usage = meta.get("usage", {})
        if usage.get("turns") != u.get("turns"): continue
        dur = abs(int(meta.get("durationMs", -999999)) - int(u.get("durationMs", -999999)))
        tools = abs(int(meta.get("toolCount", -999999)) - int(u.get("toolCalls", -999999)))
        if dur > 10000 or tools > 0: continue
        score = 100 - dur / 1000
        if run_start and abs(os.path.getmtime(mp) - run_start) < 7200: score += 10
        if run_id in open(tp, errors="replace").read(400000): score += 1000
        ranked.append((score, mp, tp, meta))
    ranked.sort(reverse=True)
    if not ranked or (len(ranked) > 1 and ranked[0][0] == ranked[1][0]): return None
    return ranked[0][1:]


def tool_paths(name, a):
    result = []
    if name == "read" and a.get("path"): result.append(a["path"])
    if name == "bash":
        cmd = a.get("command", "")
        # File operands in common inspection commands; paths extracted conservatively.
        if re.search(r"\b(cat|sed|head|tail|rg|less|awk)\b", cmd):
            result += re.findall(r"(?<![\w-])(?:\./|/|[\w-]+/)[\w./-]+\.[A-Za-z0-9_-]+", cmd)
    return [os.path.normpath(p) for p in result if p and not p.startswith("-")
            and not os.path.basename(p).isdigit()]


def command_key(a):
    cmd = re.sub(r"\s+", " ", a.get("command", "").strip())
    return cmd


def analyze(path, index):
    rows = root_rows(path)
    stem = os.path.basename(path).removesuffix(".jsonl")
    run_meta_path = path.removesuffix(".jsonl") + ".meta.json"
    run_meta = json.load(open(run_meta_path)) if os.path.exists(run_meta_path) else {}
    campaign = path.split("/results/")[1].split("/")[0]
    run_id = f"{campaign}-{stem}"
    linked = []
    for row in rows:
        hit = match_transcript(row, index, run_id, run_meta)
        if hit:
            mp, tp, meta = hit
            calls, text, times, cwds = parse_transcript(tp)
            row.update({"transcript": tp, "calls": calls, "child_text": text, "times": times,
                        "cwd": " ".join(sorted(cwds)), "toolcount": len(calls)})
            linked.append(row)
        else: row.update({"calls": [], "child_text": "", "times": [], "toolcount": 0})
    all_reads, within_reads, cross_reads = Counter(), Counter(), Counter()
    all_cmds, within_cmds, cross_cmds = Counter(), Counter(), Counter()
    locations = defaultdict(list)
    for r in linked:
        localr, localc = Counter(), Counter()
        for name, args, ts in r["calls"]:
            for p in tool_paths(name, args):
                all_reads[p] += 1; localr[p] += 1; locations[p].append((r, name))
            if name == "bash" and args.get("command"):
                k = command_key(args); all_cmds[k] += 1; localc[k] += 1
        within_reads.update(v - 1 for v in localr.values() if v > 1)
        within_cmds.update(v - 1 for v in localc.values() if v > 1)
    for p, n in all_reads.items():
        agents = {r["i"] for r, _ in locations[p]}
        if len(agents) > 1: cross_reads[p] = n - 1
    cmd_locs = defaultdict(set)
    for r in linked:
        for name, args, _ in r["calls"]:
                if name == "bash" and len(command_key(args)) >= 5: cmd_locs[command_key(args)].add(r["i"])
    cross_cmds = Counter({k: n - 1 for k, n in all_cmds.items() if len(cmd_locs[k]) > 1})
    total = sum(r["toolcount"] for r in linked)
    repeats = sum(within_reads.values()) + sum(cross_reads.values()) + sum(within_cmds.values()) + sum(cross_cmds.values())
    # Tool call records have timestamps, but no call start/end durations; don't
    # mislabel wall-clock span between calls as time attributable to repetition.
    handoff = []
    for later_pos, later in enumerate(rows):
        named = set(re.findall(r"(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9_-]+", later["task"]))
        for earlier in rows[:later_pos]:
            named.update(re.findall(r"(?:[\w.-]+/)+[\w.-]+\.[A-Za-z0-9_-]+", earlier["report"]))
        for name, args, _ in later.get("calls", []):
            for p in tool_paths(name, args):
                if any(p.endswith(n) or n.endswith(p) for n in named):
                    handoff.append((earlier["i"] if rows[:later_pos] else 0, later["i"], p))
    return rows, linked, (all_reads, within_reads, cross_reads, all_cmds, within_cmds, cross_cmds), total, repeats, handoff


def main():
    idx = load_index()
    summaries, waste_examples = [], []
    for path in sys.argv[1:] or DEFAULTS:
        rows, linked, stats, total, repeats, handoff = analyze(path, idx)
        reads, wr, cr, cmds, wc, cc = stats
        name = os.path.basename(path)
        print(f"\n== {name}: delegations={len(rows)} matched={len(linked)}/{len(rows)} child_tool_calls={total}")
        print(f"file reread extra calls: within={sum(wr.values())} across={sum(cr.values())}; bash rerun extra calls: within={sum(wc.values())} across={sum(cc.values())}")
        print(f"repeated calls={repeats}/{total} ({repeats/total:.1%}); repeated-call time unavailable (timestamps lack per-call durations)" if total else "repeated calls=0/0")
        print(f"handoff-named file rereads={len(handoff)}")
        files = [(k,v) for k,v in (wr+cr).most_common() if isinstance(k, str) and "/" in k and "." in os.path.basename(k)][:5]
        commands = [(k,v) for k,v in (wc+cc).most_common() if isinstance(k, str) and len(k) > 10][:5]
        print("top repeated files:", "; ".join(f"{k} x{v+1}" for k,v in files) or "none")
        print("top repeated bash:", "; ".join(f"{k} x{v+1}" for k,v in commands) or "none")
        for r in rows:
            if not r["calls"]: print(f"UNMATCHED #{r['i']} role={r['role']} turns={r['usage'].get('turns')} durationMs={r['usage'].get('durationMs')} toolCalls={r['usage'].get('toolCalls')}")
        summaries.append((len(linked), len(rows), total, repeats))
        for key, cnt in (wr+cr).most_common():
            if key in ("1", "2"): continue
            if cnt: waste_examples.append((cnt, name, "file", key, "within" if key in wr else "cross"))
        for key, cnt in (wc+cc).most_common():
            if key in ("1", "2", "3"): continue
            if cnt: waste_examples.append((cnt, name, "bash", key, "within" if key in wc else "cross"))
    print("\n== TOTAL")
    print(f"matched delegations={sum(x[0] for x in summaries)}/{sum(x[1] for x in summaries)}; child calls={sum(x[2] for x in summaries)}; repeated calls={sum(x[3] for x in summaries)}")


if __name__ == "__main__": main()
