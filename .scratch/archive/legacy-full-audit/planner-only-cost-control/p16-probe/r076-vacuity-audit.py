#!/usr/bin/env python3
"""Planner-side per-assertion vacuity audit for p16-r076 (ticket 37).

Independent of the executor's driver. For each new assertion: apply a mutation
the assertion is supposed to catch, run its test file, and iteratively
neutralise whatever assertion fires FIRST until the failure is attributed to
the target line. If the target never fires, the assertion is vacuous.

Distinguishes three outcomes:
  CAUGHT   - target line was the failing line
  VACUOUS  - the suite exited 0 under the mutation
  UNATTRIB - non-zero exit with no frame in the target test file (driver limit)
"""
import subprocess, re, sys, os

ROOT = os.getcwd()
SRC = ["orchestrate.ts", "reservations.ts", "usage.ts"]
TESTS = ["orchestrate.test.mjs", "architecture.test.mjs"]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    assert old in text, f"anchor not found in {path}: {old[:90]!r}"
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def neutralise(path, line_no):
    """Comment out the WHOLE assert statement the failing line belongs to.

    Commenting only the reported line breaks the file when the assert spans
    several lines, and the driver would then misread the SyntaxError as
    UNATTRIB. Paren balance decides where the statement ends; escaped parens
    (regex literals such as /exhausted \\(tokens\\)/) are excluded from the
    count, or a single-line assert carrying a regex would swallow its
    successors.
    """
    lines = open(path, encoding="utf8").read().split("\n")
    def depth(text):
        bare = text.replace("\\(", "").replace("\\)", "")
        return bare.count("(") - bare.count(")")
    start = line_no - 1
    while start > 0 and not lines[start].lstrip().startswith("assert"):
        start -= 1
    run = 0
    end = start
    for i in range(start, len(lines)):
        run += depth(lines[i])
        end = i
        if run <= 0 and i >= line_no - 1:
            break
    for i in range(start, end + 1):
        lines[i] = "// NEUTRALISED " + lines[i]
    open(path, "w", encoding="utf8").write("\n".join(lines))

FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+?\.mjs):(\d+):\d+")

def run(test_file):
    p = subprocess.run(["node", "--experimental-strip-types", test_file],
                       capture_output=True, text=True)
    out = p.stdout + p.stderr
    if p.returncode == 0:
        return "ZERO", None, ""
    first = None
    for m in FAIL_RE.finditer(out):
        if m.group(1) == test_file:
            first = int(m.group(2)); break
    msg = ""
    for line in out.split("\n"):
        s = line.strip()
        if "AssertionError" in s or s.startswith(("TypeError", "SyntaxError", "ReferenceError", "Error:")):
            msg = s[:220]; break
    return ("FAIL" if first is not None else "UNATTRIB"), first, msg

# ---------------- anchors ----------------
O = "orchestrate.ts"
R = "reservations.ts"
A = "architecture.test.mjs"
T = "orchestrate.test.mjs"

REKEY_SIG = "\trekey(fromTaskId: string, toTaskId: string, toolCallId: string): void {"
GUARD_SAME = "\t\tif (fromTaskId === toTaskId) return;"
GUARD_SRC = "\t\tif (!source) return;"
GUARD_RES = "\t\tif (!reservation) return;"
DEL_SRC = "\t\tsource.delete(toolCallId);"
DEST_SET = "\t\tdest.set(toolCallId, reservation);"
FIRST_TASK = '\t\tconst firstDelegationTask = !budgetTask && spec?.cumulativeBudget && typeof spec.cumulativeBudget === "object"'
RESERVE_CALL = "\t\t\tconst reservation = this.reservations.reserve(gateTask.taskId, budget, {"
REKEY_CALL = "\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);"
REVIEWER = '\t\tif (role !== "reviewer" && gateTask?.usage && cumulativeBudget'
HELD_LINE = "\t\tconst held = this.inFlight(taskId);"
INFLIGHT_RENDER = "\t\t\t\tconst inFlight = this.reservations.inFlight(task.taskId);"
GRANT_T = "\t\t\t\tif (grant?.tokens !== undefined) record.grantedTokens = grant.tokens;"
GRANT_C = "\t\t\t\tif (grant?.costUsd !== undefined) record.grantedCostUsd = grant.costUsd;"
SUMMARIZE = "\t\t\tconst budget = summarizeTaskBudget(gateTask.usage, cumulativeBudget as Parameters<typeof summarizeTaskBudget>[1]);"
CREATE_REPLACE = "\t\t\t\ttask = this.store.create(storedSpec, spec.taskId);"
CREATE_MATCH = "\t\t\t\ttask = this.store.create(spec);"
RELEASE = "\t\tif (record) this.reservations.release(record.taskId, toolCallId);"

def m_rekey_rename():
    sub(R, REKEY_SIG, "\tmovekey(fromTaskId: string, toTaskId: string, toolCallId: string): void {")
    sub(O, REKEY_CALL, "\t\t\t\tthis.reservations.movekey(spec.taskId, task.taskId, event.toolCallId);")

def m_second_rekey_site():
    sub(O, CREATE_MATCH, CREATE_MATCH + "\n\t\t\t\tthis.reservations.rekey(spec.taskId, task.taskId, event.toolCallId);")

def m_gap_before_rekey():
    sub(O, CREATE_REPLACE + "\n" + REKEY_CALL,
        CREATE_REPLACE + "\n\t\t\t\tvoid 0;\n" + REKEY_CALL)

def m_drop_empty_usage():
    # The literal identifier must vanish from orchestrate.ts entirely, so the
    # alias is minted in usage.ts and orchestrate.ts never spells the old name.
    sub("usage.ts", "export function emptyTaskUsage(",
        "export const blankTaskUsage = () => emptyTaskUsage();\nexport function emptyTaskUsage(")
    text = open(O, encoding="utf8").read()
    assert "emptyTaskUsage" in text
    open(O, "w", encoding="utf8").write(text.replace("emptyTaskUsage", "blankTaskUsage"))

def m_extra_create_text():
    sub(O, CREATE_MATCH, "\t\t\t\t// mutation: this.store.create(\n" + CREATE_MATCH)

def m_no_dest_set():
    sub(R, DEST_SET, "\t\tvoid reservation;")

def m_no_source_delete():
    sub(R, DEL_SRC, "\t\tvoid toolCallId;")

def m_missing_source_creates_dest():
    sub(R, GUARD_SRC,
        "\t\tif (!source) {\n\t\t\tconst d = this.held.get(toTaskId) ?? new Map();\n"
        "\t\t\td.set(toolCallId, { tokens: 7, costUsd: 7 });\n\t\t\tthis.held.set(toTaskId, d);\n\t\t\treturn;\n\t\t}")

def m_missing_call_wipes_source():
    sub(R, GUARD_RES, "\t\tif (!reservation) { this.held.delete(fromTaskId); return; }")

def m_same_id_wipes():
    sub(R, GUARD_SAME, "\t\tif (fromTaskId === toTaskId) { this.held.delete(fromTaskId); return; }")

def m_clear_source():
    sub(R, DEL_SRC, "\t\tsource.clear();")

def m_dest_value_bumped():
    sub(R, DEST_SET, "\t\tdest.set(toolCallId, { ...reservation, tokens: (reservation.tokens ?? 0) + 10 });")

def m_disable_first_gate():
    sub(O, FIRST_TASK, "\t\tconst firstDelegationTask = false && !budgetTask && spec?.cumulativeBudget && typeof spec.cumulativeBudget === \"object\"")

def m_reserve_wrong_id():
    sub(O, RESERVE_CALL, '\t\t\tconst reservation = this.reservations.reserve(gateTask.taskId + "#", budget, {')

def m_render_zero_held():
    sub(O, INFLIGHT_RENDER, "\t\t\t\tconst inFlight = { tokens: 0, costUsd: 0 };")

def m_no_grant_tokens():
    sub(O, GRANT_T, "\t\t\t\tvoid grant;")

def m_no_grant_cost():
    sub(O, GRANT_C, "\t\t\t\tvoid grant;")

def m_ignore_held():
    sub(R, HELD_LINE, "\t\tconst held = { tokens: 0, costUsd: 0 };")

def m_reviewer_not_exempt():
    sub(O, REVIEWER, "\t\tif (gateTask?.usage && cumulativeBudget")

def m_no_rekey():
    sub(O, REKEY_CALL, "\t\t\t\tvoid task;")

def m_no_release():
    sub(O, RELEASE, "\t\tvoid record;")

def m_gate_always_empty_usage():
    # Let the synthesized empty-ledger task win even when a stored Task exists:
    # exactly the D5 confusion Z15 is supposed to forbid.
    sub(O, FIRST_TASK, '\t\tconst firstDelegationTask = spec?.cumulativeBudget && typeof spec.cumulativeBudget === "object"')
    sub(O, "\t\tconst gateTask = budgetTask ?? firstDelegationTask;",
        "\t\tconst gateTask = firstDelegationTask ?? budgetTask;")

CASES = [
    ("C37-1", A, 121, m_rekey_rename,   "rename BudgetReservations.rekey -> movekey"),
    ("C37-2", A, 122, m_second_rekey_site, "add a 2nd this.reservations.rekey( call site"),
    ("C37-3", A, 123, m_gap_before_rekey,  "insert a statement between the replace-create and the rekey"),
    ("C37-4", A, 124, m_drop_empty_usage,  "alias emptyTaskUsage away so the literal name disappears"),
    ("C37-5", A, 125, m_second_rekey_site, "make the matching-id create rekey too"),
    ("C37-6", A, 126, m_extra_create_text, "introduce a 4th this.store.create( occurrence"),
    ("R1",  T, 5554, m_no_dest_set,      "rekey never writes the reservation onto dest"),
    ("R2",  T, 5562, m_no_source_delete, "rekey never removes the reservation from source"),
    ("R3",  T, 5569, m_missing_source_creates_dest, "missing source fabricates a dest reservation"),
    ("R4",  T, 5577, m_missing_call_wipes_source,   "unknown toolCallId wipes the source Task"),
    ("R5",  T, 5585, m_same_id_wipes,    "from===to drops the reservation instead of no-op"),
    ("R6a", T, 5595, m_clear_source,     "rekey clears every sibling off the source"),
    ("R6b", T, 5604, m_dest_value_bumped,"rekey writes a different reservation onto dest"),
    ("Z1",  T, 5613, m_disable_first_gate, "disable the ticket-37 first-delegation gate"),
    ("Z3",  T, 5621, m_reserve_wrong_id,   "reserve against a different task id"),
    ("Z4",  T, 5630, m_render_zero_held,   "status renders in-flight as zero"),
    ("Z5",  T, 5638, m_no_grant_cost,      "stop stamping grantedCostUsd"),
    ("Z6",  T, 5646, m_no_grant_tokens,    "stop stamping grantedTokens"),
    ("Z7",  T, 5655, m_ignore_held,        "reserve ignores already-held reservations"),
    ("Z8",  T, 5663, m_reviewer_not_exempt,"remove the reviewer exemption (reverse mutation)"),
    ("Z9",  T, 5671, m_no_rekey,           "drop the rekey after the replaced-id create"),
    ("Z10", T, 5679, m_no_rekey,           "drop the rekey after the replaced-id create"),
    ("Z11", T, 5688, m_ignore_held,        "reserve ignores already-held reservations"),
    ("Z12", T, 5697, m_no_rekey,           "drop the rekey after the replaced-id create"),
    ("Z13", T, 5707, m_no_release,         "endDelegation stops releasing the reservation"),
    ("Z14", T, 5716, m_no_rekey,           "drop the rekey after the replaced-id create"),
    ("Z15", T, 5726, m_gate_always_empty_usage, "gate always summarises from an empty ledger"),
]

only = sys.argv[1:] or None
results = []
for name, test_file, line, mutate, label in CASES:
    if only and name not in only:
        continue
    restore()
    mutate()
    neutralised = []
    verdict = None
    for _ in range(40):
        kind, first, msg = run(test_file)
        if kind == "ZERO":
            verdict = ("VACUOUS", "suite exited 0 under the mutation"); break
        if kind == "UNATTRIB":
            verdict = ("UNATTRIB", msg or "non-zero exit with no frame in the test file"); break
        if first == line:
            verdict = ("CAUGHT", msg); break
        neutralise(test_file, first)
        neutralised.append(first)
    else:
        verdict = ("UNRESOLVED", "still not attributed after 40 neutralisations")
    results.append((name, verdict[0], neutralised, verdict[1], label))
    print(f"{name:6s} {verdict[0]:9s} neutralised={neutralised}\n        mutation: {label}\n        {verdict[1]}", flush=True)

restore()
bad = [r for r in results if r[1] != "CAUGHT"]
print(f"\n=== {len(results) - len(bad)}/{len(results)} CAUGHT ===")
for r in bad:
    print(f"NOT CAUGHT: {r[0]} {r[1]} - {r[3]}")
sys.exit(1 if bad else 0)
