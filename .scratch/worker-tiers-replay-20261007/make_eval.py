#!/usr/bin/env python3
"""Generate objective checks (checks.json/md) and blind review material for the 12 replay runs."""
import ast, glob, json, os, random, re, shutil, subprocess, sys

ROOT = "/project/tmp/worker-tiers-replay"
EVAL = f"{ROOT}/eval"
WORK = f"{EVAL}/work"
BLIND = f"{EVAL}/blind"
KEY = "/project/tmp/worker-tiers-replay-key/key.json"
BASE = "/project/tmp/tcuni_probe_video"
V1 = f"{BASE}/v1_backup"
SEED = 20261006
os.makedirs(WORK, exist_ok=True)

RUNS = [f"R{t}-{m}-{n}" for t in (1, 2) for m in ("luna", "sonnet") for n in (1, 2, 3)]

R1_NAMES = ("BG_DEEP BG BRAND_RED BRAND_PINK BRAND_BLUE BRAND_CYAN BRAND_SKY BIOTIN BEAD PASS WARN FAIL "
            "TEXT_C MUTED GRADE BASE FONT STEPS RAIL_Y CAP_Y STAGE_TOP STAGE_BOTTOM zh zh_hl BrandScene glow card "
            "padlock probe_strand dna_fragment bead magnet db_icon sequencer_icon doc_icon check_mark cross_mark "
            "grade_badge stamp logo_full logo_mark").split()
BRANDSCENE_METHODS = "show_rail cap chapter clear_stage finish".split()
# name -> [(param, default-expression or None)]
SPEC = {
    "zh": [("s", None), ("size", "36"), ("color", "TEXT_C"), ("weight", "NORMAL")],
    "zh_hl": [("s", None), ("hl", "()"), ("size", "34"), ("color", "TEXT_C"), ("hl_color", "BRAND_PINK")],
    "glow": [("mob", None), ("color", "None"), ("layers", "4")],
    "card": [("w", None), ("h", None), ("color", "BRAND_BLUE")],
    "padlock": [("h", "0.4"), ("color", "BRAND_PINK")],
    "probe_strand": [("n", "10"), ("color", "BRAND_SKY"), ("biotin", "True")],
    "dna_fragment": [("n", "10"), ("color", "MUTED"), ("double", "True")],
    "bead": [("r", "0.35")],
    "magnet": [("h", "1.6")],
    "db_icon": [("h", "1.2")],
    "sequencer_icon": [("h", "1.3")],
    "doc_icon": [("h", "1.2")],
    "check_mark": [("size", None), ("color", "PASS")],
    "cross_mark": [("size", None), ("color", "FAIL")],
    "grade_badge": [("g", None), ("r", "0.3")],
    "stamp": [("text", None), ("color", None)],
    "logo_full": [("height", None)],
    "logo_mark": [("height", None)],
}
METHOD_SPEC = {
    "show_rail": [("step", None), ("animate", "True")],
    "cap": [("text", None), ("hl", "()"), ("hl_color", "BRAND_PINK")],
    "chapter": [("n", None)],
    "clear_stage": [("run_time", "0.5")],
}
STEPS_SPEC = [("明确目标", "钓什么？"), ("质量体检", "鱼钩结不结实？"), ("特异性检查", "会不会钓错鱼？"),
              ("功能注释", "哪些位点更有价值？"), ("择优布局", "有限的探针怎么摆？"), ("交付报告", "凭什么相信这套设计？")]
R1_REVIEW = ["review/w1_sheet_*.png", "review/w1_chapter.png", "review/w1_caption.png", "review/w1_widgets.png"]
R2_REVIEW = ["review/w5_s4_sheet.png", "review/w5_s4_scan.png", "review/w5_s4_fail.png", "review/w5_s4_grid.png"]

PROBE = r'''
import sys, json, inspect, os
sys.dont_write_bytecode = True
sys.path.insert(0, os.getcwd())
cfg = json.load(open(sys.argv[1]))
out = {}
try:
    import style
except Exception as e:
    print(json.dumps({"import_error": repr(e)})); sys.exit(0)
out["import_ok"] = True
ns = vars(style)
def ev(expr):
    try: return eval(expr, dict(ns))
    except Exception: return "<<eval-fail:%s>>" % expr
def cmp(fn, spec):
    try: sig = inspect.signature(fn)
    except Exception as e: return {"sig": None, "diffs": ["no signature"], "notes": []}
    params = [p for p in sig.parameters.values() if p.name != "self"]
    diffs, notes = [], []
    named = [p for p in params if p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL)]
    for i, (pn, de) in enumerate(spec):
        if i >= len(named): diffs.append("missing param %s" % pn); continue
        p = named[i]
        if p.name != pn: diffs.append("param %d name %s != %s" % (i, p.name, pn)); continue
        if de is None:
            if p.default is not p.empty: notes.append("%s has default %r (spec none)" % (pn, p.default))
        else:
            if p.default is p.empty: diffs.append("%s no default (spec %s)" % (pn, de))
            else:
                want = ev(de)
                if p.default != want and str(p.default) != str(want):
                    diffs.append("%s default %r != %r" % (pn, p.default, want))
    for p in named[len(spec):]:
        notes.append("extra param %s" % p.name)
    for p in params:
        if p.kind == p.VAR_KEYWORD: notes.append("**%s" % p.name)
    return {"sig": str(sig), "diffs": diffs, "notes": notes}
out["missing"] = [n for n in cfg["names"] if not hasattr(style, n)]
out["funcs"] = {n: cmp(getattr(style, n), s) for n, s in cfg["spec"].items() if hasattr(style, n)}
bs = getattr(style, "BrandScene", None)
out["bs_missing"] = [m for m in cfg["bs_methods"] if bs is None or not hasattr(bs, m)]
out["methods"] = {n: cmp(getattr(bs, n), s) for n, s in cfg["mspec"].items() if bs is not None and hasattr(bs, n)}
def norm(v): return str(v).upper() if isinstance(v, str) else v
out["colors"] = {n: norm(getattr(style, n, None)) for n in cfg["colors"]}
g = getattr(style, "GRADE", None)
out["grade_ok"] = (g == {1: style.PASS, 2: style.BRAND_SKY, 3: style.WARN, 4: style.FAIL}) if g is not None else None
out["grade_repr"] = repr(g)
st = getattr(style, "STEPS", None)
out["steps"] = [list(x) for x in st] if st is not None else None
print(json.dumps(out, ensure_ascii=False, default=str))
'''


def run(cmd, cwd=None, timeout=120):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)


def res(status, note=""):
    return {"status": status, "note": note}


def same(a, b):
    return os.path.exists(a) and os.path.exists(b) and run(["cmp", "-s", a, b]).returncode == 0


def find_mp4(run_dir, name):
    c = sorted(glob.glob(f"{run_dir}/media/videos/**/1080p60/{name}", recursive=True))
    c = [x for x in c if "partial_movie_files" not in x]
    return c[0] if c else None


def duration(mp4):
    r = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4])
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def storyboard_colors(path):
    cols = {}
    for line in open(path, encoding="utf-8"):
        m = re.match(r"\|\s*([A-Z_]+)\s*\|\s*`(#[0-9A-Fa-f]{6})`", line)
        if m:
            cols[m.group(1)] = m.group(2).upper()
    return cols


def review_check(d, pats):
    miss = [p for p in pats if not glob.glob(f"{d}/{p}")]
    return res("pass" if not miss else "fail", "missing: " + ", ".join(miss) if miss else "all present")


def s4_range(text):
    a = text.find("class S4Quality(BrandScene):")
    b = text.find("class S5Specificity(BrandScene):")
    return a, b


def top_defs(tree):
    """signature map for top-level funcs/classes/methods + dump map + assignment dump."""
    sigs, dumps, assigns = {}, {}, {}
    def add(prefix, node):
        key = prefix + node.name
        sigs[key] = ast.unparse(node.args)
        dumps[key] = ast.dump(node)
    for n in tree.body:
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            add("", n)
        elif isinstance(n, ast.ClassDef):
            sigs[n.name] = "class(" + ",".join(ast.unparse(b) for b in n.bases) + ")"
            dumps[n.name] = None
            for m in n.body:
                if isinstance(m, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    add(n.name + ".", m)
        elif isinstance(n, (ast.Assign, ast.AnnAssign)):
            assigns[ast.unparse(n.targets[0] if isinstance(n, ast.Assign) else n.target)] = ast.dump(n)
    return sigs, dumps, assigns


def check_r1(d, mp4, dur):
    c = {}
    c["review_images"] = review_check(d, R1_REVIEW)
    cfgp = f"{WORK}/probe_cfg_r1.json"
    sb = storyboard_colors(f"{d}/STORYBOARD.md")
    json.dump({"names": R1_NAMES, "spec": SPEC, "bs_methods": BRANDSCENE_METHODS, "mspec": METHOD_SPEC,
               "colors": list(sb)}, open(cfgp, "w"), ensure_ascii=False)
    pp = f"{WORK}/probe.py"
    open(pp, "w").write(PROBE)
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    try:
        r = subprocess.run([f"{d}/env/bin/python", pp, cfgp], cwd=d, capture_output=True, text=True, timeout=120, env=env)
        line = [l for l in r.stdout.splitlines() if l.startswith("{")]
        P = json.loads(line[-1]) if line else {"import_error": (r.stderr or r.stdout)[-300:]}
    except Exception as e:
        P = {"import_error": repr(e)}
    if "import_error" in P:
        c["style_import"] = res("fail", P["import_error"])
        for k in ("names_exist", "brandscene_methods", "signatures", "grade", "steps", "colors"):
            c[k] = res("unknown", "style.py not importable")
    else:
        c["style_import"] = res("pass")
        c["names_exist"] = res("pass" if not P["missing"] else "fail", "missing: " + ", ".join(P["missing"]) if P["missing"] else "")
        c["brandscene_methods"] = res("pass" if not P["bs_missing"] else "fail", "missing: " + ", ".join(P["bs_missing"]) if P["bs_missing"] else "")
        diffs, notes, sigs = [], [], {}
        for n, v in list(P["funcs"].items()) + [("BrandScene." + k, v) for k, v in P["methods"].items()]:
            sigs[n] = v["sig"]
            diffs += [f"{n}: {x}" for x in v["diffs"]]
            notes += [f"{n}: {x}" for x in v["notes"]]
        c["signatures"] = res("pass" if not diffs else "fail", "; ".join(diffs) if diffs else "all match")
        c["signatures"]["notes"] = notes
        c["signatures"]["actual"] = sigs
        c["grade"] = res("pass" if P["grade_ok"] else ("unknown" if P["grade_ok"] is None else "fail"), P["grade_repr"])
        st = P["steps"]
        c["steps"] = res("pass" if st == [list(x) for x in STEPS_SPEC] else "fail", "" if st == [list(x) for x in STEPS_SPEC] else json.dumps(st, ensure_ascii=False))
        bad = [f"{n}: {P['colors'][n]} != {v}" for n, v in sb.items() if P["colors"].get(n) != v and n != "BEAD"]
        bead = P["colors"].get("BEAD")
        note = f"BEAD(gradient in spec #C9A27E) actual={bead}"
        c["colors"] = res("pass" if not bad else "fail", ("; ".join(bad) + " | " if bad else "") + note)
    # assets
    from PIL import Image
    a = {}
    for f, size, mode in (("bg.png", (1920, 1080), None), ("logo_light.png", None, "RGBA"), ("logo_mark.png", None, "RGBA")):
        p = f"{d}/assets/{f}"
        if not os.path.exists(p):
            a[f] = "missing"; continue
        try:
            im = Image.open(p)
            ok = (size is None or im.size == size) and (mode is None or im.mode == mode)
            a[f] = ("ok " if ok else "BAD ") + f"{im.size} {im.mode}"
        except Exception as e:
            a[f] = "BAD " + repr(e)
    allok = all(v.startswith("ok") for v in a.values())
    c["assets"] = res("pass" if allok else "fail", "; ".join(f"{k}: {v}" for k, v in a.items()))
    c["make_assets_exists"] = res("pass" if os.path.exists(f"{d}/assets/make_assets.py") else "fail")
    c["style_demo_exists"] = res("pass" if os.path.exists(f"{d}/style_demo.py") else "fail")
    if dur is None:
        c["duration_le_15s"] = res("unknown", "no mp4")
    else:
        c["duration_le_15s"] = res("pass" if dur <= 15 else "fail", f"{dur:.2f}s")
    ch = [f for f in ("scenes_a.py", "scenes_b.py", "make_music.py", "assemble.sh", "add_music.sh", "render_hq.sh") if not same(f"{d}/{f}", f"{V1}/{f}")]
    c["baseline_untouched"] = res("pass" if not ch else "fail", "changed: " + ", ".join(ch) if ch else "all 6 identical")
    return c


def check_r2(d, mp4, dur):
    c = {}
    c["review_images"] = review_check(d, R2_REVIEW)
    base_a = open(f"{BASE}/scenes_a.py", encoding="utf-8").read()
    run_a = open(f"{d}/scenes_a.py", encoding="utf-8").read()
    ba, bb = s4_range(base_a)
    ra, rb = s4_range(run_a)
    if min(ba, bb, ra, rb) < 0:
        c["scenes_a_outside_s4"] = res("fail", "S4/S5 markers not found in run or baseline")
    else:
        ok = base_a[:ba] == run_a[:ra] and base_a[bb:] == run_a[rb:]
        c["scenes_a_outside_s4"] = res("pass" if ok else "fail", "identical outside S4 range" if ok else "differs outside S4 range")
    c["scenes_b_untouched"] = res("pass" if same(f"{d}/scenes_b.py", f"{BASE}/scenes_b.py") else "fail")
    # style.py
    bs_p, rs_p = f"{BASE}/style.py", f"{d}/style.py"
    if same(rs_p, bs_p):
        c["style_py"] = res("pass", "unchanged")
    else:
        try:
            bsig, bdump, bass = top_defs(ast.parse(open(bs_p, encoding="utf-8").read()))
            rsig, rdump, rass = top_defs(ast.parse(open(rs_p, encoding="utf-8").read()))
            sigchg = [k for k in bsig if k not in rsig or rsig[k] != bsig[k]]
            bodychg = [k for k in bdump if bdump[k] is not None and k in rdump and rdump[k] != bdump[k] and k not in sigchg]
            asschg = [k for k in bass if rass.get(k) != bass[k]]
            added = [k for k in rsig if k not in bsig] + [k for k in rass if k not in bass]
            if sigchg or bodychg or asschg:
                msg = []
                if sigchg: msg.append("signature changed/removed: " + ", ".join(sigchg))
                if bodychg: msg.append("body changed: " + ", ".join(bodychg))
                if asschg: msg.append("assignment changed: " + ", ".join(asschg))
                c["style_py"] = res("fail", "modified existing definitions; " + "; ".join(msg))
            else:
                c["style_py"] = res("pass", "additions only: " + ", ".join(added) if added else "text changed, AST-equivalent for defs")
        except Exception as e:
            c["style_py"] = res("unknown", repr(e))
    # S4Quality
    if dur is None:
        c["s4_duration_15_20s"] = res("unknown", "no mp4")
    else:
        c["s4_duration_15_20s"] = res("pass" if 15 <= dur <= 20 else "fail", f"{dur:.2f}s")
    try:
        tree = ast.parse(run_a)
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "S4Quality")
    except Exception as e:
        cls = None
        for k in ("s4_chapter2", "s4_finish", "s4_captions", "s4_digit_leak"):
            c[k] = res("unknown", "S4Quality not parsed: " + repr(e))
        return c
    src = ast.get_source_segment(run_a, cls) or ""
    c["s4_chapter2"] = res("pass" if "self.chapter(2)" in src else "fail")
    c["s4_finish"] = res("pass" if "self.finish()" in src else "fail")
    # captions
    sb = open(f"{d}/STORYBOARD.md", encoding="utf-8").read()
    i = sb.find("### S4Quality")
    sec = sb[i:sb.find("### S5Specificity", i)]
    want = [re.sub(r"[【】]", "", m.group(1)).strip() for m in re.finditer(r"^\d+\.\s*(.+)$", sec, re.M)]
    got, dyn = [], 0
    for n in ast.walk(cls):
        if isinstance(n, ast.Call) and ((isinstance(n.func, ast.Attribute) and n.func.attr == "cap") or (isinstance(n.func, ast.Name) and n.func.id == "cap")):
            a0 = n.args[0] if n.args else None
            if isinstance(a0, ast.Constant) and isinstance(a0.value, str):
                got.append(re.sub(r"[【】]", "", a0.value).strip())  # style.cap treats 【】 as highlight markup
            else:
                dyn += 1
    issues = []
    sp = lambda x: re.sub(r"\s+", "", x)
    ws_only = [g for g in got if g not in want and sp(g) in [sp(w) for w in want]]
    for k, w in enumerate(want):
        if w not in got and sp(w) not in [sp(g) for g in got]:
            issues.append(f"missing caption {k+1}: {w}")
    for g in got:
        if g not in want and sp(g) not in [sp(w) for w in want]:
            issues.append(f"extra/different cap: {g}")
    if len(got) != len(want):
        issues.append(f"cap count {len(got)} vs {len(want)}")
    if dyn:
        issues.append(f"{dyn} non-literal cap() call(s)")
    c["s4_captions"] = res("pass" if not issues else "fail", "; ".join(issues) if issues else "4/4 match")
    c["s4_captions"]["found"] = got
    if ws_only and not issues:
        c["s4_captions"]["note"] = "match ignoring whitespace only; whitespace differs in: " + " | ".join(ws_only)
    # digit leak
    leaks = []
    for n in ast.walk(cls):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and re.search(r"[\u4e00-\u9fff]", n.value):
            t = re.sub(r"[1-4]\s*[–-]\s*[1-4]\s*级", "", n.value)
            t = re.sub(r"[1-4]\s*级", "", t)
            t = re.sub(r"\b0\d\b", "", t)
            if re.search(r"\d", t):
                leaks.append(n.value)
    c["s4_digit_leak"] = res("pass" if not leaks else "unknown", "no stray digits" if not leaks else "possible leaks (manual review): " + " | ".join(leaks))
    c["s4_digit_leak"]["literals"] = leaks
    return c


def sheet_and_frames(mp4, out_dir, dur, ratios, tag):
    from PIL import Image, ImageDraw, ImageFont
    tmp = f"{WORK}/frames_{tag}"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    run(["ffmpeg", "-v", "error", "-i", mp4, "-vf", "fps=1,scale=640:-1", f"{tmp}/f_%04d.png"], timeout=300)
    files = sorted(glob.glob(f"{tmp}/f_*.png"))
    if files:
        ims = [Image.open(f).convert("RGB") for f in files]
        w, h = ims[0].size
        lab = 30
        rows = (len(ims) + 2) // 3
        sheet = Image.new("RGB", (3 * w, rows * (h + lab)), (16, 16, 16))
        dr = ImageDraw.Draw(sheet)
        font = ImageFont.load_default()
        for fp in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",):
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, 20)
        for k, im in enumerate(ims):
            x, y = (k % 3) * w, (k // 3) * (h + lab)
            sheet.paste(im, (x, y))
            dr.text((x + 8, y + h + 4), f"{k} s", fill=(235, 235, 235), font=font)
        sheet.save(f"{out_dir}/sheet.png")
    for k, r in enumerate(ratios, 1):
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{dur * r:.3f}", "-i", mp4, "-frames:v", "1", f"{out_dir}/frame_{k}.png"], timeout=120)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    rng = random.Random(SEED)
    key, results = {}, {}
    shutil.rmtree(BLIND, ignore_errors=True)
    os.makedirs(BLIND)
    os.makedirs(os.path.dirname(KEY), exist_ok=True)
    codes = {}
    for t in ("R1", "R2"):
        rs = [r for r in RUNS if r.startswith(t)]
        rng.shuffle(rs)
        for letter, r in zip("ABCDEF", rs):
            codes[r] = f"{t}-{letter}"
    json.dump({codes[r]: r for r in sorted(codes, key=lambda x: codes[x])}, open(KEY, "w"), indent=1)
    for r in RUNS:
        d = f"{ROOT}/{r}"
        t = r[:2]
        name = "StyleDemo.mp4" if t == "R1" else "S4Quality.mp4"
        mp4 = find_mp4(d, name)
        dur = duration(mp4) if mp4 else None
        rec = {"run": r, "blind_code": codes[r], "mp4": mp4 or "MISSING", "ffprobe_duration": dur}
        rec["checks"] = check_r1(d, mp4, dur) if t == "R1" else check_r2(d, mp4, dur)
        results[r] = rec
        od = f"{BLIND}/{codes[r]}"
        os.makedirs(od)
        if mp4 and dur:
            sheet_and_frames(mp4, od, dur, (0.2, 0.5, 0.75, 0.9) if t == "R1" else (0.3, 0.55, 0.75, 0.9), codes[r])
            open(f"{od}/duration.txt", "w").write(f"{dur:.2f}\n")
        else:
            open(f"{od}/MISSING.txt", "w").write("1080p video missing\n")
    json.dump(results, open(f"{EVAL}/checks.json", "w"), ensure_ascii=False, indent=1)
    # markdown
    L = ["# Objective checks (unblinded)\n"]
    for t in ("R1", "R2"):
        rs = [r for r in RUNS if r.startswith(t)]
        keys = list(results[rs[0]]["checks"].keys())
        L.append(f"\n## {t}\n")
        L.append("| check | " + " | ".join(rs) + " |")
        L.append("|---|" + "---|" * len(rs))
        L.append("| duration | " + " | ".join(f"{results[r]['ffprobe_duration']:.2f}" if results[r]["ffprobe_duration"] else "MISSING" for r in rs) + " |")
        for k in keys:
            L.append(f"| {k} | " + " | ".join(results[r]["checks"][k]["status"] for r in rs) + " |")
        L.append("\n### Details\n")
        for r in rs:
            L.append(f"**{r}** mp4: `{results[r]['mp4']}`")
            for k, v in results[r]["checks"].items():
                if v["note"] or v.get("notes"):
                    L.append(f"- {k} [{v['status']}]: {v['note']}")
                    if v.get("notes"):
                        L.append(f"  - notes: {'; '.join(v['notes'])}")
            L.append("")
    open(f"{EVAL}/checks.md", "w", encoding="utf-8").write("\n".join(L))
    print("done")


if __name__ == "__main__":
    main()
