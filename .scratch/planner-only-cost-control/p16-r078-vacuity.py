#!/usr/bin/env python3
"""Per-assertion vacuity audit for p16-r078 (16-b quarantine patch).

Each new assertion gets its own production-code mutation. Earlier asserts in
the same file are disarmed with a proxy that still evaluates arguments
(including assert.throws callbacks), so side effects stay and line numbers
do not shift.
"""
import os
import re
import subprocess

ROOT = os.getcwd()
SRC = ["ledger-store.ts", "orchestrate.ts"]
TESTS = ["ledger-store.test.mjs", "orchestrate.test.mjs", "architecture.test.mjs"]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}

LS = "ledger-store.ts"
OR = "orchestrate.ts"
LT = "ledger-store.test.mjs"
OT = "orchestrate.test.mjs"
AT = "architecture.test.mjs"


def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)


def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    if old not in text:
        raise AssertionError(f"anchor not found in {path}: {old[:160]!r}")
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))


def neutralise(path, line_no):
    text = open(path, encoding="utf8").read()
    shim = (
        "const __NEUT = new Proxy({}, { get: () => (...args) => { "
        "for (const a of args) if (typeof a === \"function\") { try { a(); } catch {} } } });\n"
    )
    lines = text.split("\n")
    if "__NEUT" not in text:
        lines[0] = shim.rstrip("\n") + " " + lines[0]
    start = line_no - 1
    while start > 0 and not lines[start].lstrip().startswith("assert"):
        start -= 1
    if not lines[start].lstrip().startswith("assert"):
        return False
    stripped = lines[start].lstrip()
    indent = lines[start][: len(lines[start]) - len(stripped)]
    lines[start] = indent + "__NEUT" + stripped[len("assert") :]
    open(path, "w", encoding="utf8").write("\n".join(lines))
    return True


FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+?\.mjs):(\d+):\d+")
ERR_HEAD = re.compile(r"^(AssertionError|TypeError|SyntaxError|ReferenceError|RangeError|Error:)")


def attribute(out, test_file):
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
    for m in FAIL_RE.finditer(out):
        if m.group(1) == test_file:
            return int(m.group(2))
    return None


def run(test_file):
    p = subprocess.run(
        ["node", "--experimental-strip-types", test_file],
        capture_output=True,
        text=True,
    )
    out = p.stdout + p.stderr
    if p.returncode == 0:
        return "ZERO", None, "", out
    first = attribute(out, test_file)
    msg = ""
    for line in out.split("\n"):
        s = line.strip()
        if "AssertionError" in s or s.startswith(("TypeError", "SyntaxError", "ReferenceError", "Error:")):
            msg = s[:240]
            break
    return ("FAIL" if first is not None else "UNATTRIB"), first, msg, out


IS_Q = """\tisQuarantined(taskId: string): boolean {
\t\treturn this.quarantined.has(taskId);
\t}"""

QUAR = """\tquarantine(taskId: string, reason: string): void {
\t\tthis.quarantined.set(taskId, reason);
\t}"""

WRITE_Q = """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tconst err = new Error(`quarantined: ${reason}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\treturn;
\t\t}"""

PARSE = """\t\t\t} catch {
\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });
\t\t\t\tcontinue;
\t\t\t}"""

RENAME = "\t\t\tfs.renameSync(tmpPath, finalPath);"

ORCH_Q = "\t\t\tthis.snapshots.quarantine(item.taskId, item.reason);"
UNTRUSTED_SET = "\t\t\tthis.untrustedBalances.set(item.taskId, item.reason);"
GATE = """\t\tif (role !== "reviewer" && untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
\t\t\tif (input && typeof input === "object" && !Array.isArray(input)) {
\t\t\t\tdelete (input as Record<string, unknown>).usageBudget;
\t\t\t\tdelete (input as Record<string, unknown>).__floorLimits;
\t\t\t}
\t\t\treturn { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId) } };
\t\t}"""
STATUS = """\t\tif (untrustedReason) {
\t\t\tlines.push("Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）");
\t\t\tlines.push(`  原因: ${untrustedReason}`);
\t\t} else if (task.usage !== undefined) {"""


def m_q1():
    sub(
        LS,
        IS_Q,
        """\tisQuarantined(taskId: string): boolean {
\t\treturn taskId === "T-20260908-q1" || this.quarantined.has(taskId);
\t}""",
    )


def m_q2():
    sub(LS, QUAR, "\tquarantine(taskId: string, reason: string): void {\n\t}")


def m_q3():
    sub(LS, IS_Q, "\tisQuarantined(taskId: string): boolean {\n\t\treturn this.quarantined.size > 0;\n\t}")


def m_q4():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tthrow new Error(`quarantined: ${reason}`);
\t\t}""",
    )


def m_q5():
    sub(LS, WRITE_Q, "")


def m_q6():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tconst ledgerDir = join(this.dir, "planner-only", "ledger");
\t\t\tfs.mkdirSync(ledgerDir, { recursive: true });
\t\t\tfs.writeFileSync(join(ledgerDir, `.tmp-${process.pid}-q`), "partial");
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tconst err = new Error(`quarantined: ${reason}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\treturn;
\t\t}""",
    )


def m_q6b():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tfs.writeFileSync(join(this.dir, "outside.txt"), "x");
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tconst err = new Error(`quarantined: ${reason}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\treturn;
\t\t}""",
    )


def m_q7():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tconst err = new Error(`quarantined: ${reason}`);
\t\t\tthis._lastWriteError = err;
\t\t\treturn;
\t\t}""",
    )


def m_q8():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.isQuarantined(record.taskId)) {
\t\t\tconst err = new Error("EACCES: permission denied");
\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\treturn;
\t\t}""",
    )


def m_q9():
    sub(
        LS,
        WRITE_Q,
        """\t\tif (this.quarantined.size > 0) {
\t\t\tconst reason = this.quarantined.get(record.taskId) ?? "unreadable snapshot";
\t\t\tconst err = new Error(`quarantined: ${reason}`);
\t\t\tthis._lastWriteError = err;
\t\t\tthis.writeErrors.set(record.taskId, err);
\t\t\treturn;
\t\t}""",
    )


def m_q10():
    sub(
        LS,
        RENAME,
        """\t\t\tfs.renameSync(tmpPath, finalPath);
\t\t\tfor (const name of fs.readdirSync(ledgerDir)) {
\t\t\t\tif (name.endsWith(".json") && name !== `${record.taskId}.json`) {
\t\t\t\t\tfs.writeFileSync(join(ledgerDir, name), body, "utf8");
\t\t\t\t}
\t\t\t}""",
    )


def m_q11():
    sub(
        LS,
        QUAR,
        """\tquarantine(taskId: string, reason: string): void {
\t\tthis.quarantined.set(taskId, reason);
\t\tconst fd = fs.openSync(join(this.dir, ".quarantine"), "w");
\t\tfs.writeSync(fd, JSON.stringify({ taskId, reason }));
\t\tfs.closeSync(fd);
\t}""",
    )
    sub(
        LS,
        IS_Q,
        """\tisQuarantined(taskId: string): boolean {
\t\tif (this.quarantined.has(taskId)) return true;
\t\ttry {
\t\t\tconst saved = JSON.parse(fs.readFileSync(join(this.dir, ".quarantine"), "utf8"));
\t\t\treturn saved.taskId === taskId;
\t\t} catch {
\t\t\treturn false;
\t\t}
\t}""",
    )


def m_q12():
    sub(LS, '\t\t\tif (name.startsWith(".tmp-")) continue;',
        '\t\t\tif (name.startsWith(".tmp-")) continue;\n\t\t\tif (this.quarantined.has(name.slice(0, -".json".length))) continue;')


def m_q13():
    sub(
        LS,
        PARSE,
        """\t\t\t} catch {
\t\t\t\tfs.writeFileSync(path, JSON.stringify({ version: 1, writtenAt: "2026-09-08T00:00:00.000Z", task: { taskId: stem } }));
\t\t\t\tcorrupt.push({ taskId: stem, reason: "unparseable JSON" });
\t\t\t\tcontinue;
\t\t\t}""",
    )


def m_l14():
    sub(OR, "\t\treturn { restored, corrupt };", "\t\treturn { restored, corrupt: [] };")


def m_l14b():
    sub(OR, UNTRUSTED_SET, "")


def m_l15():
    sub(OR, ORCH_Q, "")


def m_l16():
    sub(
        OR,
        GATE,
        """\t\tif (untrustedTaskId && this.untrustedBalances.has(untrustedTaskId)) {
\t\t\tif (input && typeof input === "object" && !Array.isArray(input)) {
\t\t\t\tdelete (input as Record<string, unknown>).usageBudget;
\t\t\t\tdelete (input as Record<string, unknown>).__floorLimits;
\t\t\t}
\t\t\treturn { block: { reason: this.untrustedLedgerRefusal(untrustedTaskId) } };
\t\t}""",
    )


def m_l17():
    sub(OR, ORCH_Q, "")


def m_l18():
    sub(OR, GATE, "")


def m_l18b():
    sub(OR, GATE, "")


def m_l19():
    sub(OR, ORCH_Q, "")


def m_l20():
    sub(OR, STATUS, "\t\tif (false && untrustedReason) {\n\t\t\tlines.push(\"Budget: 余额不可信（账本快照无法读取，拒绝把剩余当作可信数字）\");\n\t\t\tlines.push(`  原因: ${untrustedReason}`);\n\t\t} else if (task.usage !== undefined) {")


def m_l21():
    sub(OR, GATE, "")


def m_l22():
    sub(OR, GATE, "")


def m_l23():
    sub(OR, GATE, "")


def m_l24():
    sub(OR, ORCH_Q, "")


def m_c16_6():
    sub(LS, "quarantine(taskId: string, reason: string)", "isolate(taskId: string, reason: string)")


def m_c16_7():
    sub(LS, "isQuarantined(taskId: string)", "isIsolated(taskId: string)")


def m_c16_8():
    sub(OR, ORCH_Q, "")


def m_c16_9():
    sub(LS, "if (this.isQuarantined(record.taskId))", "if (this.quarantined.has(record.taskId))")


CASES = [
    ("Q1", LT, 337, m_q1, "isQuarantined reports T-20260908-q1 before quarantine is registered"),
    ("Q2", LT, 349, m_q2, "quarantine is a no-op"),
    ("Q3", LT, 351, m_q3, "any quarantine freezes every taskId"),
    ("Q4", LT, 353, m_q4, "quarantined write throws (reverse of no-throw)"),
    ("Q5", LT, 355, m_q5, "quarantine write-side gate removed (reverse: does write)"),
    ("Q6", LT, 357, m_q6, "quarantined write leaves a .tmp leftover"),
    ("Q6b", LT, 358, m_q6b, "quarantined write still calls writeFileSync outside the ledger dir"),
    ("Q7", LT, 360, m_q7, "quarantined write does not record writeErrors"),
    ("Q8", LT, 361, m_q8, "write-health reason is a disk EACCES, not quarantine"),
    ("Q9", LT, 365, m_q9, "any quarantine blocks every subsequent write"),
    ("Q10", LT, 366, m_q10, "a neighbour write also overwrites other json snapshots"),
    ("Q11", LT, 369, m_q11, "quarantine is persisted to a sidecar file (reverse of memory-only)"),
    ("Q12", LT, 371, m_q12, "readAll skips quarantined stems"),
    ("Q13", LT, 372, m_q13, "readAll rewrites unparseable JSON into a valid envelope"),
    ("L14", OT, 5851, m_l14, "restoreFromLedger drops the corrupt list"),
    ("L14b", OT, 5854, m_l14b, "corrupt restore does not mark untrustedBalances"),
    ("L15", OT, 5857, m_l15, "restoreFromLedger does not quarantine (reverse: persist launders)"),
    ("L16", OT, 5861, m_l16, "reviewer exemption removed (reverse mutation)"),
    ("L17", OT, 5863, m_l17, "restoreFromLedger does not quarantine (reverse: reviewer persist rewrites)"),
    ("L18", OT, 5868, m_l18, "untrusted gate disabled"),
    ("L18b", OT, 5869, m_l18b, "untrusted gate disabled so usageBudget is handed down"),
    ("L18c", OT, 5870, m_l18b, "untrusted gate disabled so costUsd.hard 0.5 stays on the input"),
    ("L19", OT, 5874, m_l19, "restoreFromLedger does not quarantine (reverse: later session sees JSON)"),
    ("L20", OT, 5876, m_l20, "untrusted status branch disabled"),
    ("L21", OT, 5880, m_l21, "untrusted gate disabled (later session)"),
    ("L22", OT, 5881, m_l22, "untrusted gate disabled so later session hands usageBudget"),
    ("L23", OT, 5882, m_l23, "untrusted gate disabled so later session grants 0.5"),
    ("L24", OT, 5883, m_l24, "restoreFromLedger does not quarantine (reverse: bytes self-heal)"),
    ("C16-6", AT, 125, m_c16_6, "quarantine renamed to isolate"),
    ("C16-7", AT, 126, m_c16_7, "isQuarantined renamed to isIsolated"),
    ("C16-8", AT, 127, m_c16_8, "restoreFromLedger no longer calls snapshots.quarantine"),
    ("C16-9", AT, 128, m_c16_9, "write checks the map directly instead of isQuarantined()"),
]


def snippet(out):
    lines = out.splitlines()
    keep = []
    for i, ln in enumerate(lines):
        if "AssertionError" in ln or ln.strip().startswith(("TypeError", "SyntaxError", "Error:")) or ".mjs:" in ln:
            keep.extend(lines[max(0, i - 1) : i + 8])
    seen = set()
    uniq = []
    for ln in keep:
        if ln in seen:
            continue
        seen.add(ln)
        uniq.append(ln)
    return "\n".join(uniq[:30])


def main():
    results = []
    only = [n for n in os.environ.get("ONLY", "").split(",") if n]
    try:
        for name, test_file, line_no, mutate, why in CASES:
            if only and name not in only:
                continue
            restore()
            try:
                mutate()
            except Exception as e:
                print(f"{name:6s} {test_file:22s} line {line_no:5d} MUTATION_FAILED {e}", flush=True)
                results.append((name, "MUTATION_FAILED"))
                restore()
                continue
            neutralised = []
            verdict = "?"
            caught_out = ""
            for _ in range(30):
                kind, first, msg, out = run(test_file)
                if kind == "ZERO":
                    verdict = "VACUOUS"
                    caught_out = out[-2000:]
                    break
                if kind == "UNATTRIB":
                    verdict = f"UNATTRIB {msg}"
                    caught_out = snippet(out) or out[-2000:]
                    break
                if first == line_no:
                    verdict = f"CAUGHT {msg}"
                    caught_out = snippet(out)
                    break
                neutralised.append(first)
                if not neutralise(test_file, first):
                    verdict = f"UNDISARMABLE line {first}: {msg}"
                    caught_out = snippet(out)
                    break
            else:
                verdict = "GAVE-UP"
            print(
                f"{name:6s} {test_file:22s} line {line_no:5d} neutralised={neutralised}\n"
                f"       mutation: {why}\n"
                f"       {verdict}",
                flush=True,
            )
            if caught_out:
                print(caught_out, flush=True)
            print("-" * 72, flush=True)
            results.append((name, verdict))
            restore()
    finally:
        restore()

    caught = sum(1 for _, v in results if v.startswith("CAUGHT"))
    print(f"\n=== {caught}/{len(results)} CAUGHT ===")
    for name, verdict in results:
        flag = "OK" if verdict.startswith("CAUGHT") else "FAIL"
        print(f"{flag:4s} {name:6s} {verdict}")


if __name__ == "__main__":
    main()
