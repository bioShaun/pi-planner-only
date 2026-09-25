#!/usr/bin/env python3
"""Real spend for this experiment, read from the HOST's session transcripts.

Why not the plugin's own usage.jsonl: writeUsageLog() (index.ts:442) returns early
unless a Task exists and the ledger has usage for it. Groups C and D delegate
nothing, so they create no Task and would spend invisibly -- a gate that reads the
plugin ledger is blind exactly where the cheapest bug would cost money. The host
records `message.usage.cost.total` (and the same shape under `data.usage`) on every
assistant message regardless, so that is what the gate reads.

Usage: spend.py <session-dir> [<session-dir> ...]   -> total USD on stdout
"""
import json
import os
import sys


def cost_of(record):
    """Cost of one host message record.

    Only `type == "message"` counts. The plugin mirrors every root turn as a
    `type == "custom"` record carrying the SAME usage under `data.usage`
    (observed ids `root-turn:untasked:1..3` in session-SMOKE), so summing both
    holders doubles every root turn.
    """
    if record.get("type") != "message":
        return 0.0
    holder = record.get("message")
    if not isinstance(holder, dict):
        return 0.0
    usage = holder.get("usage")
    if not isinstance(usage, dict):
        return 0.0
    cost = usage.get("cost")
    if not isinstance(cost, dict):
        return 0.0
    value = cost.get("total")
    return float(value) if isinstance(value, (int, float)) else 0.0


def session_files(roots):
    """Every session transcript under `roots`, session dirs only.

    Walking the run dir at large would sweep in unrelated .jsonl files, so only
    paths below a `session-*` directory count.
    """
    for root in roots:
        if os.path.isfile(root):
            yield root
            continue
        for dirpath, _dirs, names in os.walk(root):
            base = os.path.basename(dirpath)
            if not (base.startswith("session-") or "/session-" in dirpath):
                continue
            for name in names:
                if name.endswith(".jsonl"):
                    yield os.path.join(dirpath, name)


def total_spend(roots):
    total = 0.0
    for path in session_files(roots):
        with open(path, errors="ignore") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(record, dict):
                    total += cost_of(record)
    return total


def require_session(path):
    """Fail closed: a group that ran must have left a readable transcript.

    Without this, a wrong path makes the gate report $0.00 forever and every
    later group runs unmetered -- the one failure mode a spend gate may not have.
    """
    files = [f for f in session_files([path])]
    if not files:
        sys.exit(f"spend gate: no session transcript under {path}; refusing to account for the spend")
    return files


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--require":
        require_session(args[1])
        print(f"{total_spend(args[1:]):.6f}")
    else:
        print(f"{total_spend(args):.6f}")
