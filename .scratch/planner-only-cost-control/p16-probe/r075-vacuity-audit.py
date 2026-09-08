#!/usr/bin/env python3
"""Planner-side per-assertion vacuity audit for round p16-r075 (ticket 16-a).

For each new assertion: apply a mutation the assertion is supposed to catch,
run its test file, and iteratively neutralise whatever assertion fires FIRST
until the failure is attributed to the target line. If the target never fires,
the assertion is vacuous.
"""
import subprocess, re, sys, os

ROOT = os.getcwd()
SRC = ["ledger-store.ts", "task.ts", "orchestrate.ts", "index.ts", "package.json"]
TESTS = ["ledger-store.test.mjs", "task.test.mjs", "architecture.test.mjs"]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    assert old in text, f"anchor not found in {path}: {old[:80]!r}"
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def append(path, text):
    with open(path, "a", encoding="utf8") as fh:
        fh.write(text)

def neutralise(path, line_no):
    lines = open(path, encoding="utf8").read().split("\n")
    lines[line_no - 1] = "// NEUTRALISED " + lines[line_no - 1]
    open(path, "w", encoding="utf8").write("\n".join(lines))

FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+?\.mjs):(\d+):\d+")

def run(test_file):
    p = subprocess.run(["node", "--experimental-strip-types", test_file],
                       capture_output=True, text=True)
    if p.returncode == 0:
        return None, ""
    out = p.stdout + p.stderr
    first = None
    for m in FAIL_RE.finditer(out):
        if m.group(1) == test_file:
            first = int(m.group(2)); break
    msg = ""
    for line in out.split("\n"):
        s = line.strip()
        if s.startswith(("AssertionError", "TypeError", "SyntaxError", "Error:")) or "AssertionError" in s:
            msg = s; break
    return first, msg

# ---------------- verbatim anchors ----------------
LS = "ledger-store.ts"
LEDGERDIR = '\t\tconst ledgerDir = join(this.dir, "planner-only", "ledger");'
CTOR = "\tconstructor(dir: string) {\n\t\tthis.dir = dir;\n\t}"
GUARD = """\t\tif (!SAFE_TASK_ID.test(record.taskId)) {
\t\t\tconst err = new Error(`invalid ledger taskId: ${record.taskId}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warn(err);
\t\t\tthrow err;
\t\t}
"""
OUTER = """\t\ttry {
\t\t\tthis.writeAtomic(record);
\t\t} catch (err) {
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warn(err);
\t\t}"""
BODY = """\t\tconst body = JSON.stringify({
\t\t\tversion: 1,
\t\t\twrittenAt: new Date().toISOString(),
\t\t\ttask: record,
\t\t});
\t\tfs.mkdirSync(ledgerDir, { recursive: true });"""
TMPPATH = '\t\tconst tmpPath = join(ledgerDir, `.tmp-${process.pid}-${++tmpSeq}`);'
INNER = """\t\ttry {
\t\t\tfs.writeFileSync(tmpPath, body, "utf8");
\t\t\tfs.renameSync(tmpPath, finalPath);
\t\t} catch (err) {
\t\t\ttry {
\t\t\t\tfs.unlinkSync(tmpPath);
\t\t\t} catch {
\t\t\t\t// temp may not exist yet
\t\t\t}
\t\t\tthrow err;
\t\t}"""
ORCH = """\t\tif (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else if (deps.ledgerDir) {
\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);
\t\t\tthis.store = new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t} else {
\t\t\tthis.store = new TaskStore();
\t\t}"""
TASK_PERSIST = """\tpersist(record: TaskRecord): void {
\t\ttry {
\t\t\tthis.onPersist?.(record);
\t\t} catch {
\t\t\t// The sink records lastWriteError. Task memory must not die with a snapshot.
\t\t}
\t}"""
TASK_TOUCH = """\tprivate touch(record: TaskRecord): TaskRecord {
\t\trecord.updatedAt = this.now().toISOString();
\t\tthis.persist(record);
\t\treturn record;
\t}"""

# ---------------- mutations ----------------
def m_path():      sub(LS, LEDGERDIR, '\t\tconst ledgerDir = join(this.dir, "planner-only", "ledgerX");')
def m_version():   sub(LS, "\t\t\tversion: 1,", "\t\t\tversion: 2,")
def m_written():   sub(LS, "\t\t\twrittenAt: new Date().toISOString(),", '\t\t\twrittenAt: "nope",')
def m_taskid():    sub(LS, "\t\t\ttask: record,", '\t\t\ttask: { ...record, taskId: "MUTATED" },')
def m_nobudget():  sub(LS, "\t\t\ttask: record,", "\t\t\ttask: { ...record, spec: { ...record.spec, cumulativeBudget: undefined } },")
def m_envdir():    sub(LS, CTOR, "\tconstructor(dir: string) {\n\t\tthis.dir = process.env.PI_CODING_AGENT_DIR ?? dir;\n\t}")
def m_nowrite():   sub(LS, GUARD, GUARD + "\t\tif (SAFE_TASK_ID.test(record.taskId)) return;\n")
def m_noidguard(): sub(LS, GUARD, "")
def m_badbody():   sub(LS, BODY, '\t\tconst body = "{{{";\n\t\tfs.mkdirSync(ledgerDir, { recursive: true });')
def m_nocatch():   sub(LS, OUTER, "\t\tthis.writeAtomic(record);")
def m_truncate():  sub(LS, BODY, '\t\tfs.mkdirSync(ledgerDir, { recursive: true });\n\t\tfs.writeFileSync(finalPath, "", "utf8");\n' + BODY.rsplit("\n", 1)[0])
def m_nolasterr(): sub(LS, OUTER, "\t\ttry {\n\t\t\tthis.writeAtomic(record);\n\t\t} catch (err) {\n\t\t\tthis.warn(err);\n\t\t}")
def m_direct():    sub(LS, INNER, '\t\tfs.writeFileSync(finalPath, body, "utf8");')
def m_append():    sub(LS, '\t\t\tfs.writeFileSync(tmpPath, body, "utf8");', '\t\t\tfs.appendFileSync(tmpPath, body, "utf8");')
def m_tmproot():   sub(LS, TMPPATH, '\t\tconst tmpPath = join(this.dir, `.tmp-${process.pid}-${++tmpSeq}`);')
def m_nopid():     sub(LS, TMPPATH, '\t\tconst tmpPath = join(ledgerDir, `.tmp-${++tmpSeq}`);')
def m_throw2nd():  sub(LS, OUTER, "\t\ttry {\n\t\t\tthis.writeAtomic(record);\n\t\t} catch (err) {\n\t\t\tthis._lastWriteError = err;\n\t\t\tconst first = !this.warned;\n\t\t\tthis.warn(err);\n\t\t\tif (!first) throw err;\n\t\t}")
def m_generic():   sub(LS, OUTER, '\t\ttry {\n\t\t\tthis.writeAtomic(record);\n\t\t} catch (err) {\n\t\t\tthis._lastWriteError = new Error("persist failed");\n\t\t\tthis.warn(err);\n\t\t}')
def m_warntwice(): sub(LS, "\t\tif (this.warned) return;", "")

def m_orch_nosink():   sub("orchestrate.ts", ORCH, "\t\tif (deps.store) {\n\t\t\tthis.store = deps.store;\n\t\t} else {\n\t\t\tthis.store = new TaskStore();\n\t\t}")
def m_orch_ledger1st():sub("orchestrate.ts", ORCH, "\t\tif (deps.ledgerDir) {\n\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);\n\t\t\tthis.store = new TaskStore({\n\t\t\t\tonPersist: (record) => snapshots.write(record),\n\t\t\t});\n\t\t} else if (deps.store) {\n\t\t\tthis.store = deps.store;\n\t\t} else {\n\t\t\tthis.store = new TaskStore();\n\t\t}")
def m_orch_cwd():      sub("orchestrate.ts", "\t\t} else if (deps.ledgerDir) {\n\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);",
                           "\t\t} else if (true) {\n\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir ?? process.cwd());")

def m_task_nocreate(): sub("task.ts", "\t\tthis.tasks.set(taskId, record);\n\t\tthis.persist(record);", "\t\tthis.tasks.set(taskId, record);")
def m_task_notouch():  sub("task.ts", TASK_TOUCH, "\tprivate touch(record: TaskRecord): TaskRecord {\n\t\trecord.updatedAt = this.now().toISOString();\n\t\treturn record;\n\t}")
def m_task_dup():      sub("task.ts", "\t\tif (this.tasks.has(taskId)) return this.tasks.get(taskId) as TaskRecord;",
                           "\t\tif (this.tasks.has(taskId)) {\n\t\t\tconst existing = this.tasks.get(taskId) as TaskRecord;\n\t\t\tthis.persist(existing);\n\t\t\treturn existing;\n\t\t}")
def m_task_noop():     sub("task.ts", TASK_PERSIST, "\tpersist(record: TaskRecord): void {\n\t\tvoid record;\n\t}")
def m_task_rethrow():  sub("task.ts", TASK_PERSIST, "\tpersist(record: TaskRecord): void {\n\t\tthis.onPersist?.(record);\n\t}")

def m_c1(): sub("package.json", '    "ledger-store.ts",\n', "")
def m_c2(): sub("package.json", "node --experimental-strip-types ledger-store.test.mjs && ", "")
def m_c3(): append(LS, '\n// import x from "./index.ts";\n')
def m_c4(): append(LS, "\n// readFileSync\n")
def m_c5(): append(LS, "\n// usage.jsonl\n")
def m_c6(): sub("index.ts", "\t\tledgerDir: AGENT_DIR,", "\t\tledgerDirTypo: AGENT_DIR,")
def m_c7(): sub("orchestrate.ts", 'from "./ledger-store.ts"', 'from "./ledger-store.js"')
def m_c8(): sub("orchestrate.ts", "new LedgerSnapshotStore(deps.ledgerDir)", "new LedgerSnapshotStore(String(deps.ledgerDir))")
def m_c9(): sub("index.ts", "\t\t\ttask.usage = usage;\n\t\t\torchestrator.store.persist(task);",
                "\t\t\ttask.usage = usage;\n\t\t\tvoid 0;\n\t\t\torchestrator.store.persist(task);")

L = "ledger-store.test.mjs"
T = "task.test.mjs"
C = "architecture.test.mjs"

CASES = [
    ("A1  snapshot path shape",                       m_path,        L,  51),
    ("A2  envelope.version is 1",                     m_version,     L,  53),
    ("A3  writtenAt is ISO-8601",                     m_written,     L,  54),
    ("A4  envelope.task.taskId matches",              m_taskid,      L,  55),
    ("A5  spec.cumulativeBudget survives",            m_nobudget,    L,  56),
    ("A6  ctor dir, not PI_CODING_AGENT_DIR",         m_envdir,      L,  71),
    ("A7  snapshot lands under the ctor dir",         m_nowrite,     L,  72),
    ("A8  empty taskId throws",                       m_noidguard,   L, 102),
    ("A9  taskId with slash throws",                  m_noidguard,   L, 103),
    ("A10 traversal-shaped taskId throws",            m_noidguard,   L, 104),
    ("A11 ../escape taskId throws",                   m_noidguard,   L, 105),
    ("A12 rejected taskIds create no files",          m_noidguard,   L, 101),
    ("A13 first snapshot is valid JSON",              m_badbody,     L, 119),
    ("A14 serialize failure does not throw",          m_nocatch,     L, 128),
    ("A15 serialize failure keeps old bytes",         m_truncate,    L, 129),
    ("A16 old snapshot still parseable",              m_truncate,    L, 130),
    ("A17 lastWriteError set on serialize failure",   m_nolasterr,   L, 131),
    ("A18 writeFileSync never targets final path",    m_direct,      L, 149),
    ("A19 a temp write was attempted",                m_append,      L, 150),
    ("A20 temp file sits beside the final file",      m_tmproot,     L, 151),
    ("A21 temp file name carries the pid",            m_nopid,       L, 152),
    ("A22 final stays complete during temp write",    m_direct,      L, 153),
    ("A23 failed write leaves the original",          m_direct,      L, 154),
    ("A24 no half-written final file",                m_direct,      L, 155),
    ("A25 I/O failure does not throw",                m_nocatch,     L, 176),
    ("A26 second I/O failure still no throw",         m_throw2nd,    L, 177),
    ("A27 lastWriteError exposed on I/O failure",     m_nolasterr,   L, 178),
    ("A28 lastWriteError carries the real error",     m_generic,     L, 179),
    ("A29 warns at most once per instance",           m_warntwice,   L, 180),
    ("A30 ledgerDir + no store persists on create",   m_orch_nosink, L, 195),
    ("A31 touch() persist captures mutations",        m_task_notouch,L, 198),
    ("A32 injected store builds no disk sink",        m_orch_ledger1st, L, 211),
    ("A33 no ledgerDir means no write into cwd",      m_orch_cwd,    L, 223),
    ("T1  create() invokes onPersist",                m_task_nocreate, T, 512),
    ("T2  touch() invokes onPersist",                 m_task_notouch,  T, 514),
    ("T3  create() of an existing id does not persist", m_task_dup,    T, 516),
    ("T4  persist() is the public sink",              m_task_noop,     T, 518),
    ("T5  onPersist throw must not fail create()",    m_task_rethrow,  T, 527),
    ("T6  onPersist throw must not fail touch()",     m_task_rethrow,  T, 528),
    ("C1  ledger-store.ts ships in package files",    m_c1, C, 111),
    ("C2  test script runs ledger-store.test.mjs",    m_c2, C, 112),
    ("C3  ledger-store imports no adapter/host",      m_c3, C, 113),
    ("C4  no read-back this round",                   m_c4, C, 114),
    ("C5  does not reuse usage.jsonl",                m_c5, C, 115),
    ("C6  adapter passes AGENT_DIR as ledgerDir",     m_c6, C, 116),
    ("C7  orchestrator owns LedgerSnapshotStore",     m_c7, C, 117),
    ("C8  sink is built from deps.ledgerDir",         m_c8, C, 118),
    ("C9  syncUsage persists after the usage write",  m_c9, C, 119),
]

results = []
try:
    for name, mutate, test_file, target in CASES:
        restore()
        mutate()
        neutralised = []
        verdict = "VACUOUS"
        detail = ""
        for _ in range(24):
            line, msg = run(test_file)
            if line is None:
                verdict = "VACUOUS" if not neutralised else f"VACUOUS after neutralising {neutralised}"
                break
            if line == target:
                verdict = "CAUGHT"; detail = msg; break
            neutralised.append(line)
            neutralise(test_file, line)
        results.append((name, test_file, target, verdict, detail, neutralised))
        print(f"[{verdict:9}] {name}  ({test_file}:{target})")
        if detail: print(f"            {detail[:160]}")
        if neutralised: print(f"            neutralised first: {neutralised}")
        sys.stdout.flush()
finally:
    restore()

print("\n==== SUMMARY ====")
for name, tf, target, verdict, detail, neut in results:
    print(f"{verdict:9} | {tf}:{target} | {name}")
bad = [r for r in results if r[3] != "CAUGHT"]
print(f"\n{len(results) - len(bad)}/{len(results)} assertions proven non-vacuous")
sys.exit(1 if bad else 0)
