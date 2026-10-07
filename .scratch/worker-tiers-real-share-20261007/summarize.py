#!/usr/bin/env python3
"""Recompute the share/saving numbers in findings.md from delegations.tsv, sessions.tsv,
labels-blind.tsv and spotcheck.tsv (run extract.py first; labels are fixed inputs)."""
import collections
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PER_TASK_SAVING_SIMPLE = 0.157 - 0.044  # Sonnet vs DeepSeek Flash mean per run, evidence doc 6.9
FLASH_RATIO = 0.28


def tsv(name):
    with open(os.path.join(HERE, name), newline="") as fh:
        return list(csv.DictReader(fh, delimiter="\t"))


def f(x):
    return float(x or 0)


dele = tsv("delegations.tsv")
sess = tsv("sessions.tsv")
labels = {r["id"]: r for r in tsv("labels-blind.tsv")}
spot = tsv("spotcheck.tsv")

by_sess = collections.defaultdict(list)
for d in dele:
    by_sess[d["session"]].append(d)

root_all = child_all = root_deleg = child_deleg = 0.0
for s in sess:
    ds = by_sess.get(s["session"], [])
    if ds and all(d["exclude"] for d in ds):
        continue  # pure controlled-experiment sessions
    child = sum(f(d["cost_usd"]) for d in ds if not d["exclude"])
    root_all += f(s["root_cost_usd"])
    child_all += child
    if ds:
        root_deleg += f(s["root_cost_usd"])
        child_deleg += child

workers = [d for d in dele if d["role"] == "worker" and not d["exclude"]]
assert {d["id"] for d in workers} == set(labels), "labels-blind.tsv out of sync"
n = len(workers)
cnt = collections.Counter(labels[d["id"]]["blind_label"] for d in workers)
sonnet_real = [f(d["cost_usd"]) for d in workers if "sonnet" in d["child_model"] and d["status"] == "completed"]

print(f"valid worker delegations: {n}; blind labels: {dict(cnt)}")
print(f"S share (blind): {cnt['S']}/{n} = {100 * cnt['S'] / n:.1f}%")
dis = [r for r in spot if r["blind_label"] != r["root_label"]]
moves_to_s = sum(1 for r in dis if r["root_label"] == "S")
print(f"spot check: {len(spot)} items, {len(dis)} disagree ({100 * len(dis) / len(spot):.0f}%), {moves_to_s} of them C->S")
c_rate = sum(1 for r in spot if r["blind_label"] == "C" and r["root_label"] == "S") / max(1, sum(1 for r in spot if r["blind_label"] == "C"))
s_hi = cnt["S"] + c_rate * cnt["C"]
print(f"S share adjusted by spot-check C->S rate {c_rate:.2f}: ~{s_hi:.0f}/{n} = {100 * s_hi / n:.0f}%")
print(f"worker status: {dict(collections.Counter(d['status'] for d in workers))}")
print(f"worker models: {dict(collections.Counter(d['child_model'] for d in workers))}")
print(f"real-session Sonnet worker cost: n={len(sonnet_real)} mean={sum(sonnet_real) / len(sonnet_real):.3f}")

per_real = (sum(sonnet_real) / len(sonnet_real)) * (1 - FLASH_RATIO)
for label, denom in (("all non-experiment sessions", root_all + child_all),
                     ("sessions with >=1 delegation", root_deleg + child_deleg)):
    print(f"\ndenominator ({label}): ${denom:.2f}")
    for name, k in (("blind S", cnt["S"]), ("adjusted S", s_hi), ("all valid workers", n)):
        for pname, per in (("simple-task saving", PER_TASK_SAVING_SIMPLE), ("real Sonnet cost x0.72", per_real)):
            save = k * per
            print(f"  {name:18s} {pname:24s} ${save:6.2f} = {100 * save / denom:4.1f}%")
    need = 0.05 * denom / PER_TASK_SAVING_SIMPLE
    print(f"  S tasks needed for 5% at simple-task saving: {need:.0f} ({100 * need / n:.0f}% of valid workers)")
print(f"\nroot vs child (non-experiment): root ${root_all:.2f}, child ${child_all:.2f}")
