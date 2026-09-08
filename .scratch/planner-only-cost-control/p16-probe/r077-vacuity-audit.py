#!/usr/bin/env python3
"""Planner-side per-assertion vacuity audit for p16-r077 (ticket 16-b).

Independent of the executor's driver (.p16-r077-vacuity/audit.py): every
mutation below is written from the assertion text, not copied from theirs.

For each assertion: apply a mutation it is supposed to catch, run its own
suite, and iteratively neutralise whichever assertion fires FIRST until the
failure is attributed to the target line.

  CAUGHT   - the target line was the failing line
  VACUOUS  - the suite exited 0 under the mutation
  UNATTRIB - non-zero exit with no frame in the target test file
"""
import subprocess, re, os

ROOT = os.getcwd()
SRC = ["ledger-store.ts", "task.ts", "orchestrate.ts", "index.ts"]
TESTS = ["ledger-store.test.mjs", "task.test.mjs", "orchestrate.test.mjs",
         "index.test.mjs", "architecture.test.mjs"]
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
L = "ledger-store.ts"; K = "task.ts"; O = "orchestrate.ts"; X = "index.ts"
LT = "ledger-store.test.mjs"; KT = "task.test.mjs"; OT = "orchestrate.test.mjs"
XT = "index.test.mjs"; AT = "architecture.test.mjs"

MISSING_DIR = '\t\tif (!fs.existsSync(ledgerDir)) {\n\t\t\treturn { records: [], corrupt: [] };\n\t\t}'
SKIP_TMP = '\t\t\tif (name.startsWith(".tmp-")) continue;'
SKIP_NONJSON = '\t\t\tif (!name.endsWith(".json")) continue;'
STEM_CHECK = '\t\t\tif (!SAFE_TASK_ID.test(stem)) {'
PARSE_CATCH = '\t\t\t} catch {\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n\t\t\t\tcontinue;\n\t\t\t}'
VER_CHECK = '\t\t\tif (env.version !== 1) {'
NOTASK_REASON = '\t\t\t\tcorrupt.push({ taskId: stem, reason: "missing task" });'
MISMATCH_REASON = '\t\t\t\tcorrupt.push({ taskId: stem, reason: `task.taskId does not match filename` });'
PUSH_REC = '\t\t\trecords.push(task);'
RET_READ = '\t\treturn { records, corrupt };'
INVALID_THROW = '\t\t\tthis._lastWriteError = err;\n\t\t\tthrow err;'
WRITE_OK = '\t\t\tthis.writeAtomic(record);\n\t\t\tthis.writeErrors.delete(record.taskId);'
WRITE_CATCH = '\t\t} catch (err) {\n\t\t\tthis._lastWriteError = err;\n\t\t\tthis.writeErrors.set(record.taskId, err);\n\t\t\tthis.warnIo(err);\n\t\t}'
WRITE_ERR_FOR = '\twriteErrorFor(taskId: string): unknown {\n\t\treturn this.writeErrors.get(taskId);\n\t}'
READ_FILE = '\t\t\t\traw = fs.readFileSync(path, "utf8");'

RESTORE_SIG = '\trestore(record: TaskRecord): void {\n\t\tif (this.tasks.has(record.taskId)) return;\n\t\tthis.tasks.set(record.taskId, record);\n\t}'
RESTORE_GUARD = '\t\tif (this.tasks.has(record.taskId)) return;'
RESTORE_SET = '\t\tthis.tasks.set(record.taskId, record);'

NO_SNAP = '\t\tif (!this.snapshots) return { restored: 0, corrupt: [] };'
REST_LOOP = '\t\t\tif (this.store.get(record.taskId)) continue;\n\t\t\tthis.store.restore(record);\n\t\t\trestored += 1;'
REST_RET = '\t\treturn { restored, corrupt };'
CORRUPT_LOOP = '\t\t\tthis.untrustedBalances.set(item.taskId, item.reason);'
SNAP_ASSIGN = '\t\t\tthis.snapshots = snapshots;'
UNTRUSTED_GATE = '\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {'
REFUSAL_MSG = '\t\t\t`Planner-only guard: task ${taskId} ledger snapshot unreadable`,'
REFUSAL_2ND = '\t\t\t"余额无法确认，拒绝新的受控启动。",'
STATUS_UNTRUSTED = '\t\t\tlines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");'
STATUS_BRANCH = '\t\tif (untrustedReason) {'
SESSION_START = '\t\torchestrator.restoreFromLedger();'

# ------------------------------------------------------------------ mutations
def m_b1():  sub(L, MISSING_DIR, '\t\tif (!fs.existsSync(ledgerDir)) {\n\t\t\treturn { records: [], corrupt: [{ taskId: "?", reason: "no ledger dir" }] };\n\t\t}')
def m_b2():  sub(L, MISSING_DIR, '\t\tif (!fs.existsSync(ledgerDir)) {\n\t\t\tthis.warnIo(new Error("no ledger dir"));\n\t\t\treturn { records: [], corrupt: [] };\n\t\t}')
def m_b3():  sub(L, PUSH_REC, '\t\t\tvoid task;')
def m_b4():  sub(L, PUSH_REC, '\t\t\trecords.push({ ...task, taskId: `${task.taskId}!` });')
def m_b5():  sub(L, SKIP_TMP, '\t\t\tvoid name;')
def m_b6():  sub(L, SKIP_TMP, '\t\t\tif (name.startsWith(".tmp-")) { fs.unlinkSync(join(ledgerDir, name)); continue; }')
def m_b7():  sub(L, SKIP_NONJSON, '\t\t\tif (!name.endsWith(".json")) { fs.unlinkSync(join(ledgerDir, name)); continue; }')
def m_b8():  sub(L, RET_READ, '\t\tif (corrupt.length > 0) return { records: [], corrupt };\n' + RET_READ)
def m_b9():  sub(L, STEM_CHECK, '\t\t\tif (false && !SAFE_TASK_ID.test(stem)) {')
def m_b10(): sub(L, PARSE_CATCH, '\t\t\t} catch {\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "damaged file" });\n\t\t\t\tcontinue;\n\t\t\t}')
def m_b11(): sub(L, VER_CHECK, '\t\t\tif (env.version !== 1 && env.version !== 2) {')
def m_b12(): sub(L, NOTASK_REASON, '\t\t\t\tcorrupt.push({ taskId: stem, reason: "no payload" });')
def m_b13(): sub(L, MISMATCH_REASON, '\t\t\t\tcorrupt.push({ taskId: stem, reason: `id mismatch` });')
def m_b14(): sub(L, PARSE_CATCH, '\t\t\t} catch {\n\t\t\t\tfs.unlinkSync(path);\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n\t\t\t\tcontinue;\n\t\t\t}')
def m_b15(): sub(L, VER_CHECK, '\t\t\tif (env.version !== 1) {\n\t\t\t\tfs.unlinkSync(path);')
def m_b16(): sub(L, INVALID_THROW, '\t\t\tthis._lastWriteError = err;\n\t\t\treturn;')
def m_b17(): sub(L, INVALID_THROW, '\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warnIo(err);\n\t\t\tthrow err;')
def m_b18(): sub(L, WRITE_CATCH, '\t\t} catch (err) {\n\t\t\tif (String(this._lastWriteError ?? "").includes("invalid ledger taskId")) throw err;\n\t\t\tthis._lastWriteError = err;\n\t\t\tthis.writeErrors.set(record.taskId, err);\n\t\t\tthis.warnIo(err);\n\t\t}')
def m_b19(): sub(L, INVALID_THROW, '\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warnedIo = true;\n\t\t\tthrow err;')
def m_b20(): sub(L, WRITE_CATCH, '\t\t} catch (err) {\n\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warnIo(err);\n\t\t}')
def m_b21(): sub(L, WRITE_ERR_FOR, '\twriteErrorFor(taskId: string): unknown {\n\t\treturn this.writeErrors.get(taskId) ?? this._lastWriteError;\n\t}')
def m_b22(): sub(L, WRITE_OK, '\t\t\tthis.writeAtomic(record);')
def m_b23(): sub(L, WRITE_OK, WRITE_OK + '\n\t\t\tthis._lastWriteError = undefined;')
def m_b24(): sub(L, WRITE_OK, WRITE_OK + '\n\t\t\tthis._lastWriteError = new Error("last write ok");')

def m_r1():
    sub(K, '\trestore(record: TaskRecord): void {', '\tinstall(record: TaskRecord): void {')
    sub(O, '\t\t\tthis.store.restore(record);', '\t\t\tthis.store.install(record);')
    sub(O, '\t\t\t\tthis.store.restore(untrustedPlaceholder(item.taskId));', '\t\t\t\tthis.store.install(untrustedPlaceholder(item.taskId));')
def m_r2(): sub(K, RESTORE_SET, '\t\tthis.tasks.set(record.taskId, { ...record, state: "planning" });')
def m_r3(): sub(K, RESTORE_SET, '\t\tthis.tasks.set(record.taskId, record);\n\t\tthis.touch(record);')
def m_r4(): sub(K, RESTORE_SET, '\t\tthis.tasks.set(record.taskId, record);\n\t\tthis.persist(record);')
def m_r5(): sub(K, RESTORE_GUARD, '\t\tvoid 0;')
def m_r6(): sub(K, RESTORE_GUARD, '\t\tif (this.tasks.has(record.taskId)) { this.persist(record); return; }')

def m_l1():  sub(O, REST_LOOP, '\t\t\tif (this.store.get(record.taskId)) continue;\n\t\t\tthis.store.restore(record);')
def m_l1b(): sub(O, REST_RET, '\t\treturn { restored, corrupt: [...corrupt, { taskId: "synthetic", reason: "noise" }] };')
def m_l1c(): sub(O, '\t\t\tthis.store.restore(record);', '\t\t\tthis.store.restore({ ...record, state: "planning" });')
def m_l2():  sub(O, '\t\tif (deps.store) {\n\t\t\tthis.store = deps.store;', '\t\tif (deps.store) {\n\t\t\tthis.store = deps.store;\n\t\t\tif (deps.ledgerDir) this.snapshots = new LedgerSnapshotStore(deps.ledgerDir);')
def m_l2b(): sub(O, '\t\tif (deps.store) {\n\t\t\tthis.store = deps.store;', '\t\tif (deps.store) {\n\t\t\tthis.store = deps.store;\n\t\t\tif (deps.ledgerDir) { this.snapshots = new LedgerSnapshotStore(deps.ledgerDir); }')
def m_l3():  sub(O, NO_SNAP, '\t\tif (!this.snapshots) return { restored: 1, corrupt: [] };')
def m_l4():  sub(O, REST_LOOP, REST_LOOP + '\n\t\t\tthis.reservations.reserve(record.taskId, { tokens: { limit: 1000, known: 0 }, costUsd: { limit: 1, known: 0 } } as never, { toolCallId: "restored", tokens: 5, costUsd: 0.5 });')
def m_l5():  sub(O, '\t\t\tthis.store.restore(record);', '\t\t\tthis.store.restore({ ...record, usage: { ...record.usage, children: [...(record.usage?.children ?? []), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, kind: "worker", pending: false, source: "sync-details", costUsd: 1 }] } } as never);')
def m_l5b(): sub(O, '\t\t\tthis.store.restore(record);', '\t\t\tthis.store.restore({ ...record, spec: record.spec ? { ...record.spec, cumulativeBudget: undefined } : undefined } as never);')
def m_l12():  sub(O, REST_LOOP, REST_LOOP + '\n\t\t\tthis.store.persist({ ...record, updatedAt: "1999-01-01T00:00:00.000Z" });')
def m_l12a(): sub(O, '\t\t\tthis.store.restore(record);', '\t\t\tthis.store.restore({ ...record, updatedAt: "1999-01-01T00:00:00.000Z" });')
def m_l13():  sub(O, '\t\t\tif (this.store.get(record.taskId)) continue;', '\t\t\tif (this.store.get(record.taskId)) { restored += 1; continue; }')
def m_l13b():
    sub(O, '\t\t\tif (this.store.get(record.taskId)) continue;', '\t\t\tvoid 0;')
    sub(K, RESTORE_GUARD, '\t\tvoid 0;')
def m_l9c(): sub(O, CORRUPT_LOOP, CORRUPT_LOOP + '\n\t\t\trestored += 1;')
def m_l6c(): sub(O, REST_RET, '\t\treturn { restored, corrupt: [] };')
def m_l10():  sub(O, STATUS_BRANCH, '\t\tif (false && untrustedReason) {')
def m_l10b(): sub(O, STATUS_UNTRUSTED, '\t\t\tlines.push("Budget: 余额不可信");')
def m_l11():  sub(O, STATUS_UNTRUSTED, STATUS_UNTRUSTED + '\n\t\t\tlines.push("  剩余 $0.0100");')
def m_l11b(): sub(O, STATUS_UNTRUSTED, STATUS_UNTRUSTED + '\n\t\t\tlines.push("  剩余 42");')
def m_l6():   sub(O, UNTRUSTED_GATE, '\t\tif (false && role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {')
def m_l6b():  sub(O, REFUSAL_2ND, '\t\t\t"账本读不出来。",')
def m_l7():   sub(O, REFUSAL_2ND, '\t\t\t"cumulative budget exhausted (costUsd).",')
def m_l8():   sub(O, UNTRUSTED_GATE, '\t\tif (untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {')
def m_l9():   sub(O, UNTRUSTED_GATE, '\t\tif (role !== "reviewer" && this.untrustedBalances.size > 0) {\n\t\t\tconst untrustedTaskIdX = untrustedTaskId ?? [...this.untrustedBalances.keys()][0];\n\t\t\tvoid untrustedTaskIdX;')
def m_l9d():  sub(O, '\t\tconst untrustedReason = this.untrustedBalances.get(task.taskId);', '\t\tconst untrustedReason = this.untrustedBalances.get(task.taskId) ?? (this.untrustedBalances.size > 0 ? "spill" : undefined);')
def m_l9e():  sub(O, '				return `  ${label}: 已用 ${format(dimension.known)}${debtNote} / 上限 ${format(dimension.limit)}，剩余 ${format(dimension.remaining ?? 0)}，未知项 ${dimension.unknownParts} 项${overBudget}`;', '				return `  ${label}: 已用 ${format(dimension.known)}${debtNote} / 上限 ${format(dimension.limit)}，余量 ${format(dimension.remaining ?? 0)}，未知项 ${dimension.unknownParts} 项${overBudget}`;')

def m_i1(): sub(X, SESSION_START, '\t\tvoid 0;')
def m_i2(): sub(O, '				return `  ${label}: 已用 ${format(dimension.known)}${debtNote} / 上限 ${format(dimension.limit)}，剩余 ${format(dimension.remaining ?? 0)}，未知项 ${dimension.unknownParts} 项${overBudget}`;', '				return `  ${label}: 已用 ${format(dimension.known)}${debtNote} / 上限 ${format(dimension.limit)}，剩余 ${format(dimension.limit)}，未知项 ${dimension.unknownParts} 项${overBudget}`;')
def m_i3(): sub(O, REST_LOOP, REST_LOOP + '\n\t\t\tthis.untrustedBalances.set(record.taskId, "restored");')
def m_i4(): m_l5b()

def m_c4():
    sub(L, 'const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");',
        'const fs = createRequire(import.meta.url)("fs") as typeof import("node:fs");\nconst fsRead = (fs as unknown as Record<string, unknown>)[["read", "File", "Sync"].join("")] as never;')
    sub(L, READ_FILE, '\t\t\t\traw = fsRead(path, "utf8");')
def m_c16_1(): m_r1()
def m_c16_2():
    sub(O, '\trestoreFromLedger(): { restored: number; corrupt: LedgerCorrupt[] } {', '\treloadLedger(): { restored: number; corrupt: LedgerCorrupt[] } {')
    sub(X, SESSION_START, '\t\torchestrator.reloadLedger();')
def m_c16_3(): sub(X, SESSION_START, '\t\tvoid 0;')
def m_c16_4():
    text = open(O, encoding="utf8").read()
    assert "untrustedBalances" in text
    open(O, "w", encoding="utf8").write(text.replace("untrustedBalances", "untrustedIds"))
def m_c16_5():
    text = open(O, encoding="utf8").read()
    assert "ledger snapshot unreadable" in text
    open(O, "w", encoding="utf8").write(text.replace("ledger snapshot unreadable", "snapshot broken"))

CASES = [
    ("B1",  LT, 239, m_b1,  "missing ledger dir returns a corrupt entry"),
    ("B2",  LT, 240, m_b2,  "missing ledger dir warns"),
    ("B3",  LT, 258, m_b3,  "valid snapshot never pushed into records"),
    ("B4",  LT, 259, m_b4,  "records carry a mangled taskId"),
    ("B5",  LT, 260, m_b5,  ".tmp- leftovers are not skipped"),
    ("B6",  LT, 261, m_b6,  "readAll unlinks .tmp- leftovers"),
    ("B7",  LT, 262, m_b7,  "readAll unlinks non-json files"),
    ("B8",  LT, 280, m_b8,  "one corrupt file suppresses every record"),
    ("B9",  LT, 282, m_b9,  "unsafe stem check dropped"),
    ("B10", LT, 283, m_b10, "parse failure reports a different reason"),
    ("B11", LT, 284, m_b11, "version 2 accepted as valid"),
    ("B12", LT, 285, m_b12, "missing task reports a different reason"),
    ("B13", LT, 286, m_b13, "id mismatch reports a different reason"),
    ("B14", LT, 287, m_b14, "readAll deletes an unparseable file"),
    ("B15", LT, 288, m_b15, "readAll deletes an unsupported-version file"),
    ("B16", LT, 304, m_b16, "invalid taskId returns instead of throwing"),
    ("B17", LT, 305, m_b17, "invalid taskId consumes the I/O warn quota"),
    ("B18", LT, 309, m_b18, "a sticky invalid-id error makes the next I/O failure rethrow"),
    ("B19", LT, 310, m_b19, "invalid taskId silently burns warnedIo"),
    ("B20", LT, 311, m_b20, "write failure records no per-task health"),
    ("B21", LT, 312, m_b21, "writeErrorFor falls back to the global last error"),
    ("B22", LT, 315, m_b22, "successful write does not clear the failure mark"),
    ("B23", LT, 316, m_b23, "successful write clears lastWriteError"),
    ("B24", LT, 317, m_b24, "successful write overwrites lastWriteError"),
    ("R1",  KT, 539, m_r1,  "TaskStore.restore renamed to install"),
    ("R2",  KT, 560, m_r2,  "restore forces state=planning"),
    ("R3",  KT, 561, m_r3,  "restore touches the record"),
    ("R4",  KT, 562, m_r4,  "restore persists the record"),
    ("R5",  KT, 566, m_r5,  "restore overwrites a live in-memory record"),
    ("R6",  KT, 567, m_r6,  "a skipped restore still persists"),
    ("L3",  OT, 5747, m_l3,  "no-ledgerDir path claims restored:1"),
    ("L2",  OT, 5756, m_l2,  "injected store still reads the disk ledger"),
    ("L2b", OT, 5757, m_l2b, "injected store gets snapshots installed"),
    ("L1",  OT, 5772, m_l1,  "restored counter never increments"),
    ("L1b", OT, 5773, m_l1b, "a synthetic corrupt entry is reported"),
    ("L1c", OT, 5775, m_l1c, "restore rewrites state to planning"),
    ("L12a",OT, 5776, m_l12a,"restore stamps a fresh updatedAt"),
    ("L12", OT, 5777, m_l12, "restoreFromLedger rewrites the snapshot bytes"),
    ("L4",  OT, 5778, m_l4,  "restore rehydrates an in-flight reservation"),
    ("L5",  OT, 5781, m_l5,  "restore inflates usage past the budget"),
    ("L5b", OT, 5782, m_l5b, "restore drops spec.cumulativeBudget"),
    ("L13", OT, 5799, m_l13, "an in-memory record counts as restored"),
    ("L13b",OT, 5800, m_l13b,"the disk snapshot overwrites live memory"),
    ("L9c", OT, 5817, m_l9c, "corrupt entries count as restored"),
    ("L6c", OT, 5818, m_l6c, "corrupt list is dropped from the result"),
    ("L10", OT, 5820, m_l10, "status skips the untrusted branch"),
    ("L10b",OT, 5821, m_l10b,"untrusted line drops the snapshot wording"),
    ("L11", OT, 5822, m_l11, "untrusted status still prints 剩余 $N"),
    ("L11b",OT, 5823, m_l11b,"untrusted status prints a bare 剩余 number"),
    ("L6",  OT, 5825, m_l6,  "untrusted gate disabled"),
    ("L6b", OT, 5826, m_l6b, "refusal drops the 余额无法确认 sentence"),
    ("L7",  OT, 5827, m_l7,  "untrusted refusal reuses the exhausted-budget wording"),
    ("L8",  OT, 5829, m_l8,  "reviewer exemption removed (reverse mutation)"),
    ("L9",  OT, 5832, m_l9,  "any corrupt file freezes every Task (reverse mutation)"),
    ("L9d", OT, 5835, m_l9d, "every Task renders as untrusted"),
    ("L9e", OT, 5836, m_l9e, "status stops printing 剩余"),
    ("I1",  XT, 4012, m_i1,  "session_start no longer restores"),
    ("I2",  XT, 4013, m_i2,  "status prints the limit as the remaining"),
    ("I3",  XT, 4019, m_i3,  "every restored Task is marked untrusted"),
    ("I4",  XT, 4020, m_i4,  "restore drops spec.cumulativeBudget"),
    ("C4",   AT, 114, m_c4,     "readFileSync reached without naming it"),
    ("C16-1",AT, 120, m_c16_1,  "TaskStore.restore renamed to install"),
    ("C16-2",AT, 121, m_c16_2,  "restoreFromLedger renamed to reloadLedger"),
    ("C16-3",AT, 122, m_c16_3,  "session_start call removed"),
    ("C16-4",AT, 123, m_c16_4,  "untrustedBalances renamed to untrustedIds"),
    ("C16-5",AT, 124, m_c16_5,  "refusal message reworded"),
]

results = []
ONLY = [n for n in os.environ.get("ONLY", "").split(",") if n]
for name, test_file, line_no, mutate, why in CASES:
    if ONLY and name not in ONLY: continue
    restore()
    mutate()
    neutralised = []
    verdict = "?"
    for _ in range(30):
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
