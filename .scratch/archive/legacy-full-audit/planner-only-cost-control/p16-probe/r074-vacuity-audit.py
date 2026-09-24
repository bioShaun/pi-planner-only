#!/usr/bin/env python3
"""Per-assertion vacuity audit for round p16-r074 (planner, not the executor).

For each new assertion: apply a mutation that the assertion is supposed to
catch, then iteratively neutralise whatever assertion fires FIRST until the
failure is attributed to the target line. If the target never fires, it is
vacuous.
"""
import subprocess, shutil, re, sys, os

ROOT = os.getcwd()
SRC = ["orchestrate.ts", "index.ts", "reservations.ts"]
TESTS = ["orchestrate.test.mjs", "index.test.mjs", "architecture.test.mjs"]
BAK = {f: open(f, encoding="utf8").read() for f in SRC + TESTS}

def restore():
    for f, text in BAK.items():
        open(f, "w", encoding="utf8").write(text)

def head_version(path):
    return subprocess.run(["git", "show", f"HEAD:{path}"], capture_output=True, text=True, check=True).stdout

def sub(path, old, new, count=1):
    text = open(path, encoding="utf8").read()
    assert old in text, f"anchor not found in {path}: {old[:70]!r}"
    open(path, "w", encoding="utf8").write(text.replace(old, new, count))

def revert(path):
    open(path, "w", encoding="utf8").write(head_version(path))

def neutralise(path, line_no):
    lines = open(path, encoding="utf8").read().split("\n")
    lines[line_no - 1] = "// NEUTRALISED " + lines[line_no - 1]
    open(path, "w", encoding="utf8").write("\n".join(lines))

FAIL_RE = re.compile(rf"{re.escape(ROOT)}/(\S+\.mjs):(\d+):\d+")

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
        if "AssertionError" in line or "TypeError" in line or "SyntaxError" in line:
            msg = line.strip(); break
    return first, msg

# ---- the status-line block in orchestrate.ts, verbatim -------------------
STATUS_BLOCK = """				const inFlight = this.reservations.inFlight(task.taskId);
				if (inFlight.tokens !== 0 || inFlight.costUsd !== 0) {
					const held = this.reservations.heldCount(task.taskId);
					lines.push(`  在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}（${held} 个子进程未回执）`);
				}
"""
STATUS_NOGUARD = """				const inFlight = this.reservations.inFlight(task.taskId);
				{
					const held = this.reservations.heldCount(task.taskId);
					lines.push(`  在途预留: tokens=${inFlight.tokens}, 费用 $${inFlight.costUsd.toFixed(4)}（${held} 个子进程未回执）`);
				}
"""
ADD_LINE = "			if (!isBudgetStop) this.confirmedNotLaunchedIds.add(event.toolCallId);\n"
ASYNC_RETURN = """				return {
					content: [{
						type: "text",
						text: [
							`[PLANNER-ONLY] Error for the async run"""
HELDCOUNT = """	heldCount(taskId: string): number {
		return this.held.get(taskId)?.size ?? 0;
	}"""

def m_noadd():        sub("orchestrate.ts", ADD_LINE, "")
def m_alwaysadd():    sub("orchestrate.ts", ADD_LINE, "			this.confirmedNotLaunchedIds.add(event.toolCallId);\n")
def m_noline():       sub("orchestrate.ts", STATUS_BLOCK, "")
def m_noguard():      sub("orchestrate.ts", STATUS_BLOCK, STATUS_NOGUARD)
ROOT_TAIL = "\t\t\t\t);\n\t\t\t}\n\t\t\tconst roles = "
def m_moveline():
    sub("orchestrate.ts", STATUS_BLOCK, "")
    sub("orchestrate.ts", ROOT_TAIL, "\t\t\t\t);\n" + STATUS_BLOCK + "\t\t\t}\n\t\t\tconst roles = ")
def m_release():      sub("orchestrate.ts", ASYNC_RETURN, "				this.endDelegation(event.toolCallId);\n" + ASYNC_RETURN)
def m_addearly():     sub("orchestrate.ts", "			if (delegation.runId && !isBudgetStop) {",
                          "			if (delegation.runId && !isBudgetStop) {\n				this.confirmedNotLaunchedIds.add(event.toolCallId);")
def m_heldcount1():   sub("reservations.ts", HELDCOUNT, """	heldCount(taskId: string): number {
		return this.held.get(taskId) ? 1 : 0;
	}""")
def m_revert_index(): revert("index.ts")
def m_revert_orch():  revert("orchestrate.ts")

CASES = [
	("Y1  confirmed-not-launched is remembered",        m_noadd,      "orchestrate.test.mjs",  5419),
	("Y2  budget-stop is NOT a start failure (D3)",     m_alwaysadd,  "orchestrate.test.mjs",  5434),
	("Y3  status prints the in-flight line",            m_noline,     "orchestrate.test.mjs",  5443),
	("Y3b that line sits between 费用 and Root",         m_moveline,   "orchestrate.test.mjs",  5453),
	("Y4  no line when nothing is held",                m_noguard,    "orchestrate.test.mjs",  5459),
	("Y5  unconfirmed async keeps the reservation",     m_release,    "orchestrate.test.mjs",  5477),
	("Y6  unconfirmed async still shows the line",      m_noline,     "orchestrate.test.mjs",  5499),
	("Y7  unconfirmed async is not a start failure",    m_addearly,   "orchestrate.test.mjs",  5519),
	("Y8  heldCount counts, not hardcodes",             m_heldcount1, "orchestrate.test.mjs",  5534),
	("Z1  no phantom debt exhausts the budget",         m_revert_index, "index.test.mjs",      3819),
	("Z2  known tokens stay at the settled child",      m_revert_index, "index.test.mjs",      3856),
	("Z3  known cost stays at the settled child",       m_revert_index, "index.test.mjs",      3893),
	("Z4  a never-launched child is not an unknown",    m_revert_index, "index.test.mjs",      3930),
	("Z5  a budget-stop DOES still charge debt (D3)",   m_alwaysadd,  "index.test.mjs",        3967),
	("A1  the adapter queries the orchestrator",        m_revert_index, "architecture.test.mjs", 107),
	("A2  the classifier lives in the orchestrator",    m_revert_orch,  "architecture.test.mjs", 108),
]

results = []
try:
	for name, mutate, test_file, target in CASES:
		restore()
		mutate()
		neutralised = []
		verdict = "NO FAILURE (VACUOUS)"
		detail = ""
		for _ in range(12):
			line, msg = run(test_file)
			if line is None:
				verdict = "NO FAILURE (VACUOUS)" if not neutralised else f"NO FAILURE after neutralising {neutralised}"
				break
			if line == target:
				verdict = "CAUGHT"
				detail = msg
				break
			neutralised.append(line)
			neutralise(test_file, line)
		results.append((name, test_file, target, verdict, detail, neutralised))
		print(f"[{verdict:9}] {name}  ({test_file}:{target})")
		if detail: print(f"            {detail}")
		if neutralised: print(f"            (first neutralised: {neutralised})")
		sys.stdout.flush()
finally:
	restore()

print("\n==== SUMMARY ====")
for name, tf, target, verdict, detail, neut in results:
	print(f"{verdict:9} | {tf}:{target} | {name}")
bad = [r for r in results if r[3] != "CAUGHT"]
print(f"\n{len(results) - len(bad)}/{len(results)} assertions proven non-vacuous")
sys.exit(1 if bad else 0)
