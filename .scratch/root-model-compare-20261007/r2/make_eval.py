#!/usr/bin/env python3
"""Synthesise <attempt>.eval.json from the files run_one.sh left in the out dir.

usage: make_eval.py <out-dir> <attempt-id> [--early "reason"]
--early marks an attempt that failed before the Root ran (health/build): valid=false, root_started=false.
Inputs (all optional; a missing one is itself an invalid reason): .meta.json .metrics.json .runcheck.json
.check.json .checker.rc .exit .health.json. Checker "fail" results do not affect validity.
"""
import json, re, sys
from datetime import datetime
from pathlib import Path


def load(p):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return None


def model_matches(expected, actual):
    return actual == expected or expected.endswith("/" + actual.split("/", 1)[-1])


def main():
    a = sys.argv[1:]
    out, aid = Path(a[0]), a[1]
    early = a[a.index("--early") + 1] if "--early" in a else None
    m = re.fullmatch(r"R2-(\w+)-(\d+)-a(\d+)", aid)
    arm, rep, attempt = m.group(1), int(m.group(2)), int(m.group(3))
    f = lambda s: out / f"{aid}.{s}"
    reasons = []
    meta, metrics, health = load(f("meta.json")), load(f("metrics.json")), load(f("health.json"))
    ev = {"id": aid, "task": "R2", "arm": arm, "rep": rep, "attempt": attempt, "root_started": early is None,
          "finished": datetime.now().astimezone().isoformat(timespec="seconds"), "pass": None, "check_file": None,
          "health_cost": (health or {}).get("cost"), "health_cost_complete": (health or {}).get("cost_complete")}
    if early:
        reasons.append(early)
        ev.update(valid=False, invalid_reasons=reasons, isolation_flags=None, isolation_clean=None)
        Path(f("eval.json")).write_text(json.dumps(ev, indent=2))
        return 0
    try:
        timed_out = int(f("exit").read_text().strip()) in (124, 137)
    except (OSError, ValueError):
        timed_out = False
    ev["timed_out"] = timed_out
    rc = load(f("runcheck.json"))
    if not isinstance(rc, dict) or "valid" not in rc:
        reasons.append("runcheck produced no result")
    elif rc["valid"] is not True:
        # A timeout kill (124 = timeout, 137 = -k SIGKILL) explains the nonzero Pi exit; other reasons still count.
        exit_only = (lambda r: timed_out and re.search(r"nonzero Pi exit", str(r)))
        reasons += ["runcheck: " + str(r) for r in rc.get("reasons", ["invalid"]) if not exit_only(r)]
    flags = []
    if not isinstance(metrics, dict):
        reasons.append("metrics unavailable")
    else:
        flags = metrics.get("isolation_flags") or []
        if flags:
            reasons.append("isolation: " + "; ".join(sorted({x["kind"] for x in flags})))
        expected = ((meta or {}).get("arm") or {}).get("rootModel")
        actual = metrics.get("root_models") or []
        if not expected or not actual or not all(model_matches(expected, x) for x in actual):
            reasons.append(f"root model mismatch: expected {expected}, got {actual}")
        if metrics.get("worker_identity") == "mismatch":
            reasons.append(f"worker identity mismatch: {metrics.get('worker_models')} {metrics.get('worker_thinking')}")
        ev.update(total_cost=metrics.get("total_cost"), cost_complete=metrics.get("cost_complete"),
                  known_cost_lower_bound=metrics.get("known_cost_lower_bound"), worker_identity=metrics.get("worker_identity"))
    if not isinstance(meta, dict):
        reasons.append("meta unavailable")
    else:
        # Only the child-role config matters: other keys (e.g. enabledModels) are edited by
        # unrelated interactive sessions. Compare the overrides recorded at start with now.
        try:
            now = json.load(open(Path.home() / ".pi/agent/settings.json")).get("subagents", {}).get("agentOverrides", {})
        except (OSError, ValueError):
            now = None
        if now != meta.get("childOverrides"):
            reasons.append("settings.json subagents.agentOverrides changed during run")
        if meta.get("agentsMdChanged") is True:
            reasons.append("agents_md_changed")
    # hidden acceptance: only a broken checker invalidates; a failing verdict does not
    chk = load(f("check.json"))
    try:
        crc = int(f("checker.rc").read_text().strip())
    except (OSError, ValueError):
        crc = None
    if crc != 0:
        reasons.append(f"checker exit {crc}")
    if not isinstance(chk, dict) or not all(k in chk for k in ("checks", "auto_pass", "auto_total")):
        reasons.append("checker output missing checks/auto_pass/auto_total")
    else:
        ev["pass"] = {"auto_pass": chk["auto_pass"], "auto_total": chk["auto_total"]}
        ev["check_file"] = str(f("check.json"))
    ev.update(valid=not reasons, invalid_reasons=reasons, isolation_flags=len(flags), isolation_clean=not flags)
    Path(f("eval.json")).write_text(json.dumps(ev, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
