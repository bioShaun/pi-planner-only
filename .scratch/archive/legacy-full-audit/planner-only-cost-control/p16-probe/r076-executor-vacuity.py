#!/usr/bin/env python3
"""Per-assertion vacuity audit for p16-r076 ticket 37."""
import os, re, subprocess, sys

ROOT = os.getcwd()
LOG = os.path.join(ROOT, ".scratch", "planner-only-cost-control")
SRC = [
    "reservations.ts",
    "orchestrate.ts",
    "orchestrate.test.mjs",
    "architecture.test.mjs",
]
BAK = {f: open(f, encoding="utf8").read() for f in SRC}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def neutralise(path, spec):
    if isinstance(spec, tuple):
        start, end = spec
    else:
        start = end = spec
    lines = open(path, encoding="utf8").read().split("\n")
    for i in range(start - 1, end):
        lines[i] = "// NEUTRALISED " + lines[i]
    open(path, "w", encoding="utf8").write("\n".join(lines))

FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+\.mjs):(\d+):\d+")

def run(test_file):
    p = subprocess.run(
        ["node", "--experimental-strip-types", test_file],
        capture_output=True, text=True,
    )
    out = p.stdout + p.stderr
    if p.returncode == 0:
        return None, "", out
    first = None
    for m in FAIL_RE.finditer(out):
        if m.group(1) == test_file:
            first = int(m.group(2))
            break
    msg = ""
    for line in out.split("\n"):
        if "AssertionError" in line or "TypeError" in line or "SyntaxError" in line:
            msg = line.strip()
            break
    return first, msg, out

CASES = []

def case(cid, test, target_line, mutate, neutralize=(), note=""):
    CASES.append({
        "id": cid, "test": test, "target": target_line,
        "mutate": mutate, "neutralize": list(neutralize), "note": note,
    })

# ---- rekey unit ----
REKEY_MOVE = """\t\tsource.delete(toolCallId);
\t\tif (source.size === 0) this.held.delete(fromTaskId);
\t\tlet dest = this.held.get(toTaskId);
\t\tif (!dest) {
\t\t\tdest = new Map();
\t\t\tthis.held.set(toTaskId, dest);
\t\t}
\t\tdest.set(toolCallId, reservation);"""

case("R1", "orchestrate.test.mjs", 5554,
     lambda: sub("reservations.ts", REKEY_MOVE, "\t\tsource.delete(toolCallId);\n\t\tif (source.size === 0) this.held.delete(fromTaskId);"),
     note="rekey deletes source but does not copy onto dest")

case("R2", "orchestrate.test.mjs", 5562,
     lambda: sub("reservations.ts",
                 "\t\tsource.delete(toolCallId);\n\t\tif (source.size === 0) this.held.delete(fromTaskId);",
                 "\t\t// keep source"),
     note="rekey copies to dest but does not delete from source")

case("R3", "orchestrate.test.mjs", 5569,
     lambda: sub("reservations.ts",
                 "\t\tconst source = this.held.get(fromTaskId);\n\t\tif (!source) return;",
                 "\t\tconst source = this.held.get(fromTaskId);\n\t\tif (!source) {\n\t\t\tthis.held.set(toTaskId, new Map([[toolCallId, { tokens: 1, costUsd: 0.01 }]]));\n\t\t\treturn;\n\t\t}"),
     note="reverse: missing source fabricates a dest reservation")

case("R4", "orchestrate.test.mjs", 5577,
     lambda: sub("reservations.ts",
                 "\t\tconst reservation = source.get(toolCallId);\n\t\tif (!reservation) return;",
                 "\t\tconst reservation = source.get(toolCallId);\n\t\tif (!reservation) { this.held.delete(fromTaskId); return; }"),
     note="missing toolCallId deletes the whole source map")

case("R5", "orchestrate.test.mjs", 5585,
     lambda: sub("reservations.ts",
                 "\t\tif (fromTaskId === toTaskId) return;",
                 "\t\tif (fromTaskId === toTaskId) { this.held.delete(fromTaskId); return; }"),
     note="same-id rekey deletes the reservation instead of no-op")

case("R6a", "orchestrate.test.mjs", 5595,
     lambda: sub("reservations.ts",
                 "\t\tconst reservation = source.get(toolCallId);\n\t\tif (!reservation) return;\n\t\tsource.delete(toolCallId);\n\t\tif (source.size === 0) this.held.delete(fromTaskId);",
                 "\t\tconst reservation = source.get(toolCallId);\n\t\tif (!reservation) return;\n\t\tthis.held.delete(fromTaskId);"),
     note="rekey moves the whole source map, sibling included")

case("R6b", "orchestrate.test.mjs", 5604,
     lambda: sub("reservations.ts",
                 "\t\tdest.set(toolCallId, reservation);",
                 "\t\tdest.set(toolCallId, reservation);\n\t\tfor (const [id, held] of source) dest.set(id, held);"),
     note="reverse: dest also receives the sibling that should stay on source",
     neutralize=(5595,))

# ---- first-delegation gate ----
FIRST = """\t\tconst firstDelegationTask = !budgetTask && spec?.cumulativeBudget && typeof spec.cumulativeBudget === "object"
\t\t\t? { taskId: spec.taskId, usage: emptyTaskUsage(), spec, reports: [] as TaskRecord["reports"] }
\t\t\t: undefined;"""

case("Z1", "orchestrate.test.mjs", 5613,
     lambda: sub("orchestrate.ts", FIRST, "\t\tconst firstDelegationTask = undefined;"),
     note="drop the new-Task empty-usage budget branch")

case("Z3", "orchestrate.test.mjs", 5621,
     lambda: sub("orchestrate.ts", FIRST, "\t\tconst firstDelegationTask = undefined;"),
     note="same as Z1; Z1 neutralized so Z3 is the first failure",
     neutralize=(5613,))

case("Z4", "orchestrate.test.mjs", 5630,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\tlines.push(`  在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}（${held} 个子进程未回执）`);",
                 "\t\t\t\t// no D4 line"),
     note="strip the 在途预留 renderer",
     neutralize=(5443, 5453, 5499))

case("Z5", "orchestrate.test.mjs", 5638,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\tif (grant?.costUsd !== undefined) record.grantedCostUsd = grant.costUsd;",
                 "\t\t\t\t// skip cost grant stamp"),
     note="do not stamp grantedCostUsd")

case("Z6", "orchestrate.test.mjs", 5646,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\tif (grant?.tokens !== undefined) record.grantedTokens = grant.tokens;",
                 "\t\t\t\t// skip token grant stamp"),
     note="do not stamp grantedTokens")

case("Z7", "orchestrate.test.mjs", 5655,
     lambda: sub("orchestrate.ts", FIRST, "\t\tconst firstDelegationTask = undefined;"),
     note="no first-delegation reserve, so the second call is not refused",
     neutralize=(5613, 5621, 5630, 5638, 5646))

case("Z8", "orchestrate.test.mjs", 5663,
     lambda: sub("orchestrate.ts",
                 'if (role !== "reviewer" && gateTask?.usage && cumulativeBudget && typeof cumulativeBudget === "object")',
                 "if (gateTask?.usage && cumulativeBudget && typeof cumulativeBudget === \"object\")"),
     note="drop the reviewer exemption (reverse: exhausted reviewer is blocked)",
     neutralize=(2083,))

case("Z9", "orchestrate.test.mjs", 5671,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"),
     note="reverse: skip rekey so the hold stays on the alias")

case("Z10", "orchestrate.test.mjs", 5679,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"),
     note="skip rekey; Z9 neutralized so canonical emptiness is the first failure",
     neutralize=(5671,))

case("Z11", "orchestrate.test.mjs", 5688,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"),
     note="skip rekey; gate on canonical does not see the alias hold",
     neutralize=(5671, 5679))

case("Z12", "orchestrate.test.mjs", 5697,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"),
     note="skip rekey; canonical status has no 在途预留",
     neutralize=(5671, 5679, 5688))

case("Z13", "orchestrate.test.mjs", 5707,
     lambda: sub("orchestrate.ts",
                 "\t\tif (record) this.reservations.release(record.taskId, toolCallId);",
                 "\t\t// skip release"),
     note="endDelegation does not release; canonical hold survives settle",
     neutralize=(2076,))

case("Z14", "orchestrate.test.mjs", 5716,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"),
     note="skip rekey; settle releases canonical and leaves the alias hold",
     neutralize=(5671, 5679, 5688, 5697, 5707))

case("Z15", "orchestrate.test.mjs", 5726,
     lambda: sub("orchestrate.ts",
                 "const budget = summarizeTaskBudget(gateTask.usage, cumulativeBudget as Parameters<typeof summarizeTaskBudget>[1]);",
                 "const budget = summarizeTaskBudget(emptyTaskUsage(), cumulativeBudget as Parameters<typeof summarizeTaskBudget>[1]);"),
     note="gate always summarizes emptyTaskUsage(), wiping recorded spend on existing Tasks",
     neutralize=(2042, 2043, 2051, 2052, (2059, 2067), 2086))

# ---- architecture ----
case("C37-1", "architecture.test.mjs", 121,
     lambda: sub("reservations.ts", "\trekey(fromTaskId: string, toTaskId: string, toolCallId: string): void {",
                 "\trekeyReservation(fromTaskId: string, toTaskId: string, toolCallId: string): void {"),
     note="rename rekey so reservations.ts no longer matches /rekey(/")

case("C37-2", "architecture.test.mjs", 122,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);",
                 "\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);"),
     note="duplicate the rekey call so the count is 2")

case("C37-3", "architecture.test.mjs", 123,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);\n\t\t\t\twarnings.push(",
                 "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);\n\t\t\t\twarnings.push("),
     note="rekey is no longer immediately after the replace create",
     neutralize=(122,))

def mutate_c374():
    sub("orchestrate.ts",
        "import { emptyTaskUsage, summarizeTaskBudget } from \"./usage.ts\";",
        "import { summarizeTaskBudget } from \"./usage.ts\";")
    sub("orchestrate.ts",
        "? { taskId: spec.taskId, usage: emptyTaskUsage(), spec, reports: [] as TaskRecord[\"reports\"] }",
        "? { taskId: spec.taskId, usage: undefined as never, spec, reports: [] as TaskRecord[\"reports\"] }")

case("C37-4", "architecture.test.mjs", 124, mutate_c374,
     note="remove emptyTaskUsage import and call")

case("C37-5", "architecture.test.mjs", 125,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(spec);\n\t\t\t\tthis.store.bindSpec(task.taskId, spec);",
                 "\t\t\t\ttask = this.store.create(spec);\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);\n\t\t\t\tthis.store.bindSpec(task.taskId, spec);"),
     note="reverse: matching-id create also rekeys",
     neutralize=(122,))

case("C37-6", "architecture.test.mjs", 126,
     lambda: sub("orchestrate.ts",
                 "\t\t\t\ttask = this.store.create(spec);",
                 "\t\t\t\ttask = this.store.create(spec); // this.store.create("),
     note="comment adds a fourth this.store.create( match")


def main():
    os.makedirs(LOG, exist_ok=True)
    results = []
    try:
        for c in CASES:
            restore()
            for line in c["neutralize"]:
                neutralise(c["test"], line)
            c["mutate"]()
            first, msg, out = run(c["test"])
            path = os.path.join(LOG, f"p16-r076-fail-{c['id']}.log")
            with open(path, "w", encoding="utf8") as fh:
                fh.write(f"id={c['id']}\n")
                fh.write(f"mutation={c['note']}\n")
                fh.write(f"neutralize={c['neutralize']}\n")
                fh.write(f"target_line={c['target']}\n")
                fh.write(f"first_fail_line={first}\n")
                fh.write(f"msg={msg}\n")
                fh.write("----\n")
                fh.write(out)
            caught = first == c["target"]
            status = "CAUGHT" if caught else ("VACUOUS" if first is None else "WRONG_LINE")
            print(f"[{status:10}] {c['id']:6}  {c['test']}:{c['target']}  first={first}  {msg[:120]}")
            results.append((status, c, first, msg))
    finally:
        restore()

    print("\n==== SUMMARY ====")
    n_ok = sum(1 for s, *_ in results if s == "CAUGHT")
    print(f"CAUGHT {n_ok}/{len(results)}")
    for status, c, first, msg in results:
        if status != "CAUGHT":
            print(f"  {status} {c['id']} expected {c['target']} got {first}")
    return 0 if n_ok == len(results) else 1

if __name__ == "__main__":
    sys.exit(main())
