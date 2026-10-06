"""Verify recovered historical evidence; no network or business-data execution."""
from pathlib import Path
from datetime import datetime
from decimal import Decimal
import ast
import difflib
import hashlib
import json
import re
import runpy

BASE = Path(__file__).resolve().parent
RAW = BASE / "raw"
manifest = json.loads((BASE / "remote-manifest.json").read_text())
for entry in manifest["files"]:
    data = (RAW / entry["name"]).read_bytes()
    assert len(data) == entry["bytes"]
    assert hashlib.sha256(data).hexdigest() == entry["sha256"]
    assert entry.get("stable", True)
    assert entry.get("exit_code", 0) == 0

def records(path):
    return [json.loads(line) for line in path.read_text().splitlines()]

def texts(message):
    return "\n".join(c.get("text", "") for c in message.get("content", [])
                     if c.get("type") == "text")

root = records(RAW / "root-session.jsonl")
worker_id = "a5a59126-481a-47fe-9da1-cdd90e5076dc"
worker = records(RAW / "children" / worker_id / "run-0/session.jsonl")
copies = []
for line_number, entry in enumerate(worker, 1):
    message = entry.get("message", {})
    if message.get("role") != "toolResult":
        continue
    numbered = re.findall(r"^\s*(\d+)\t(.*)$", texts(message), re.M)
    if len(numbered) < 250:
        continue
    assert [int(n) for n, _ in numbered] == list(range(1, len(numbered) + 1))
    source = "\n".join(line for _, line in numbered) + "\n"
    if "def parse_genotype(" in source:
        compile(source, "worker-variant.py", "exec")
        copies.append((line_number, source))
assert len(copies) == 1, "Need one complete, numbered worker source output"
source_line, before = copies[0]
(RAW / "worker-variant.py").write_text(before)
after = (RAW / "committed-variant.py").read_text()
diff = "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
                                  fromfile="worker-final/deg_variant_assoc.py",
                                  tofile="1d89adb/deg_variant_assoc.py"))
(BASE / "worker-to-commit.diff").write_text(diff)

def genotype_function(source):
    return next(n for n in ast.parse(source).body
                if isinstance(n, ast.FunctionDef) and n.name == "parse_genotype")

assert ast.dump(genotype_function(before)) == ast.dump(genotype_function(after))
dosages = {}
for name in ["worker-variant.py", "committed-variant.py"]:
    code = runpy.run_path(str(RAW / name), run_name="evidence_audit")
    dosages[name] = {gt: code["parse_genotype"](gt + ":10", ["GT", "DP"], 5)[1]
                     for gt in ["0/1", "1/2"]}
assert dosages["worker-variant.py"] == dosages["committed-variant.py"] == {
    "0/1": 0.5, "1/2": 1.0}

selected = []
for line_number in [73, 74, 122, 123, 124, 125, 126, 127, 128, 129, 130]:
    message = root[line_number - 1].get("message", {})
    # Preserve visible messages/tool calls only, excluding recorded thinking.
    content = [c for c in message.get("content", []) if c.get("type") != "thinking"]
    selected.append({"source_line": line_number, "role": message.get("role"),
                     "toolName": message.get("toolName"), "content": content})
(BASE / "verified-excerpts.json").write_text(json.dumps(selected, ensure_ascii=False, indent=2) + "\n")

costs = {str(n): Decimal(str(root[n - 1]["message"]["usage"]["cost"]["total"]))
         for n in [124, 126, 128, 130]}
child_identities = []
for path in sorted((RAW / "children").glob("*/run-0/session.jsonl")):
    entries = records(path)
    models = [e for e in entries if e.get("type") == "model_change"]
    thinking = [e["thinkingLevel"] for e in entries if e.get("type") == "thinking_level_change"]
    messages = [e["message"] for e in entries if e.get("message", {}).get("role") == "assistant"]
    child_identities.append({"run_id": path.parent.parent.name,
                             "models": [{"provider": e["provider"], "model": e["modelId"]} for e in models],
                             "thinking": thinking, "assistant_messages": len(messages),
                             "recorded_cost_usd": str(sum((Decimal(str(m.get("usage", {}).get("cost", {}).get("total", 0))) for m in messages), Decimal(0)))})
def timestamp(line):
    return datetime.fromisoformat(root[line - 1]["timestamp"].replace("Z", "+00:00"))

summary = {
    "verified_remote_files": len(manifest["files"]),
    "root_session_lines": len(root),
    "worker_source_evidence": {"run_id": worker_id, "source_line": source_line,
                               "sha256": hashlib.sha256(before.encode()).hexdigest()},
    "genotype_function_unchanged": True,
    "synthetic_function_observation": dosages,
    "root_post_review_costs_usd": {n: str(cost) for n, cost in costs.items()},
    "root_read_and_edit_cost_usd": str(costs["124"] + costs["126"]),
    "root_commit_and_final_cost_usd": str(costs["128"] + costs["130"]),
    "root_all_post_review_cost_usd": str(sum(costs.values())),
    "review_return_to_final_seconds": (timestamp(130) - timestamp(123)).total_seconds(),
    "cost_caveat": "Observed historical usage, not an estimate of avoidable AF rework cost; includes performance optimization and routine closeout.",
    "child_identities": child_identities,
}
(BASE / "verified-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary, ensure_ascii=False, indent=2))
print(diff)
