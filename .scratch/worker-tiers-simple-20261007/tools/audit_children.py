#!/usr/bin/env python3
"""核对 18 次被测 child：身份（model/thinking）、task 原文与 tasks/<run>.md 一致、工具调用是否越界读写。"""
import glob, json, os, re, sys

SESS = os.path.expanduser("~/.pi/agent/sessions/--home-tcuni-claw-pi-pi-planner-only--/2026-10-07T12-01-28-173Z_01a1163d-726d-738f-bb74-6aa6d77cd9bf")
B = "/project/tmp/worker-tiers-simple"
FORBID = [B + "/hidden", B + "/baseline", B + "/templates", B + "/eval", B + "/tasks", B + "/hidden-selftest",
          "/home/tcuni-claw/pi/pi-planner-only", "/home/tcuni-claw/.pi/agent/sessions", "nf-rnaseq-v2", "committed-variant", "smoke_ref"]
RUNRE = re.compile(r"worker-tiers-simple/(S[12]-[a-z]+-\d)")

out = []
for f in sorted(glob.glob(SESS + "/*/run-0/session.jsonl")):
    model = thinking = None
    first_user = None
    calls = []
    for line in open(f):
        o = json.loads(line)
        if o.get("type") == "model_change":
            model = f'{o.get("provider")}/{o.get("modelId")}'
        if o.get("type") == "thinking_level_change":
            thinking = o.get("thinkingLevel")
        m = o.get("message") or {}
        if m.get("role") == "user" and first_user is None:
            c = m.get("content")
            first_user = c if isinstance(c, str) else "".join(x.get("text", "") for x in c if isinstance(x, dict))
        if m.get("role") == "assistant":
            for c in m.get("content", []):
                if c.get("type") == "toolCall":
                    calls.append(json.dumps(c.get("arguments"), ensure_ascii=False))
    runs = RUNRE.findall(first_user or "")
    run = runs[0] if runs else None
    if not run:
        continue
    task = open(f"{B}/tasks/{run}.md").read().strip()
    same = task in (first_user or "")
    other = sorted({r for c in calls for r in RUNRE.findall(c)} - {run})
    bad = sorted({p for c in calls for p in FORBID if p in c and not (p == "/home/tcuni-claw/pi/pi-planner-only" and "pi-planner-only/node_modules" in c and c.count("pi-planner-only") == c.count("pi-planner-only/node_modules"))})
    out.append((run, model, thinking, same, len(calls), other, bad, f.split("/")[-3]))

for r in sorted(out):
    print(" | ".join(str(x) for x in r))
print("n =", len(out))
