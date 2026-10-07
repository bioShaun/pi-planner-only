#!/usr/bin/env python3
"""Acceptance checks for task S2 (per-repo read/write lock). stdlib only."""
import argparse, difflib, json, os, re, shutil, subprocess, sys, time

BASE_DEFAULT = "/project/tmp/worker-tiers-simple/baseline/s2"
REPO_DEFAULT = "/home/tcuni-claw/pi/pi-planner-only"
REF_DEFAULT = "f2fe050"
EXCL = {"node_modules", ".git"}
REF_TESTS = ["contract.test.mjs", "delegate.test.mjs", "index.test.mjs"]
EXACT_WORDING = "worker and validator run alone per repository; explorers can run together but not alongside a worker or validator; a reviewer or another repository can run alongside."
EXACT_RE = "/worker and validator run alone per repository; explorers can run together but not alongside a worker or validator; a reviewer or another repository can run alongside\\./"

# Old-rule sentences (verified present in the baseline at run time).
# 裁定 2（2026-10-07，全部 18 次运行完成后）：原检查把引导句（如 "A child with bash or write holds its cwd"）
# 也当旧规则，误伤了保留引导句、但已把规则改成读写锁的写法。改为只认「旧的独占断言」：
# 第二个持有 cwd 的子代理一律被拒、explorer 记为独占（yes/是）、或原句整句未改。
OLD_RULES = {
    "index.ts": [
        "worker, explorer, and validator run one at a time per repository (a second one is refused)",
    ],
    "README.md": [
        "a second such child in",
        "| `explorer` | `scout` | yes |",
    ],
    "README.zh-CN.md": [
        "同一目录里第二个这样的子代理会被拒绝",
        "| `explorer` | `scout` | 是 |",
    ],
    "CONTEXT.md": [
        "A child with bash or write holds its cwd until it ends; an unconfirmed stop keeps the hold until the late terminal.",
    ],
}
CAP_LINE = re.compile(r"(length\s*(<=?|>=?)\s*[\d_\.]+|[\d_]+\s*(<=?|>=?)\s*[\w.]*length|\+\s*[\d_]+\)?;?\s*$)")
CAP_LINE_STRICT = re.compile(r"length[^\n]*?(<=?)[^\n]*?\d|\d[^\n]*?(<=?)[^\n]*?length")
CAP_CONST = re.compile(r"^\s*(?:export\s+)?const\s+(\w*(?:MAX|CAP|LIMIT|TARGET)\w*)\s*(?::[^=]+)?=\s*([\d_]+)\s*;?", re.M)

checks = []
def add(i, status, detail):
    checks.append({"id": i, "status": status, "detail": detail})

def walk(root):
    out = {}
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in EXCL]
        for f in files:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = p
    return out

def read(p):
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return None

def sh(cmd, cwd, tmp, env_extra=None):
    env = dict(os.environ, TMPDIR=tmp)
    t = time.time()
    try:
        r = subprocess.run(cmd, cwd=cwd, env=env, shell=True, capture_output=True, text=True, timeout=180)
        return r.returncode, (r.stdout + r.stderr), time.time() - t
    except subprocess.TimeoutExpired as e:
        return 124, "TIMEOUT 180s\n" + ((e.stdout or b"").decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")), 180.0

def copy_tree(src, dst):
    if os.path.lexists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("node_modules", ".git"), symlinks=True)
    nm = os.path.realpath(os.path.join(src, "node_modules"))
    if not os.path.exists(nm):
        nm = os.path.join(REPO_DEFAULT, "node_modules")
    os.symlink(nm, os.path.join(dst, "node_modules"))

def tail(s, n=1500):
    return s[-n:]

def first_assert_error(out):
    m = re.search(r"(AssertionError[^\n]*(?:\n(?!\s+at ).*){0,25})", out)
    if m:
        return m.group(1)[:1500]
    m = re.search(r"(error TS[^\n]*)", out)
    if m:
        return m.group(1)
    return tail(out, 1200)

def cap_numbers(text):
    """set of (key, number) for caps in text."""
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--base", default=BASE_DEFAULT)
    ap.add_argument("--ref-repo", default=REPO_DEFAULT)
    ap.add_argument("--ref", default=REF_DEFAULT)
    a = ap.parse_args()
    run, out, base = [os.path.abspath(x) for x in (a.run, a.out, a.base)]
    os.makedirs(out, exist_ok=True)
    tmp = os.path.join(out, "tmp")
    os.makedirs(tmp, exist_ok=True)
    t0 = time.time()

    # 1 own_tests
    own = os.path.join(out, "own")
    copy_tree(run, own)
    code, o, dt = sh("npm run test:release", own, tmp)
    add("own_tests", "pass" if code == 0 else "fail", f"exit={code} ({dt:.1f}s)\n{tail(o)}")

    # 2 ref_tests
    ref = os.path.join(out, "ref")
    copy_tree(run, ref)
    for f in REF_TESTS:
        r = subprocess.run(["git", "-C", a.ref_repo, "show", f"{a.ref}:{f}"], capture_output=True, text=True)
        if r.returncode != 0:
            add("ref_tests:setup", "fail", r.stderr)
            break
        # 2026-10-07 裁定（看到第一批 Luna 结果后、其他模型运行前定下，对所有运行一致适用）：
        # - task 写的 "N explorer child(ren)" 属于单复数占位，接受 child(ren)/children/child；
        # - index.test 中工具描述的逐字文案断言放宽为关键短语，逐字一致单独由 wording_exact 计分，
        #   以免第一个文案断言失败遮住后面的行为断言。
        txt = r.stdout.replace("child\\(ren\\)", "child(?:\\(ren\\)|ren)?")
        txt = txt.replace(EXACT_RE, "/explorers can run together/i")
        with open(os.path.join(ref, f), "w", encoding="utf-8") as fh:
            fh.write(txt)
    code, o, dt = sh("npm run typecheck", ref, tmp)
    add("ref_tests:typecheck", "pass" if code == 0 else "fail",
        f"exit={code}" if code == 0 else f"exit={code}\n{first_assert_error(o)}")
    for f in REF_TESTS:
        code, o, dt = sh(f"node --experimental-strip-types {f}", ref, tmp)
        add(f"ref_tests:{f}", "pass" if code == 0 else "fail",
            f"exit={code}" if code == 0 else f"exit={code}\n{first_assert_error(o)}")

    idx = read(os.path.join(run, "index.ts")) or ""
    add("wording_exact", "pass" if EXACT_WORDING.lower() in idx.lower() else "fail",
        "task 给出的新规则文案是否逐字出现在 index.ts（忽略大小写）")

    bf, rf = walk(base), walk(run)
    changed = sorted(p for p in bf if p in rf and read(bf[p]) != read(rf[p]))
    added = sorted(p for p in rf if p not in bf)
    deleted = sorted(p for p in bf if p not in rf)

    # 3 assertions_kept
    lines_out = []
    for p in sorted(bf):
        if not p.endswith(".test.mjs") or os.sep in p:
            continue
        b = (read(bf[p]) or "").splitlines()
        r = (read(rf[p]) or "").splitlines() if p in rf else []
        for l in difflib.unified_diff(b, r, lineterm="", n=0):
            if l.startswith("-") and not l.startswith("---") and "assert" in l:
                lines_out.append(f"{p}: {l}")
    add("assertions_kept:removed_or_modified", "info",
        f"{len(lines_out)} assert line(s) removed/modified (human review)\n" + "\n".join(lines_out) if lines_out else "none")
    bad = []
    cap_report = []
    for p in sorted(bf):
        if not p.endswith((".ts", ".mjs")) or os.sep in p:
            continue
        bt, rt = read(bf[p]) or "", (read(rf[p]) if p in rf else "") or ""
        bc, rc = cap_numbers(bt), cap_numbers(rt)
        for k, v, ln in bc:
            cap_report.append(f"{p}: {ln}")
        rvals = [(k, v) for k, v, _ in rc]
        bvals = [(k, v) for k, v, _ in bc]
        missing = [(k, v) for (k, v) in bvals if (k, v) not in rvals]
        extra = [(k, v) for (k, v) in rvals if (k, v) not in bvals]
        for k, v in missing:
            bigger = [e for e in extra if e[0] == k and e[1] > v] if k != "line" else [e for e in extra if e[1] > v]
            if bigger:
                bad.append(f"{p}: cap {k}={v} raised to {bigger[0][1]}")
            elif not [e for e in extra if e[0] == k]:
                bad.append(f"{p}: cap {k}={v} removed (human review)") if k != "line" else None
    add("assertions_kept:caps", "fail" if bad else "pass",
        ("; ".join(bad) if bad else "no baseline cap raised") + "\nbaseline caps:\n" + "\n".join(cap_report))

    # 4 docs_updated
    for p, sents in OLD_RULES.items():
        bt, rt = read(bf.get(p, "")) , read(rf.get(p, ""))
        if bt is None or rt is None:
            add(f"docs_updated:{p}", "fail", "file missing"); continue
        absent_in_base = [s for s in sents if s not in bt]
        still = [s for s in sents if s in rt]
        probs = []
        if bt == rt: probs.append("file unchanged")
        if still: probs.append("old rule still present: " + " | ".join(still))
        added = [l for l in rt.splitlines() if l not in set(bt.splitlines())]
        if bt != rt and not any(("explorer" in l.lower()) or ("shared" in l.lower()) or ("共享" in l) for l in added):
            probs.append("changed lines do not mention explorers/shared")
        if absent_in_base: probs.append("(checker bug) not in baseline: " + " | ".join(absent_in_base))
        add(f"docs_updated:{p}", "fail" if probs else "pass",
            "; ".join(probs) if probs else "changed; old sentences gone\nold rules: " + " | ".join(sents))

    # 5 role_lock_map
    dt_ = read(os.path.join(run, "delegate.ts")) or ""
    m = re.search(r"ROLE_AGENTS[^=]*=\s*\{(.*?)\n\};", dt_, re.S)
    problems = []
    if not m:
        problems.append("ROLE_AGENTS block not found")
    else:
        blk = m.group(1)
        if re.search(r"\bexclusive\s*:", blk):
            problems.append("`exclusive:` field still present")
        for role, mode in (("worker", "exclusive"), ("validator", "exclusive"), ("explorer", "shared"), ("reviewer", "none")):
            mm = re.search(r"\b" + role + r"\s*:\s*\{(.*?)\n\t\}", blk, re.S)
            if not mm:
                problems.append(f"{role}: entry not found"); continue
            lm = re.search(r"\block\s*:\s*\"(\w+)\"", mm.group(1))
            if not lm or lm.group(1) != mode:
                problems.append(f"{role}: lock={lm.group(1) if lm else None}, expected {mode}")
    add("role_lock_map", "fail" if problems else "pass", "; ".join(problems) or "worker/validator exclusive, explorer shared, reviewer none")

    # 6 scope
    sens = [p for p in changed + added + deleted if p in ("package.json", "package-lock.json", "tsconfig.json")]
    expected = {"delegate.ts", "index.ts", "delegate.test.mjs", "contract.test.mjs", "index.test.mjs", "README.md", "README.zh-CN.md", "CONTEXT.md", "CHANGELOG.md"}
    outside = [p for p in changed + added + deleted if p not in expected]
    add("scope", "info", f"changed: {changed}\nadded: {added}\ndeleted: {deleted}\n"
        f"config files touched: {sens}\nother out-of-expected-range: {outside}")

    # output
    with open(os.path.join(out, "checks.json"), "w", encoding="utf-8") as f:
        json.dump(checks, f, ensure_ascii=False, indent=1)
    scored = [c for c in checks if c["status"] in ("pass", "fail")]
    npass = sum(c["status"] == "pass" for c in scored)
    md = ["| id | status | detail |", "|---|---|---|"]
    for c in checks:
        d = c["detail"].replace("|", "\\|").replace("\n", "<br>")
        md.append(f"| {c['id']} | {c['status']} | {d[:1800]} |")
    md.append("")
    md.append(f"通过 {npass} / 总 {len(scored)}  (info {len(checks) - len(scored)} 条不计分; 耗时 {time.time() - t0:.1f}s)")
    with open(os.path.join(out, "checks.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(md) + "\n")
    print(md[-1])

if __name__ == "__main__":
    main()
