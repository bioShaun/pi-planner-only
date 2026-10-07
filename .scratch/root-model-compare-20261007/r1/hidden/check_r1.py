#!/usr/bin/env python3
"""Hidden acceptance for R1 (explorer/reviewer parallel, scout write tools). stdlib only.

usage: check_r1.py <repo> <baseline-commit> --out <json>
Compares the working tree of <repo> with <baseline-commit> in that repo. No LLM / pi session is used.
"""
import argparse, json, os, re, shutil, signal, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
TMP_ROOT = "/project/tmp/root-model-compare/r1/check-tmp"
SUBAGENTS_DEFAULT = os.path.expanduser("~/.pi/agent/npm/node_modules/pi-subagents")
TEST_FILES = ["contract.test.mjs", "delegate.test.mjs", "index.test.mjs", "git.test.mjs", "host.test.mjs", "handoff.test.mjs"]

OLD_RULES = {
    "index.ts": ["worker, explorer, and validator run one at a time per repository (a second one is refused)"],
    "README.md": ["a second such child in", "| `explorer` | `scout` | yes |"],
    "README.zh-CN.md": ["同一目录里第二个这样的子代理会被拒绝", "| `explorer` | `scout` | 是 |"],
    "CONTEXT.md": ["A child with bash or write holds its cwd until it ends; an unconfirmed stop keeps the hold until the late terminal."],
}
# Removed baseline assert lines tied to the rule being changed (old wording / old lock bookkeeping) may go;
# every other removed assert line must still be present verbatim.
RULE_LINE = re.compile(r"one at a time|a second one is refused|exclusive|tryAcquire|isHeld|\.held\(|locks\.size|canChange|holds the cwd")
CAP_LINE_STRICT = re.compile(r"length[^\n]*?(<=?)[^\n]*?\d|\d[^\n]*?(<=?)[^\n]*?length")
CAP_CONST = re.compile(r"^\s*(?:export\s+)?const\s+(\w*(?:MAX|CAP|LIMIT|TARGET)\w*)\s*(?::[^=]+)?=\s*([\d_]+)\s*;?", re.M)

checks = []
manual = []


def add(i, status, detail):
    checks.append({"id": i, "status": status, "detail": detail})
    if status == "manual":
        manual.append(i)


def run(cmd, cwd, env=None, timeout=300, shell=False):
    """Run in its own process group; on timeout kill the whole group so no grandchild (npm/sleep) survives."""
    e = dict(os.environ, **(env or {}))
    p = subprocess.Popen(cmd, cwd=cwd, env=e, shell=shell, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, errors="replace", start_new_session=True)
    try:
        o, _ = p.communicate(timeout=timeout)
        return p.returncode, o or ""
    except subprocess.TimeoutExpired:
        try:
            os.killpg(p.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            o, _ = p.communicate(timeout=10)
        except Exception:
            o = ""
        return 124, f"TIMEOUT {timeout}s\n{o or ''}"


def git_show(repo, rev, path):
    r = subprocess.run(["git", "-C", repo, "show", f"{rev}:{path}"], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else None


def read(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None


def tail(s, n=1200):
    return s[-n:]


def first_err(out):
    m = re.search(r"(AssertionError[^\n]*(?:\n(?!\s+at ).*){0,12})", out)
    if m:
        return m.group(1)[:900]
    m = re.search(r"(error TS[^\n]*)", out)
    return m.group(1) if m else tail(out, 900)


def cap_numbers(text):
    res = []
    for line in text.splitlines():
        if CAP_LINE_STRICT.search(line):
            for n in re.findall(r"(?<![\w.])\d[\d_]*(?![\w.])", line):
                v = int(n.replace("_", ""))
                if v >= 50:
                    res.append(("line", v, line.strip()))
    for m in CAP_CONST.finditer(text):
        res.append((m.group(1), int(m.group(2).replace("_", "")), m.group(0).strip()))
    return res


def assert_lines(text):
    return [l.strip() for l in text.splitlines() if re.match(r"\s*(?:if\b.*\)\s*)?assert\b", l) or re.search(r"\bassert\.\w+\(", l)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo")
    ap.add_argument("baseline")
    ap.add_argument("--out", required=True)
    ap.add_argument("--subagents-dir", default=os.environ.get("PI_SUBAGENTS_DIR", SUBAGENTS_DEFAULT))
    ap.add_argument("--skip-tests", action="store_true", help="skip npm run test:release (debug only)")
    a = ap.parse_args()
    repo = os.path.abspath(a.repo)
    os.makedirs(TMP_ROOT, exist_ok=True)
    tmp = tempfile.mkdtemp(prefix="run-", dir=TMP_ROOT)
    env = {"TMPDIR": tmp}

    # 1. own tests
    if a.skip_tests:
        add("own_tests", "fail", "skipped by --skip-tests")
    else:
        code, o = run("npm run test:release", repo, env, int(os.environ.get("R1_CHECK_TEST_TIMEOUT", "300")), shell=True)  # env var: debug only
        add("own_tests", "pass" if code == 0 else "fail", f"exit={code}" if code == 0 else f"exit={code}\n{first_err(o)}")

    # 2-9. behavior through public entry points
    ids = ["explorer_parallel", "explorer_blocks_worker_validator", "worker_blocks_explorer", "validator_blocks_explorer",
           "reviewer_unaffected", "other_repo_independent", "released_then_worker_runs", "partial_release_still_blocks", "handoff_guard"]
    code, o = run(["node", "--experimental-strip-types", os.path.join(HERE, "driver.mjs"), repo], repo, env, 120)
    res = {}
    try:
        res = json.loads(o.strip().splitlines()[-1])
    except Exception:
        pass
    for i in ids:
        r = res.get(i)
        if r is None:
            add(f"behavior:{i}", "fail", f"driver produced no result (exit={code}): {tail(o, 600)}")
        else:
            add(f"behavior:{i}", "pass" if r["ok"] else "fail", r["detail"])

    # 10. assertions kept (vs baseline)
    problems, notes = [], []
    for f in TEST_FILES:
        bt = git_show(repo, a.baseline, f)
        if bt is None:
            continue
        rt = read(os.path.join(repo, f))
        if rt is None:
            problems.append(f"{f}: deleted")
            continue
        ba, ra = assert_lines(bt), assert_lines(rt)
        rset = set(ra)
        gone = [l for l in ba if l not in rset]
        hard = [l for l in gone if not RULE_LINE.search(l)]
        if hard:
            problems += [f"{f}: removed/changed assert not tied to the lock rule: {l[:160]}" for l in hard[:3]]
        if len(ra) < len(ba):
            problems.append(f"{f}: assert count dropped {len(ba)} -> {len(ra)}")
        if gone:
            notes.append(f"{f}: {len(gone)} rule-related assert line(s) replaced")
    # contract.test must still relate agent tools to the lock/role
    bt, rt = git_show(repo, a.baseline, "contract.test.mjs") or "", read(os.path.join(repo, "contract.test.mjs")) or ""
    tb = sum(1 for l in assert_lines(bt) if "tools" in l)
    tr = sum(1 for l in assert_lines(rt) if "tools" in l)
    if tr < tb:
        problems.append(f"contract.test.mjs: asserts that look at the agent's tools {tb} -> {tr}")
    add("assertions_kept", "fail" if problems else "pass", "; ".join(problems) if problems else "no assert removed outside the rule being changed; " + "; ".join(notes))

    # 11. caps unchanged
    bad = []
    tracked = subprocess.run(["git", "-C", repo, "ls-tree", "--name-only", a.baseline], capture_output=True, text=True).stdout.split()
    for p in tracked:
        if not p.endswith((".ts", ".mjs")):
            continue
        b, r = git_show(repo, a.baseline, p) or "", read(os.path.join(repo, p)) or ""
        rv = [(k, v) for k, v, _ in cap_numbers(r)]
        extra = [(k, v) for k, v in rv if (k, v) not in [(k2, v2) for k2, v2, _ in cap_numbers(b)]]
        for k, v, _ in cap_numbers(b):
            if (k, v) in rv:
                continue
            bigger = [e for e in extra if (e[0] == k or k == "line") and e[1] > v]
            if bigger:
                bad.append(f"{p}: cap {k}={v} raised to {bigger[0][1]}")
            elif k != "line" and not [e for e in extra if e[0] == k]:
                bad.append(f"{p}: cap {k}={v} removed")
    add("caps_unchanged", "fail" if bad else "pass", "; ".join(bad) if bad else "no baseline size/length cap raised or removed")

    # 12. docs: old rule gone
    for p, sents in OLD_RULES.items():
        bt, rt = git_show(repo, a.baseline, p), read(os.path.join(repo, p))
        if bt is None or rt is None:
            add(f"docs_old_rule:{p}", "fail", "file missing")
            continue
        probs = []
        if bt == rt:
            probs.append("file unchanged")
        still = [s for s in sents if s in rt]
        if still:
            probs.append("old rule still present: " + " | ".join(still))
        bl = set(bt.splitlines())
        added = [l for l in rt.splitlines() if l not in bl]
        if bt != rt and not any(re.search(r"explorer|shared|共享|parallel|并行|together|concurrent|同时", l, re.I) for l in added):
            probs.append("changed lines do not mention explorers running together")
        if any(s not in bt for s in sents):
            probs.append("(checker bug) old sentence not in baseline")
        add(f"docs_old_rule:{p}", "fail" if probs else "pass", "; ".join(probs) or "changed; old exclusive-explorer wording gone")

    # 13. scout write tools
    scout_check(repo, a, tmp, env)

    # 14. README consistency
    readme_check(repo)

    shutil.rmtree(tmp, ignore_errors=True)
    scored = [c for c in checks if c["status"] in ("pass", "fail")]
    result = {"checks": checks, "auto_pass": sum(c["status"] == "pass" for c in scored), "auto_total": len(scored), "manual": manual}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=1)
    print(f"auto {result['auto_pass']}/{result['auto_total']}; manual: {manual}")


def scout_check(repo, a, tmp, env):
    sub = a.subagents_dir
    scout_md = os.path.join(sub, "agents", "scout.md")
    if not os.path.exists(scout_md):
        add("scout_write_tools", "fail", f"checker environment: {scout_md} not found")
        add("scout_write_report", "manual", "see CHECKS.md")
        return
    # (a) plugin-level restriction: explorer request carries a tool list without write/apply_patch
    plugin_ok, plugin_detail = False, "explorer REQUEST has no tool restriction field"
    probe = (
        "import {pathToFileURL as u} from 'node:url';import {join} from 'node:path';"
        "const D=await import(u(join(process.argv[2],'delegate.ts')).href);const H=await import(u(join(process.argv[2],'test-helpers.mjs')).href);"
        "const C=await import(u(join(process.argv[2],'subagent-delegation-contract.ts')).href);"
        "const bus=H.fakeBus();let req;bus.on(C.SUBAGENT_DELEGATION_REQUEST_EVENT,r=>{req=r});"
        "D.runDelegation({events:bus,git:H.noGit,ownerRunId:'o',limits:{timeoutMs:60000,maxTokens:1e6,startTimeoutMs:40,cancelGraceMs:40},locks:D.createCwdLocks()},{role:'explorer',task:'t',cwd:'/w1'});"
        "await H.tick(40);console.log(JSON.stringify(req??null));process.exit(0)"
    )
    pf = os.path.join(tmp, "probe.mjs")
    with open(pf, "w") as f:
        f.write(probe)
    code, o = run(["node", "--experimental-strip-types", pf, repo], repo, env, 60)
    try:
        req = json.loads(o.strip().splitlines()[-1])
        s = json.dumps(req)
        if req and re.search(r'"(tools|allowedTools|toolAllowlist|allow)"\s*:', s) and not re.search(r"write|apply_patch", json.dumps({k: v for k, v in req.items() if k != "task"})):
            plugin_ok, plugin_detail = True, "explorer REQUEST carries a tool restriction without write/apply_patch"
    except Exception:
        plugin_detail = f"probe failed: {tail(o, 300)}"

    # (b) test fault injection: a scout that gains edit/apply_patch must make the repo tests fail
    fake = os.path.join(tmp, "subagents")
    os.makedirs(fake)
    for name in os.listdir(sub):
        if name != "agents":
            os.symlink(os.path.join(sub, name), os.path.join(fake, name))
    shutil.copytree(os.path.join(sub, "agents"), os.path.join(fake, "agents"))
    text = read(scout_md)
    outcomes = {}
    for label, tool in (("control", None), ("edit", "edit"), ("apply_patch", "apply_patch")):
        md = text if tool is None else re.sub(r"^(tools:.*)$", lambda m: m.group(1) + ", " + tool, text, count=1, flags=re.M)
        with open(os.path.join(fake, "agents", "scout.md"), "w", encoding="utf-8") as f:
            f.write(md)
        code, o = run("node --experimental-strip-types contract.test.mjs", repo, dict(env, PI_SUBAGENTS_DIR=fake), 120, shell=True)
        outcomes[label] = (code, first_err(o) if code else "")
    ctrl = outcomes["control"][0]
    caught = [k for k in ("edit", "apply_patch") if outcomes[k][0] != 0]
    inj = "; ".join(f"{k}: exit={outcomes[k][0]}" for k in outcomes)
    if ctrl != 0:
        add("scout_write_tools", "fail", f"control run of contract.test.mjs on unmodified scout failed (exit={ctrl}): {outcomes['control'][1]}")
    elif plugin_ok:
        add("scout_write_tools", "pass", plugin_detail + f"; injection: {inj}")
    elif caught:
        add("scout_write_tools", "pass", f"contract.test.mjs fails when scout gains {', '.join(caught)} ({inj})")
    else:
        add("scout_write_tools", "fail", f"no plugin-level tool restriction and no test fails when scout gains edit/apply_patch ({inj}; {plugin_detail})")
    add("scout_write_report", "manual", "Root's final report: does it state what was done / not done for scout write tools and why? (CHECKS.md)")


def readme_check(repo):
    problems, details = [], []
    for p, row in (("README.md", r"\|\s*`explorer`\s*\|\s*`scout`\s*\|\s*(yes|exclusive[^|]*)\s*\|"), ("README.zh-CN.md", r"\|\s*`explorer`\s*\|\s*`scout`\s*\|\s*(是|独占[^|]*)\s*\|")):
        t = read(os.path.join(repo, p))
        if t is None:
            problems.append(f"{p}: missing")
            continue
        if re.search(row, t):
            problems.append(f"{p}: explorer row still marked exclusive/yes")
        for s in OLD_RULES.get(p, []):
            if s in t:
                problems.append(f"{p}: old sentence present: {s[:60]}")
        # leftover generic old-rule phrases
        for pat in (r"a second such child", r"第二个这样的子代理", r"explorer[^.\n|]{0,40}(one at a time|each repository alone)"):
            if re.search(pat, t, re.I):
                problems.append(f"{p}: matches old-rule pattern /{pat}/")
        details.append(p)
    add("readme_consistent:auto", "fail" if problems else "pass", "; ".join(problems) if problems else "no old-rule sentence, explorer row not exclusive in " + ", ".join(details))
    add("readme_consistent:manual", "manual", "README.md / README.zh-CN.md describe explorer parallel, worker/validator exclusive, reviewer unlocked and are internally consistent (CHECKS.md)")


if __name__ == "__main__":
    main()
