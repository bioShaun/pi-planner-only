"""Read saved identity evidence only; no model calls or credential reads."""
import json
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
base = repo / ".scratch/root-stamped-run-identity/evidence"
rows = []
for scenario in ("A", "B"):
    meta = json.loads((base / scenario / "meta.json").read_text())
    metas = meta if isinstance(meta, list) else [meta]
    by_run = {item["runId"]: item for item in metas}
    ledger = json.loads((base / scenario / "ledger.json").read_text())
    task = ledger.get("task", ledger)
    for child in task["usage"]["children"]:
        terminal = by_run.get(child["runId"])
        actual = child.get("model")
        requested = terminal.get("requestedModel") if terminal else None
        # The saved launcher model suffix denotes thinking, not model identity.
        model_id = actual.rsplit(":", 1)[0] if actual else None
        if scenario == "A":
            verdict = "routing-absent"
            expected = "qwen-local/qwen3.8-27b"
            basis = "Historical baseline records scout override; planner-scout has no route wiring."
        else:
            expected = requested
            verdict = "match" if expected and model_id == expected else "unknown"
            basis = "Saved requestedModel and terminal model, correlated by runId."
        if terminal:
            assert terminal.get("model") == actual, "terminal/ledger model disagreement"
        rows.append({"scenario": scenario, "runId": child["runId"],
                     "actual": actual, "expected": expected, "verdict": verdict,
                     "basis": basis, "terminalAvailable": terminal is not None})

versions = {}
for label, package in {
    "plugin": repo / "package.json",
    "localTestHost": repo / "node_modules/@earendil-works/pi-coding-agent/package.json",
    "cliHost": Path.home() / ".nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/package.json",
    "installedLauncher": Path.home() / ".pi/agent/npm/node_modules/pi-subagents/package.json",
}.items():
    versions[label] = json.loads(package.read_text())["version"]

assert len(rows) == 5
assert sum(row["verdict"] == "routing-absent" for row in rows) == 3
assert sum(row["verdict"] == "match" for row in rows) == 2
print(json.dumps({"versionsNow": versions, "historicalEvidence": {
    "plugin": "0.8.0", "host": "0.85.1", "launcher": "0.68.0",
    "baseline": "84cced4372700cac3051312b4867615820c696b2"},
    "rows": rows, "current069RuntimeIdentity": "unknown-no-new-host-run",
    "costConclusion": "none", "scenarioC": "No child launched; copied B ledger is not a third sample."
}, ensure_ascii=False, indent=2))
