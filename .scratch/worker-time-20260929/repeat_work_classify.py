#!/usr/bin/env python3
"""Classify repeated reads and bash commands in selected T2 child runs."""
import importlib.util
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("repeat_work", HERE / "repeat_work.py")
rw = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(rw)
RUNS = [
    "/project/tmp/ppo-bench/results/o2-t2/runs/T2-lite-tds-strict-o2-1.jsonl",
    "/project/tmp/ppo-bench/results/rdt-r2t/runs/T2-lite-tds-strict-treat-1.jsonl",
    "/project/tmp/ppo-bench/results/rdt-r5s/runs/T2-lite-tds-strict-treat-1.jsonl",
]
LABELS = ("FIRST", "USEFUL-REVERIFY", "USEFUL-AFTER-EDIT", "WASTE-CROSS", "WASTE-SAME", "OTHER-REPEAT")


def transcript_events(path, row, index, run_id, run_meta):
    hit = rw.match_transcript(row, index, run_id, run_meta)
    if not hit:
        return [], "", "", []
    _, tp, _ = hit
    events, assistant_times, text = [], [], []
    for line in open(tp, errors="replace"):
        try: e = json.loads(line)
        except ValueError: continue
        msg = e.get("message") or {}
        stamp = e.get("ts") or (msg.get("timestamp") if isinstance(msg, dict) else None)
        role = msg.get("role")
        if role == "assistant" and stamp:
            assistant_times.append(int(stamp) / 1000)
        if role in ("assistant", "user"):
            text.append(rw.parts(msg.get("content")))
        if role != "assistant": continue
        for c in msg.get("content", []) if isinstance(msg.get("content"), list) else []:
            if c.get("type") not in ("toolCall", "tool_call"): continue
            events.append((int(stamp or 0) / 1000, row, c.get("name", ""), c.get("arguments") or {}))
    return events, "\n".join(text), tp, assistant_times


def modifies(name, args):
    if name in ("write", "edit", "apply_patch"):
        raw = str(args)
        return re.findall(r"(?:\./|/|[\w.-]+/)[\w./-]+", raw)
    if name == "bash":
        cmd = args.get("command", "")
        if re.search(r"\b(>|>>|tee|sed\s+-i|perl\s+-i|apply_patch)\b", cmd):
            return rw.tool_paths("bash", args)
    return []


def analyze(path, index):
    rows = rw.root_rows(path)
    meta_path = path.removesuffix(".jsonl") + ".meta.json"
    meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
    campaign = path.split("/results/")[1].split("/")[0]
    run_id = campaign + "-" + os.path.basename(path).removesuffix(".jsonl")
    stream, child_text, roles = [], {}, {}
    child_spans, all_turns = [], set()
    for row in rows:
        ev, text, tp, ats = transcript_events(path, row, index, run_id, meta)
        child_text[row["i"]] = row["task"] + "\n" + row["report"]
        roles[row["i"]] = row["role"]
        stream.extend(ev)
        if ats:
            unique = sorted(set(ats)); all_turns.update(unique)
            child_spans.append(unique[-1] - unique[0])
    stream.sort(key=lambda x: (x[0], x[1]["i"]))
    named = {}
    for row in rows:
        names = set(re.findall(r"(?:[\w.-]+/)+[\w.-]+(?:\.[A-Za-z0-9_-]+)?", child_text[row["i"]]))
        named[row["i"]] = names
    read_state, cmd_state = {}, {}
    latest_edit = 0
    counts, examples, turns = Counter(), defaultdict(list), defaultdict(list)
    # Approximate each assistant turn by this assistant timestamp to the next assistant timestamp.
    for i, (ts, row, tool, args) in enumerate(stream):
        child, role = row["i"], row["role"]
        units = []
        paths = [args["path"]] if tool == "read" and args.get("path") else rw.tool_paths(tool, args)
        paths = list(dict.fromkeys(os.path.normpath(p) for p in paths))
        for p in paths:
            units.append(("file", p, (tool, args)))
        if tool == "bash" and args.get("command"):
            units.append(("bash", rw.command_key(args), (tool, args)))
        for kind, key, payload in units:
            state_map = read_state if kind == "file" else cmd_state
            prior = state_map.get(key)
            changed = bool(prior and prior["modified"] > prior["read"])
            if prior and kind == "bash" and re.search(r"\b(pytest|test|lint|mypy|ruff)\b", key):
                changed = changed or latest_edit > prior["read"]
            actual_key = key[0] if isinstance(key, tuple) else key
            earlier_named = prior and prior["child"] != child and any(
                actual_key == n or actual_key.endswith("/" + n) or n.endswith("/" + actual_key)
                for n in named.get(prior["child"], set()))
            verifier = role in ("validator", "reviewer")
            if not prior: label = "FIRST"
            elif verifier and changed: label = "USEFUL-REVERIFY"
            elif changed: label = "USEFUL-AFTER-EDIT"
            elif kind == "bash" and prior["child"] == child: label = "WASTE-SAME"
            elif kind == "file" and prior["child"] == child and prior.get("range") == (args.get("offset", 0), args.get("limit")): label = "WASTE-SAME"
            elif role in ("worker", "explorer") and earlier_named: label = "WASTE-CROSS"
            else: label = "OTHER-REPEAT"
            counts[label] += 1
            examples[label].append((key[0] if isinstance(key, tuple) else key, role, child, kind))
            turns[ts].append(label)
            state_map[key] = {"read": ts, "modified": prior["modified"] if prior else 0, "child": child,
                              "range": (args.get("offset", 0), args.get("limit"))}
        for p in modifies(tool, args):
            p = os.path.normpath(p)
            latest_edit = max(latest_edit, ts)
            for state_map in (read_state, cmd_state):
                for key in state_map:
                    actual = key[0] if isinstance(key, tuple) else key
                    if actual == p: state_map[key]["modified"] = ts
    # Tool calls in one assistant message share its timestamp.
    assistant_stamps = sorted(all_turns)
    wasted = mixed = total_sec = 0.0
    for pos, start in enumerate(assistant_stamps):
        end = assistant_stamps[pos + 1] if pos + 1 < len(assistant_stamps) else start
        span = max(0, end - start)
        total_sec += span
        labs = turns.get(start, [])
        if labs and all(x.startswith("WASTE-") for x in labs): wasted += span
        elif any(x.startswith("WASTE-") for x in labs): mixed += span / 2
    wall_file = path.removesuffix(".jsonl") + ".wall"
    try: wall = float(open(wall_file).read().strip())
    except (OSError, ValueError): wall = 0
    return {"name": os.path.basename(path), "counts": counts, "examples": examples,
            "linked": sum(bool(transcript_events(path, r, index, run_id, meta)[0]) for r in rows),
            "delegations": len(rows), "total": sum(child_spans), "wasted": wasted,
            "mixed": mixed, "wall": wall, "turns": len(assistant_stamps)}


def main():
    index = rw.load_index()
    results = [analyze(p, index) for p in RUNS]
    header = "run " + " ".join(LABELS) + " child_s turns wall_s waste_s mixed_half_s waste_pct"
    print(header)
    total = Counter()
    for r in results:
        c = r["counts"]; total.update(c)
        pct = 100 * (r["wasted"] + r["mixed"]) / r["wall"] if r["wall"] else 0
        print(r["name"], *(c[x] for x in LABELS), f'{r["total"]:.1f}', r["turns"], f'{r["wall"]:.1f}',
              f'{r["wasted"]:.1f}', f'{r["mixed"]:.1f}', f'{pct:.2f}%')
    print("TOTAL", *(total[x] for x in LABELS), f'{sum(r["total"] for r in results):.1f}',
          sum(r["turns"] for r in results), f'{sum(r["wall"] for r in results):.1f}',
          f'{sum(r["wasted"] for r in results):.1f}', f'{sum(r["mixed"] for r in results):.1f}')
    for label in ("WASTE-CROSS", "WASTE-SAME"):
        print("EXAMPLES", label)
        seen = set()
        for r in results:
            for item in r["examples"].get(label, []):
                if item[0] not in seen:
                    print(" ", r["name"], item[1], item[0]); seen.add(item[0])
                    if len(seen) == 3: break
            if len(seen) == 3: break


if __name__ == "__main__": main()
