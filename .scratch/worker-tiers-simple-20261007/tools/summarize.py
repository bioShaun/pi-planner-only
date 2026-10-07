#!/usr/bin/env python3
"""汇总 eval/<run>/checks.json 为 scores.md（当前裁定）与 scores-raw.md（若存在 eval-raw/）。"""
import json, os, re, sys

B = "/project/tmp/worker-tiers-simple"


def load(evaldir, run):
    p = os.path.join(evaldir, run, "checks.json")
    if not os.path.exists(p):
        return None
    cs = json.load(open(p))
    st = lambda c: c.get("status") or c.get("result")
    scored = [c for c in cs if st(c) in ("pass", "fail", "error")]
    fails = [c["id"] for c in scored if st(c) != "pass"]
    return sum(st(c) == "pass" for c in scored), len(scored), fails


def runs_md():
    rows = {}
    for l in open(os.path.join(B, "runs.md")):
        m = re.match(r"\| (S[12]-\S+) \| (\w+) \| (\S+) \| (\S+) \| ([\d.]+) \| (\d+) \| (\d+) \|", l)
        if m:
            rows[m.group(1)] = dict(status=m.group(2), model=m.group(3), tok=m.group(4), cost=float(m.group(5)), turns=int(m.group(6)), s=int(m.group(7)))
    return rows


def main(evaldir, out):
    R = runs_md()
    lines = ["| run | status | 通过/总 | 失败项 | $ | turns | s |", "|---|---|---|---|---|---|---|"]
    for t in ("S1", "S2"):
        for L in ("luna", "dsflash", "sonnet"):
            for n in (1, 2, 3):
                run = f"{t}-{L}-{n}"
                sc = load(evaldir, run)
                r = R.get(run, {})
                lines.append(f"| {run} | {r.get('status')} | {sc[0]}/{sc[1]} | {', '.join(sc[2]) or '—'} | {r.get('cost')} | {r.get('turns')} | {r.get('s')} |")
    lines += ["", "| 模型 | 6 次费用合计 $ | 单次均值 $ | 耗时范围 s |", "|---|---|---|---|"]
    for L in ("luna", "dsflash", "sonnet"):
        rs = [R[k] for k in R if f"-{L}-" in k]
        lines.append(f"| {L} | {sum(x['cost'] for x in rs):.4f} | {sum(x['cost'] for x in rs)/len(rs):.4f} | {min(x['s'] for x in rs)}–{max(x['s'] for x in rs)} |")
    open(out, "w").write("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(B, "eval"), sys.argv[2] if len(sys.argv) > 2 else os.path.join(B, "scores.md"))
