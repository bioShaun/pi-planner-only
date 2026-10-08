"""Tests for ledger.py reserve and preflight. Run: python3 test_ledger.py"""
import contextlib, io, json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ledger  # noqa: E402


class Case(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir="/project/tmp/root-model-compare/r2/tmp" if Path("/project/tmp/root-model-compare/r2/tmp").is_dir() else None)
        self.base = Path(self.tmp.name)
        self.out = self.base / "out"
        self.out.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def attempt(self, aid, health=0.0, run=None, complete=True, valid=True, lower=None):
        (self.out / f"{aid}.health.json").write_text(json.dumps({"cost": health, "cost_complete": True, "ok": True}))
        if run is None:
            (self.out / f"{aid}.eval.json").write_text(json.dumps({"root_started": False, "valid": False}))
            return
        (self.out / f"{aid}.metrics.json").write_text(json.dumps(
            {"cost_complete": complete, "known_cost_lower_bound": run if lower is None else lower, "total_cost": run if complete else None}))
        (self.out / f"{aid}.eval.json").write_text(json.dumps({"root_started": True, "valid": valid}))

    def preflight(self, arm, budget):
        buf = io.StringIO()
        sys.argv = ["ledger.py", "preflight", str(self.out), arm, str(budget)]
        with contextlib.redirect_stdout(buf):
            rc = ledger.main()
        return rc

    def test_no_observation_uses_defaults(self):
        self.assertEqual(ledger.reserve_for(self.out, "opus"), 6.0)
        self.assertEqual(ledger.reserve_for(self.out, "sonnet"), 3.0)

    def test_observed_max_times_1_2_including_invalid_and_health(self):
        self.attempt("R2-sonnet-1-a1", health=0.01, run=1.0, valid=False)
        self.attempt("R2-sonnet-1-a2", health=0.01, run=2.0)
        self.attempt("R2-opus-1-a1", health=0.0, run=9.0)
        self.assertAlmostEqual(ledger.reserve_for(self.out, "sonnet"), 2.01 * 1.2)
        self.assertAlmostEqual(ledger.reserve_for(self.out, "opus"), 9.0 * 1.2)

    def test_incomplete_cost_is_lower_bound_plus_default(self):
        self.attempt("R2-sonnet-1-a1", run=1.0, complete=False, lower=0.5, valid=False)
        self.assertAlmostEqual(ledger.reserve_for(self.out, "sonnet"), (0.5 + 3.0) * 1.2)

    def test_health_only_failure_is_not_a_reserve_sample(self):
        self.attempt("R2-sonnet-1-a1", health=0.01)  # root_started=false
        self.assertEqual(ledger.reserve_for(self.out, "sonnet"), 3.0)
        self.assertAlmostEqual(ledger.total(self.out), 0.01)

    def test_over_budget_writes_stop(self):
        self.attempt("R2-opus-1-a1", run=8.0)
        self.assertEqual(self.preflight("opus", 13.0), 1)  # 8 + 9.6 > 13
        self.assertTrue((self.base / "STOP").exists())

    def test_over_budget_with_defaults_writes_stop(self):
        self.assertEqual(self.preflight("opus", 5.0), 1)
        self.assertTrue((self.base / "STOP").exists())

    def test_within_budget_no_stop(self):
        self.attempt("R2-sonnet-1-a1", run=2.0)
        self.assertEqual(self.preflight("sonnet", 13.0), 0)
        self.assertFalse((self.base / "STOP").exists())

    def test_exactly_at_budget_is_ok(self):
        self.assertEqual(self.preflight("sonnet", 3.0), 0)
        self.assertFalse((self.base / "STOP").exists())


if __name__ == "__main__":
    unittest.main()
