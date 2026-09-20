import unittest
from tui_proof import inspect_rows

class TuiProofTest(unittest.TestCase):
    def rows(self):
        identity = dict(requestId="child", ownerRunId="owner", nodeId="task")
        def row(t, closed=False, settled=False, **data):
            return dict(t=t, requests=[dict(id="root", closedReason="deadline" if closed else None,
                        settled=settled, rootStop="confirmed" if settled else "requested")], **data)
        return [
            row(1, kind="host", hook="agent_start", hasUI=True),
            row(2, kind="launcher", event="request", **identity),
            row(3, kind="host", hook="input", marker="queued", source="interactive", streamingBehavior="followUp"),
            row(4, True, kind="launcher", event="cancel", **identity),
            row(5, True, kind="launcher", event="response", status="cancelled", **identity),
            row(6, True, True, kind="host", hook="agent_settled"),
            row(7, True, True, kind="injection", event="timer_fired"),
            row(8, True, True, kind="host", hook="input", marker="scheduled", source="extension"),
            row(9, True, kind="host", hook="agent_start"),
            row(10, True, True, kind="host", hook="agent_settled"),
        ]
    def test_all_injections_are_observed(self):
        self.assertTrue(inspect_rows(self.rows(), "combined")["ready"])
    def test_missing_delivery_is_not_proven(self):
        rows = self.rows()
        self.assertFalse(inspect_rows([r for r in rows if r.get("marker") != "scheduled"], "combined")["ready"])
        self.assertFalse(inspect_rows([r for r in rows if r.get("marker") != "queued"], "combined")["ready"])
    def test_rollover_and_calls_cannot_hide_behind_open_snapshot(self):
        rows = self.rows()
        rows.append(dict(t=11, kind="host", hook="before_provider_request", requests=[dict(id="new-root")]))
        proof = inspect_rows(rows, "combined")
        self.assertFalse(proof["ready"])
        self.assertEqual(proof["afterClosure"]["modelHooks"], 1)
        self.assertFalse(proof["requestUnchanged"])
    def test_unrelated_terminal_is_not_confirmation(self):
        rows = self.rows()
        rows[4]["requestId"] = "unrelated"
        self.assertFalse(inspect_rows(rows, "combined")["ready"])
    def test_interactive_input_cannot_impersonate_schedule(self):
        rows = self.rows()
        rows[7]["source"] = "interactive"
        self.assertFalse(inspect_rows(rows, "scheduled")["ready"])

if __name__ == "__main__":
    unittest.main()
