#!/usr/bin/env python3
"""Per-assertion vacuity audit for p16-r075 ledger snapshot writes."""
import os, re, subprocess, sys

ROOT = os.getcwd()
LOG = os.path.join(ROOT, ".scratch", "planner-only-cost-control")
SRC = [
    "ledger-store.ts",
    "task.ts",
    "orchestrate.ts",
    "index.ts",
    "package.json",
    "ledger-store.test.mjs",
    "task.test.mjs",
    "architecture.test.mjs",
]
BAK = {f: open(f, encoding="utf8").read() for f in SRC}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    assert old in text, f"anchor not found in {path}: {old[:80]!r}"
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def neutralise(path, line_no):
    lines = open(path, encoding="utf8").read().split("\n")
    lines[line_no - 1] = "// NEUTRALISED " + lines[line_no - 1]
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

# ---- production snippets --------------------------------------------------
LEDGER_DIR = '\t\tconst ledgerDir = join(this.dir, "planner-only", "ledger");'
CTOR = """\tconstructor(dir: string) {
\t\tthis.dir = dir;
\t}"""
SAFE = """\t\tif (!SAFE_TASK_ID.test(record.taskId)) {
\t\t\tconst err = new Error(`invalid ledger taskId: ${record.taskId}`);
\t\t\tthis._lastWriteError = err;
\t\tthis.warn(err);
\t\t\tthrow err;
\t\t}
"""
# tabs in SAFE as in the file — verify below
CATCH = """\t\ttry {
\t\t\tthis.writeAtomic(record);
\t\t} catch (err) {
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warn(err);
\t\t}"""
WRITE_TEMP = """\t\t\tfs.writeFileSync(tmpPath, body, "utf8");
\t\t\tfs.renameSync(tmpPath, finalPath);"""
TMP = "\t\tconst tmpPath = join(ledgerDir, `.tmp-${process.pid}-${++tmpSeq}`);"
WARN_ONCE = """\t\tif (this.warned) return;
\t\tthis.warned = true;"""
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
CREATE = """\t\tthis.tasks.set(taskId, record);
\t\tthis.persist(record);
\t\treturn record;"""
TOUCH = """\t\trecord.updatedAt = this.now().toISOString();
\t\tthis.persist(record);
\t\treturn record;"""
PERSIST = """\tpersist(record: TaskRecord): void {
\t\ttry {
\t\t\tthis.onPersist?.(record);
\t\t} catch {
\t\t\t// The sink records lastWriteError. Task memory must not die with a snapshot.
\t\t}
\t}"""
DUP = "\t\tif (this.tasks.has(taskId)) return this.tasks.get(taskId) as TaskRecord;"

def m_path():          sub("ledger-store.ts", LEDGER_DIR, "\t\tconst ledgerDir = this.dir;")
def m_version():       sub("ledger-store.ts", "\t\t\tversion: 1,", "\t\t\tversion: 2,")
def m_written():        sub("ledger-store.ts", "\t\t\twrittenAt: new Date().toISOString(),", '\t\t\twrittenAt: "not-an-iso",')
def m_taskid():         sub("ledger-store.ts", "\t\t\ttask: record,", '\t\t\ttask: { ...record, taskId: "mutated-id" },')
def m_budget():         sub("ledger-store.ts", "\t\t\ttask: record,", "\t\t\ttask: { ...record, spec: { ...record.spec, cumulativeBudget: undefined } },")
def m_env():           sub("ledger-store.ts", CTOR, "\tconstructor(dir: string) {\n\t\tthis.dir = process.env.PI_CODING_AGENT_DIR ?? dir;\n\t}")
def m_nosafe():         sub("ledger-store.ts", SAFE, "")
def m_corrupt():        sub("ledger-store.ts", CATCH, CATCH.replace(
    "\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warn(err);",
    '\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warn(err);\n\t\t\ttry { fs.writeFileSync(join(this.dir, "planner-only", "ledger", record.taskId + ".json"), "CORRUPT", "utf8"); } catch { /* ignore */ }',
))
def m_nosave():         sub("ledger-store.ts", CATCH, """\t\ttry {
\t\t\tthis.writeAtomic(record);
\t\t} catch (err) {
\t\t\tthis.warn(err);
\t\t}""")
def m_rethrow():        sub("ledger-store.ts", CATCH, """\t\ttry {
\t\t\tthis.writeAtomic(record);
\t\t} catch (err) {
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warn(err);
\t\t\tthrow err;
\t\t}""")
def m_genericerr():     sub("ledger-store.ts", CATCH, """\t\ttry {
\t\t\tthis.writeAtomic(record);
\t\t} catch (err) {
\t\t\tthis._lastWriteError = new Error("generic");
\t\t\tthis.warn(err);
\t\t}""")
def m_final():          sub("ledger-store.ts", WRITE_TEMP, '\t\t\tfs.writeFileSync(finalPath, body, "utf8");')
def m_writesync():      sub("ledger-store.ts", WRITE_TEMP, """\t\t\tconst fd = fs.openSync(tmpPath, "w");
\t\t\tfs.writeSync(fd, body);
\t\t\tfs.closeSync(fd);
\t\t\tfs.renameSync(tmpPath, finalPath);""")
def m_parenttmp():      sub("ledger-store.ts", TMP, "\t\tconst tmpPath = join(this.dir, `.tmp-${process.pid}-${++tmpSeq}`);")
def m_nopid():          sub("ledger-store.ts", TMP, "\t\tconst tmpPath = join(ledgerDir, `.tmp-${++tmpSeq}`);")
def m_alwayswarn():     sub("ledger-store.ts", WARN_ONCE, "")
def m_nolegger():       sub("orchestrate.ts", ORCH, """\t\tif (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else {
\t\t\tthis.store = new TaskStore();
\t\t}""")
def m_preferdir():      sub("orchestrate.ts", ORCH, """\t\tif (deps.ledgerDir) {
\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);
\t\t\tthis.store = new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t} else if (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else {
\t\t\tthis.store = new TaskStore();
\t\t}""")
def m_cwddefault():     sub("orchestrate.ts", ORCH, """\t\tif (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else if (deps.ledgerDir) {
\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);
\t\t\tthis.store = new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t} else {
\t\t\tconst snapshots = new LedgerSnapshotStore(process.cwd());
\t\t\tthis.store = new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t}""")
def m_nopersist_create(): sub("task.ts", CREATE, "\t\tthis.tasks.set(taskId, record);\n\t\treturn record;")
def m_nopersist_touch():  sub("task.ts", TOUCH, "\t\trecord.updatedAt = this.now().toISOString();\n\t\treturn record;")
def m_dup_persist():    sub("task.ts", DUP, """\t\tif (this.tasks.has(taskId)) {
\t\t\tconst existing = this.tasks.get(taskId) as TaskRecord;
\t\t\tthis.persist(existing);
\t\t\treturn existing;
\t\t}""")
def m_persist_noop():  sub("task.ts", PERSIST, "\tpersist(record: TaskRecord): void {\n\t\tvoid record;\n\t}")
def m_persist_throw():  sub("task.ts", PERSIST, "\tpersist(record: TaskRecord): void {\n\t\tthis.onPersist?.(record);\n\t}")
def m_nofiles():        sub("package.json", '    "ledger-store.ts",\n', "")
def m_notest():         sub("package.json", " && node --experimental-strip-types ledger-store.test.mjs", "")
def m_c3():            sub("ledger-store.ts", 'import type { TaskRecord } from "./task.ts";', 'import type { TaskRecord } from "./task.ts";\n// from "./index.ts" @earendil-works')
def m_c4():            sub("ledger-store.ts", 'import type { TaskRecord } from "./task.ts";', 'import type { TaskRecord } from "./task.ts";\nvoid "readFileSync";')
def m_c5():            sub("ledger-store.ts", 'import type { TaskRecord } from "./task.ts";', 'import type { TaskRecord } from "./task.ts";\nvoid "usage.jsonl";')
def m_c6():            sub("index.ts", "\t\tledgerDir: AGENT_DIR,\n", "")
def m_c7():            sub("orchestrate.ts", 'import { LedgerSnapshotStore } from "./ledger-store.ts";\n', "")
def m_c8():            sub("orchestrate.ts", "new LedgerSnapshotStore(deps.ledgerDir)", "new LedgerSnapshotStore(deps.ledgerDir ?? \"\")")
def m_c9():            sub("index.ts", "\t\t\ttask.usage = usage;\n\t\t\torchestrator.store.persist(task);\n", "\t\t\ttask.usage = usage;\n")

LS = "ledger-store.test.mjs"
TS = "task.test.mjs"
AR = "architecture.test.mjs"

CASES = [
    ("A1  snapshot path",              m_path,          LS, 51),
    ("A2  envelope.version is 1",     m_version,       LS, 53),
    ("A3  writtenAt is ISO",           m_written,       LS, 54),
    ("A4  envelope.task.taskId",      m_taskid,        LS, 55),
    ("A5  cumulativeBudget survives", m_budget,        LS, 56),
    ("A6  constructor ignores env",   m_env,           LS, 71),
    ("A7  snapshot under ctor dir",    m_env,           LS, 72),
    ("A8  empty taskId throws",        m_nosafe,       LS, 102),
    ("A9  slash taskId throws",        m_nosafe,       LS, 103),
    ("A10 traversal taskId throws",   m_nosafe,       LS, 104),
    ("A11 ../escape throws",          m_nosafe,       LS, 105),
    ("A12 no files on reject",          m_nosafe,       LS, 101),
    ("A13 first snapshot is JSON",    m_version,      LS, 119),
    ("A14 serialize does not throw",  m_rethrow,      LS, 128),
    ("A15 serialize leaves old bytes", m_corrupt,      LS, 129),
    ("A16 previous still parseable",  m_corrupt,      LS, 130),
    ("A17 lastWriteError on serialize", m_nosave,       LS, 131),
    ("A18 never write the final path", m_final,        LS, 149),
    ("A19 a temp write was attempted", m_writesync,    LS, 150),
    ("A20 temp is in the ledger dir",   m_parenttmp,    LS, 151),
    ("A21 temp name includes pid",      m_nopid,        LS, 152),
    ("A22 final stays complete mid-write", m_final,    LS, 153),
    ("A23 old snapshot complete after fail", m_final,  LS, 154),
    ("A24 no half-written final",       m_final,        LS, 155),
    ("A25 I/O failure does not throw",  m_rethrow,      LS, 176),
    ("A26 second I/O still no throw",   m_rethrow,      LS, 177),
    ("A27 lastWriteError after I/O",   m_nosave,       LS, 178),
    ("A28 lastWriteError is the I/O error", m_genericerr, LS, 179),
    ("A29 warns at most once",         m_alwayswarn,   LS, 180),
    ("A30 orch+ledgerDir persists",     m_nolegger,     LS, 195),
    ("A31 touch persist",              m_nopersist_touch, LS, 198),
    ("A32 injected store is silent",   m_preferdir,    LS, 211),
    ("A33 omit ledgerDir no cwd write", m_cwddefault,   LS, 223),
    ("T1  create invokes onPersist",  m_nopersist_create, TS, 512),
    ("T2  touch invokes onPersist",     m_nopersist_touch, TS, 514),
    ("T3  duplicate create no persist", m_dup_persist,  TS, 516),
    ("T4  persist() is the public sink", m_persist_noop, TS, 518),
    ("T5  sink throw does not fail create", m_persist_throw, TS, 527),
    ("T6  sink throw does not fail touch", m_persist_throw, TS, 528),
    ("C1  files includes ledger-store.ts", m_nofiles,  AR, 111),
    ("C2  test script runs ledger-store", m_notest,    AR, 112),
    ("C3  ledger-store is a pure module", m_c3,        AR, 113),
    ("C4  no snapshot readback",       m_c4,          AR, 114),
    ("C5  no usage.jsonl reuse",       m_c5,          AR, 115),
    ("C6  adapter passes ledgerDir",   m_c6,          AR, 116),
    ("C7  orchestrator imports store", m_c7,          AR, 117),
    ("C8  sink from deps.ledgerDir",   m_c8,          AR, 118),
    ("C9  syncUsage persist after usage", m_c9,      AR, 119),
]

# Fix SAFE snippet from the live file so tabs match.
def _load_safe():
    text = BAK["ledger-store.ts"]
    start = text.index("\t\tif (!SAFE_TASK_ID.test(record.taskId)) {")
    end = text.index("\t\ttry {\n\t\t\tthis.writeAtomic(record);")
    return text[start:end]

# A13: writing to this.dir means snapshotPath() (planner-only/ledger/...) does not exist.
# JSON.parse in the first block throws at line 52, not A13. Use m_version so A13's JSON.parse(first)
# still runs on a valid file under the atomic block. A13 asserts version===1; version 2 fails A2 first.
# Better A13 mutation: write valid JSON whose version is 2 — A2 fires first. Neutralise through A2, then
# A13 is a later file read of the same write. First block A2 is line 53; A13 is 112. Neutralise 53, A13 still
# sees version 2. Other asserts A3-A5 still run... A3 writtenAt still ISO. After A2 neutralised, A3-A12
# pass, then A13 fails. Yes!

def main():
    global SAFE
    SAFE = _load_safe()
    # rewrite m_nosafe closure? it already calls sub(..., SAFE, "") — SAFE is global looked up at call time. OK.

    os.makedirs(LOG, exist_ok=True)
    results = []
    try:
        for name, mutate, test_file, target in CASES:
            restore()
            mutate()
            # reload SAFE-dependent mutations already applied
            neutralised = []
            verdict = "NO FAILURE (VACUOUS)"
            detail = ""
            caught_out = ""
            for _ in range(20):
                line, msg, out = run(test_file)
                if line is None:
                    verdict = "NO FAILURE (VACUOUS)" if not neutralised else f"NO FAILURE after neutralising {neutralised}"
                    caught_out = out
                    break
                if line == target:
                    verdict = "CAUGHT"
                    detail = msg
                    caught_out = out
                    break
                neutralised.append(line)
                neutralise(test_file, line)
            results.append((name, test_file, target, verdict, detail, neutralised, caught_out))
            print(f"[{verdict:9}] {name}  ({test_file}:{target})")
            if detail:
                print(f"            {detail}")
            if neutralised:
                print(f"            (first neutralised: {neutralised})")
            slug = name.split()[0]
            open(os.path.join(LOG, f"p16-r075-fail-{slug}.log"), "w", encoding="utf8").write(caught_out)
            sys.stdout.flush()
    finally:
        restore()

    print("\n==== SUMMARY ====")
    for name, tf, target, verdict, detail, neut, _ in results:
        print(f"{verdict:9} | {tf}:{target} | {name}")
    bad = [r for r in results if r[3] != "CAUGHT"]
    print(f"\n{len(results) - len(bad)}/{len(results)} assertions proven non-vacuous")
    if bad:
        print("VACUOUS:")
        for r in bad:
            print(" -", r[0], r[3])
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main()
