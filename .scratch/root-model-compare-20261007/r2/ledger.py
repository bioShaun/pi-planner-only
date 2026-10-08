#!/usr/bin/env python3
"""Cost ledger / stop rules over all attempts in an out dir (attempt = R2-<arm>-<rep>-a<N>).

usage:
  ledger.py total <out>                      cumulative cost incl. reserve for unknown attempts
  ledger.py preflight <out> <arm> [budget]   exit 0 ok, 1 if total + reserve(arm) > budget (writes STOP beside out/)
  ledger.py streak <out> <arm>               trailing consecutive invalid attempts
  ledger.py has-valid <out> <arm> <rep>      exit 0 if out/R2-arm-rep.current -> valid eval
  ledger.py next-attempt <out> <arm> <rep>   prints next attempt number
"""
import json, os, re, sys
from datetime import datetime
from pathlib import Path

DEFAULT_RESERVE = {"opus": 6.0, "sonnet": 3.0}  # USD per run when the arm has no observation yet
RESERVE_FACTOR = 1.2  # reserve = largest observed single-attempt cost of the arm x this
BUDGET = float(os.environ.get("R2_BUDGET", "13.0"))  # $15 phase cap minus ~$2 preparation
HEALTH_RESERVE = 0.05
ATT = re.compile(r"^R2-(\w+)-(\d+)-a(\d+)\.")


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def num(x):
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0 else None


def attempts(out):
    found = {}
    for p in Path(out).iterdir():
        m = ATT.match(p.name)
        if m:
            found.setdefault(p.name.split(".")[0], []).append(p)
    return found


def attempt_arm(aid):
    return aid.split("-")[1]


def attempt_cost(out, aid, files):
    """(counted_cost, exact) ; unreadable/incomplete costs add the arm reserve to what is known."""
    out = Path(out)
    reserve = DEFAULT_RESERVE.get(attempt_arm(aid), max(DEFAULT_RESERVE.values()))
    ev = load(out / f"{aid}.eval.json")
    health = load(out / f"{aid}.health.json")
    h = num((health or {}).get("cost")) if isinstance(health, dict) else None
    health_part = h if h is not None else (HEALTH_RESERVE if any(".health." in p.name for p in files) else 0.0)
    if isinstance(health, dict) and health.get("cost_complete") is False:
        health_part += HEALTH_RESERVE
    if isinstance(ev, dict) and ev.get("root_started") is False:
        return health_part, h is not None or health_part == 0.0
    mt = load(out / f"{aid}.metrics.json")
    if isinstance(mt, dict):
        lb = num(mt.get("known_cost_lower_bound"))
        if lb is not None and mt.get("cost_complete") is True:
            return lb + health_part, True
        if lb is not None:
            return lb + health_part + reserve, False
    return health_part + reserve, False


def reserve_for(out, arm):
    """Largest observed Root-run cost of the arm x 1.2 (attempts with root_started=false are not samples) (incomplete: known lower bound + default reserve);
    default reserve when the arm has no attempt yet."""
    costs = [attempt_cost(out, aid, files)[0] for aid, files in attempts(out).items()
             if attempt_arm(aid) == arm and (load(Path(out) / f"{aid}.eval.json") or {}).get("root_started") is not False]
    return max(costs) * RESERVE_FACTOR if costs else DEFAULT_RESERVE[arm]


def total(out):
    return sum(attempt_cost(out, aid, files)[0] for aid, files in attempts(out).items())


def attempt_time(out, aid, files):
    ev = load(Path(out) / f"{aid}.eval.json")
    if isinstance(ev, dict) and ev.get("finished"):
        return ev["finished"], int(aid.rsplit("-a", 1)[1])
    return "", int(aid.rsplit("-a", 1)[1])


def streak(out, arm):
    rows = []
    for aid, files in attempts(out).items():
        if attempt_arm(aid) != arm:
            continue
        ev = load(Path(out) / f"{aid}.eval.json")
        mt = max(p.stat().st_mtime for p in files)
        rows.append((mt, int(aid.rsplit("-a", 1)[1]), isinstance(ev, dict) and ev.get("valid") is True))
    n = 0
    for _, _, ok in sorted(rows):
        n = 0 if ok else n + 1
    return n


def current_valid(out, arm, rep):
    cur = Path(out) / f"R2-{arm}-{rep}.current"
    try:
        aid = cur.read_text().strip()
    except OSError:
        return False
    ev = load(Path(out) / f"{aid}.eval.json")
    return isinstance(ev, dict) and ev.get("valid") is True


def main():
    a = sys.argv[1:]
    cmd, out = a[0], a[1]
    if cmd == "total":
        print(f"{total(out):.4f}")
    elif cmd == "preflight":
        arm = a[2]; budget = float(a[3]) if len(a) > 3 else BUDGET
        t, r = total(out), reserve_for(out, arm)
        print(f"cumulative={t:.4f} reserve({arm})={r:.4f} budget={budget}")
        if t + r > budget:
            stop = Path(out).parent / "STOP"
            with open(stop, "a") as fh:
                fh.write(f"{datetime.now().astimezone().isoformat(timespec='seconds')} budget: cumulative={t:.4f} + reserve({arm})={r:.4f} > {budget}\n")
            return 1
        return 0
    elif cmd == "streak":
        print(streak(out, a[2]))
    elif cmd == "has-valid":
        return 0 if current_valid(out, a[2], a[3]) else 1
    elif cmd == "next-attempt":
        pre = f"R2-{a[2]}-{a[3]}-a"
        ns = [int(x.rsplit("-a", 1)[1]) for x in attempts(out) if x.startswith(pre)]
        print(max(ns, default=0) + 1)
    else:
        print(__doc__, file=sys.stderr); return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
