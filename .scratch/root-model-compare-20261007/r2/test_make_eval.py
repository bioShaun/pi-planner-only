"""make_eval.py timeout handling. Run: python3 test_make_eval.py
Fake out dirs live under /project/tmp/root-model-compare/r2/selftest-timeout/."""
import json, subprocess, sys, unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path("/project/tmp/root-model-compare/r2/selftest-timeout")
SETTINGS = Path.home() / ".pi/agent/settings.json"


def build(aid, exit_code, extra_reasons=()):
    out = ROOT / aid
    out.mkdir(parents=True, exist_ok=True)
    ov = json.load(open(SETTINGS)).get("subagents", {}).get("agentOverrides", {})
    w = lambda s, v: (out / f"{aid}.{s}").write_text(v if isinstance(v, str) else json.dumps(v))
    model = "tcuni-claude/claude-sonnet-5-5"
    w("meta.json", {"arm": {"rootModel": model}, "childOverrides": ov, "agentsMdChanged": False})
    w("metrics.json", {"isolation_flags": [], "root_models": [model], "worker_identity": "match", "total_cost": 1, "cost_complete": True, "known_cost_lower_bound": 1})
    w("runcheck.json", {"valid": False, "reasons": ["pi exit x1: nonzero Pi exit", *extra_reasons]})
    w("check.json", {"checks": [], "auto_pass": 0, "auto_total": 13})
    w("checker.rc", "0\n")
    w("exit", f"{exit_code}\n")
    subprocess.run([sys.executable, str(HERE / "make_eval.py"), str(out), aid], check=True)
    return json.load(open(out / f"{aid}.eval.json"))


class Case(unittest.TestCase):
    def test_124_and_137_are_timed_out_not_invalid(self):
        for code in (124, 137):
            ev = build(f"R2-sonnet-1-a{code}", code)
            self.assertTrue(ev["timed_out"]); self.assertTrue(ev["valid"], ev["invalid_reasons"])

    def test_exit_1_stays_invalid(self):
        ev = build("R2-sonnet-1-a1", 1)
        self.assertFalse(ev["timed_out"]); self.assertFalse(ev["valid"])

    def test_timeout_does_not_hide_other_runcheck_reasons(self):
        ev = build("R2-sonnet-1-a2", 124, ["target commit referenced x1"])
        self.assertTrue(ev["timed_out"]); self.assertFalse(ev["valid"])


if __name__ == "__main__":
    unittest.main()
