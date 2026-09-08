#!/usr/bin/env python3
"""Per-assertion vacuity audit for p16-r077 (ticket 16-b).

Each case applies a mutation that should change observable behaviour, runs the
owning test file, and records the first assertion that fires. Neutralise earlier
assertions in the same file until the named target appears or the cap is hit.
"""
import os
import re
import subprocess
import sys

ROOT = os.getcwd()
SRC = [
    "ledger-store.ts",
    "task.ts",
    "orchestrate.ts",
    "index.ts",
    "architecture.test.mjs",
]
TESTS = [
    "ledger-store.test.mjs",
    "task.test.mjs",
    "orchestrate.test.mjs",
    "architecture.test.mjs",
    "index.test.mjs",
]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}


def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)


def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    if old not in text:
        raise AssertionError(f"anchor not found in {path}: {old[:120]!r}")
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))


def neutralize(path, line_no):
    lines = open(path, encoding="utf8").read().split("\n")
    lines[line_no - 1] = "// NEUTRALISED " + lines[line_no - 1]
    open(path, "w", encoding="utf8").write("\n".join(lines))


FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+?\.mjs):(\d+):\d+")


def run(test_file):
    p = subprocess.run(
        ["node", "--experimental-strip-types", test_file],
        capture_output=True,
        text=True,
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
        s = line.strip()
        if s.startswith(("AssertionError", "TypeError", "SyntaxError", "Error:")) or "AssertionError" in s:
            msg = s
            break
    return first, msg, out


# ---- mutations (must change observable behaviour) ----
LS = "ledger-store.ts"
TS = "task.ts"
OR = "orchestrate.ts"
IX = "index.ts"

MISSING = """\t\tif (!fs.existsSync(ledgerDir)) {
\t\t\treturn { records: [], corrupt: [] };
\t\t}"""
TMP_SKIP = '\t\t\tif (name.startsWith(".tmp-")) continue;'
UNSAFE = """\t\t\tif (!SAFE_TASK_ID.test(stem)) {
\t\t\t\tcorrupt.push({ taskId: stem, reason: "filename is not a safe taskId" });
\t\t\t\tcontinue;
\t\t\t}"""
PARSE = """\t\t\t} catch {
\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });
\t\t\t\tcontinue;
\t\t\t}"""
VERSION = """\t\t\tif (env.version !== 1) {
\t\t\t\tcorrupt.push({ taskId: stem, reason: `unsupported version: ${String(env.version)}` });
\t\t\t\tcontinue;
\t\t\t}"""
MISSING_TASK = """\t\t\tif (env.task === undefined || env.task === null || typeof env.task !== "object" || Array.isArray(env.task)) {
\t\t\t\tcorrupt.push({ taskId: stem, reason: "missing task" });
\t\t\t\tcontinue;
\t\t\t}"""
MISMATCH = """\t\t\tif (task.taskId !== stem) {
\t\t\t\tcorrupt.push({ taskId: stem, reason: `task.taskId does not match filename` });
\t\t\t\tcontinue;
\t\t\t}"""
INVALID = """\t\tif (!SAFE_TASK_ID.test(record.taskId)) {
\t\t\tconst err = new Error(`invalid ledger taskId: ${record.taskId}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthrow err;
\t\t}"""
WRITE_OK = """\t\t\tthis.writeAtomic(record);
\t\t\tthis.writeErrors.delete(record.taskId);"""
WRITE_ERR = """\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\tthis.warnIo(err);"""
RESTORE = """\trestore(record: TaskRecord): void {
\t\tif (this.tasks.has(record.taskId)) return;
\t\tthis.tasks.set(record.taskId, record);
\t}"""
UNTRUSTED_GATE = """\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
\t\t\treturn { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId) } };
\t\t}"""
UNTRUSTED_STATUS = """\t\tif (untrustedReason) {
\t\t\tlines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");
\t\t\tlines.push(`  原因: ${untrustedReason}`);
\t\t} else if (task.usage !== undefined) {"""
RESTORE_LEDGER_EMPTY = """\t\tif (!this.snapshots) return { restored: 0, corrupt: [] };"""
SKIP_EXISTING = """\t\t\tif (this.store.get(record.taskId)) continue;
\t\t\tthis.store.restore(record);
\t\t\trestored += 1;"""
CTOR_FULL = """\t\tif (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else if (deps.ledgerDir) {
\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);
\t\t\tthis.snapshots = snapshots;
\t\t\tthis.store = new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t} else {
\t\t\tthis.store = new TaskStore();
\t\t}"""


def m_b15():
    sub(LS, VERSION, """\t\t\tif (env.version !== 1) {
\t\t\t\ttry { fs.unlinkSync(path); } catch {}
\t\t\t\tcorrupt.push({ taskId: stem, reason: `unsupported version: ${String(env.version)}` });
\t\t\t\tcontinue;
\t\t\t}""")


def m_b18():
    sub(LS, WRITE_ERR, """\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\tthis.warnIo(err);
\t\t\tthrow err;""")


def m_l1():
    sub(OR, SKIP_EXISTING, "\t\t\tcontinue;")


def m_l6b():
    sub(OR, "余额无法确认，拒绝新的受控启动。", "余额可能不准，请人工核对。")


def m_l10b():
    sub(OR, 'lines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");',
        'lines.push("Budget: 余额不可信");')


def m_b1():
    sub(LS, MISSING, "\t\tif (!fs.existsSync(ledgerDir)) {\n\t\t\tthrow new Error(\"missing ledger dir\");\n\t\t}")


def m_b2():
    sub(LS, MISSING, "\t\tif (!fs.existsSync(ledgerDir)) {\n\t\t\tconsole.error(\"missing ledger dir\");\n\t\t\treturn { records: [], corrupt: [] };\n\t\t}")


def m_b3():
    sub(LS, '\t\t\tif (!name.endsWith(".json")) continue;', '\t\t\tif (!name.endsWith(".json")) continue;\n\t\t\tcontinue;')


def m_b5():
    sub(LS, TMP_SKIP, "")


def m_b6():
    sub(LS, TMP_SKIP, '\t\t\tif (name.startsWith(".tmp-")) { try { fs.unlinkSync(join(ledgerDir, name)); } catch {} continue; }')


def m_b9():
    sub(LS, UNSAFE, "")


def m_b10():
    sub(LS, PARSE, "\t\t\t} catch {\n\t\t\t\tcontinue;\n\t\t\t}")


def m_b11():
    sub(LS, VERSION, "")


def m_b12():
    sub(LS, MISSING_TASK, "")


def m_b13():
    sub(LS, MISMATCH, "")


def m_b14():
    sub(LS, PARSE, '\t\t\t} catch {\n\t\t\t\ttry { fs.unlinkSync(path); } catch {}\n\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });\n\t\t\t\tcontinue;\n\t\t\t}')


def m_b17():
    sub(LS, INVALID, """\t\tif (!SAFE_TASK_ID.test(record.taskId)) {
\t\t\tconst err = new Error(`invalid ledger taskId: ${record.taskId}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warnIo(err);
\t\t\tthrow err;
\t\t}""")


def m_b19():
    sub(LS, INVALID, """\t\tif (!SAFE_TASK_ID.test(record.taskId)) {
\t\t\tconst err = new Error(`invalid ledger taskId: ${record.taskId}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.warnedIo = true;
\t\t\tthrow err;
\t\t}""")


def m_b20():
    sub(LS, WRITE_ERR, "\t\t\tthis._lastWriteError = err;\n\t\t\tthis.warnIo(err);")


def m_b21():
    sub(LS, WRITE_ERR, """\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\tthis.writeErrors.set("T-20260908-other", err);
\t\t\tthis.warnIo(err);""")


def m_b22():
    sub(LS, WRITE_OK, "\t\t\tthis.writeAtomic(record);")


def m_b23():
    sub(LS, WRITE_OK, "\t\t\tthis.writeAtomic(record);\n\t\t\tthis.writeErrors.delete(record.taskId);\n\t\t\tthis._lastWriteError = undefined;")


def m_b24():
    sub(LS, WRITE_ERR, """\t\t\tthis._lastWriteError = new Error("persist failed");
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\tthis.warnIo(err);""")


def m_r1():
    sub(TS, RESTORE, "")


def m_r2():
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tthis.tasks.set(record.taskId, { ...record, state: "planning" });
\t}""")


def m_r3():
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tif (this.tasks.has(record.taskId)) return;
\t\trecord.updatedAt = this.now().toISOString();
\t\tthis.tasks.set(record.taskId, record);
\t}""")


def m_r4():
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tif (this.tasks.has(record.taskId)) return;
\t\tthis.tasks.set(record.taskId, record);
\t\tthis.persist(record);
\t}""")


def m_r5():
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tthis.tasks.set(record.taskId, record);
\t}""")


def m_r6():
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tif (this.tasks.has(record.taskId)) {
\t\t\tthis.persist(record);
\t\t\treturn;
\t\t}
\t\tthis.tasks.set(record.taskId, record);
\t}""")


def m_l2():
    sub(OR, CTOR_FULL, """\t\tif (deps.ledgerDir) {
\t\t\tconst snapshots = new LedgerSnapshotStore(deps.ledgerDir);
\t\t\tthis.snapshots = snapshots;
\t\t\tthis.store = deps.store ?? new TaskStore({
\t\t\t\tonPersist: (record) => snapshots.write(record),
\t\t\t});
\t\t} else if (deps.store) {
\t\t\tthis.store = deps.store;
\t\t} else {
\t\t\tthis.store = new TaskStore();
\t\t}""")


def m_l3():
    sub(OR, RESTORE_LEDGER_EMPTY, "\t\tif (!this.snapshots) return { restored: 1, corrupt: [] };")


def m_l4():
    sub(OR, SKIP_EXISTING, """\t\t\tif (this.store.get(record.taskId)) continue;
\t\t\tthis.store.restore(record);
\t\t\tthis.reservations.reserve(record.taskId, {
\t\t\t\ttokens: { known: 0, unknownParts: 0, debt: 0, remaining: 1, limit: 1 },
\t\t\t\tcostUsd: { known: 0, unknownParts: 0, debt: 0, remaining: 1, limit: 1 },
\t\t\t}, { toolCallId: "restored", tokens: 1, costUsd: 0.01 });
\t\t\trestored += 1;""")


def m_l12():
    sub(OR, SKIP_EXISTING, """\t\t\tif (this.store.get(record.taskId)) continue;
\t\t\tthis.store.restore(record);
\t\t\trecord.reviewRound = 99;
\t\t\tthis.store.persist(record);
\t\t\trestored += 1;""")


def m_l13():
    sub(OR, SKIP_EXISTING, """\t\t\tthis.store.restore(record);
\t\t\trestored += 1;""")
    sub(TS, RESTORE, """\trestore(record: TaskRecord): void {
\t\tthis.tasks.set(record.taskId, record);
\t}""")


def m_l5b():
    sub(OR, "\t\t\tthis.store.restore(record);", """\t\t\tconst copy = { ...record, usage: { ...record.usage, children: [] } };
\t\t\tthis.store.restore(copy);""")


def m_l6():
    sub(OR, UNTRUSTED_GATE, "")


def m_l7():
    sub(OR, UNTRUSTED_GATE, """\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
\t\t\treturn { block: { reason: this.cumulativeBudgetRefusal(untrustedTaskId, {
\t\t\t\ttokens: { known: 0, unknownParts: 0, debt: 0 },
\t\t\t\tcostUsd: { known: 0, unknownParts: 0, debt: 0 },
\t\t\t}, { dimension: "costUsd" }) } };
\t\t}""")


def m_l8():
    sub(OR, UNTRUSTED_GATE, """\t\tif (untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
\t\t\treturn { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId) } };
\t\t}""")


def m_l9():
    sub(OR, UNTRUSTED_GATE, """\t\tif (role !== "reviewer" && this.untrustedBalances.size > 0) {
\t\t\treturn { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId ?? "any") } };
\t\t}""")


def m_l10():
    sub(OR, UNTRUSTED_STATUS, "\t\tif (false && untrustedReason) {\n\t\t\tlines.push(\"Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）\");\n\t\t\tlines.push(`  原因: ${untrustedReason}`);\n\t\t} else if (task.usage !== undefined) {")


def m_l11():
    sub(OR, UNTRUSTED_STATUS, """\t\tif (untrustedReason) {
\t\t\tlines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");
\t\t\tlines.push(`  原因: ${untrustedReason}`);
\t\t\tlines.push("  费用: 已用 $0.0000 / 上限 $0.0500，剩余 $0.0100，未知项 0 项");
\t\t} else if (task.usage !== undefined) {""")


def m_b4():
    sub(LS, "\t\t\trecords.push(task);", "\t\t\trecords.push({ ...task, taskId: \"MUTATED\" });")


def m_b7():
    sub(LS, '\t\t\tif (!name.endsWith(".json")) continue;', '\t\t\tif (!name.endsWith(".json")) { try { fs.unlinkSync(join(ledgerDir, name)); } catch {} continue; }')


def m_b8():
    sub(LS, "\t\t\trecords.push(task);", "\t\t\tif (task.taskId !== \"T-20260908-keep\") records.push(task);")


def m_b16():
    sub(LS, INVALID, "")


def m_c16_1():
    sub(TS, "restore(record: TaskRecord): void", "installSnapshot(record: TaskRecord): void")


def m_c16_2():
    sub(OR, "restoreFromLedger()", "reloadLedger()")


def m_c4():
    sub(LS, "raw = fs.readFileSync(path, \"utf8\");", "raw = String(fs.readFile(path, \"utf8\"));")


def m_i1():
    sub(IX, "\t\torchestrator.restoreFromLedger();\n", "")


def m_c16_3():
    sub(IX, "\t\torchestrator.restoreFromLedger();\n", "")


def m_c16_4():
    sub(OR, "untrustedBalances", "untrustedX", count=99)


def m_c16_5():
    sub(OR, "ledger snapshot unreadable", "ledger snapshot broken", count=99)


CASES = [
    ("B1 missing dir empty", m_b1, "ledger-store.test.mjs", "B1:"),
    ("B2 missing dir no warn", m_b2, "ledger-store.test.mjs", "B2:"),
    ("B3 valid snapshot in records", m_b3, "ledger-store.test.mjs", "B3:"),
    ("B4 restored record keeps taskId", m_b4, "ledger-store.test.mjs", "B4:"),
    ("B5 tmp leftovers not corrupt", m_b5, "ledger-store.test.mjs", "B5:"),
    ("B6 readAll does not delete tmp", m_b6, "ledger-store.test.mjs", "B6:"),
    ("B7 readAll does not delete non-json", m_b7, "ledger-store.test.mjs", "B7:"),
    ("B8 neighbouring valid snapshot still restores", m_b8, "ledger-store.test.mjs", "B8:"),
    ("B9 unsafe stem is corrupt", m_b9, "ledger-store.test.mjs", "B9:"),
    ("B10 unparseable JSON is corrupt", m_b10, "ledger-store.test.mjs", "B10:"),
    ("B11 version !== 1 is corrupt", m_b11, "ledger-store.test.mjs", "B11:"),
    ("B12 missing task is corrupt", m_b12, "ledger-store.test.mjs", "B12:"),
    ("B13 taskId mismatch is corrupt", m_b13, "ledger-store.test.mjs", "B13:"),
    ("B14 readAll does not delete corrupt", m_b14, "ledger-store.test.mjs", "B14:"),
    ("B15 readAll does not delete unsupported-version file", m_b15, "ledger-store.test.mjs", "B15:"),
    ("B16 empty taskId still throws", m_b16, "ledger-store.test.mjs", "B16:"),
    ("B17 invalid id does not consume I/O warn", m_b17, "ledger-store.test.mjs", "B17:"),
    ("B18 I/O failure after invalid still does not throw", m_b18, "ledger-store.test.mjs", "B18:"),
    ("B19 I/O after invalid still warns", m_b19, "ledger-store.test.mjs", "B19:"),
    ("B20 writeErrorFor records the failed id", m_b20, "ledger-store.test.mjs", "B20:"),
    ("B21 write failure is per-taskId", m_b21, "ledger-store.test.mjs", "B21:"),
    ("B22 success clears that taskId mark", m_b22, "ledger-store.test.mjs", "B22:"),
    ("B23 lastWriteError stays diagnostic", m_b23, "ledger-store.test.mjs", "B23:"),
    ("B24 lastWriteError still carries the I/O error", m_b24, "ledger-store.test.mjs", "B24:"),
    ("R1 restore is a real method", m_r1, "task.test.mjs", "R1:"),
    ("R2 restore installs the snapshot", m_r2, "task.test.mjs", "R2:"),
    ("R3 restore does not rewrite updatedAt", m_r3, "task.test.mjs", "R3:"),
    ("R4 restore does not call onPersist", m_r4, "task.test.mjs", "R4:"),
    ("R5 restore does not overwrite live id", m_r5, "task.test.mjs", "R5:"),
    ("R6 skipped restore still does not persist", m_r6, "task.test.mjs", "R6:"),
    ("L2 injected store does not read disk", m_l2, "orchestrate.test.mjs", "L2:"),
    ("L1 restoreFromLedger installs the snapshot", m_l1, "orchestrate.test.mjs", "L1:"),
    ("L3 no ledgerDir is a no-op", m_l3, "orchestrate.test.mjs", "L3:"),
    ("L4 reservations are not rehydrated", m_l4, "orchestrate.test.mjs", "L4:"),
    ("L4 reservations are not rehydrated", m_l4, "orchestrate.test.mjs", "L4:"),
    ("L5b restored remaining clamps costUsd.hard", m_l5b, "orchestrate.test.mjs", "L5b:"),
    ("L12 restore does not rewrite snapshot bytes", m_l12, "orchestrate.test.mjs", "L12:"),
    ("L13 live memory wins over disk", m_l13, "orchestrate.test.mjs", "L13b:"),
    ("L6 corrupt Task paid launch refused", m_l6, "orchestrate.test.mjs", "L6:"),
    ("L6b refusal says 余额无法确认", m_l6b, "orchestrate.test.mjs", "L6b:"),
    ("L7 untrusted is not exhausted-budget", m_l7, "orchestrate.test.mjs", "L7:"),
    ("L8 reviewer still allowed (reverse: drop exemption)", m_l8, "orchestrate.test.mjs", "L8:"),
    ("L8 reviewer still allowed (reverse: drop exemption)", m_l8, "orchestrate.test.mjs", "L8:"),
    ("L9 neighbour intact Task not frozen (reverse: global freeze)", m_l9, "orchestrate.test.mjs", "L9:"),
    ("L10 status says 余额不可信", m_l10, "orchestrate.test.mjs", "L10:"),
    ("L10b status names the unreadable snapshot", m_l10b, "orchestrate.test.mjs", "L10b:"),
    ("L11 untrusted status has no remaining $", m_l11, "orchestrate.test.mjs", "L11:"),
    ("C4 readAll uses readFileSync", m_c4, "architecture.test.mjs", "C4:"),
    ("C4 readAll uses readFileSync", m_c4, "architecture.test.mjs", "C4:"),
    ("C16-1 TaskStore.restore is a real method", m_c16_1, "architecture.test.mjs", "C16-1:"),
    ("C16-2 orchestrator restoreFromLedger", m_c16_2, "architecture.test.mjs", "C16-2:"),
    ("C16-3 session_start restores after loadSessionUsage", m_c16_3, "architecture.test.mjs", "C16-3:"),
    ("C16-4 untrustedBalances exists", m_c16_4, "architecture.test.mjs", "C16-4:"),
    ("C16-5 untrusted message is distinct", m_c16_5, "architecture.test.mjs", "C16-5:"),
    ("I1 session_start restore shows spent cost", m_i1, "index.test.mjs", "I1:"),
    ("I2 session_start restore shows remaining 0.01", m_i1, "index.test.mjs", "I2:"),
]


def token_in_output(out, token):
    return token in out


def main():
    results = []
    for name, mut, test_file, token in CASES:
        restore()
        try:
            mut()
        except Exception as e:
            results.append((name, "MUTATION_FAILED", str(e), ""))
            restore()
            continue
        target_hit = False
        first_msg = ""
        first_line = None
        verbatim = ""
        for _ in range(12):
            line, msg, out = run(test_file)
            if line is None:
                break
            first_msg = first_msg or msg
            first_line = first_line or line
            verbatim = verbatim or out
            if token_in_output(out, token):
                target_hit = True
                verbatim = out
                break
            if line is None:
                break
            neutralize(test_file, line)
        status = "CAUGHT" if target_hit else ("VACUOUS" if first_line is None else "WRONG_ASSERTION")
        results.append((name, status, f"line={first_line} {first_msg}", verbatim))
        restore()

    restore()
    caught = sum(1 for r in results if r[1] == "CAUGHT")
    print(f"caught {caught}/{len(results)}")
    for name, status, meta, out in results:
        print("=" * 78)
        print(f"{status}  {name}")
        print(f"  {meta}")
        lines = out.splitlines()
        keep = []
        for i, ln in enumerate(lines):
            if "AssertionError" in ln or "Error:" in ln or ".mjs:" in ln:
                keep.extend(lines[max(0, i - 2): i + 6])
        # unique preserve order
        seen = set()
        uniq = []
        for ln in keep:
            if ln in seen:
                continue
            seen.add(ln)
            uniq.append(ln)
        print("\n".join(uniq[:40] if status == "CAUGHT" else lines[-50:]))


if __name__ == "__main__":
    try:
        main()
    finally:
        restore()
