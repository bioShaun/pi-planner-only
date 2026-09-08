#!/usr/bin/env python3
"""Planner-side per-assertion vacuity audit for p16-r078 (ticket 16-b', quarantine).

Independent of the executor's driver: every mutation below is written from the
assertion text, not copied from theirs.

For each assertion: apply a mutation it is supposed to catch, run its own
suite, and iteratively neutralise whichever assertion fires FIRST until the
failure is attributed to the target line.

  CAUGHT   - the target line was the failing line
  VACUOUS  - the suite exited 0 under the mutation
  UNATTRIB - non-zero exit with no frame in the target test file
"""
import subprocess, re, os

ROOT = os.getcwd()
SRC = ["ledger-store.ts", "orchestrate.ts"]
TESTS = ["ledger-store.test.mjs", "orchestrate.test.mjs", "architecture.test.mjs"]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    assert old in text, f"anchor not found in {path}: {old[:100]!r}"
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def neutralise(path, line_no):
    """Disarm the assert statement owning line_no WITHOUT deleting it.

    Commenting the statement out has two failure modes I hit in this audit:
    it breaks the file when the statement spans a try/catch boundary
    (SyntaxError read as UNATTRIB), and it silently removes side effects
    that later assertions depend on -- `assert.deepEqual(orch.restoreFromLedger(), ...)`
    carries the very call the next assertion is about.

    So redirect the call to a proxy that evaluates its arguments (side effects
    intact, including any callback an assert.throws would have run) and then
    swallows the outcome.
    """
    text = open(path, encoding="utf8").read()
    shim = ('const __NEUT = new Proxy({}, { get: () => (...args) => { '
            'for (const a of args) if (typeof a === "function") { try { a(); } catch {} } } });\n')
    lines = text.split("\n")
    if "__NEUT" not in text:
        # Merge into line 1 rather than inserting a line: every recorded target
        # line number would otherwise shift by one. ESM imports are hoisted, so
        # a const in front of the first import is legal and initialises first.
        lines[0] = shim.rstrip("\n") + " " + lines[0]
    start = line_no - 1
    while start > 0 and not lines[start].lstrip().startswith("assert"):
        start -= 1
    if not lines[start].lstrip().startswith("assert"):
        # The failure is not inside any assert statement (a bare `throw` in an
        # injected stub, say). Nothing to disarm; say so instead of mangling
        # line 1, which is what the earlier version did.
        return False
    stripped = lines[start].lstrip()
    indent = lines[start][:len(lines[start]) - len(stripped)]
    lines[start] = indent + "__NEUT" + stripped[len("assert"):]
    open(path, "w", encoding="utf8").write("\n".join(lines))
    return True

FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+?\.mjs):(\d+):\d+")

ERR_HEAD = re.compile(r"^(AssertionError|TypeError|SyntaxError|ReferenceError|RangeError|Error:)")

def attribute(out, test_file):
    """Line of the frame that actually threw.

    NOT simply the first `<test file>:<line>` in the output: when the failing
    assertion's `actual` is an Error object, node renders that object's stack
    inside the diff, so the first match is a frame from wherever that error was
    constructed -- three lines earlier, in another statement entirely. B21/B22
    were misattributed to the injected `throw new Error("disk full")` stub that
    way. Anchor on the error header instead, skip the `+`/`-` diff rendering,
    and take the first real frame after it.
    """
    lines = out.split("\n")
    start = next((i for i, l in enumerate(lines) if ERR_HEAD.match(l.strip())), 0)
    for l in lines[start:]:
        st = l.strip()
        if st.startswith(("+", "-")):
            continue
        if not st.startswith("at "):
            continue
        m = FAIL_RE.search(l)
        if m and m.group(1) == test_file:
            return int(m.group(2))
    for m in FAIL_RE.finditer(out):          # e.g. a SyntaxError header frame
        if m.group(1) == test_file:
            return int(m.group(2))
    return None

def run(test_file):
    p = subprocess.run(["node", "--experimental-strip-types", test_file],
                       capture_output=True, text=True)
    out = p.stdout + p.stderr
    if p.returncode == 0:
        return "ZERO", None, ""
    first = attribute(out, test_file)
    msg = ""
    for line in out.split("\n"):
        s = line.strip()
        if "AssertionError" in s or s.startswith(("TypeError", "SyntaxError", "ReferenceError", "Error:")):
            msg = s[:200]; break
    return ("FAIL" if first is not None else "UNATTRIB"), first, msg


# ------------------------------------------------------------------ anchors
L = "ledger-store.ts"; O = "orchestrate.ts"
LT = "ledger-store.test.mjs"; OT = "orchestrate.test.mjs"; AT = "architecture.test.mjs"

QUAR_FIELD = '\tprivate readonly quarantined = new Map<string, string>();'
QUAR_METHOD = ('\tquarantine(taskId: string, reason: string): void {\n'
               '\t\tthis.quarantined.set(taskId, reason);\n\t}')
ISQ_METHOD = ('\tisQuarantined(taskId: string): boolean {\n'
              '\t\treturn this.quarantined.has(taskId);\n\t}')
QUAR_BLOCK = ('\t\tif (this.isQuarantined(record.taskId)) {\n'
              '\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";\n'
              '\t\t\tconst err = new Error(`quarantined: ${reason}`);\n'
              '\t\t\tthis._lastWriteError = err;\n'
              '\t\t\tthis.writeErrors.set(record.taskId, err);\n'
              '\t\t\treturn;\n\t\t}\n')
QUAR_ERRSET = '\t\t\tthis.writeErrors.set(record.taskId, err);\n\t\t\treturn;'
QUAR_MSG = '\t\t\tconst err = new Error(`quarantined: ${reason}`);'
QUAR_RETURN = '\t\t\treturn;\n\t\t}\n\t\ttry {'
TMP_PATH = '\t\tconst tmpPath = join(ledgerDir, `.tmp-${process.pid}-${++tmpSeq}`);'
STEM_OK = '\t\t\tconst path = join(ledgerDir, name);'
PARSE_CATCH = ('\t\t\t} catch {\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n'
               '\t\t\t\tcontinue;\n\t\t\t}')

CORRUPT_SET = '\t\t\tthis.untrustedBalances.set(item.taskId, item.reason);'
CORRUPT_QUAR = '\t\t\tthis.snapshots.quarantine(item.taskId, item.reason);'
CORRUPT_FOR = '\t\tfor (const item of corrupt) {'
REST_RET = '\t\treturn { restored, corrupt };'
GATE_IF = '\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {'
DEL_UB = '\t\t\t\tdelete (input as Record<string, unknown>).usageBudget;'
DEL_FL = '\t\t\t\tdelete (input as Record<string, unknown>).__floorLimits;'

# ------------------------------------------------------------------ mutations
# --- ledger-store.ts (Q1..Q13, ledger-store.test.mjs) ---
def m_q1():  sub(L, ISQ_METHOD, '\tisQuarantined(taskId: string): boolean {\n\t\treturn this.quarantined.has(taskId) || taskId === "T-20260908-q1";\n\t}')
def m_q2():  sub(L, QUAR_METHOD, '\tquarantine(taskId: string, reason: string): void {\n\t\tvoid taskId; void reason;\n\t}')
def m_q3():  sub(L, ISQ_METHOD, '\tisQuarantined(taskId: string): boolean {\n\t\tvoid taskId;\n\t\treturn this.quarantined.size > 0;\n\t}')
def m_q4():  sub(L, QUAR_ERRSET, '\t\t\tthis.writeErrors.set(record.taskId, err);\n\t\t\tthrow err;')
def m_q5():  sub(L, QUAR_BLOCK, '')
def m_q6():  sub(L, QUAR_RETURN, '\t\t\tfs.mkdirSync(join(this.dir, "planner-only", "ledger"), { recursive: true });\n\t\t\tfs.writeFileSync(join(this.dir, "planner-only", "ledger", ".tmp-quarantine"), "x", "utf8");\n\t\t\treturn;\n\t\t}\n\t\ttry {')
def m_q6b(): sub(L, QUAR_RETURN, '\t\t\tconst probe = join(this.dir, "planner-only", "ledger", ".tmp-probe");\n\t\t\tfs.mkdirSync(join(this.dir, "planner-only", "ledger"), { recursive: true });\n\t\t\tfs.writeFileSync(probe, "x", "utf8");\n\t\t\tfs.unlinkSync(probe);\n\t\t\treturn;\n\t\t}\n\t\ttry {')
def m_q7():  sub(L, QUAR_ERRSET, '\t\t\treturn;')
def m_q8():  sub(L, QUAR_MSG, '\t\t\tconst err = new Error(`failed to persist ledger snapshot: ${reason}`);')
def m_q9():  m_q3()          # scope leak: every id counts as quarantined once one is
def m_q10(): sub(L, TMP_PATH, '\t\tconst tmpPath = join(ledgerDir, "T-20260908-q1.json");')
def m_q11():
    sub(L, 'let tmpSeq = 0;', 'let tmpSeq = 0;\nconst GLOBAL_QUARANTINE = new Map<string, string>();')
    sub(L, QUAR_FIELD, '\tprivate readonly quarantined = GLOBAL_QUARANTINE;')
def m_q12(): sub(L, STEM_OK, '\t\t\tif (this.isQuarantined(stem)) continue;\n' + STEM_OK)
def m_q13(): sub(L, PARSE_CATCH, '\t\t\t} catch {\n\t\t\t\tfs.writeFileSync(path, JSON.stringify({ version: 1, task: { taskId: stem } }), "utf8");\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n\t\t\t\tcontinue;\n\t\t\t}')

# --- orchestrate.ts (L14..L24, orchestrate.test.mjs) ---
def m_l14():  sub(O, REST_RET, '\t\treturn { restored, corrupt: [] };')
def m_l14b(): sub(O, CORRUPT_SET, '\t\t\tvoid item;')
def m_l15():  sub(O, CORRUPT_QUAR, '\t\t\tvoid 0;')
def m_l16():  sub(O, GATE_IF, '\t\tif (untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {')
def m_l17():  sub(L, QUAR_ERRSET, '\t\t\tthis.writeErrors.set(record.taskId, err);\n\t\t\tthis.quarantined.delete(record.taskId);\n\t\t\treturn;')
def m_l18():  sub(O, GATE_IF, '\t\tif (false && role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {')
def m_l18b(): sub(O, DEL_UB, '\t\t\t\tvoid 0;')
def m_l18c():
    # First draft removed `delete input.__floorLimits` and the suite stayed
    # green -- I nearly filed L18c as vacuous. Probe
    # r078-planner-floorlimits-shape.mjs says why that mutation proves nothing:
    # __floorLimits is {value, source}, so /"hard":\s*0\.5/ can never match it.
    # The only key that carries `"hard": 0.5` is usageBudget, so mutate that
    # deletion and let the disarm loop step past L18b.
    sub(O, DEL_UB, '\t\t\t\tvoid 0;')
def m_l19():
    sub(L, 'let tmpSeq = 0;', 'let tmpSeq = 0;\nconst SEEN_CORRUPT = new Set<string>();')
    sub(L, PARSE_CATCH, '\t\t\t} catch {\n\t\t\t\tif (SEEN_CORRUPT.has(stem)) continue;\n\t\t\t\tSEEN_CORRUPT.add(stem);\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n\t\t\t\tcontinue;\n\t\t\t}')
def m_l20():
    # Narrow on purpose: the first draft skipped the whole corrupt loop on every
    # second restore, which killed the placeholder in the earlier L9 block --
    # `store.require` threw from a non-assert line and the disarm loop spun.
    # Forget only the untrusted mark, only for this block's taskId, only the
    # second time round. The placeholder still exists, so the status renders.
    sub(O, 'export class PlannerOrchestrator {', 'let L20_SEEN = 0;\nexport class PlannerOrchestrator {')
    sub(O, CORRUPT_SET, '\t\t\tif (item.taskId !== "T-20260908-963" || ++L20_SEEN < 2) this.untrustedBalances.set(item.taskId, item.reason);')
def m_l21():
    sub(O, 'export class PlannerOrchestrator {', 'const REFUSED_ONCE = new Set<string>();\nexport class PlannerOrchestrator {')
    sub(O, GATE_IF, '\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId) && !REFUSED_ONCE.has(untrustedTaskId)) {\n\t\t\tREFUSED_ONCE.add(untrustedTaskId);')
def m_l22(): m_l18b()
def m_l23(): m_l18c()
def m_l24(): m_l15()

# --- architecture.test.mjs text gates (C16-6..C16-9) ---
def m_c16_6():
    sub(L, QUAR_METHOD, '\tquarantine(ident: string, reason: string): void {\n\t\tthis.quarantined.set(ident, reason);\n\t}')
def m_c16_7():
    sub(L, ISQ_METHOD, '\tisQuarantined(ident: string): boolean {\n\t\treturn this.quarantined.has(ident);\n\t}')
def m_c16_8():
    sub(O, CORRUPT_QUAR, '\t\t\tconst snaps = this.snapshots;\n\t\t\tsnaps.quarantine(item.taskId, item.reason);')
def m_c16_9():
    sub(L, '\t\tif (this.isQuarantined(record.taskId)) {', '\t\tconst rid = record.taskId;\n\t\tif (this.isQuarantined(rid)) {')

CASES = [
    ("Q1",  LT, 337, m_q1,  "isQuarantined reports an unregistered taskId as quarantined"),
    ("Q2",  LT, 349, m_q2,  "quarantine() does not register anything (reverse mutation)"),
    ("Q3",  LT, 351, m_q3,  "quarantine leaks scope: any id counts once one is listed"),
    ("Q4",  LT, 353, m_q4,  "write of a quarantined id throws instead of returning"),
    ("Q5",  LT, 355, m_q5,  "quarantine check removed from write (reverse mutation)"),
    ("Q6",  LT, 357, m_q6,  "quarantined write leaves a temp file behind"),
    ("Q6b", LT, 358, m_q6b, "quarantined write calls writeFileSync (and cleans up after itself)"),
    ("Q7",  LT, 360, m_q7,  "quarantined write records no per-taskId write health"),
    ("Q8",  LT, 361, m_q8,  "quarantine reason worded as a disk fault"),
    ("Q9",  LT, 365, m_q9,  "quarantine leaks scope: the neighbour is refused too"),
    ("Q10", LT, 366, m_q10, "writeAtomic stages its temp file on the quarantined path"),
    ("Q11", LT, 369, m_q11, "quarantine list shared across store instances (persists)"),
    ("Q12", LT, 371, m_q12, "readAll skips quarantined stems"),
    ("Q13", LT, 372, m_q13, "readAll repairs the unparseable file (reverse mutation)"),
    ("L14", OT, 5851, m_l14,  "restoreFromLedger drops the corrupt list"),
    ("L14b",OT, 5854, m_l14b, "corrupt taskIds are not put in untrustedBalances"),
    ("L15", OT, 5857, m_l15,  "restoreFromLedger does not register the quarantine (reverse mutation)"),
    ("L16", OT, 5861, m_l16,  "reviewer exemption removed (reverse mutation)"),
    ("L17", OT, 5863, m_l17,  "quarantine is one-shot: cleared after the first refused write"),
    ("L18", OT, 5868, m_l18,  "untrusted gate disabled"),
    ("L18b",OT, 5869, m_l18b, "blocked path stops deleting input.usageBudget"),
    ("L18c",OT, 5870, m_l18c, "blocked path keeps input.usageBudget -- the only key that carries \"hard\": 0.5"),
    ("L19", OT, 5874, m_l19,  "a corrupt file is reported only in the session that first saw it"),
    ("L20", OT, 5876, m_l20,  "the second session forgets that the file is untrusted"),
    ("L21", OT, 5880, m_l21,  "refusal is one-shot across sessions"),
    ("L22", OT, 5881, m_l22,  "blocked path stops deleting input.usageBudget"),
    ("L23", OT, 5882, m_l23,  "blocked path keeps input.usageBudget -- the only key that carries \"hard\": 0.5"),
    ("L24", OT, 5883, m_l24,  "quarantine removed, so the corrupt bytes get overwritten"),
    ("C16-6", AT, 125, m_c16_6, "quarantine's parameter renamed (literal gone from source)"),
    ("C16-7", AT, 126, m_c16_7, "isQuarantined's parameter renamed (literal gone from source)"),
    ("C16-8", AT, 127, m_c16_8, "orchestrate calls quarantine through a local alias"),
    ("C16-9", AT, 128, m_c16_9, "write checks isQuarantined on a local, not record.taskId"),
]

results = []
ONLY = [n for n in os.environ.get("ONLY", "").split(",") if n]
for name, test_file, line_no, mutate, why in CASES:
    if ONLY and name not in ONLY: continue
    restore()
    mutate()
    neutralised = []
    verdict = "?"
    for _ in range(40):
        kind, first, msg = run(test_file)
        if kind == "ZERO":
            verdict = "VACUOUS"; break
        if kind == "UNATTRIB":
            verdict = f"UNATTRIB {msg}"; break
        if first == line_no:
            verdict = f"CAUGHT {msg}"; break
        neutralised.append(first)
        if not neutralise(test_file, first):
            verdict = f"UNDISARMABLE line {first} is not inside an assert: {msg}"; break
    else:
        verdict = "GAVE-UP"
    print(f"{name:6s} {test_file:22s} line {line_no:5d} neutralised={neutralised}\n       mutation: {why}\n       {verdict}", flush=True)
    results.append((name, verdict))

restore()
bad = [n for n, v in results if not v.startswith("CAUGHT")]
print(f"\n=== {len(results) - len(bad)}/{len(results)} CAUGHT ===")
if bad:
    print("NOT CAUGHT:", ", ".join(bad))
