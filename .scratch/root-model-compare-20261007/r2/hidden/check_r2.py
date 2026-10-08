#!/usr/bin/env python3
"""R2 hidden acceptance checks. usage: check_r2.py <repo> <baseline_sha> --out <json> [--sensitivity]
Observes only host-visible effects via driver_r2.mjs; never reads implementation-specific names."""
import argparse, hashlib, json, os, re, shutil, signal, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
DRIVER = HERE / "driver_r2.mjs"
TMPROOT = Path("/project/tmp/root-model-compare/r2/check-tmp")
MAIN = Path("/home/tcuni-claw/pi/pi-planner-only")
DEPS = Path("/project/tmp/root-model-compare/deps/node_modules")
BRIEF = ("Continue the parser migration in this repository. Goal: finish the streaming parser. Decisions: preserve the public API and avoid dependencies. "
         "Constraints: TypeScript, existing tests, no commits. Relevant files: index.ts and index.test.mjs. Done: analysis and initial implementation. "
         "Open: validate edge cases and update tests. Exact next step: inspect parser tests, implement missing cases, then run npm run test:release.")
assert len(BRIEF) >= 200


def new_agent():
    TMPROOT.mkdir(parents=True, exist_ok=True)
    d = Path(tempfile.mkdtemp(dir=TMPROOT)) / "agent"
    d.mkdir()
    return d


def run(repo, steps, agent, handoff_env=None):
    env = {k: v for k, v in os.environ.items() if not k.startswith("PI_")}
    env.update(TMPDIR=str(TMPROOT), PI_PLANNER_ONLY="1", PI_PLANNER_ONLY_MODE="lite", PI_CODING_AGENT_DIR=str(agent))
    if handoff_env is not None:
        env["PI_PLANNER_ONLY_HANDOFF"] = handoff_env
    sf = Path(tempfile.mkstemp(dir=TMPROOT, suffix=".json")[1])
    sf.write_text(json.dumps(steps))
    p = subprocess.Popen(["node", "--experimental-strip-types", str(DRIVER), str(repo), str(sf)], env=env, cwd=str(repo),
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
    try:
        out, err = p.communicate(timeout=60)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        p.communicate()
        raise RuntimeError("driver timeout")
    finally:
        sf.unlink(missing_ok=True)
    lines = [l for l in out.splitlines() if l.startswith("{")]
    if not lines:
        raise RuntimeError(f"driver produced no trace (rc={p.returncode}): {err[-500:]}")
    t = json.loads(lines[-1])
    if t.get("load_error"):
        raise RuntimeError("driver load_error: " + t["load_error"][:300])
    return t


def words(text, *ws):
    return all(re.search(r"\b" + re.escape(w) + r"\b", text, re.I) for w in ws)


def last_notes(t):
    return "\n".join(map(str, t["steps"][-1]["notes_added"]))


def errors(t):
    return [s["error"] for s in t["steps"] if s["error"]]


def show(repo, agent, env=None, pre=()):
    """Fresh process: session_start then bare handoff-mode; returns note text of the bare command."""
    t = run(repo, list(pre) + ["session_start", {"cmd": "handoff-mode"}], agent, env)
    return t, last_notes(t)


def persist(repo, agent, mode):
    return run(repo, ["session_start", {"cmd": f"handoff-mode {mode}"}], agent)


def listing(agent):
    return sorted(str(p.relative_to(agent)) for p in agent.rglob("*"))


def snapshot(agent):
    snap = {}
    for p in sorted(agent.rglob("*")):
        rel = str(p.relative_to(agent))
        snap[rel] = "<dir>" if p.is_dir() else hashlib.sha256(p.read_bytes()).hexdigest()
    return snap


def b1(repo):
    a = new_agent(); persist(repo, a, "auto")
    t, n = show(repo, a)
    return (words(n, "auto", "persisted"), f"notes={n!r}")


def b2(repo):
    a = new_agent(); persist(repo, a, "auto")
    res = []
    for m in ("confirm", "off"):
        _, n = show(repo, a, m)
        res.append((words(n, m, "env"), f"env={m}: {n!r}"))
    return (all(r[0] for r in res), "; ".join(r[1] for r in res))


def b3(repo):
    a = new_agent(); _, n = show(repo, a)
    return (words(n, "off", "default"), f"notes={n!r}")


def file_shas(agent):
    return {str(p.relative_to(agent)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(agent.rglob("*")) if p.is_file()}


def b4(repo):
    a = new_agent()
    run(repo, ["session_start"], a)
    s0 = file_shas(a)
    run(repo, ["session_start", {"cmd": "handoff-mode auto"}], a)
    s1 = file_shas(a)
    cands = [r for r in sorted(s1) if s0.get(r) != s1[r]]
    if not cands:
        return (False, "no new or changed file in agent dir after handoff-mode auto")
    mutations = {"text": lambda t: t.write_text("garbage\n"),
                 "binary": lambda t: t.write_bytes(os.urandom(256)),
                 "dir": lambda t: (t.unlink(), t.mkdir())}
    no_error, pref_like, lines = True, [], []
    for rel in cands:
        target = a / rel
        orig = target.read_bytes()
        res = {}
        for name, mut in mutations.items():
            if target.is_dir():
                shutil.rmtree(target)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(orig)
            mut(target)
            t = run(repo, ["session_start", "before_agent_start", {"cmd": "handoff-mode"}], a)
            n = last_notes(t)
            err = bool(errors(t))
            no_error &= not err
            res[name] = (err, words(n, "off", "default"))
            lines.append(f"{rel}/{name}:{'ERROR ' + repr(errors(t)) if err else ('off+default' if res[name][1] else 'other ' + repr(n[:80]))}")
        if target.is_dir():
            shutil.rmtree(target)
        target.write_bytes(orig)
        if all(not e and od for e, od in res.values()):
            pref_like.append(rel)
    return (no_error and bool(pref_like), f"candidates={cands} preference-like={pref_like} " + " ".join(lines))


def b5(repo):
    a = new_agent(); persist(repo, a, "confirm")
    s0 = snapshot(a)
    t = run(repo, ["session_start", {"cmd": "handoff-mode maybe"}], a)
    s1 = snapshot(a)
    notes = t["steps"][-1]["notes_added"]
    _, n = show(repo, a)
    good = s0 == s1 and len(notes) >= 1 and not errors(t) and words(n, "confirm", "persisted")
    return (good, f"snapshot_same={s0 == s1} notes={len(notes)} errors={errors(t)} after={n!r}")


def b6(repo):
    a = new_agent()
    t = run(repo, ["session_start", {"cmd": "handoff-mode auto"}, "agent_settled"], a)
    bad = {k: t[k] for k in ("sentUserMessages", "sessionCalls", "replaced_editor", "replaced_sent") if t[k]}
    return (not bad and not errors(t), f"nonempty={json.dumps(bad)[:300]} errors={errors(t)}")


def strip_notes(t):
    return {k: t[k] for k in ("sentUserMessages", "sessionCalls", "replaced_sent", "replaced_editor", "replaced_notes", "sentMessages")} | \
           {"errors": [bool(s["error"]) for s in t["steps"]]}


def first_diff(a, b, path=""):
    if type(a) != type(b):
        return f"{path}: {str(a)[:120]!r} != {str(b)[:120]!r}"
    if isinstance(a, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b:
                return f"{path}.{k}: missing on one side"
            d = first_diff(a[k], b[k], f"{path}.{k}")
            if d: return d
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{path}: len {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, f"{path}[{i}]")
            if d: return d
        return None
    return None if a == b else f"{path}: {str(a)[:160]!r} != {str(b)[:160]!r}"


def b6b(repo, base_sha):
    base = new_agent().parent / "base"
    base.mkdir()
    for src in (repo, MAIN):  # fixtures are re-initialised repos; fall back to MAIN for the original sha
        ar = subprocess.run(f"git -C {src} archive {base_sha} | tar -x -C {base}", shell=True, capture_output=True, text=True)
        if ar.returncode == 0: break
    else:
        raise RuntimeError("archive failed: " + ar.stderr)
    (base / "node_modules").symlink_to(DEPS)
    steps = ["session_start", {"cmd": "handoff some goal text"}, "agent_settled"]
    tb = strip_notes(run(base, steps, new_agent()))
    tr = strip_notes(run(repo, steps, new_agent()))
    d = first_diff(tb, tr)
    return (d is None and bool(tb["sentUserMessages"]), d or f"identical; sentUserMessages={len(tb['sentUserMessages'])}")


def b7(repo):
    a = new_agent()
    t = run(repo, ["session_start", {"cmd": "handoff-mode confirm"}, {"cmd": "status"}], a)
    n = last_notes(t)
    return (words(n, "confirm"), f"status notes={n!r}")


SCEN = {
    "s1": (["session_start", {"usage": 200000}, {"tool": "handoff", "brief": BRIEF}],
           lambda t: {"errors": errors(t), "result": t["steps"][-1]["tool_result"]}),
    "s2": (["session_start", {"usage": 200000}], lambda t: {"errors": errors(t), "sentMessages": t["sentMessages"]}),
    "s3": (["session_start", {"usage": 200000}, {"tool": "handoff", "brief": BRIEF}, "agent_settled", {"cmd": "handoff"}],
           lambda t: {"errors": errors(t), "sentUserMessages": t["sentUserMessages"], "sessionCalls": t["sessionCalls"],
                      "replaced_sent": t["replaced_sent"], "replaced_editor": t["replaced_editor"]}),
}


def mask(obj):
    """Mask source words in every string value (not in the serialised JSON)."""
    if isinstance(obj, str):
        obj = re.sub(r"PI_PLANNER_ONLY_HANDOFF=[A-Za-z_-]+", "<SRC>", obj)
        return re.sub(r"\b(env|persisted|default)\b", "<SRC>", obj, flags=re.I)
    if isinstance(obj, list):
        return [mask(x) for x in obj]
    if isinstance(obj, dict):
        return {k: mask(v) for k, v in obj.items()}
    return obj


def b8(repo):
    subs, ok = [], True
    for x in ("off", "confirm", "auto"):
        ap = new_agent(); persist(repo, ap, x)
        for sc, (steps, ext) in SCEN.items():
            te = ext(run(repo, steps, new_agent(), x))
            tp = ext(run(repo, steps, ap))
            d = first_diff(mask(te), mask(tp))
            ok &= d is None
            subs.append(f"{x}/{sc}:{'eq' if d is None else 'DIFF ' + d}")
    return (ok, " ".join(subs))


def sensitivity(repo):
    res = {}
    for sc, (steps, ext) in SCEN.items():
        tr = {x: ext(run(repo, steps, new_agent(), x)) for x in ("off", "confirm", "auto")}
        res[sc] = {"off_vs_auto_differ": mask(tr["off"]) != mask(tr["auto"]),
                   "confirm_vs_auto_differ": mask(tr["confirm"]) != mask(tr["auto"]),
                   "off_vs_confirm_differ": mask(tr["off"]) != mask(tr["confirm"])}
    return res


def b12(repo):
    r = {n: ("handoff-mode" in (Path(repo) / n).read_text() if (Path(repo) / n).exists() else False) for n in ("README.md", "README.zh-CN.md")}
    return (all(r.values()), json.dumps(r))


def extract_baseline(repo, base_sha, dest):
    dest.mkdir(parents=True)
    for src in (repo, MAIN):
        ar = subprocess.run(f"git -C {src} archive {base_sha} | tar -x -C {dest}", shell=True, capture_output=True, text=True)
        if ar.returncode == 0:
            return
    raise RuntimeError("archive failed: " + ar.stderr)


def tree_files(root):
    out = {}
    for dp, dns, fns in os.walk(root):
        dns[:] = [d for d in dns if d not in (".git", "node_modules")]
        for f in fns:
            p = Path(dp) / f
            if p.is_file() and not p.is_symlink():
                out[str(p.relative_to(root))] = p
    return out


def is_test_file(rel):
    n = Path(rel).name
    return n.endswith(".test.mjs") or n == "test-helpers.mjs"


def copy_repo(repo, name):
    d = Path(tempfile.mkdtemp(dir=TMPROOT, prefix=name + "-"))
    c = d / "repo"
    subprocess.run(["cp", "-a", str(repo), str(c)], check=True)
    if not (c / "node_modules").exists():
        (c / "node_modules").symlink_to(DEPS)
    return d, c


def npm_run(cwd, home_dir, args):
    timeout = int(os.environ.get("R2_CHECK_TEST_TIMEOUT", "300"))
    home = home_dir / "home"
    home.mkdir()
    tmpd = home_dir / "tmp"
    tmpd.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith("PI_PLANNER_ONLY") and k != "PI_CODING_AGENT_DIR"}
    env.update(HOME=str(home), TMPDIR=str(tmpd), npm_config_cache=str(home_dir / "npm-cache"),
               PI_SUBAGENTS_DIR="/home/tcuni-claw/.pi/agent/npm/node_modules/pi-subagents")
    p = subprocess.Popen(["npm"] + args, cwd=str(cwd), env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out, home
    except subprocess.TimeoutExpired:
        os.killpg(p.pid, signal.SIGKILL)
        out, _ = p.communicate()
        return None, (out or ""), home


def tail_lines(s, n):
    return "\n".join(s.splitlines()[-n:])


def b9_b11(repo):
    d, c = copy_repo(repo, "b9")
    rc, out, home = npm_run(c, d, ["run", "test:release"])
    r9 = (rc == 0, f"exit={'timeout' if rc is None else rc}\n{tail_lines(out, 40)}")
    found = sorted(str(p.relative_to(home)) for p in (home / ".pi").rglob("*") if p.is_file()) if (home / ".pi").exists() else []
    r11 = (not found, f"files under fake HOME/.pi: {found}" if found else "no files under fake HOME/.pi")
    return r9, r11


def b10(repo, base_sha):
    """Restore non-test source to baseline (package.json is the test entry and stays); keep new files."""
    d, c = copy_repo(repo, "b10")
    base = d / "base"
    extract_baseline(repo, base_sha, base)
    bf, cf = tree_files(base), tree_files(c)
    restored, recreated = [], []
    for rel in sorted(bf):
        if is_test_file(rel) or rel == "package.json":
            continue
        if rel in cf:
            if bf[rel].read_bytes() != cf[rel].read_bytes():
                shutil.copyfile(bf[rel], cf[rel])
                restored.append(rel)
        else:
            (c / rel).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(bf[rel], c / rel)
            recreated.append(rel)
    if not restored and not recreated:
        return (False, "no non-test files differ from baseline; nothing restored")
    rc, out, _ = npm_run(c, d, ["test"])
    return (rc is not None and rc != 0,
            f"restored={restored} recreated={recreated} exit={'timeout' if rc is None else rc}\n{tail_lines(out, 20)}")


def h2(repo, base_sha):
    import difflib
    d = Path(tempfile.mkdtemp(dir=TMPROOT, prefix="h2-"))
    base = d / "base"
    extract_baseline(repo, base_sha, base)
    bf, cf = tree_files(base), tree_files(repo)
    items = []
    for rel in sorted(bf):
        if not rel.endswith(".test.mjs"):
            continue
        a = bf[rel].read_text(errors="replace").splitlines()
        b = cf[rel].read_text(errors="replace").splitlines() if rel in cf else []
        for tag, i1, i2, _, _ in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if tag in ("replace", "delete"):
                for i in range(i1, i2):
                    if "assert" in a[i]:
                        items.append({"file": rel, "line": i + 1, "text": a[i]})
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo"); ap.add_argument("baseline_sha"); ap.add_argument("--out"); ap.add_argument("--sensitivity", action="store_true")
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    if a.sensitivity:
        print(json.dumps(sensitivity(repo), indent=1)); return 0
    checks = []
    table = [("B1", b1), ("B2", b2), ("B3", b3), ("B4", b4), ("B5", b5), ("B6", b6), ("B6b", lambda r: b6b(r, a.baseline_sha)),
             ("B7", b7), ("B8", b8), ("B12", b12)]
    for cid, fn in table:
        try:
            ok, detail = fn(repo)
            checks.append({"id": cid, "status": "pass" if ok else "fail", "detail": detail[:1500]})
        except Exception as e:
            checks.append({"id": cid, "status": "fail", "detail": f"checker exception: {e}"[:1500]})
    try:
        r9, r11 = b9_b11(repo)
    except Exception as e:
        r9 = r11 = (False, f"checker exception: {e}")
    try:
        r10 = b10(repo, a.baseline_sha)
    except Exception as e:
        r10 = (False, f"checker exception: {e}")
    for cid, (ok, detail) in ((("B9", r9), ("B10", r10), ("B11", r11))):
        checks.append({"id": cid, "status": "pass" if ok else "fail", "detail": detail[:3000]})
    try:
        h2items = h2(repo, a.baseline_sha)
        checks.append({"id": "H2", "status": "manual", "detail": f"{len(h2items)} removed/changed assert lines"})
    except Exception as e:
        h2items = [f"checker exception: {e}"]
        checks.append({"id": "H2", "status": "manual", "detail": f"checker exception: {e}"})
    scored = [c for c in checks if c["status"] in ("pass", "fail")]
    res = {"checks": checks, "auto_pass": sum(c["status"] == "pass" for c in scored), "auto_total": len(scored),
           "manual": [{"id": "H2", "removed_or_changed_asserts": h2items}, "H1 README priority consistency", "H3 report matches changes", "H4 review findings fixed (if reviewer used)"]}
    txt = json.dumps(res, indent=1, ensure_ascii=False)
    if a.out: Path(a.out).write_text(txt)
    print(txt)
    return 0


if __name__ == "__main__":
    sys.exit(main())
